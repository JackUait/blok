//! Loopback helpers: a real blok-http server, raw requests, parsed answers,
//! and C# HistoryApp, the routes over a room manager on the built-in
//! journal.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_auth::{Authorization, BoxFuture as AuthFuture, Error as AuthError, User};
use blok_collab::{BoxFuture, CloseReason, Member, Membership, OperationSource};
use blok_collab_convert::{
    DocConverter, EditError, EditOp, RichTextHtml, RichTextHtmlSlot, RuntimeHtmlReader, SlotStep,
    TransientError,
};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo};
use blok_collab_operation::{
    AppendOutcome, AppendResult, Candidate, Checkpoint, Head, Lookup, OpenResult, Record, Reset,
};
use blok_collab_room::{
    Converter, Endpoint, Error, Headers, HistoryConverter, HistoryStore, LocalJournal, Manager,
    ManagerOptions, Opened, OperationSession, OperationStore, Options as RoomOptions, PurgeStore,
    Records,
};
use blok_collab_wire::Message;
use blok_collab_workingset::LocalStore;
use blok_http::{Config as HttpConfig, Handler, Request, ResponseWriter, Server};
use blok_jsjson::{Node, Object, Options as JsonOptions, Str, Value, parse_node};
use blok_jsruntime::{
    Failure as RuntimeFailure, InvokeError, Kind as FailureKind, Options as PoolOptions, Pool,
};
use blok_route::Router;
use blok_yjs::Doc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::{Config, Handlers};

pub struct Running {
    pub address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start(handler: impl Handler) -> Running {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, HttpConfig::default());
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    Running { address, task }
}

