//! The remote live room client: one tokio task per handle owns the socket,
//! the local Yjs document, the outbox, awareness and every timer. A port of
//! the parts of src/components/modules/collaboration/provider.ts and
//! headless-session.ts a headless agent uses, plus src/mcp/live/live-session.ts.
//! The bundle plans each batch; the task exports, applies and sends.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab_convert::{DocConverter, RichTextFieldEntry, RichTextFields, RuntimeHtmlReader};
use blok_collab_wire::{Message, decode, encode};
use blok_jsjson::{Node, Options as JsonOptions, parse_node};
use blok_yjs::{Direction, Doc, Options as DocOptions};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Instant, sleep_until};

use crate::awareness::{self, Awareness};
use crate::bundle::{Bundle, BundleInvoker, Obj};
use crate::errors::{Fault, HostError};
use crate::live::Tickets;
use crate::outbound::Outbound;
use crate::ws::{self, Event, Refused, Socket};

const SUPPORTED_FORMAT: i32 = 2;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const AWARENESS_THROTTLE: Duration = Duration::from_millis(100);
const MAX_HANDSHAKE_TIMEOUTS_SINCE_SYNC: u32 = 3;
const BACKOFF_BASE_MS: f64 = 1000.0;
const BACKOFF_CAP_MS: f64 = 30_000.0;
const SHORT_RECONNECT: Duration = Duration::from_millis(250);
const ACTIVITY_INTERVAL: Duration = Duration::from_secs(60);
/// The provider's redrive: an unanswered operation is resent on a new socket.
const ACK_TIMEOUT: Duration = Duration::from_secs(15);
const EMPTY_UPDATE_BYTES: usize = 2;
const MAX_BUFFERED_INBOUND: usize = 64;
/// headless-session's first-sync wait.
pub const SYNC_TIMEOUT: Duration = Duration::from_secs(15);
/// How long a restore waits for the room to send its update back.
const RESTORE_ECHO_WAIT: Duration = Duration::from_secs(2);
const HISTORY_STEPS: usize = 100;
const V2: &str = "blok-sync.v2";
const CLOSE_MESSAGE_TOO_BIG: u16 = 1009;
/// The state vector of a document with no history.
const EMPTY_STATE_VECTOR: [u8; 1] = [0];
const V1: &str = "blok-sync.v1";

/// What the processes share: the engines and the converter.
pub struct LiveShared {
    pub bundle: Arc<Bundle>,
    pub converter: DocConverter<RuntimeHtmlReader<BundleInvoker>>,
    pub outbound: Outbound,
    /// The start flags, with sync on.
    pub flags: Value,
}

impl LiveShared {
    /// `fields`: mcpRichTextFields' answer, each type's rich-text fields.
    pub fn new(
        bundle: Arc<Bundle>,
        outbound: Outbound,
        flags: Value,
        fields: &Value,
    ) -> LiveShared {
        let entries: Vec<RichTextFieldEntry> = fields
            .as_object()
            .into_iter()
            .flatten()
            .map(|(kind, list)| RichTextFieldEntry {
                kind: blok_jsjson::Str::from(kind.as_str()),
                fields: list.as_array().map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(blok_jsjson::Str::from)
                        .collect()
                }),
            })
            .collect();
        LiveShared {
            converter: DocConverter {
                now: Box::new(std::time::SystemTime::now),
                html: RuntimeHtmlReader {
                    runtime: BundleInvoker(bundle.clone()),
                },
                // A name the converter cannot hold leaves the client's own table.
                fields: Some(
                    RichTextFields::new(&entries).unwrap_or_else(|_| RichTextFields::built_in()),
                ),
                log: None,
            },
            bundle,
            outbound,
            flags,
        }
    }
}

/// The agent as peers see it (src/mcp/live/presence.ts).
#[derive(Clone, Debug)]
pub struct Presence {
    pub actor_id: String,
    pub name: String,
    pub color: String,
    pub on_behalf_of: String,
}

pub struct RoomSpec {
    pub document_id: String,
    pub url: String,
    pub origin: Option<String>,
    pub tickets: Option<Arc<Tickets>>,
    pub write: bool,
    pub presence: Presence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    V1,
    V2,
}

/// Why a room ended for good after its first sync.
#[derive(Clone, Debug)]
enum End {
    Reset,
    Terminal(String),
}

/// How a write batch's operations fared.
#[derive(Debug)]
pub enum Fate {
    Acked(Option<String>),
    Quarantined(String),
    Ended(HostError),
}

/// A batch's answer, before its delivery wait.
pub enum Executed {
    Ask(Value),
    /// The uploader call the batch stopped at; nothing was written.
    Upload(Value),
    Done {
        result: String,
        delivery: Delivery,
    },
}

pub enum Delivery {
    None,
    Now(Value),
    Wait(oneshot::Receiver<Fate>),
    Failed(HostError),
}

#[derive(Clone)]
pub struct ExecuteInput {
    pub batch: Value,
    pub actor: Value,
    pub approval: Value,
    pub created_pages: Vec<String>,
    /// The page the host could not create, for the insert that needs it.
    pub create_failure: Option<Value>,
    /// What each page write the host made gave, in batch order.
    pub page_writes: Vec<Value>,
    /// The `uploads` input: the host's uploader and the answers so far.
    pub uploads: Option<Value>,
}

enum Command {
    Execute(ExecuteInput, oneshot::Sender<Result<Executed, Fault>>),
    Read(Value, Value, oneshot::Sender<Result<String, Fault>>),
    IsEmpty(oneshot::Sender<Result<bool, Fault>>),
    Document(oneshot::Sender<Result<String, Fault>>),
    PagesNeeded(Value, Value, Value, oneshot::Sender<Result<Value, Fault>>),
    Close(oneshot::Sender<Value>),
}

/// A live handle's room.
pub struct RemoteRoom {
    commands: mpsc::UnboundedSender<Command>,
    pub protocol: Protocol,
}

impl RemoteRoom {
    pub async fn execute(&self, input: ExecuteInput) -> Result<Executed, Fault> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(Command::Execute(input, reply))
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?;
        answer
            .await
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?
    }

    /// The room's document as this copy holds it now.
    pub async fn document(&self) -> Result<String, Fault> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(Command::Document(reply))
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?;
        answer
            .await
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?
    }

    /// How many page documents to make before `batch` runs here.
    pub async fn pages_needed(
        &self,
        batch: Value,
        actor: Value,
        approval: Value,
    ) -> Result<Value, Fault> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(Command::PagesNeeded(batch, actor, approval, reply))
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?;
        answer
            .await
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?
    }

    /// blok_read: the answer's structuredContent, or an error.
    pub async fn read(&self, view: Value, actor: Value) -> Result<String, Fault> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(Command::Read(view, actor, reply))
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?;
        answer
            .await
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?
    }

    /// Whether the doc holds no block, title or icon, read without the bundle.
    pub async fn is_empty(&self) -> Result<bool, Fault> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(Command::IsEmpty(reply))
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?;
        answer
            .await
            .map_err(|_| Fault::Internal("the room is gone".to_owned()))?
    }

    /// `{ unsavedBatches, hostRecordLags }`, after the room said goodbye.
    pub async fn close(&self) -> Value {
        let (reply, answer) = oneshot::channel();
        if self.commands.send(Command::Close(reply)).is_err() {
            return json!({ "unsavedBatches": 0, "hostRecordLags": self.protocol == Protocol::V2 });
        }
        answer.await.unwrap_or_else(
            |_| json!({ "unsavedBatches": 0, "hostRecordLags": self.protocol == Protocol::V2 }),
        )
    }
}

