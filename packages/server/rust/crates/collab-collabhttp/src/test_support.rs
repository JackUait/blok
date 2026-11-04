//! Loopback helpers: a real blok-http server, raw requests, parsed answers,
//! and C# HistoryApp, the routes over a room manager on the built-in
//! journal.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime};

use blok_auth::{Authorization, BoxFuture as AuthFuture, Error as AuthError, User};
use blok_collab::BoxFuture;
use blok_collab_convert::{
    DocConverter, EditError, EditOp, RichTextHtml, RichTextHtmlSlot, RuntimeHtmlReader, SlotStep,
    TransientError,
};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo};
use blok_collab_room::{
    Converter, Endpoint, Error, Headers, HistoryConverter, HistoryStore, LocalJournal, Manager,
    ManagerOptions, Opened, OperationStore, Options as RoomOptions, PurgeStore, Records,
};
use blok_collab_workingset::LocalStore;
use blok_http::{Config as HttpConfig, Handler, Request, ResponseWriter, Server};
use blok_jsjson::{Node, Object, Options as JsonOptions, Str, Value, parse_node};
use blok_jsruntime::{Options as PoolOptions, Pool};
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
            pool_size: 1,
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
}

/// C# FailingConverter over the real converter.
pub struct FailingConverter {
    inner: DocConverter<&'static RuntimeHtmlReader<Pool>>,
    state: Mutex<(Failure, Option<String>)>,
    pub next_edit: Mutex<Option<EditFailure>>,
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
        Box::pin(async move { Ok(None) })
    }
}

fn corrupt() -> Error {
    Error::Journal(blok_collab_journal::Error::InvalidData {
        message: "collab: the record is corrupt.".to_owned(),
        source: None,
    })
}

/// The built-in journal with C#'s CorruptRecords and CorruptLineages
/// switches on its history reads.
pub struct TestJournal {
    inner: LocalJournal,
    pub corrupt_records: AtomicBool,
    pub corrupt_lineages: AtomicBool,
}

impl OperationStore for TestJournal {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        self.inner.open(ctx, doc_id)
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(&self.inner)
    }
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        Some(self)
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
        self.inner.read_baseline(ctx, doc_id, lineage)
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        self.inner.read_headers(ctx, doc_id, lineage)
    }
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
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
        self.inner.delete_lineage(ctx, doc_id, lineage)
    }
}

/// C# RecordingAuthorization: both gates on by default, every call kept as
/// (gate, user id, doc).
pub struct RecordingAuthorization {
    pub allow_read: AtomicBool,
    pub allow_write: AtomicBool,
    pub calls: Mutex<Vec<(String, String, String)>>,
}

impl RecordingAuthorization {
    pub fn new(read: bool, write: bool) -> Arc<Self> {
        Arc::new(Self {
            allow_read: AtomicBool::new(read),
            allow_write: AtomicBool::new(write),
            calls: Mutex::default(),
        })
    }

    pub fn set(&self, read: bool, write: bool) {
        self.allow_read.store(read, Ordering::SeqCst);
        self.allow_write.store(write, Ordering::SeqCst);
    }

    pub fn calls(&self) -> Vec<(String, String, String)> {
        self.calls.lock().unwrap().clone()
    }

    fn answer(&self, gate: &str, user: &User, doc: &str, allowed: &AtomicBool) -> bool {
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
    ) -> AuthFuture<'a, Result<bool, AuthError>> {
        Box::pin(async move { Ok(self.answer("read", user, document_id, &self.allow_read)) })
    }
    fn can_write_document<'a>(
        &'a self,
        user: &'a User,
        document_id: &'a str,
    ) -> AuthFuture<'a, Result<bool, AuthError>> {
        Box::pin(async move { Ok(self.answer("write", user, document_id, &self.allow_write)) })
    }
}

/// What an app is started with.
#[derive(Default)]
pub struct AppOptions {
    /// The built-in journal; without it the rooms keep no journal.
    pub journal: bool,
    pub ticket_mode: bool,
    pub authorization: Option<Arc<RecordingAuthorization>>,
    pub retry_backoff: Duration,
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
/// the pass's doc claim); Origin is echoed as an allowed CORS origin, and
/// X-Expose is what the host's own CORS layer exposes first.
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
    });
    let endpoint = Arc::new(HeldDocument::default());
    let mut room = RoomOptions {
        retry_backoff: options.retry_backoff,
        ..RoomOptions::default()
    };
    let journal = options.journal.then(|| {
        let store = blok_collab_journal::Store::new(temp_dir(), Default::default()).unwrap();
        room.max_update_bytes = store.max_update_bytes();
        Arc::new(TestJournal {
            inner: LocalJournal(store),
            corrupt_records: AtomicBool::new(false),
            corrupt_lineages: AtomicBool::new(false),
        })
    });
    let manager = Manager::new(ManagerOptions {
        store: Arc::new(LocalStore::new(temp_dir(), None)),
        endpoint: endpoint.clone(),
        converter: converter.clone(),
        room,
        log: None,
        operations: journal
            .clone()
            .map(|journal| journal as Arc<dyn OperationStore>),
        activity: None,
    });
    let rooms = manager.clone();
    let corrupt = Arc::new(Mutex::new(Vec::new()));
    let logged = corrupt.clone();
    let routes = Handlers::new(Config {
        ticket_mode: options.ticket_mode,
        authorization: options
            .authorization
            .map(|hook| hook as Arc<dyn Authorization>),
        rooms: Arc::new(move || Ok(rooms.clone())),
        max_message_bytes: 8 << 20,
        corrupt_log: Some(Arc::new(move |doc: &str| {
            logged.lock().unwrap().push(doc.to_owned());
        })),
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
    ] {
        let routes = routes.clone();
        router.handle(
            pattern,
            Some(&[method]),
            move |mut request: Request, mut response: ResponseWriter| {
                let routes = routes.clone();
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
                if let Some(exposed) = request.headers().get("X-Expose") {
                    response
                        .headers_mut()
                        .set("Access-Control-Expose-Headers", exposed);
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
}