#[derive(Debug)]
pub struct Answer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Answer {
    pub fn header(&self, name: &str) -> &str {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map_or("", |(_, v)| v.as_str())
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Sends head lines (no blank line) and body on a fresh connection, with
/// Connection: close and a Content-Length for the body.
pub async fn send(address: SocketAddr, head: &str, body: &[u8]) -> Answer {
    let conn = TcpStream::connect(address).await.unwrap();
    let mut request = format!(
        "{head}\r\nHost: x\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )
    .into_bytes();
    request.extend_from_slice(body);
    let (mut read, mut write) = conn.into_split();
    let writer = tokio::spawn(async move {
        let _ = write.write_all(&request).await;
        write
    });
    let answer = read_answer(&mut read).await;
    writer.abort();
    answer
}

async fn read_answer(conn: &mut (impl AsyncReadExt + Unpin)) -> Answer {
    let mut bytes = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(30), conn.read_to_end(&mut bytes)).await;
    let end = find(&bytes, b"\r\n\r\n").expect("a response head");
    let head = String::from_utf8_lossy(&bytes[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap()[9..12].parse().unwrap();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(": "))
        .map(|(n, v)| (n.to_owned(), v.to_owned()))
        .collect();
    let mut rest = &bytes[end + 4..];
    let mut body = Vec::new();
    let chunked = headers
        .iter()
        .any(|(n, v)| n.eq_ignore_ascii_case("transfer-encoding") && v == "chunked");
    if chunked {
        while let Some(line_end) = find(rest, b"\r\n") {
            let size =
                usize::from_str_radix(&String::from_utf8_lossy(&rest[..line_end]), 16).unwrap();
            rest = &rest[line_end + 2..];
            if size == 0 {
                break;
            }
            body.extend_from_slice(&rest[..size]);
            rest = &rest[size + 2..];
        }
    } else {
        body.extend_from_slice(rest);
    }
    Answer {
        status,
        headers,
        body,
    }
}

/// A fresh directory under the system temp dir.
pub fn temp_dir() -> PathBuf {
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).unwrap();
    let hex: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("blok-collabhttp-test-{hex}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn runtime_reader() -> &'static RuntimeHtmlReader<Pool> {
    static READER: OnceLock<RuntimeHtmlReader<Pool>> = OnceLock::new();
    READER.get_or_init(|| RuntimeHtmlReader {
        runtime: Pool::new(PoolOptions {
            pool_size: Some(1),
            ..PoolOptions::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    })
}

/// What the failing converter throws.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    None,
    Transient,
    NotJson,
}

fn failure_error(failure: Failure) -> Option<Error> {
    match failure {
        Failure::None => None,
        Failure::Transient => Some(Error::Convert(blok_collab_convert::Error::Transient(
            TransientError {
                message: "collab: the runtime timed out".to_owned(),
                err: Box::new(blok_collab_convert::Error::Message(
                    "collab: the runtime timed out".to_owned(),
                )),
            },
        ))),
        Failure::NotJson => Some(Error::message("not JSON")),
    }
}

/// How the next edit's apply fails: C#'s NextEditFailure.
pub enum EditFailure {
    Transient,
    Refused(&'static str),
    /// A refusal whose cause is the runtime's DocumentTooLarge.
    TooLarge(&'static str),
}

/// C# FailingConverter over the real converter.
pub struct FailingConverter {
    inner: DocConverter<&'static RuntimeHtmlReader<Pool>>,
    state: Mutex<(Failure, Option<String>)>,
    pub next_edit: Mutex<Option<EditFailure>>,
    pub apply_calls: AtomicUsize,
}

impl FailingConverter {
    pub fn set(&self, failure: Failure, resolved_blob: Option<String>) {
        *self.state.lock().unwrap_or_else(PoisonError::into_inner) = (failure, resolved_blob);
    }

    fn state(&self) -> (Failure, Option<String>) {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Converter for FailingConverter {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        Converter::seed(&self.inner, doc, output_data)
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        Box::pin(async move {
            if let Some(err) = failure_error(self.state().0) {
                return Err(err);
            }
            Converter::export(&self.inner, doc).await
        })
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            self.apply_calls.fetch_add(1, Ordering::SeqCst);
            let next = self
                .next_edit
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take();
            match next {
                Some(EditFailure::Transient) => Err(failure_error(Failure::Transient).unwrap()),
                Some(EditFailure::Refused(message)) => Err(Error::Convert(
                    blok_collab_convert::Error::Edit(EditError::new(message)),
                )),
                Some(EditFailure::TooLarge(message)) => Err(Error::Convert(
                    blok_collab_convert::Error::Edit(EditError {
                        message: message.to_owned(),
                        err: Some(Box::new(blok_collab_convert::Error::Runtime(
                            InvokeError::Failure(RuntimeFailure {
                                kind: FailureKind::DocumentTooLarge,
                                err: blok_jsruntime::Error::Engine("too large".to_owned()),
                            }),
                        ))),
                    }),
                )),
                None => Converter::apply_ops(&self.inner, doc, ops).await,
            }
        })
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        Converter::migrate_rich_text(&self.inner, doc)
    }
    fn history(&self) -> Option<&dyn HistoryConverter> {
        Some(self)
    }
}

impl HistoryConverter for FailingConverter {
    /// While a blob is set, every rawblob's blob reads as HTML, a row that
    /// grows only once its HTML is read.
    fn export_blocks(
        &self,
        doc: &Doc,
        warned: &mut HashSet<String>,
    ) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), Error> {
        let (failure, blob) = self.state();
        if let Some(err) = failure_error(failure) {
            return Err(err);
        }
        let (blocks, slots) = HistoryConverter::export_blocks(&self.inner, doc, warned)?;
        if blob.is_none() {
            return Ok((blocks, slots));
        }
        let mut slots = Vec::new();
        for (index, block) in blocks.iter().enumerate() {
            let Value::Object(object) = block else {
                continue;
            };
            if object.get(&Str::from("type")) != Some(&Value::String(Str::from("rawblob"))) {
                continue;
            }
            let Some(Value::Object(data)) = object.get(&Str::from("data")) else {
                continue;
            };
            let Some(Value::String(html)) = data.get(&Str::from("blob")) else {
                continue;
            };
            slots.push(RichTextHtmlSlot {
                path: vec![SlotStep::Index(index), SlotStep::Key(Str::from("data"))],
                key: Str::from("blob"),
                html: RichTextHtml {
                    kind: Str::from("rawblob"),
                    field: Str::from("blob"),
                    html: html.clone(),
                },
            });
        }
        Ok((blocks, slots))
    }

    fn resolve<'a>(
        &'a self,
        blocks: &'a mut [Value],
        slots: &'a [RichTextHtmlSlot],
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move {
            if let Some(blob) = self.state().1 {
                for slot in slots {
                    if let Some(target) = slot.target_mut(blocks) {
                        target.set(slot.key.clone(), Value::String(Str::from(blob.as_str())));
                    }
                }
                return Ok(());
            }
            HistoryConverter::resolve(&self.inner, blocks, slots).await
        })
    }
}

/// A doc endpoint holding one paragraph "one"; C#'s FakeDocEndpointClient
/// counts its loads and can fail them.
#[derive(Default)]
pub struct HeldDocument {
    pub gets: AtomicUsize,
    pub saves: AtomicUsize,
    pub load_fails: AtomicBool,
}

impl Endpoint for HeldDocument {
    fn load<'a>(&'a self, _doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, Error>> {
        Box::pin(async move {
            self.gets.fetch_add(1, Ordering::SeqCst);
            if self.load_fails.load(Ordering::SeqCst) {
                return Err(Error::message("the records are down"));
            }
            let data = parse_node(
                br#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"one"}}]}"#,
                JsonOptions {
                    max_depth: 64,
                    ..JsonOptions::default()
                },
            )
            .map_err(|err| Error::message(err.to_string()))?;
            Ok(Loaded {
                data: Some(data),
                version: None,
            })
        })
    }
    fn save<'a>(
        &'a self,
        _doc_id: &'a str,
        _output_data: &'a Value,
        _version: Option<&'a str>,
        _projection: Option<&'a Projection>,
    ) -> BoxFuture<'a, Result<Option<String>, Error>> {
        self.saves.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { Ok(None) })
    }
}