/// Joins the room and waits for its first sync, up to SYNC_TIMEOUT.
pub async fn open(shared: Arc<LiveShared>, spec: RoomSpec) -> Result<RemoteRoom, Fault> {
    let (commands, received) = mpsc::unbounded_channel();
    let (synced, first_sync) = oneshot::channel();
    let room = Room::new(shared.clone(), spec, synced);
    tokio::spawn(room.run(received));
    let waited = tokio::time::timeout(SYNC_TIMEOUT, first_sync).await;
    match waited {
        Ok(Ok(Ok(protocol))) => Ok(RemoteRoom { commands, protocol }),
        Ok(Ok(Err(terminal))) => {
            let answer = shared
                .bundle
                .call("mcpRoomError", &json!({ "terminal": terminal }).to_string())
                .await?;
            Err(HostError::as_is(answer.get("error").cloned().unwrap_or(Value::Null)).into())
        }
        _ => Err(HostError::surface(
            "ROOM_SYNC_TIMEOUT",
            "The room did not finish loading in time. Try again.",
        )
        .into()),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    Connecting,
    AwaitingControl,
    Ready,
    Offline,
    Terminal,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Residual {
    None,
    Requested,
    Done,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RowState {
    Pending,
    Acked(String),
    Quarantined(String),
}

struct Row {
    operation_id: String,
    lineage: String,
    bytes: Vec<u8>,
    state: RowState,
}

struct Batch {
    number: u64,
    ids: Vec<String>,
    waiter: Option<oneshot::Sender<Fate>>,
}

enum Approved {
    Yes,
    Ask(Value),
    /// The result to answer with; nothing runs.
    Refused(String),
}

/// A batch whose command acts on another document (effects: 'host'):
/// with no edits of its own, the executor marks it 'other'.
fn writes_another_document(batch: &Value) -> bool {
    batch
        .get("commands")
        .and_then(Value::as_array)
        .is_some_and(|commands| {
            commands.iter().any(|c| {
                matches!(
                    c.get("name").and_then(Value::as_str),
                    Some("page.rename" | "page.setIcon")
                )
            })
        })
}

/// The database comment actions (COMMENT_COMMANDS); the planner refuses a
/// batch that mixes them with other writes.
fn comments_only(batch: &Value) -> bool {
    const COMMENTS: [&str; 5] = [
        "database.addComment",
        "database.replyToComment",
        "database.editComment",
        "database.resolveComment",
        "database.deleteComment",
    ];
    batch
        .get("commands")
        .and_then(Value::as_array)
        .is_some_and(|commands| {
            commands.iter().any(|c| {
                c.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| COMMENTS.contains(&name))
            })
        })
}

/// One applied batch, as undo and redo replay it (store-applier.ts Step).
struct Step {
    serial: Option<u64>,
    ids: BTreeSet<String>,
    placed_only: BTreeSet<String>,
    parents: BTreeSet<Option<String>>,
    shape: String,
}

struct Room {
    shared: Arc<LiveShared>,
    spec: RoomSpec,
    doc: Doc,
    local: Arc<Mutex<Vec<Vec<u8>>>>,
    count: Arc<AtomicU64>,
    awareness: Awareness,
    random: SystemRandom,
    socket: Option<Socket>,
    events: Option<mpsc::UnboundedReceiver<Event>>,
    phase: Phase,
    protocol: Protocol,
    lineage: Option<String>,
    synced: bool,
    ever_synced: bool,
    first_sync: Option<oneshot::Sender<Result<Protocol, String>>>,
    attempt: u32,
    unauthorized_since_sync: u32,
    handshake_timeouts_since_sync: u32,
    force_ticket_refresh: bool,
    buffered: Vec<Message>,
    announced_max: Option<i64>,
    in_flight: Option<String>,
    resync_owed: bool,
    residual: Residual,
    handshake_activity_at: Option<Instant>,
    presence_activity_at: Option<Instant>,
    handshake_deadline: Option<Instant>,
    first_sync_deadline: Option<Instant>,
    ack_deadline: Option<Instant>,
    reconnect_at: Option<Instant>,
    awareness_flush_at: Option<Instant>,
    awareness_full: bool,
    awareness_clients: BTreeSet<u64>,
    awareness_check_at: Instant,
    rows: Vec<Row>,
    /// The room refused a write for good: no local row is queued until the
    /// next sync, which rebuilds the copy (Node's store drops its session).
    poisoned: bool,
    /// The copy holds a refused write: the next connection asks for the
    /// whole room and replaces the copy with it, so the write is never sent.
    rebuild: bool,
    /// This connection asked for the whole room; its first SyncStep2 is it.
    whole_room_owed: bool,
    sizes: SizeMemory,
    batches: Vec<Batch>,
    batch_number: u64,
    read_only: bool,
    end: Option<End>,
    done: Vec<Step>,
    undone: Vec<Step>,
    /// The executor's history marks, one per write batch.
    marks_past: Vec<Mark>,
    marks_future: Vec<Mark>,
}

/// What a close 1009 taught: it names no frame, so the largest one this
/// connection wrote is the estimate (provider.ts).
#[derive(Debug, Default)]
struct SizeMemory {
    largest_sent: usize,
    refused: Option<usize>,
    oversized_since_sync: u32,
}

impl SizeMemory {
    fn sent(&mut self, bytes: usize) {
        self.largest_sent = self.largest_sent.max(bytes);
    }

    /// A close 1009; true when it is the second since an answer shipped.
    fn too_big(&mut self) -> bool {
        self.oversized_since_sync += 1;
        // A 1009 on a connection we never wrote to says nothing of our frames.
        if self.largest_sent > 0 {
            self.refused = Some(
                self.refused
                    .map_or(self.largest_sent, |r| r.min(self.largest_sent)),
            );
        }
        self.oversized_since_sync > 1
    }

    fn may_answer(&self, bytes: usize, announced: Option<i64>) -> bool {
        !(announced.is_some_and(|max| bytes as i64 > max)
            || self.refused.is_some_and(|refused| bytes >= refused))
    }

    /// An answer shipped: the stranded bytes went out, the memory did its job.
    fn answered(&mut self) {
        self.refused = None;
        self.oversized_since_sync = 0;
    }
}

/// The executor's HistoryMark.
#[derive(Clone, Debug, PartialEq)]
enum Mark {
    /// The session's own step.
    Own,
    /// A restore, naming the version current before; undo cannot cross it.
    Restored(String),
    /// A batch that wrote only another document (page.rename, page.setIcon).
    Other,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse(text: &str) -> Result<Node, Fault> {
    parse_node(
        text.as_bytes(),
        JsonOptions {
            max_depth: 512,
            refuse_duplicates: false,
        },
    )
    .map_err(|e| Fault::Internal(e.to_string()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn str_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

impl Room {
    fn new(
        shared: Arc<LiveShared>,
        spec: RoomSpec,
        first_sync: oneshot::Sender<Result<Protocol, String>>,
    ) -> Room {
        let doc = Doc::new(DocOptions::default());
        doc.enable_undo();
        let local = Arc::new(Mutex::new(Vec::new()));
        let count = Arc::new(AtomicU64::new(0));
        watch(&doc, &local, &count);
        let awareness = Awareness::new(doc.client_id());
        let read_only = !spec.write;
        Room {
            shared,
            spec,
            doc,
            local,
            count,
            awareness,
            random: SystemRandom::new(),
            socket: None,
            events: None,
            phase: Phase::Offline,
            protocol: Protocol::V1,
            lineage: None,
            synced: false,
            ever_synced: false,
            first_sync: Some(first_sync),
            attempt: 0,
            unauthorized_since_sync: 0,
            handshake_timeouts_since_sync: 0,
            force_ticket_refresh: false,
            buffered: Vec::new(),
            announced_max: None,
            in_flight: None,
            resync_owed: false,
            residual: Residual::None,
            handshake_activity_at: None,
            presence_activity_at: None,
            handshake_deadline: None,
            first_sync_deadline: None,
            ack_deadline: None,
            reconnect_at: Some(Instant::now()),
            awareness_flush_at: None,
            awareness_full: false,
            awareness_clients: BTreeSet::new(),
            awareness_check_at: Instant::now() + awareness::CHECK_EVERY,
            rows: Vec::new(),
            poisoned: false,
            rebuild: false,
            whole_room_owed: false,
            sizes: SizeMemory::default(),
            batches: Vec::new(),
            batch_number: 0,
            read_only,
            end: None,
            done: Vec::new(),
            undone: Vec::new(),
            marks_past: Vec::new(),
            marks_future: Vec::new(),
        }
    }

    fn revision(&self) -> String {
        format!("l{}", self.count.load(Ordering::SeqCst))
    }

    fn take_local(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.local.lock().unwrap_or_else(|p| p.into_inner()))
    }

    // ---- the loop ----

    async fn run(mut self, mut commands: mpsc::UnboundedReceiver<Command>) {
        loop {
            if self.phase == Phase::Terminal && self.first_sync.is_none() && self.end.is_none() {
                // Terminal before anyone held the room: nothing more to do.
                return;
            }
            let deadline = self.next_deadline();
            tokio::select! {
                command = commands.recv() => match command {
                    None => {
                        self.close_room().await;
                        return;
                    }
                    Some(Command::Close(reply)) => {
                        let summary = self.close_summary();
                        self.close_room().await;
                        let _ = reply.send(summary);
                        return;
                    }
                    Some(Command::Execute(input, reply)) => {
                        let answer = Box::pin(self.execute(input)).await;
                        let _ = reply.send(answer);
                    }
                    Some(Command::Document(reply)) => {
                        let document = self.export().await;
                        #[cfg(test)]
                        let document = if self.shared.bundle.fail_room_read.load(Ordering::SeqCst) {
                            Err(Fault::Internal("failed for a test".to_owned()))
                        } else {
                            document
                        };
                        let _ = reply.send(document);
                    }
                    Some(Command::PagesNeeded(batch, actor, approval, reply)) => {
                        let answer = self.pages_needed(&batch, &actor, &approval).await;
                        let _ = reply.send(answer);
                    }
                    Some(Command::Read(view, actor, reply)) => {
                        let answer = self.read(&view, &actor).await;
                        let _ = reply.send(answer);
                    }
                    Some(Command::IsEmpty(reply)) => {
                        let answer = match self.end.clone() {
                            Some(end) => Err(self.end_error(&end).into()),
                            None => page_doc_is_empty(
                                &self.doc,
                                self.shared
                                    .converter
                                    .fields
                                    .as_ref()
                                    .unwrap_or(&RichTextFields::built_in()),
                            ),
                        };
                        let _ = reply.send(answer);
                    }
                },
                event = recv(&mut self.events) => self.on_event(event).await,
                () = sleep_until(deadline) => self.on_timers().await,
            }
            if self.first_sync.as_ref().is_some_and(|s| s.is_closed()) {
                // The opener gave up waiting.
                self.close_room().await;
                return;
            }
        }
    }

    fn next_deadline(&self) -> Instant {
        [
            self.handshake_deadline,
            self.first_sync_deadline,
            self.ack_deadline,
            self.reconnect_at,
            self.awareness_flush_at,
            Some(self.awareness_check_at),
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or_else(|| Instant::now() + Duration::from_secs(3600))
    }

    async fn on_timers(&mut self) {
        let now = Instant::now();
        if self.reconnect_at.is_some_and(|t| t <= now) {
            self.reconnect_at = None;
            self.open_generation().await;
        }
        if self.handshake_deadline.is_some_and(|t| t <= now) {
            self.handshake_deadline = None;
            self.handshake_timeout().await;
        }
        if self.first_sync_deadline.is_some_and(|t| t <= now) {
            self.first_sync_deadline = None;
            self.teardown(true).await;
            self.schedule_reconnect(None);
        }
        if self.ack_deadline.is_some_and(|t| t <= now) {
            self.ack_deadline = None;
            self.teardown(true).await;
            self.schedule_reconnect(None);
        }
        if self.awareness_flush_at.is_some_and(|t| t <= now) {
            self.awareness_flush_at = None;
            self.flush_awareness().await;
        }
        if self.awareness_check_at <= now {
            self.awareness_check_at = now + awareness::CHECK_EVERY;
            let changed = self.awareness.check();
            self.awareness_changed(changed);
        }
    }

    // ---- connection ----

    async fn open_generation(&mut self) {
        if self.phase == Phase::Terminal {
            return;
        }
        self.phase = Phase::Connecting;
        let fresh = std::mem::take(&mut self.force_ticket_refresh);
        let mut protocols = vec![V2.to_owned(), V1.to_owned()];
        if let Some(tickets) = &self.spec.tickets {
            match tickets.get(fresh).await {
                Ok(ticket) => protocols.push(ticket),
                // Node's revocable(): a FORBIDDEN mint ends the room, never retried.
                Err(_) if tickets.refused() => {
                    self.phase = Phase::Offline;
                    return self.terminate("forbidden").await;
                }
                Err(_) => {
                    self.phase = Phase::Offline;
                    self.schedule_reconnect(None);
                    return;
                }
            }
        }
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        self.handshake_deadline = Some(deadline);
        let connected = ws::connect(
            &self.shared.outbound,
            &self.spec.url,
            &protocols,
            self.spec.origin.as_deref(),
            HANDSHAKE_TIMEOUT,
        )
        .await;
        match connected {
            Ok((mut socket, events)) => {
                self.protocol = if socket.protocol == V2 {
                    Protocol::V2
                } else {
                    Protocol::V1
                };
                self.phase = Phase::AwaitingControl;
                self.buffered.clear();
                self.announced_max = None;
                self.sizes.largest_sent = 0;
                // An empty vector after a refusal: the answer is then the whole room.
                self.whole_room_owed = self.rebuild;
                let sv = if self.rebuild {
                    EMPTY_STATE_VECTOR.to_vec()
                } else {
                    self.doc.encode_state_vector()
                };
                let sent = match encode(&Message::SyncStep1 { state_vector: sv }) {
                    Ok(bytes) => {
                        self.sizes.sent(bytes.len());
                        socket.send(&bytes).await
                    }
                    Err(_) => Ok(()),
                };
                self.socket = Some(socket);
                self.events = Some(events);
                if sent.is_err() {
                    self.on_close(ws::CLOSE_ABNORMAL).await;
                }
            }
            Err(Refused::Status(_) | Refused::Failed) => {
                if Instant::now() >= deadline {
                    self.handshake_deadline = None;
                    self.handshake_timeout().await;
                } else {
                    self.handshake_deadline = None;
                    self.phase = Phase::Offline;
                    self.schedule_reconnect(Some(ws::CLOSE_ABNORMAL));
                }
            }
        }
    }

    fn jitter(&self) -> f64 {
        let mut byte = [0u8; 4];
        let _ = self.random.fill(&mut byte);
        f64::from(u32::from_le_bytes(byte)) / f64::from(u32::MAX)
    }

    fn schedule_reconnect(&mut self, code: Option<u16>) {
        if self.phase == Phase::Terminal {
            return;
        }
        self.attempt += if code == Some(1008) { 2 } else { 1 };
        let delay = if code == Some(1001) && self.attempt == 1 {
            SHORT_RECONNECT
        } else {
            let ceiling = BACKOFF_CAP_MS.min(BACKOFF_BASE_MS * 2f64.powi(self.attempt as i32 - 1));
            Duration::from_millis((ceiling * (0.5 + self.jitter() * 0.5)).round() as u64)
        };
        self.reconnect_at = Some(Instant::now() + delay);
    }

    /// teardownGeneration.
    async fn teardown(&mut self, close_socket: bool) {
        self.handshake_deadline = None;
        self.first_sync_deadline = None;
        self.awareness_flush_at = None;
        self.ack_deadline = None;
        self.in_flight = None;
        self.resync_owed = false;
        self.residual = Residual::None;
        self.whole_room_owed = false;
        self.awareness_clients.clear();
        self.awareness_full = false;
        let events = self.events.take();
        if let Some(socket) = self.socket.take()
            && close_socket
        {
            socket.close(1000, events).await;
        }
        self.buffered.clear();
        self.synced = false;
        if self.phase != Phase::Terminal {
            self.phase = Phase::Offline;
        }
        self.awareness.clear_remote();
    }

    async fn terminate(&mut self, error: &str) {
        self.teardown(true).await;
        self.reconnect_at = None;
        self.phase = Phase::Terminal;
        match self.first_sync.take() {
            Some(waiting) => {
                let _ = waiting.send(Err(error.to_owned()));
            }
            None => self.finish(End::Terminal(error.to_owned())),
        }
    }

    fn finish(&mut self, end: End) {
        if self.end.is_some() {
            return;
        }
        self.end = Some(end.clone());
        let error = self.end_error(&end);
        for batch in &mut self.batches {
            if let Some(waiter) = batch.waiter.take() {
                let _ = waiter.send(Fate::Ended(error.clone()));
            }
        }
    }

    fn not_saved(&self) -> Vec<u64> {
        self.batches
            .iter()
            .filter(|b| {
                !b.ids.iter().all(|id| {
                    self.rows
                        .iter()
                        .any(|r| &r.operation_id == id && matches!(r.state, RowState::Acked(_)))
                })
            })
            .map(|b| b.number)
            .collect()
    }

    fn end_error(&self, end: &End) -> HostError {
        match end {
            End::Reset => HostError::surface_with(
                "ROOM_RESET",
                "The room's history was reset. Work not acknowledged is lost; open the document again.",
                json!({ "notSavedBatches": self.not_saved() }),
            ),
            // terminalToError, inline: the bundle's mcpRoomError is async.
            End::Terminal(error) => match error.as_str() {
                "unsupported-format" => HostError::surface(
                    "VERSION_SKEW",
                    "The room uses a newer document format. Upgrade @bloklabs/mcp to the server family version.",
                ),
                "forbidden" | "unauthorized" => HostError::surface(
                    "FORBIDDEN",
                    "The room refused this agent. Its ticket may not grant this document.",
                ),
                other => HostError::surface_with(
                    "SOURCE_UNAVAILABLE",
                    "The room connection stopped for good. Open the document again.",
                    json!({ "terminal": other }),
                ),
            },
        }
    }

    async fn on_close(&mut self, code: u16) {
        if let Some(socket) = self.socket.take() {
            // Echo the close, as `ws` does.
            socket.close(code, None).await;
        }
        self.teardown(false).await;
        let oversized = code == CLOSE_MESSAGE_TOO_BIG && self.sizes.too_big();
        if code == 4401 {
            self.unauthorized_since_sync += 1;
        }
        match code {
            4400 => return self.terminate("bad-request").await,
            4403 => return self.terminate("forbidden").await,
            4409 => return self.relineage(Some(code)).await,
            4401 if self.unauthorized_since_sync > 1 => {
                return self.terminate("unauthorized").await;
            }
            // The second 1009 since an answer shipped: the same bytes again.
            _ if oversized => return self.terminate("oversized-update").await,
            4401 => self.force_ticket_refresh = true,
            _ => {}
        }
        self.schedule_reconnect(Some(code));
    }

    async fn handshake_timeout(&mut self) {
        self.handshake_timeouts_since_sync += 1;
        if self.handshake_timeouts_since_sync >= MAX_HANDSHAKE_TIMEOUTS_SINCE_SYNC {
            return self.terminate("handshake-timeout").await;
        }
        self.teardown(true).await;
        self.schedule_reconnect(None);
    }

    /// The room's history is not ours any more: quarantine, discard the
    /// document, and join again from empty.
    async fn relineage(&mut self, code: Option<u16>) {
        // The batches waiting now are the ones the reset lost.
        self.finish(End::Reset);
        if let Some(lineage) = self.lineage.clone() {
            self.quarantine(&lineage, "lineage-reset");
        }
        // A fresh doc; the agent's view of the old one is gone.
        let doc = Doc::new(DocOptions::default());
        doc.enable_undo();
        watch(&doc, &self.local, &self.count);
        self.doc = doc;
        self.lineage = None;
        self.schedule_reconnect(code);
    }

    async fn send(&mut self, message: &Message) {
        let Ok(bytes) = encode(message) else { return };
        let failed = match self.socket.as_mut() {
            Some(socket) => {
                self.sizes.sent(bytes.len());
                socket.send(&bytes).await.is_err()
            }
            None => false,
        };
        if failed {
            self.on_close(ws::CLOSE_ABNORMAL).await;
        }
    }

    async fn on_event(&mut self, event: Option<Event>) {
        match event {
            None => self.on_close(ws::CLOSE_ABNORMAL).await,
            Some(Event::Closed(code)) => self.on_close(code).await,
            Some(Event::Ping(payload)) => {
                if let Some(socket) = self.socket.as_mut() {
                    let _ = socket.pong(&payload).await;
                }
            }
            Some(Event::Binary(bytes)) => {
                let Ok(message) = decode(&bytes) else { return };
                match message {
                    Message::Unknown { .. } | Message::Operation { .. } | Message::Activity => {}
                    Message::BlokControl { tag } => self.on_control(tag).await,
                    message if self.phase == Phase::AwaitingControl => {
                        if matches!(
                            message,
                            Message::Acknowledgement { .. }
                                | Message::Rejection { .. }
                                | Message::Identities { .. }
                        ) {
                            return;
                        }
                        if self.buffered.len() >= MAX_BUFFERED_INBOUND {
                            self.teardown(true).await;
                            self.schedule_reconnect(None);
                            return;
                        }
                        self.buffered.push(message);
                    }
                    message => self.on_frame(message).await,
                }
            }
        }
    }

    async fn on_control(&mut self, tag: blok_collab_wire::Tag) {
        self.handshake_deadline = None;
        if tag.format != SUPPORTED_FORMAT {
            return self.terminate("unsupported-format").await;
        }
        if self.lineage.as_ref().is_some_and(|l| *l != tag.lineage) {
            self.teardown(true).await;
            return self.relineage(None).await;
        }
        self.lineage = Some(tag.lineage);
        if self.phase == Phase::Ready {
            return;
        }
        self.phase = Phase::Ready;
        // The handshake's own minute, separate from presence's.
        if self
            .handshake_activity_at
            .is_none_or(|t| t.elapsed() >= ACTIVITY_INTERVAL)
        {
            self.handshake_activity_at = Some(Instant::now());
            self.send(&Message::Activity).await;
        }
        for message in std::mem::take(&mut self.buffered) {
            if self.phase != Phase::Ready {
                break;
            }
            self.on_frame(message).await;
        }
        if self.phase != Phase::Ready {
            return;
        }
        if self.awareness.has_states() {
            self.schedule_awareness(true);
        }
        if !self.synced {
            self.first_sync_deadline = Some(Instant::now() + HANDSHAKE_TIMEOUT);
        }
    }

    async fn on_frame(&mut self, message: Message) {
        match message {
            Message::SyncStep2 { update } => {
                if self.whole_room_owed {
                    self.rebuild_from_room();
                }
                if self.apply_remote(&update).await {
                    self.mark_synced().await;
                }
            }
            Message::SyncUpdate { update } => {
                self.apply_remote(&update).await;
            }
            Message::SyncStep1 { state_vector } => match self.protocol {
                Protocol::V2 => self.on_resync(&state_vector).await,
                Protocol::V1 => self.answer_resync(&state_vector).await,
            },
            Message::Awareness { update } => self.awareness.apply(&update),
            Message::QueryAwareness => self.schedule_awareness(true),
            Message::BlokLimits { max_message_bytes } => {
                self.announced_max = Some(max_message_bytes)
            }
            Message::Acknowledgement {
                lineage,
                operation_id,
                server_sequence,
            } => self.on_ack(&lineage, &operation_id, server_sequence).await,
            Message::Rejection {
                lineage,
                operation_id,
                code,
            } => self.on_reject(&lineage, &operation_id, &code).await,
            _ => {}
        }
    }

    /// A doc frame that will not apply ends the room (apply-failed).
    async fn apply_remote(&mut self, update: &[u8]) -> bool {
        match self.doc.apply_update(update) {
            Ok(_) => true,
            Err(_) => {
                self.terminate("apply-failed").await;
                false
            }
        }
    }

    async fn mark_synced(&mut self) {
        if self.synced {
            return;
        }
        self.synced = true;
        // Node records the session again here: writes may queue once more.
        self.poisoned = false;
        self.first_sync_deadline = None;
        self.attempt = 0;
        self.unauthorized_since_sync = 0;
        self.handshake_timeouts_since_sync = 0;
        if !self.ever_synced {
            self.ever_synced = true;
            // createLiveSession announces as the open resolves.
            self.announce();
        }
        if let Some(waiting) = self.first_sync.take() {
            // l<n> counts updates from the session's start, not the first sync.
            self.count.store(0, Ordering::SeqCst);
            let _ = waiting.send(Ok(self.protocol));
        }
        self.drain().await;
    }

    async fn on_resync(&mut self, state_vector: &[u8]) {
        if self.residual != Residual::Requested {
            self.resync_owed = true;
            self.drain().await;
            return;
        }
        // The server took this vector before it had the operation now in
        // flight, so the diff would send that work twice. Ask again once the
        // outbox drains (provider.ts).
        if self.in_flight.is_some() {
            self.residual = Residual::None;
            self.resync_owed = true;
            return;
        }
        self.residual = Residual::Done;
        let Ok(residual) = self.doc.encode_state_as_update(state_vector) else {
            return;
        };
        if residual.len() <= EMPTY_UPDATE_BYTES {
            return;
        }
        if self.append(residual).is_some() {
            self.drain().await;
        }
    }

    // ---- outbox ----

    /// A local update as an outbox row; None when the lineage was refused.
    fn append(&mut self, bytes: Vec<u8>) -> Option<String> {
        if self.poisoned {
            return None;
        }
        let lineage = self.lineage.clone()?;
        let mut id = [0u8; 16];
        let _ = self.random.fill(&mut id);
        let operation_id = hex(&id);
        self.rows.push(Row {
            operation_id: operation_id.clone(),
            lineage,
            bytes,
            state: RowState::Pending,
        });
        Some(operation_id)
    }

    async fn drain(&mut self) {
        if self.protocol != Protocol::V2
            || self.phase != Phase::Ready
            || !self.synced
            || self.in_flight.is_some()
            || self.socket.is_none()
        {
            return;
        }
        let next = self
            .rows
            .iter()
            .find(|r| r.state == RowState::Pending)
            .map(|r| (r.operation_id.clone(), r.lineage.clone(), r.bytes.clone()));
        let Some((operation_id, lineage, bytes)) = next else {
            if self.resync_owed && self.residual == Residual::None {
                self.resync_owed = false;
                self.residual = Residual::Requested;
                let state_vector = self.doc.encode_state_vector();
                self.send(&Message::SyncStep1 { state_vector }).await;
            }
            return;
        };
        if self.lineage.as_deref() != Some(lineage.as_str()) {
            self.quarantine(&lineage, "stale-lineage");
            return Box::pin(self.drain()).await;
        }
        let message = Message::Operation {
            lineage,
            operation_id: operation_id.clone(),
            update: bytes,
        };
        if let (Some(max), Ok(framed)) = (self.announced_max, encode(&message))
            && framed.len() as i64 > max
        {
            let lineage = self.lineage.clone().unwrap_or_default();
            self.quarantine(&lineage, "oversized-update");
            // Same verdict as the room's own rejection.
            self.refused_for_good();
            return;
        }
        self.in_flight = Some(operation_id);
        self.ack_deadline = Some(Instant::now() + ACK_TIMEOUT);
        self.send(&message).await;
    }

    async fn on_ack(&mut self, lineage: &str, operation_id: &str, sequence: u64) {
        if self.protocol != Protocol::V2 || self.lineage.as_deref() != Some(lineage) {
            return;
        }
        if self.in_flight.as_deref() == Some(operation_id) {
            self.in_flight = None;
            self.ack_deadline = None;
        }
        if let Some(row) = self
            .rows
            .iter_mut()
            .find(|r| r.operation_id == operation_id)
        {
            row.state = RowState::Acked(sequence.to_string());
        }
        self.settle_batches();
        self.drain().await;
    }

    async fn on_reject(&mut self, lineage: &str, operation_id: &str, code: &str) {
        if self.protocol != Protocol::V2 || self.lineage.as_deref() != Some(lineage) {
            return;
        }
        if self.in_flight.as_deref() == Some(operation_id) {
            self.in_flight = None;
            self.ack_deadline = None;
        }
        match code {
            "lineage-mismatch" => {
                self.teardown(true).await;
                self.relineage(None).await;
            }
            "not-synced" => {
                self.teardown(true).await;
                self.schedule_reconnect(None);
            }
            final_code => {
                let lineage = lineage.to_owned();
                self.quarantine(&lineage, final_code);
                self.refused_for_good();
            }
        }
    }

    /// A write the room will never take: later local edits depend on it, so
    /// none is queued until the copy is rebuilt from the room.
    fn refused_for_good(&mut self) {
        self.poisoned = true;
        self.rebuild = true;
    }

    /// Drops the copy that holds a refused write, just before the room's
    /// whole copy is applied. The session goes on: the lineage is still ours.
    fn rebuild_from_room(&mut self) {
        self.rebuild = false;
        self.whole_room_owed = false;
        let doc = Doc::new(DocOptions::default());
        doc.enable_undo();
        watch(&doc, &self.local, &self.count);
        self.doc = doc;
        // Their steps lived in the old copy.
        self.done.clear();
        self.undone.clear();
        self.take_local();
    }

    /// Answers a v1 SyncStep1, unless the answer is over the announced cap
    /// or as big as a frame the room already refused (provider.ts answerResync).
    async fn answer_resync(&mut self, state_vector: &[u8]) {
        let Ok(update) = self.doc.encode_state_as_update(state_vector) else {
            return;
        };
        let message = Message::SyncStep2 { update };
        let Ok(bytes) = encode(&message) else { return };
        if !self.sizes.may_answer(bytes.len(), self.announced_max) {
            return self.terminate("oversized-update").await;
        }
        self.send(&message).await;
        self.sizes.answered();
    }

    fn quarantine(&mut self, lineage: &str, reason: &str) {
        for row in &mut self.rows {
            if row.lineage == lineage && row.state == RowState::Pending {
                row.state = RowState::Quarantined(reason.to_owned());
            }
        }
        if reason == "read-only" {
            self.read_only = true;
        }
        self.settle_batches();
    }

    /// Resolves the delivery waits whose operations are all decided.
    fn settle_batches(&mut self) {
        let mut done = Vec::new();
        for (index, batch) in self.batches.iter_mut().enumerate() {
            let states: Vec<&RowState> = batch
                .ids
                .iter()
                .filter_map(|id| {
                    self.rows
                        .iter()
                        .find(|r| &r.operation_id == id)
                        .map(|r| &r.state)
                })
                .collect();
            let fate = if let Some(RowState::Quarantined(reason)) = states
                .iter()
                .find(|s| matches!(s, RowState::Quarantined(_)))
            {
                Some(Fate::Quarantined(reason.clone()))
            } else if states.iter().all(|s| matches!(s, RowState::Acked(_))) {
                let last = states.last().and_then(|s| match s {
                    RowState::Acked(seq) => Some(seq.clone()),
                    _ => None,
                });
                Some(Fate::Acked(last))
            } else {
                None
            };
            if let Some(fate) = fate {
                let reset = matches!(&fate, Fate::Quarantined(r) if r == "lineage-reset");
                if let Some(waiter) = batch.waiter.take() {
                    let _ = waiter.send(fate);
                }
                if !reset {
                    done.push(index);
                }
            }
        }
        for index in done.into_iter().rev() {
            // Acked or refused batches are saved or settled; a reset keeps them.
            self.batches.remove(index);
        }
    }

    fn close_summary(&self) -> Value {
        json!({
            "unsavedBatches": self.not_saved().len(),
            "hostRecordLags": self.protocol == Protocol::V2,
        })
    }

    /// presence.clear, then the immediate departure and the close.
    async fn close_room(&mut self) {
        self.set_awareness("agentCursor", Value::Null);
        self.set_awareness("blockId", Value::Null);
        if self.phase == Phase::Ready {
            let departure = self.awareness.departure();
            self.send(&Message::Awareness { update: departure }).await;
        }
        self.phase = Phase::Terminal;
        self.teardown(true).await;
        self.reconnect_at = None;
    }

    // ---- awareness and presence ----

    fn set_awareness(&mut self, field: &str, value: Value) {
        let changed = self.awareness.set_field(field, value);
        self.awareness_changed(changed);
    }

    fn awareness_changed(&mut self, changed: Vec<u64>) {
        // The provider hears awareness only while a connection is live.
        if changed.is_empty() || self.phase != Phase::Ready {
            return;
        }
        self.awareness_clients.extend(changed);
        self.schedule_awareness(false);
    }

    fn schedule_awareness(&mut self, full: bool) {
        self.awareness_full |= full;
        if self.awareness_flush_at.is_none() {
            self.awareness_flush_at = Some(Instant::now() + AWARENESS_THROTTLE);
        }
    }

    async fn flush_awareness(&mut self) {
        let full = std::mem::take(&mut self.awareness_full);
        let clients: Vec<u64> = std::mem::take(&mut self.awareness_clients)
            .into_iter()
            .collect();
        if self.socket.is_none() || self.phase != Phase::Ready || (!full && clients.is_empty()) {
            return;
        }
        let update = self
            .awareness
            .encode(if full { None } else { Some(&clients) });
        self.send(&Message::Awareness { update }).await;
    }

    fn announce(&mut self) {
        let p = self.spec.presence.clone();
        self.set_awareness(
            "user",
            json!({ "name": p.name, "color": p.color, "id": p.actor_id }),
        );
        self.set_awareness(
            "agent",
            json!({ "via": "mcp", "onBehalfOf": p.on_behalf_of }),
        );
    }

    /// presence.afterBatch for a successful result.
    async fn after_batch(&mut self, result: &Value) {
        let changed = result.get("changed");
        let last = |key: &str| {
            changed
                .and_then(|c| c.get(key))
                .and_then(Value::as_array)
                .and_then(|a| a.last())
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        let touched = last("created")
            .or_else(|| last("updated"))
            .or_else(|| last("moved"));
        self.set_awareness("activeAt", json!(now_ms()));
        if let Some(touched) = touched {
            let range = result.get("lastRange");
            let block_id = range
                .and_then(|r| str_of(r, "blockId"))
                .map(str::to_owned)
                .unwrap_or(touched);
            self.set_awareness("blockId", Value::String(block_id.clone()));
            let p = self.spec.presence.clone();
            let mut cursor = Map::new();
            cursor.insert("actorId".to_owned(), json!(p.actor_id));
            cursor.insert("name".to_owned(), json!(p.name));
            cursor.insert("color".to_owned(), json!(p.color));
            cursor.insert("blockId".to_owned(), json!(block_id));
            if let Some(range) = range {
                for key in ["field", "start", "end"] {
                    cursor.insert(
                        key.to_owned(),
                        range.get(key).cloned().unwrap_or(Value::Null),
                    );
                }
            }
            self.set_awareness("agentCursor", Value::Object(cursor));
        }
        let due = self
            .presence_activity_at
            .is_none_or(|t| t.elapsed() >= ACTIVITY_INTERVAL);
        // A send on a socket that was not ready does not spend the minute.
        if due && self.phase == Phase::Ready && self.socket.is_some() {
            self.presence_activity_at = Some(Instant::now());
            self.send(&Message::Activity).await;
        }
    }

    // ---- the agent ----

    fn session_input(&self, write: bool, document: &str, actor: &Value) -> Obj {
        let mut mcp = self.shared.flags.clone();
        mcp["mode"] = json!("live");
        mcp["write"] = json!(write);
        let n = self.count.load(Ordering::SeqCst);
        Obj::new()
            .val("mcp", &mcp)
            .raw("document", document)
            .val("actor", actor)
            .val(
                "revision",
                &json!({ "now": format!("l{n}"), "afterWrite": format!("l{}", n + 1) }),
            )
    }

    async fn export(&self) -> Result<String, Fault> {
        self.export_doc(&self.doc).await
    }

    async fn export_doc(&self, doc: &Doc) -> Result<String, Fault> {
        let exported = self
            .shared
            .converter
            .export(doc)
            .await
            .map_err(|e| Fault::Internal(e.to_string()))?;
        let bytes = blok_collab_docendpoint::serialize(&blok_jsjson::Value::Object(exported))
            .map_err(|e| Fault::Internal(e.to_string()))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    async fn pages_needed(
        &mut self,
        batch: &Value,
        actor: &Value,
        approval: &Value,
    ) -> Result<Value, Fault> {
        if self.end.is_some() || self.read_only {
            return Ok(json!({ "count": 0 }));
        }
        let document = self.export().await?;
        let input = self
            .session_input(!self.read_only, &document, actor)
            .val("batch", batch)
            .val("approval", approval);
        let input = input.finish();
        Ok(self.shared.bundle.call("agentPagesNeeded", &input).await?)
    }

    async fn read(&mut self, view: &Value, actor: &Value) -> Result<String, Fault> {
        if let Some(end) = self.end.clone() {
            return Err(self.end_error(&end).into());
        }
        let document = self.export().await?;
        let input = self
            .session_input(!self.read_only, &document, actor)
            .val("view", view)
            .finish();
        let raw = self.shared.bundle.call_raw("mcpRead", &input).await?;
        Ok(raw.text("answer").unwrap_or("null").to_owned())
    }

    async fn execute(&mut self, input: ExecuteInput) -> Result<Executed, Fault> {
        if let Some(end) = self.end.clone() {
            return Ok(Executed::Done {
                result: "{\"ok\":false,\"warnings\":[]}".to_owned(),
                delivery: Delivery::Failed(self.end_error(&end)),
            });
        }
        let first = input
            .batch
            .pointer("/commands/0/name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if first == "history.undo" || first == "history.redo" {
            return self.replay(&input, first == "history.undo").await;
        }
        let version_history = if first.starts_with("history.") {
            let loaded = self.load_versions(&first, &input.batch).await;
            // Node's revocable(): a FORBIDDEN mint ends the room here too.
            if self.spec.tickets.as_ref().is_some_and(|t| t.refused()) {
                self.terminate("forbidden").await;
            }
            Some(loaded)
        } else {
            None
        };
        let document = self.export().await?;
        let mut call = self
            .session_input(!self.read_only, &document, &input.actor)
            .val("batch", &input.batch)
            .val("approval", &input.approval);
        if let Some(history) = &version_history {
            call = call.val("versionHistory", history);
        }
        if !input.created_pages.is_empty() {
            call = call.val("createdPages", &json!(input.created_pages));
        }
        if let Some(failure) = &input.create_failure {
            call = call.val("createPageFailure", failure);
        }
        if let Some(uploads) = &input.uploads {
            call = call.val("uploads", uploads);
        }
        if !input.page_writes.is_empty() {
            call = call.val("pageWrites", &json!(input.page_writes));
        }
        let out = self
            .shared
            .bundle
            .call_raw("agentExecute", &call.finish())
            .await?;
        if let Some(ask) = out.value("ask") {
            return Ok(Executed::Ask(ask));
        }
        if let Some(upload) = out.value("upload") {
            return Ok(Executed::Upload(upload));
        }
        let result_text = out.text("result").unwrap_or("{}").to_owned();
        let result: Value =
            serde_json::from_str(&result_text).map_err(|e| Fault::Internal(e.to_string()))?;
        let writes = out.value("writes") == Some(Value::Bool(true));
        let ok = result.get("ok") == Some(&Value::Bool(true));
        if !ok {
            if result.pointer("/error/code").and_then(Value::as_str) == Some("APPLY_FAILED") {
                self.read_only = true;
            }
            return Ok(Executed::Done {
                result: result_text,
                delivery: Delivery::None,
            });
        }
        let edits = out.text("edits").unwrap_or("[]").to_owned();
        if edits != "[]" {
            self.apply(
                &edits,
                out.text("document").unwrap_or("{}"),
                &result_text,
                &document,
                comments_only(&input.batch),
            )
            .await?;
            // A comment batch leaves the undo history alone, as Node's executor does.
            if !comments_only(&input.batch) {
                self.marks_past.push(Mark::Own);
                self.marks_future.clear();
            }
        } else if writes_another_document(&input.batch) {
            self.marks_past.push(Mark::Other);
        }
        let mut result_text = result_text;
        // A restore the bundle checked goes to the sync server's history route.
        if let Some(Value::String(version)) = out.value("restore") {
            let before = self.count.load(Ordering::SeqCst);
            let previous = result
                .pointer("/results/0/previous")
                .and_then(Value::as_str);
            if let Err(failed) = self.restore(&version, previous).await {
                // Node's revocable(): a FORBIDDEN mint for the POST ends the room too.
                if self.spec.tickets.as_ref().is_some_and(|t| t.refused()) {
                    self.terminate("forbidden").await;
                }
                return Ok(Executed::Done {
                    result: restore_failure(&result, &failed),
                    delivery: Delivery::None,
                });
            }
            // The restore comes back as a peer's update, and the result's
            // revision counts it, as Node's does.
            self.wait_for_update(before, RESTORE_ECHO_WAIT).await;
            let mut restored = result.clone();
            restored["revision"] = json!(self.revision());
            result_text = restored.to_string();
            let previous = result
                .pointer("/results/0/previous")
                .and_then(Value::as_str)
                .unwrap_or_default();
            self.marks_past.push(Mark::Restored(previous.to_owned()));
            self.marks_future.clear();
        }
        self.finish_batch(result_text, &result, writes).await
    }

    /// From the local updates the batch made to its delivery.
    async fn finish_batch(
        &mut self,
        result_text: String,
        result: &Value,
        writes: bool,
    ) -> Result<Executed, Fault> {
        let updates = self.take_local();
        // v1: the seam sends each local update at once, before presence.
        if self.protocol == Protocol::V1 {
            for update in &updates {
                let message = Message::SyncUpdate {
                    update: update.clone(),
                };
                // Refused before the write: a bigger frame buys only a 1009.
                if let (Some(max), Ok(bytes)) = (self.announced_max, encode(&message))
                    && bytes.len() as i64 > max
                {
                    self.terminate("oversized-update").await;
                    break;
                }
                self.send(&message).await;
            }
        }
        self.after_batch(result).await;
        if !writes || self.protocol == Protocol::V1 {
            return Ok(Executed::Done {
                result: result_text,
                delivery: Delivery::None,
            });
        }
        let mut ids = Vec::new();
        for update in updates {
            match self.append(update) {
                Some(id) => ids.push(id),
                None => {
                    self.read_only = true;
                    return Ok(Executed::Done {
                        result: result_text,
                        delivery: Delivery::Failed(HostError::surface_with(
                            "APPLY_FAILED",
                            "The batch changed the local copy but could not be queued for the room. It was not saved; open the document again.",
                            json!({ "stage": "journal" }),
                        )),
                    });
                }
            }
        }
        self.batch_number += 1;
        let (waiter, fate) = oneshot::channel();
        self.batches.push(Batch {
            number: self.batch_number,
            ids,
            waiter: Some(waiter),
        });
        self.settle_batches();
        self.drain().await;
        Ok(Executed::Done {
            result: result_text,
            delivery: Delivery::Wait(fate),
        })
    }

    async fn apply(
        &mut self,
        edits: &str,
        after: &str,
        result: &str,
        before: &str,
        comments: bool,
    ) -> Result<(), Fault> {
        let ops = blok_blokagent::translate(&parse(edits)?, &parse(after)?, &parse(result)?)
            .map_err(|e| Fault::Internal(format!("{e:?}")))?;
        let before_blocks = blocks_of(before);
        let edits: Value = serde_json::from_str(edits).unwrap_or(Value::Null);
        if comments {
            // A person's comment is no undo step, so neither is the agent's.
            return self
                .shared
                .converter
                .apply_ops(&self.doc, &ops)
                .await
                .map_err(|err| {
                    self.read_only = true;
                    Fault::Internal(err.to_string())
                });
        }
        let mut step = Step {
            serial: None,
            ids: BTreeSet::new(),
            placed_only: BTreeSet::new(),
            parents: BTreeSet::new(),
            shape: String::new(),
        };
        step_ids(&edits, &before_blocks, &mut step);
        let stacked = self.doc.stack_top(Direction::Undo);
        self.doc.set_capturing(true);
        let applied = self.shared.converter.apply_ops(&self.doc, &ops).await;
        self.doc.set_capturing(false);
        if let Err(err) = applied {
            self.read_only = true;
            return Err(Fault::Internal(err.to_string()));
        }
        #[cfg(test)]
        if self
            .shared
            .bundle
            .fail_after_room_write
            .load(Ordering::SeqCst)
        {
            return Err(Fault::Internal(
                "failed for a test after the room write".to_owned(),
            ));
        }
        let after_blocks = blocks_of(&self.export().await?);
        for block in before_blocks.iter().chain(after_blocks.iter()) {
            if let Some(id) = str_of(block, "id")
                && step.ids.contains(id)
            {
                step.parents
                    .insert(str_of(block, "parent").map(str::to_owned));
            }
        }
        let top = self.doc.stack_top(Direction::Undo);
        step.serial = if top != stacked { top } else { None };
        step.shape = shape(&step, &after_blocks);
        self.done.push(step);
        self.undone.clear();
        while self.done.len() > HISTORY_STEPS {
            let oldest = self.done.remove(0);
            if let Some(serial) = oldest.serial {
                self.doc.forget_step(serial);
            }
        }
        Ok(())
    }

    /// history.undo / history.redo: the bundle checks the call, then the
    /// document's own undo manager replays the step (store-applier.ts replay).
    async fn replay(&mut self, input: &ExecuteInput, undo: bool) -> Result<Executed, Fault> {
        let gate = self
            .shared
            .bundle
            .call_raw(
                "agentExecute",
                &self
                    .session_input(!self.read_only, r#"{"blocks":[]}"#, &input.actor)
                    .val("batch", &input.batch)
                    .finish(),
            )
            .await?;
        let gate_text = gate.text("result").unwrap_or("{}").to_owned();
        let gate_result: Value = serde_json::from_str(&gate_text).unwrap_or(Value::Null);
        let code = gate_result.pointer("/error/code").and_then(Value::as_str);
        if code != Some("NOTHING_TO_UNDO") && code != Some("NOTHING_TO_REDO") {
            return Ok(Executed::Done {
                result: gate_text,
                delivery: Delivery::None,
            });
        }
        if let Some(refusal) = self.mark_refusal(undo) {
            return Ok(Executed::Done {
                result: refusal,
                delivery: Delivery::None,
            });
        }
        let failed = |code: &str, message: &str, retryable: bool, revision: String| {
            json!({
                "ok": false,
                "revision": revision,
                "error": { "code": code, "message": message, "retryable": retryable },
                "warnings": [],
            })
            .to_string()
        };
        let (from, direction) = if undo {
            (&mut self.done, Direction::Undo)
        } else {
            (&mut self.undone, Direction::Redo)
        };
        let Some(step) = from.pop() else {
            let (code, message) = if undo {
                ("NOTHING_TO_UNDO", "This session has no step to undo.")
            } else {
                (
                    "NOTHING_TO_REDO",
                    "This session has no undone step to redo.",
                )
            };
            return Ok(Executed::Done {
                result: failed(code, message, false, self.revision()),
                delivery: Delivery::None,
            });
        };
        // The replay runs on an exact fork of the doc and the gate judges
        // that fork, so what is approved is what is written. The fork
        // becomes the doc only after the yes; the room task reads no frame
        // in between.
        let other = if undo {
            Direction::Redo
        } else {
            Direction::Undo
        };
        let fork = self
            .doc
            .fork()
            .map_err(|e| Fault::Internal(e.to_string()))?;
        let mut replayed = None;
        if step.serial.is_some() {
            let before = fork.stack_top(other);
            let (_, update) = fork
                .replay(direction)
                .map_err(|e| Fault::Internal(e.to_string()))?;
            let after = fork.stack_top(other);
            replayed = Some((if after != before { after } else { None }, update));
        }
        let target = self.export_doc(&fork).await?;
        // Node asks before it checks for a conflict.
        match self.approve_replay(input, &target, direction).await? {
            Approved::Yes => {}
            Approved::Ask(question) => {
                self.put_back(undo, step);
                return Ok(Executed::Ask(question));
            }
            Approved::Refused(result) => {
                self.put_back(undo, step);
                return Ok(Executed::Done {
                    result,
                    delivery: Delivery::None,
                });
            }
        }
        let mut step = step;
        let blocks = blocks_of(&self.export().await?);
        let top = self.doc.stack_top(direction);
        if shape(&step, &blocks) != step.shape || (step.serial.is_some() && top != step.serial) {
            let word = if undo { "undone" } else { "redone" };
            let message = format!(
                "Someone else changed the blocks this step added, removed or moved, so it can no longer be {word}. Re-read the document before retrying."
            );
            self.put_back(undo, step);
            return Ok(Executed::Done {
                result: failed("CONFLICT", &message, true, self.revision()),
                delivery: Delivery::None,
            });
        }
        if let Some((serial, update)) = replayed {
            step.serial = serial;
            watch(&fork, &self.local, &self.count);
            self.doc = fork;
            if let Some(update) = update {
                self.local
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .push(update);
                self.count.fetch_add(1, Ordering::SeqCst);
            }
        }
        step.shape = shape(&step, &blocks_of(&target));
        if undo {
            self.undone.push(step);
            let mark = self.marks_past.pop().unwrap_or(Mark::Own);
            self.marks_future.push(mark);
        } else {
            self.done.push(step);
            let mark = self.marks_future.pop().unwrap_or(Mark::Own);
            self.marks_past.push(mark);
        }
        let result = json!({
            "ok": true,
            "revision": self.revision(),
            "results": [{}],
            "refs": {},
            "changed": { "created": [], "updated": [], "moved": [], "removed": [] },
            "warnings": [],
        });
        self.finish_batch(result.to_string(), &result, true).await
    }

    /// The executor's historyStep check: a restore cannot be undone, and
    /// nothing is redone after one.
    fn mark_refusal(&self, undo: bool) -> Option<String> {
        let (code, message) = match self.marks_past.last()? {
            Mark::Own => return None,
            Mark::Other if !undo => return None,
            Mark::Other => (
                "UNDO_OTHER_DOCUMENT",
                "The last batch wrote another document (a sub-page title or icon). history.undo cannot undo it. To revert it, run that command again with the old value.".to_owned(),
            ),
            Mark::Restored(previous) => Self::restore_refusal(previous, undo),
        };
        Some(
            json!({
                "ok": false,
                "revision": self.revision(),
                "error": { "code": code, "message": message, "commandIndex": 0, "retryable": false },
                "warnings": [],
            })
            .to_string(),
        )
    }

    fn restore_refusal(previous: &str, undo: bool) -> (&'static str, String) {
        if undo {
            let mut message =
                "The last batch restored a version. history.undo cannot undo a restore.".to_owned();
            if !previous.is_empty() {
                message.push_str(&format!(
                    " To go back, history.restore \"{previous}\", the version that was current before."
                ));
            }
            ("UNDO_RESTORED", message)
        } else {
            (
                "NOTHING_TO_REDO",
                "The last batch restored a version. There is nothing to redo after it.".to_owned(),
            )
        }
    }

    /// The executor's approval gate, run in the bundle: the live document,
    /// with `target` (the step replayed on a fork) as the session's one
    /// step, so undoing a lock asks as database.setLock does.
    async fn approve_replay(
        &self,
        input: &ExecuteInput,
        target: &str,
        direction: Direction,
    ) -> Result<Approved, Fault> {
        let target: Value =
            serde_json::from_str(target).map_err(|e| Fault::Internal(e.to_string()))?;
        let document = self.export().await?;
        let mut mcp = self.shared.flags.clone();
        mcp["mode"] = json!("live");
        mcp["write"] = json!(!self.read_only);
        // The carried history is kept only at the document's own revision.
        let read = self
            .shared
            .bundle
            .call_raw(
                "mcpRead",
                &Obj::new()
                    .val("mcp", &mcp)
                    .raw("document", &document)
                    .val("actor", &input.actor)
                    .val("view", &json!({}))
                    .finish(),
            )
            .await?;
        let view: Value = serde_json::from_str(read.text("answer").unwrap_or("null"))
            .map_err(|e| Fault::Internal(e.to_string()))?;
        let revision = view
            .pointer("/structuredContent/revision")
            .cloned()
            .unwrap_or(Value::Null);
        let history = if direction == Direction::Undo {
            json!({ "past": [target], "future": [], "revision": revision })
        } else {
            json!({ "past": [], "future": [target], "revision": revision })
        };
        let out = self
            .shared
            .bundle
            .call_raw(
                "agentExecute",
                &self
                    .session_input(!self.read_only, &document, &input.actor)
                    .val("history", &history)
                    .val("batch", &input.batch)
                    .val("approval", &input.approval)
                    .finish(),
            )
            .await?;
        if let Some(ask) = out.value("ask") {
            return Ok(Approved::Ask(ask));
        }
        if out.value("result").and_then(|r| r.get("ok").cloned()) != Some(Value::Bool(true)) {
            return Ok(Approved::Refused(
                out.text("result").unwrap_or("{}").to_owned(),
            ));
        }
        Ok(Approved::Yes)
    }

    /// Reads the room until the doc counts an update past `before`, or
    /// `timeout` passes.
    async fn wait_for_update(&mut self, before: u64, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while self.count.load(Ordering::SeqCst) == before && self.end.is_none() {
            match tokio::time::timeout_at(deadline, recv(&mut self.events)).await {
                Ok(event) => self.on_event(event).await,
                Err(_) => return,
            }
        }
    }

    /// A step that was not replayed goes back where it was.
    fn put_back(&mut self, undo: bool, step: Step) {
        if undo {
            self.done.push(step);
        } else {
            self.undone.push(step);
        }
    }

    // ---- version history over HTTP (src/mcp/live/version-history.ts) ----

    fn history_base(&self) -> String {
        format!("{}/history", ws::http_url(&self.spec.url))
    }

    async fn history_send(
        &self,
        method: &str,
        url: &str,
        extra: Vec<(String, String)>,
    ) -> Result<crate::outbound::Answer, String> {
        let mut fresh = false;
        loop {
            let mut headers = extra.clone();
            if let Some(tickets) = &self.spec.tickets {
                // Node puts the thrown error's message after "The version history failed: ".
                let ticket = tickets.get(fresh).await.map_err(|fault| match fault {
                    Fault::Host(error) => error.error["message"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned(),
                    Fault::Internal(message) => message,
                })?;
                headers.push(("Authorization".to_owned(), format!("Bearer {ticket}")));
            }
            if let Some(origin) = &self.spec.origin {
                headers.push(("Origin".to_owned(), origin.clone()));
            }
            let answer = self
                .shared
                .outbound
                .send(method, url, headers, None, Duration::from_secs(60))
                .await
                .map_err(|_| HISTORY_UNREACHABLE.to_owned())?;
            if answer.status == 401 && !fresh && self.spec.tickets.is_some() {
                fresh = true;
                continue;
            }
            return Ok(answer);
        }
    }

    async fn history_versions(
        &self,
        group: Option<&Value>,
    ) -> Result<Value, (String, Option<u16>)> {
        let mut url = self.history_base();
        if let Some(group) = group.and_then(Value::as_i64) {
            url = format!("{url}?group={group}");
        }
        let answer = self
            .history_send("GET", &url, Vec::new())
            .await
            .map_err(|m| (m, None))?;
        if !(200..=299).contains(&answer.status) {
            return Err((
                format!(
                    "The sync server answered {}: {}",
                    answer.status,
                    String::from_utf8_lossy(&answer.body).trim()
                ),
                Some(answer.status),
            ));
        }
        let body: Value = serde_json::from_slice(&answer.body).unwrap_or(Value::Null);
        let Some(versions) = body.get("versions").and_then(Value::as_array) else {
            return Err((
                "The sync server sent a version list it could not read.".to_owned(),
                None,
            ));
        };
        let current: BTreeSet<String> = body
            .get("lineages")
            .and_then(Value::as_array)
            .map(|l| {
                l.iter()
                    .filter(|e| e.get("current") == Some(&Value::Bool(true)))
                    .filter_map(|e| e.get("lineage").map(js_string))
                    .collect()
            })
            .unwrap_or_default();
        let time = |v: Option<&Value>| v.filter(|v| v.is_number()).cloned().unwrap_or(Value::Null);
        Ok(Value::Array(
            versions
                .iter()
                .filter(|v| v.is_object())
                .map(|v| {
                    let lineage = v.get("lineage").map(js_string).unwrap_or_default();
                    let mut entry = Map::new();
                    entry.insert(
                        "version".to_owned(),
                        json!(format!(
                            "{lineage}:{}",
                            v.get("sequence").map(js_string).unwrap_or_default()
                        )),
                    );
                    entry.insert("savedAt".to_owned(), time(v.get("savedAt")));
                    entry.insert("startedAt".to_owned(), time(v.get("startedAt")));
                    entry.insert(
                        "actors".to_owned(),
                        Value::Array(
                            v.get("actors")
                                .and_then(Value::as_array)
                                .map(|a| a.iter().filter(|x| x.is_string()).cloned().collect())
                                .unwrap_or_default(),
                        ),
                    );
                    if !current.contains(&lineage) {
                        entry.insert("beforeReset".to_owned(), json!(true));
                    }
                    Value::Object(entry)
                })
                .collect(),
        ))
    }

    async fn history_read(&self, version: &str) -> Result<Value, (String, Option<u16>)> {
        let Some(path) = point_path(version) else {
            return Ok(Value::Null);
        };
        let url = format!("{}/{path}", self.history_base());
        let answer = self
            .history_send("GET", &url, Vec::new())
            .await
            .map_err(|m| (m, None))?;
        if answer.status == 404 {
            return Ok(Value::Null);
        }
        if !(200..=299).contains(&answer.status) {
            return Err((
                format!(
                    "The sync server answered {}: {}",
                    answer.status,
                    String::from_utf8_lossy(&answer.body).trim()
                ),
                Some(answer.status),
            ));
        }
        let body: Value = serde_json::from_slice(&answer.body).unwrap_or(Value::Null);
        Ok(if body.get("blocks").is_some_and(Value::is_array) {
            body
        } else {
            Value::Null
        })
    }

    /// The preview route's answer for a history.previewRestore, keyed by its
    /// version (null for a 404). Arguments the bundle refuses ask nothing.
    async fn history_preview(&self, args: &Value) -> Result<Value, (String, Option<u16>)> {
        let mut previews = Map::new();
        let Some(version) = args
            .get("version")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        else {
            return Ok(Value::Object(previews));
        };
        let query = match args.get("databases") {
            None => String::new(),
            Some(Value::String(databases)) if databases == "keep" || databases == "restore" => {
                format!("?databases={databases}")
            }
            Some(_) => return Ok(Value::Object(previews)),
        };
        let Some(path) = point_path(version) else {
            previews.insert(version.to_owned(), Value::Null);
            return Ok(Value::Object(previews));
        };
        let url = format!("{}/{path}/restore/preview{query}", self.history_base());
        let answer = self
            .history_send("POST", &url, Vec::new())
            .await
            .map_err(|m| (m, None))?;
        if answer.status == 404 {
            previews.insert(version.to_owned(), Value::Null);
            return Ok(Value::Object(previews));
        }
        if !(200..=299).contains(&answer.status) {
            return Err((
                format!(
                    "The sync server answered {}: {}",
                    answer.status,
                    String::from_utf8_lossy(&answer.body).trim()
                ),
                Some(answer.status),
            ));
        }
        let Ok(body) = serde_json::from_slice::<Value>(&answer.body) else {
            return Err((
                "The sync server sent a restore preview it could not read.".to_owned(),
                None,
            ));
        };
        previews.insert(version.to_owned(), body);
        Ok(Value::Object(previews))
    }

    /// The versionHistory input for a history command: the list and the
    /// documents the command names, or `failed` with the reason.
    async fn load_versions(&self, name: &str, batch: &Value) -> Value {
        let args = batch
            .pointer("/commands/0/args")
            .cloned()
            .unwrap_or(json!({}));
        let failed = |(message, status): (String, Option<u16>)| {
            let mut out = json!({ "failed": message });
            if let Some(status) = status {
                out["status"] = json!(status);
            }
            // No answer came: Node's fetch error says a retry can help.
            if message == HISTORY_UNREACHABLE {
                out["retryable"] = json!(true);
            }
            out
        };
        let mut out = json!({});
        if name == "history.previewRestore" {
            // A preview asks its own route and reads nothing else.
            return match self.history_preview(&args).await {
                Ok(previews) => json!({ "previews": previews }),
                Err(err) => failed(err),
            };
        }
        if name == "history.versions" || name == "history.restore" {
            match self.history_versions(args.get("group")).await {
                Ok(versions) => out["versions"] = versions,
                Err(err) => return failed(err),
            }
        }
        let keys: &[&str] = match name {
            "history.read" | "history.restore" => &["version"],
            "history.changes" => &["from", "to"],
            _ => &[],
        };
        let mut documents = Map::new();
        for key in keys {
            let Some(version) = args.get(*key).and_then(Value::as_str) else {
                continue;
            };
            if documents.contains_key(version) {
                continue;
            }
            match self.history_read(version).await {
                Ok(document) => {
                    documents.insert(version.to_owned(), document);
                }
                Err(err) => return failed(err),
            }
        }
        if !keys.is_empty() {
            out["documents"] = Value::Object(documents);
        }
        out
    }

    /// POSTs the restore, pinned to `previous`, the head the checks saw.
    async fn restore(&self, version: &str, previous: Option<&str>) -> Result<(), RestoreFailure> {
        let Some(path) = point_path(version) else {
            return Err(RestoreFailure::NotFound(version.to_owned()));
        };
        let mut key = [0u8; 16];
        let _ = self.random.fill(&mut key);
        let Some(headers) = restore_headers(&uuid(&key), previous) else {
            return Err(RestoreFailure::Stale);
        };
        let url = format!("{}/{path}/restore", self.history_base());
        let answer = self
            .history_send("POST", &url, headers)
            .await
            .map_err(|message| RestoreFailure::Host(message, None))?;
        match restore_verdict(answer.status) {
            Ok(Restored::Done) => Ok(()),
            Ok(Restored::NotFound) => Err(RestoreFailure::NotFound(version.to_owned())),
            Ok(Restored::Stale) => Err(RestoreFailure::Stale),
            Err(status) => Err(RestoreFailure::Host(
                format!(
                    "The sync server answered {}: {}",
                    answer.status,
                    String::from_utf8_lossy(&answer.body).trim()
                ),
                status,
            )),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Restored {
    Done,
    NotFound,
    Stale,
}

/// Why nothing was restored, as Node's runRestore reports it.
#[derive(Debug)]
enum RestoreFailure {
    NotFound(String),
    Stale,
    /// The host failed: its message, and its status when it answered.
    Host(String, Option<u16>),
}

/// The restore route's status, as Node's live version history reads it.
fn restore_verdict(status: u16) -> Result<Restored, Option<u16>> {
    match status {
        200..=299 => Ok(Restored::Done),
        404 => Ok(Restored::NotFound),
        412 => Ok(Restored::Stale),
        other => Err(Some(other)),
    }
}

/// The restore's headers; None when `previous` is a tag the server cannot
/// read, which would restore unpinned.
fn restore_headers(key: &str, previous: Option<&str>) -> Option<Vec<(String, String)>> {
    let mut headers = vec![("Blok-Idempotency-Key".to_owned(), key.to_owned())];
    if let Some(previous) = previous {
        point_path(previous)?;
        headers.push(("If-Match".to_owned(), format!("\"{previous}\"")));
    }
    Some(headers)
}

/// The failed batch result Node's executor gives, key order included: its
/// runRestore throws these at command 0, after the plan's own revision.
fn restore_failure(result: &Value, failure: &RestoreFailure) -> String {
    let error = match failure {
        RestoreFailure::NotFound(version) => json!({
            "code": "VERSION_NOT_FOUND",
            "message": format!("There is no version \"{version}\". history.versions lists them."),
            "path": "/commands/0/args/version",
            "retryable": false,
            "commandIndex": 0,
        }),
        RestoreFailure::Stale => json!({
            "code": "STALE",
            "message": "The document changed since the version history was read, so nothing was restored. Read it again, then retry.",
            "commandIndex": 0,
            "retryable": true,
        }),
        RestoreFailure::Host(message, status) => {
            // Node's ask(): no answer, a 429 or a 5xx other than a plain 500 or a 501 may pass on a retry.
            // A failed ticket is a plain error: only no answer at all may pass.
            let retryable = match status {
                None => message == HISTORY_UNREACHABLE,
                Some(status) => *status == 429 || ((502..=599).contains(status) && *status != 501),
            };
            json!({
                "code": "TOOL_ACTION_FAILED",
                "message": format!("The version history failed: {message}"),
                "retryable": retryable,
                "commandIndex": 0,
                "path": "/commands/0/args",
            })
        }
    };
    json!({
        "ok": false,
        "revision": result.get("revision").cloned().unwrap_or(Value::Null),
        "error": error,
        "warnings": result.get("warnings").cloned().unwrap_or_else(|| json!([])),
    })
    .to_string()
}

/// Node's words when fetch got no answer ("fetch failed" is undici's).
const HISTORY_UNREACHABLE: &str = "The sync server could not be reached: fetch failed";

/// Counts the doc's updates for l<n> and keeps its local ones to send.
fn watch(doc: &Doc, local: &Arc<Mutex<Vec<Vec<u8>>>>, count: &Arc<AtomicU64>) {
    let (local, count) = (local.clone(), count.clone());
    // Kept for the life of the doc: the subscription is never dropped.
    std::mem::forget(doc.on_update(move |event| {
        count.fetch_add(1, Ordering::SeqCst);
        if event.local {
            local
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(event.update.clone());
        }
    }));
}

async fn recv(events: &mut Option<mpsc::UnboundedReceiver<Event>>) -> Option<Event> {
    match events {
        Some(events) => events.recv().await,
        None => std::future::pending().await,
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// "lineage:sequence" as its route path.
fn point_path(version: &str) -> Option<String> {
    let colon = version.rfind(':')?;
    let (lineage, sequence) = (&version[..colon], &version[colon + 1..]);
    if colon == 0
        || lineage == "."
        || lineage == ".."
        || sequence.is_empty()
        || !sequence.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    Some(format!(
        "{}/{sequence}",
        crate::sources::encode_uri_component(lineage)
    ))
}

fn uuid(bytes: &[u8; 16]) -> String {
    let mut b = *bytes;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex(&b);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn blocks_of(document: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(document)
        .ok()
        .and_then(|d| d.get("blocks").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

/// The blocks a batch added, removed or moved (store-applier.ts applyOne).
fn step_ids(edits: &Value, before: &[Value], step: &mut Step) {
    let children_of = |id: &str| -> Vec<String> {
        before
            .iter()
            .find(|b| str_of(b, "id") == Some(id))
            .and_then(|b| b.get("content"))
            .and_then(Value::as_array)
            .map(|c| {
                c.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    fn tree(block: &Value, step: &mut Step) {
        if let Some(id) = str_of(block, "id") {
            step.ids.insert(id.to_owned());
        }
        for child in block
            .get("children")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            tree(child, step);
        }
    }
    for edit in edits.as_array().into_iter().flatten() {
        let id = str_of(edit, "id").unwrap_or_default().to_owned();
        match str_of(edit, "op") {
            Some("insert") => {
                if let Some(block) = edit.get("block") {
                    tree(block, step);
                }
            }
            Some("remove") => {
                if edit.get("withChildren") == Some(&Value::Bool(true)) {
                    let mut stack = vec![id];
                    while let Some(current) = stack.pop() {
                        stack.extend(children_of(&current));
                        step.ids.insert(current.clone());
                        step.placed_only.remove(&current);
                    }
                } else {
                    for child in children_of(&id) {
                        if step.ids.insert(child.clone()) {
                            step.placed_only.insert(child);
                        }
                    }
                    step.ids.insert(id.clone());
                    step.placed_only.remove(&id);
                }
            }
            Some("move") if step.ids.insert(id.clone()) => {
                step.placed_only.insert(id);
            }
            _ => {}
        }
    }
}

/// The step's blocks as the document has them now, with each parent's
/// order of them. Only compared with itself.
fn shape(step: &Step, blocks: &[Value]) -> String {
    let find = |id: &str| blocks.iter().find(|b| str_of(b, "id") == Some(id));
    let placement = |id: &str| -> Value {
        let Some(block) = find(id) else {
            return Value::Null;
        };
        let parent = str_of(block, "parent").map(str::to_owned);
        let siblings: Vec<String> = match &parent {
            None => blocks
                .iter()
                .filter(|b| b.get("parent").is_none())
                .filter_map(|b| str_of(b, "id").map(str::to_owned))
                .collect(),
            Some(parent) => find(parent)
                .and_then(|p| p.get("content"))
                .and_then(Value::as_array)
                .map(|c| {
                    c.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        };
        let at = siblings.iter().position(|s| s == id);
        let after = at
            .and_then(|at| at.checked_sub(1))
            .map(|i| siblings[i].clone());
        json!({ "parentId": parent, "afterId": after })
    };
    let order_in = |parent: &Option<String>| -> Value {
        let order: Option<Vec<String>> = match parent {
            None => Some(
                blocks
                    .iter()
                    .filter(|b| b.get("parent").is_none())
                    .filter_map(|b| str_of(b, "id").map(str::to_owned))
                    .collect(),
            ),
            Some(parent) => find(parent)
                .and_then(|p| p.get("content"))
                .and_then(Value::as_array)
                .map(|c| {
                    c.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                }),
        };
        match order {
            None => Value::Null,
            Some(order) => json!(
                order
                    .into_iter()
                    .filter(|id| step.ids.contains(id))
                    .collect::<Vec<_>>()
            ),
        }
    };
    let described: Vec<Value> = step
        .ids
        .iter()
        .map(|id| match find(id) {
            None => json!("gone"),
            Some(_) if step.placed_only.contains(id) => placement(id),
            Some(block) => block.clone(),
        })
        .collect();
    let parents: Vec<Value> = step
        .parents
        .iter()
        .map(|parent| json!([parent, order_in(parent)]))
        .collect();
    json!({ "blocks": described, "parents": parents }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_page_doc_is_empty_until_it_holds_a_block_or_a_title() {
        let doc = Doc::new(DocOptions::default());
        let fields = RichTextFields::built_in();
        assert!(page_doc_is_empty(&doc, &fields).unwrap());
        let page = doc.get_map("page").unwrap();
        doc.transact(|tx| {
            page.set(
                tx,
                "title",
                blok_jsjson::Value::String(blok_jsjson::Str::from("Taken")),
            )
        })
        .unwrap();
        assert!(!page_doc_is_empty(&doc, &fields).unwrap());
    }

    #[test]
    fn version_paths_are_lineage_and_sequence() {
        assert_eq!(point_path("abc:3").as_deref(), Some("abc/3"));
        assert_eq!(point_path(":3"), None);
        assert_eq!(point_path("..:3"), None);
        assert_eq!(point_path("a:x"), None);
    }

    // Node's live version history: 404 is no such version, 412 is a head
    // that moved past the one the checks saw; nothing was restored.
    #[test]
    fn a_restore_404_or_412_is_not_a_success() {
        assert_eq!(restore_verdict(204), Ok(Restored::Done));
        assert_eq!(restore_verdict(404), Ok(Restored::NotFound));
        assert_eq!(restore_verdict(412), Ok(Restored::Stale));
        assert_eq!(restore_verdict(503), Err(Some(503)));
    }

    // The restore pins the head the checks saw, as Node and C# do.
    #[test]
    fn a_restore_sends_if_match_with_the_version_current_before() {
        assert_eq!(
            restore_headers("k", Some("abc:2")),
            Some(vec![
                ("Blok-Idempotency-Key".to_owned(), "k".to_owned()),
                ("If-Match".to_owned(), "\"abc:2\"".to_owned()),
            ])
        );
        assert_eq!(
            restore_headers("k", None),
            Some(vec![("Blok-Idempotency-Key".to_owned(), "k".to_owned())])
        );
        // A tag the server cannot read would restore unpinned: stale, never sent.
        assert_eq!(restore_headers("k", Some("nope")), None);
    }

    // Node's bytes (verify-live restore404/412/500 logs).
    #[test]
    fn a_failed_restore_answers_like_node() {
        let base = json!({ "ok": true, "revision": "l0", "results": [], "warnings": [] });
        assert_eq!(
            restore_failure(&base, &RestoreFailure::NotFound("a:1".to_owned())),
            r#"{"ok":false,"revision":"l0","error":{"code":"VERSION_NOT_FOUND","message":"There is no version \"a:1\". history.versions lists them.","path":"/commands/0/args/version","retryable":false,"commandIndex":0},"warnings":[]}"#
        );
        assert_eq!(
            restore_failure(&base, &RestoreFailure::Stale),
            r#"{"ok":false,"revision":"l0","error":{"code":"STALE","message":"The document changed since the version history was read, so nothing was restored. Read it again, then retry.","commandIndex":0,"retryable":true},"warnings":[]}"#
        );
        let host = |message: &str, status| {
            restore_failure(&base, &RestoreFailure::Host(message.to_owned(), status))
        };
        assert_eq!(
            host("The sync server answered 503: {\"error\":\"x\"}", Some(503)),
            r#"{"ok":false,"revision":"l0","error":{"code":"TOOL_ACTION_FAILED","message":"The version history failed: The sync server answered 503: {\"error\":\"x\"}","retryable":true,"commandIndex":0,"path":"/commands/0/args"},"warnings":[]}"#
        );
        // A plain 500, a 501 or a refusal never passes on a retry.
        for status in [500, 501, 403] {
            assert!(
                host("x", Some(status)).contains(r#""retryable":false"#),
                "{status}"
            );
        }
        assert!(host("x", Some(429)).contains(r#""retryable":true"#));
        // No answer at all: the network may come back.
        assert!(host(HISTORY_UNREACHABLE, None).contains(r#""retryable":true"#));
    }

    // provider.ts: the second 1009 since an answer shipped is terminal, and
    // a resync answer as big as a refused frame is never written.
    #[test]
    fn a_second_close_1009_ends_the_room() {
        let mut sizes = SizeMemory::default();
        sizes.sent(500);
        assert!(!sizes.too_big());
        assert!(!sizes.may_answer(500, None));
        assert!(sizes.may_answer(499, None));
        assert!(!sizes.may_answer(10, Some(9)));
        sizes.largest_sent = 0;
        assert!(sizes.too_big());
        sizes.answered();
        assert!(!sizes.too_big());
        // A 1009 before any write leaves no bound.
        let mut fresh = SizeMemory::default();
        fresh.too_big();
        assert!(fresh.may_answer(1 << 20, None));
    }

    #[test]
    fn a_step_counts_the_blocks_it_added_removed_or_moved() {
        let before = vec![
            json!({ "id": "a", "content": ["c"] }),
            json!({ "id": "c", "parent": "a" }),
        ];
        let edits = json!([
            { "op": "insert", "block": { "id": "n", "children": [{ "id": "n2", "children": [] }] } },
            { "op": "move", "id": "m" },
            { "op": "remove", "id": "a" },
            { "op": "setData", "id": "x" },
        ]);
        let mut step = Step {
            serial: None,
            ids: BTreeSet::new(),
            placed_only: BTreeSet::new(),
            parents: BTreeSet::new(),
            shape: String::new(),
        };
        step_ids(&edits, &before, &mut step);
        assert_eq!(
            step.ids.iter().map(String::as_str).collect::<Vec<_>>(),
            vec!["a", "c", "m", "n", "n2"]
        );
        assert_eq!(
            step.placed_only
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["c", "m"]
        );
    }

    #[test]
    fn a_peer_edit_inside_a_step_block_changes_its_shape() {
        let mut step = Step {
            serial: None,
            ids: BTreeSet::from(["p1".to_owned()]),
            placed_only: BTreeSet::new(),
            parents: BTreeSet::from([None]),
            shape: String::new(),
        };
        let before = vec![json!({ "id": "p1", "data": { "text": "Hello" } })];
        step.shape = shape(&step, &before);
        let typed = vec![json!({ "id": "p1", "data": { "text": "Hello!" } })];
        let other = vec![
            json!({ "id": "p1", "data": { "text": "Hello" } }),
            json!({ "id": "x", "parent": "q" }),
        ];
        assert_ne!(shape(&step, &typed), step.shape);
        assert_eq!(shape(&step, &other), step.shape);
        assert_ne!(shape(&step, &[]), step.shape);
    }
}

/// The opener's check that a new page room is empty. It skips the bundle:
/// Node's check ends inside the 100 ms presence throttle, so the room sees
/// only the departure, and a bundle read is slow enough to let the announce
/// out first.
fn page_doc_is_empty(doc: &Doc, fields: &RichTextFields) -> Result<bool, Fault> {
    let internal = |e: &dyn std::fmt::Display| Fault::Internal(e.to_string());
    let (blocks, _) = blok_collab_convert::export(doc, fields, None).map_err(|e| internal(&e))?;
    let page = blok_collab_convert::export_page(doc).map_err(|e| internal(&e))?;
    Ok(blocks.is_empty() && page.members().is_empty())
}

/// presenceColorFor(the SHA-256 seed of the actor id), as presence.ts picks it.
pub fn presence_color(actor_id: &str) -> String {
    const PALETTE: [&str; 8] = [
        "#0b6e99", "#c1461f", "#0f7b6c", "#6940a5", "#ad1a72", "#886c1a", "#1f5aa8", "#8f3a1c",
    ];
    let digest = ring::digest::digest(&ring::digest::SHA256, actor_id.as_bytes());
    let seed = u16::from_be_bytes([digest.as_ref()[0], digest.as_ref()[1]]);
    PALETTE[usize::from(seed) % PALETTE.len()].to_owned()
}

#[cfg(test)]
mod color_tests {
    #[test]
    fn colours_the_agent_as_node_does() {
        assert_eq!(super::presence_color("agent:alice:claude-code"), "#8f3a1c");
    }
}