fn corrupt() -> Error {
    Error::Journal(blok_collab_journal::Error::InvalidData {
        message: "collab: the record is corrupt.".to_owned(),
        source: None,
    })
}

/// Switches on a session's appends: C#'s BeforeAppend and
/// NextAppendOutcome.
#[derive(Default)]
pub struct AppendHook {
    /// The next append waits for `release` after notifying `entered`.
    pub hold: AtomicBool,
    pub entered: tokio::sync::Notify,
    pub release: tokio::sync::Notify,
    /// The next append answers Duplicate without writing.
    pub duplicate: AtomicBool,
}

struct HookedSession {
    inner: Arc<dyn OperationSession>,
    hook: Arc<AppendHook>,
}

impl OperationSession for HookedSession {
    fn open_result(&self) -> &OpenResult {
        self.inner.open_result()
    }
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        self.inner.find_committed(ctx, operation_id, digest)
    }
    fn append<'a>(
        &'a self,
        ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        Box::pin(async move {
            if self.hook.hold.swap(false, Ordering::SeqCst) {
                self.hook.entered.notify_one();
                self.hook.release.notified().await;
            }
            if self.hook.duplicate.swap(false, Ordering::SeqCst) {
                return Ok(AppendResult {
                    outcome: AppendOutcome::Duplicate,
                    sequence: 0,
                });
            }
            self.inner.append(ctx, candidate).await
        })
    }
    fn write_checkpoint<'a>(
        &'a self,
        ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        self.inner.write_checkpoint(ctx, checkpoint)
    }
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        self.inner.reset(ctx, reset)
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        self.inner.close()
    }
}

/// The built-in journal with C#'s CorruptRecords, CorruptLineages,
/// HeaderSpacing and LineagesAsked on its history reads.
pub struct TestJournal {
    inner: LocalJournal,
    pub corrupt_records: AtomicBool,
    pub corrupt_lineages: AtomicBool,
    /// False makes it a journal that keeps no history.
    pub keeps_history: bool,
    /// Header N reads as committed at the Unix epoch plus N times this.
    pub header_spacing: Mutex<Option<Duration>>,
    pub lineages_asked: Mutex<Vec<String>>,
    pub hook: Arc<AppendHook>,
}

impl TestJournal {
    fn asked(&self, lineage: &str) {
        self.lineages_asked.lock().unwrap().push(lineage.to_owned());
    }

    /// The current lineage's records of doc, read past the switches.
    pub fn committed(&self, doc: &str) -> Vec<Record> {
        let ctx = Context::background();
        let lineages = self.inner.list_lineages(&ctx, doc).unwrap();
        let Some(current) = lineages.iter().find(|info| info.current) else {
            return Vec::new();
        };
        self.inner
            .read_records(&ctx, doc, &current.lineage, u64::MAX)
            .map(Result::unwrap)
            .collect()
    }
}

impl OperationStore for TestJournal {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        Box::pin(async move {
            let (outcome, session) = self.inner.open(ctx, doc_id).await?;
            let session = session.map(|inner| {
                Arc::new(HookedSession {
                    inner,
                    hook: self.hook.clone(),
                }) as Arc<dyn OperationSession>
            });
            Ok((outcome, session))
        })
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(&self.inner)
    }
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        if self.keeps_history { Some(self) } else { None }
    }
    fn type_name(&self) -> &'static str {
        "TestJournal"
    }
}

impl HistoryStore for TestJournal {
    fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, Error> {
        self.inner.is_purged(ctx, doc_id)
    }
    fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, Error> {
        if self.corrupt_lineages.load(Ordering::SeqCst) {
            return Err(corrupt());
        }
        self.inner.list_lineages(ctx, doc_id)
    }
    fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, Error> {
        self.asked(lineage);
        self.inner.read_baseline(ctx, doc_id, lineage)
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        self.asked(lineage);
        let headers = self.inner.read_headers(ctx, doc_id, lineage);
        let Some(spacing) = *self.header_spacing.lock().unwrap() else {
            return headers;
        };
        Box::new(headers.map(move |header| {
            header.map(|mut header| {
                header.committed_at = UNIX_EPOCH + spacing * header.sequence as u32;
                header
            })
        }))
    }
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
        self.asked(lineage);
        if self.corrupt_records.load(Ordering::SeqCst) {
            return Box::new(std::iter::once(Err(corrupt())));
        }
        self.inner.read_records(ctx, doc_id, lineage, through)
    }
    fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, Error> {
        self.asked(lineage);
        self.inner.delete_lineage(ctx, doc_id, lineage)
    }
}

/// C# RecordingAuthorization: both gates on by default, every call kept as
/// (gate, user id, doc).
pub struct RecordingAuthorization {
    pub allow_read: AtomicBool,
    pub allow_write: AtomicBool,
    pub calls: Mutex<Vec<(String, String, String)>>,
    /// The Tenant the host attached, per call ("" for none).
    pub tenants: Mutex<Vec<String>>,
}

/// A value the host attaches from X-Tenant, as a C# host adds a claim.
pub struct Tenant(pub String);

impl RecordingAuthorization {
    pub fn new(read: bool, write: bool) -> Arc<Self> {
        Arc::new(Self {
            allow_read: AtomicBool::new(read),
            allow_write: AtomicBool::new(write),
            calls: Mutex::default(),
            tenants: Mutex::default(),
        })
    }

    pub fn set(&self, read: bool, write: bool) {
        self.allow_read.store(read, Ordering::SeqCst);
        self.allow_write.store(write, Ordering::SeqCst);
    }

    pub fn calls(&self) -> Vec<(String, String, String)> {
        self.calls.lock().unwrap().clone()
    }

    fn answer(
        &self,
        gate: &str,
        user: &User,
        doc: &str,
        request: &blok_auth::Extensions,
        allowed: &AtomicBool,
    ) -> bool {
        let tenant = request.get::<Tenant>().map(|t| t.0.clone());
        self.tenants
            .lock()
            .unwrap()
            .push(tenant.unwrap_or_default());
        self.calls
            .lock()
            .unwrap()
            .push((gate.to_owned(), user.id.clone(), doc.to_owned()));
        allowed.load(Ordering::SeqCst)
    }
}

impl Authorization for RecordingAuthorization {
    fn can_read_document<'a>(
        &'a self,
        user: &'a User,
        document_id: &'a str,
        request: &'a blok_auth::Extensions,
    ) -> AuthFuture<'a, Result<bool, AuthError>> {
        Box::pin(
            async move { Ok(self.answer("read", user, document_id, request, &self.allow_read)) },
        )
    }
    fn can_write_document<'a>(
        &'a self,
        user: &'a User,
        document_id: &'a str,
        request: &'a blok_auth::Extensions,
    ) -> AuthFuture<'a, Result<bool, AuthError>> {
        Box::pin(
            async move { Ok(self.answer("write", user, document_id, request, &self.allow_write)) },
        )
    }
}

/// What an app is started with.
#[derive(Default)]
pub struct AppOptions {
    /// The built-in journal; without it the rooms keep no journal.
    pub journal: bool,
    pub ticket_mode: bool,
    pub authorization: Option<Arc<RecordingAuthorization>>,
    /// Any other hook; it wins over `authorization`.
    pub policy: Option<Arc<dyn Authorization>>,
    /// None keeps the room's default, as the C# harness does.
    pub retry_backoff: Option<Duration>,
    /// The journal keeps no history.
    pub no_history: bool,
    /// Where the journal lives; a fresh directory when None.
    pub journal_dir: Option<PathBuf>,
}

pub struct App {
    pub running: Running,
    pub converter: Arc<FailingConverter>,
    pub endpoint: Arc<HeldDocument>,
    pub journal: Option<Arc<TestJournal>>,
    pub manager: Manager,
    pub corrupt: Arc<Mutex<Vec<String>>>,
    keys: Mutex<usize>,
}

/// C# HistoryApp.StartAsync: the routes over a room manager on the built-in
/// journal.
pub async fn start_history() -> App {
    start_app(AppOptions {
        journal: true,
        ..AppOptions::default()
    })
    .await
}

/// Test headers the app's own middleware reads, standing in for the
/// server's guard: X-User signs a caller in (ticket mode takes X-Doc as
/// the pass's doc claim); Origin is echoed as an allowed CORS origin.
pub async fn start_app(options: AppOptions) -> App {
    let converter = Arc::new(FailingConverter {
        inner: DocConverter {
            now: Box::new(SystemTime::now),
            html: runtime_reader(),
            fields: None,
            log: None,
        },
        state: Mutex::new((Failure::None, None)),
        next_edit: Mutex::new(None),
        apply_calls: AtomicUsize::new(0),
    });
    let endpoint = Arc::new(HeldDocument::default());
    let mut room = RoomOptions::default();
    if let Some(backoff) = options.retry_backoff {
        room.retry_backoff = backoff;
    }
    let journal = options.journal.then(|| {
        let dir = options.journal_dir.clone().unwrap_or_else(temp_dir);
        let store = blok_collab_journal::Store::new(dir, Default::default()).unwrap();
        room.max_update_bytes = store.max_update_bytes();
        Arc::new(TestJournal {
            inner: LocalJournal(store),
            corrupt_records: AtomicBool::new(false),
            corrupt_lineages: AtomicBool::new(false),
            keeps_history: !options.no_history,
            header_spacing: Mutex::new(None),
            lineages_asked: Mutex::new(Vec::new()),
            hook: Arc::default(),
        })
    });
    let mut o = ManagerOptions::new(
        Arc::new(LocalStore::new(temp_dir(), None)),
        endpoint.clone(),
        converter.clone(),
    );
    o.room = room;
    o.operations = journal
        .clone()
        .map(|journal| journal as Arc<dyn OperationStore>);
    let manager = Manager::new(o);
    let rooms = manager.clone();
    let corrupt = Arc::new(Mutex::new(Vec::new()));
    let logged = corrupt.clone();
    let routes = Handlers::new(Config {
        ticket_mode: options.ticket_mode,
        authorization: options.policy.or(options
            .authorization
            .map(|hook| hook as Arc<dyn Authorization>)),
        rooms: Arc::new(move || Ok(rooms.clone())),
        max_message_bytes: 8 << 20,
        corrupt_log: Some(Arc::new(move |doc: &str| {
            logged.lock().unwrap().push(doc.to_owned());
        })),
        enforce_restore_guards: false,
        stamp_authority: false,
    });
    let mut router = Router::new();
    for (pattern, method, which) in [
        ("/sync/{doc}/edit", "POST", Route::Edit),
        ("/sync/{doc}/state", "GET", Route::State),
        ("/sync/{doc}/reset", "POST", Route::Reset),
        ("/sync/{doc}/history", "GET", Route::List),
        (
            "/sync/{doc}/history/{lineage}/{sequence}",
            "GET",
            Route::Read,
        ),
        ("/sync/{doc}/history/{lineage}", "DELETE", Route::Delete),
        (
            "/sync/{doc}/history/{lineage}/{sequence}/changes",
            "GET",
            Route::Changes,
        ),
        (
            "/sync/{doc}/history/{lineage}/{sequence}/restore",
            "POST",
            Route::Restore,
        ),
        (
            "/sync/{doc}/history/{lineage}/{sequence}/restore/preview",
            "POST",
            Route::Preview,
        ),
        ("/sync/{doc}/history/at", "GET", Route::At),
        ("/sync/{doc}/history/changes", "GET", Route::Range),
    ] {
        let routes = routes.clone();
        router.handle(
            pattern,
            Some(&[method]),
            move |mut request: Request, mut response: ResponseWriter| {
                let routes = routes.clone();
                if let Some(tenant) = request.headers().get("X-Tenant").map(str::to_owned) {
                    request.extensions.insert(Tenant(tenant));
                }
                if let Some(id) = request.headers().get("X-User").map(str::to_owned) {
                    let doc = request.headers().get("X-Doc").unwrap_or("").to_owned();
                    request.extensions.insert(User {
                        name: id.clone(),
                        id,
                        doc,
                        write: true,
                        authenticated: true,
                    });
                }
                if let Some(origin) = request.headers().get("Origin") {
                    response
                        .headers_mut()
                        .set("Access-Control-Allow-Origin", origin);
                }
                async move {
                    match which {
                        Route::Edit => routes.edit(request, response).await,
                        Route::State => routes.state(request, response).await,
                        Route::Reset => routes.reset(request, response).await,
                        Route::List => routes.history_list(request, response).await,
                        Route::Read => routes.history_read(request, response).await,
                        Route::Delete => routes.history_delete(request, response).await,
                        Route::Changes => routes.history_changes(request, response).await,
                        Route::Restore => routes.history_restore(request, response).await,
                        Route::Preview => routes.history_restore_preview(request, response).await,
                        Route::At => routes.history_at(request, response).await,
                        Route::Range => routes.history_changes_between(request, response).await,
                    }
                }
            },
        );
    }
    App {
        running: start(router).await,
        converter,
        endpoint,
        journal,
        manager,
        corrupt,
        keys: Mutex::new(0),
    }
}

#[derive(Clone, Copy)]
enum Route {
    Edit,
    State,
    Reset,
    List,
    Read,
    Delete,
    Changes,
    Restore,
    Preview,
    At,
    Range,
}

impl App {
    /// One request to /sync/doc{path} with extra header lines.
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> Answer {
        let mut head = format!("{method} /sync/doc{path} HTTP/1.1");
        for (name, value) in headers {
            head.push_str(&format!("\r\n{name}: {value}"));
        }
        send(self.running.address, &head, body.as_bytes()).await
    }

    pub async fn send(
        &self,
        method: &str,
        path: &str,
        key: &str,
        if_match: &str,
        body: &str,
    ) -> Answer {
        let mut headers = Vec::new();
        if !key.is_empty() {
            headers.push(("Blok-Idempotency-Key", key));
        }
        if !if_match.is_empty() {
            headers.push(("If-Match", if_match));
        }
        self.request(method, path, &headers, body).await
    }

    /// Loads the room through /state and answers its lineage.
    pub async fn open(&self) -> String {
        let state = self.send("GET", "/state", "", "", "").await;
        assert_eq!(state.status, 200, "state = {}", state.text());
        state.header("Blok-Doc-Lineage").to_owned()
    }

    pub async fn blocks(&self) -> String {
        let state = self.send("GET", "/state", "", "", "").await;
        assert_eq!(state.status, 200, "state = {}", state.text());
        state.text()
    }

    pub async fn edit(&self, key: &str, body: &str) {
        let response = self.send("POST", "/edit", key, "", body).await;
        assert_eq!(response.status, 204, "edit {key} = {}", response.text());
    }

    pub async fn edit_text(&self, text: &str) {
        let n = {
            let mut keys = self.keys.lock().unwrap();
            *keys += 1;
            *keys
        };
        self.edit(
            &format!("text-{n}-{text}"),
            &format!(
                r#"{{ "ops": [ {{ "op": "update", "id": "a", "data": {{ "text": "{text}" }} }} ] }}"#
            ),
        )
        .await;
    }

    pub async fn restore(
        &self,
        lineage: &str,
        sequence: &str,
        key: &str,
        if_match: &str,
    ) -> Answer {
        self.send(
            "POST",
            &format!("/history/{lineage}/{sequence}/restore"),
            key,
            if_match,
            "",
        )
        .await
    }

    pub async fn drain(&self) {
        let _ = self.manager.drain().await;
    }

    /// Each block of a client doc as "id=text", read with the real
    /// converter.
    pub async fn export(&self, doc: &Doc) -> Vec<String> {
        let object = Converter::export(&self.converter.inner, doc)
            .await
            .unwrap_or_else(|err| panic!("{err}"));
        let Some(Value::Array(blocks)) = object.get(&Str::from("blocks")) else {
            panic!("no blocks");
        };
        let field = |value: &Value, key: &str| match value {
            Value::Object(object) => object.get(&Str::from(key)).cloned(),
            _ => None,
        };
        blocks
            .iter()
            .map(|block| {
                let text = field(block, "data").and_then(|data| field(&data, "text"));
                // Rich text reads as segments: [{"text": ..}, ..].
                let as_text = |value: Option<Value>| match value {
                    Some(Value::String(text)) => text.to_string(),
                    Some(Value::Array(segments)) => segments
                        .iter()
                        .filter_map(|segment| match field(segment, "text") {
                            Some(Value::String(text)) => Some(text.to_string()),
                            _ => None,
                        })
                        .collect(),
                    other => format!("{other:?}"),
                };
                format!("{}={}", as_text(field(block, "id")), as_text(text))
            })
            .collect()
    }

    /// Joins "doc" as a v1 blok-sync writer and syncs a fresh client doc.
    pub async fn connect(&self) -> (Arc<RecordingMember>, Box<dyn Membership>, Doc) {
        let member = Arc::new(RecordingMember::default());
        let joined = self
            .manager
            .join("doc", member.clone())
            .await
            .unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(joined.status, blok_collab::JoinStatus::Joined);
        let membership = joined.membership.expect("a membership");
        let mirror = Doc::new(blok_yjs::Options::default());
        let step1 = blok_collab_wire::encode(&Message::SyncStep1 {
            state_vector: mirror.encode_state_vector(),
        })
        .unwrap();
        membership.receive(step1).await.unwrap();
        let step2 = member
            .messages()
            .into_iter()
            .find_map(|message| match message {
                Message::SyncStep2 { update } => Some(update),
                _ => None,
            })
            .expect("a SyncStep2");
        mirror.apply_update(&step2).unwrap();
        member.clear();
        (member, membership, mirror)
    }

    /// Waits until /state's head reaches sequence: C# WaitForSequenceAsync.
    pub async fn wait_for_sequence(&self, sequence: u64) {
        for _ in 0..500 {
            let state = self.send("GET", "/state", "", "", "").await;
            if state
                .header("Blok-Doc-Sequence")
                .parse::<u64>()
                .unwrap_or(0)
                >= sequence
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the head never reached {sequence}");
    }
}

/// A v1 blok-sync member that keeps every frame and close it gets.
#[derive(Default)]
pub struct RecordingMember {
    messages: Mutex<Vec<Message>>,
    pub closed: Mutex<Vec<CloseReason>>,
}

impl RecordingMember {
    pub fn messages(&self) -> Vec<Message> {
        self.messages.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.messages.lock().unwrap().clear();
    }

    pub fn updates(&self) -> Vec<Vec<u8>> {
        self.messages()
            .into_iter()
            .filter_map(|message| match message {
                Message::SyncUpdate { update } => Some(update),
                _ => None,
            })
            .collect()
    }
}

impl Member for RecordingMember {
    fn can_write(&self) -> bool {
        true
    }
    fn accepts_control_frames(&self) -> bool {
        true
    }
    fn actor_id(&self) -> String {
        String::new()
    }
    fn protocol_source(&self) -> OperationSource {
        OperationSource::ClientV1
    }
    fn recheck_access(&self) -> BoxFuture<'_, Result<bool, blok_collab::Error>> {
        Box::pin(async { Ok(true) })
    }
    fn send(&self, frame: Vec<u8>) {
        let message = blok_collab_wire::decode(&frame).expect("a frame the codec reads");
        self.messages.lock().unwrap().push(message);
    }
    fn close(&self, reason: CloseReason) {
        self.closed.lock().unwrap().push(reason);
    }
}
