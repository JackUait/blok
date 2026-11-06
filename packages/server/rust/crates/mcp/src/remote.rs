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
    Done { result: String, delivery: Delivery },
}

pub enum Delivery {
    None,
    Now(Value),
    Wait(oneshot::Receiver<Fate>),
    Failed(HostError),
}

pub struct ExecuteInput {
    pub batch: Value,
    pub actor: Value,
    pub approval: Value,
    pub created_pages: Vec<String>,
    /// The page the host could not create, for the insert that needs it.
    pub create_failure: Option<Value>,
    /// What each page write the host made gave, in batch order.
    pub page_writes: Vec<Value>,
}

enum Command {
    Execute(ExecuteInput, oneshot::Sender<Result<Executed, Fault>>),
    Read(Value, Value, oneshot::Sender<Result<String, Fault>>),
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
    poisoned: bool,
    batches: Vec<Batch>,
    batch_number: u64,
    read_only: bool,
    end: Option<End>,
    done: Vec<Step>,
    undone: Vec<Step>,
    /// The executor's history marks, one per write batch: None for a write,
    /// Some(previous version) for a restore, which undo cannot cross.
    marks_past: Vec<Option<String>>,
    marks_future: Vec<Option<String>>,
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
                    Some(Command::PagesNeeded(batch, actor, approval, reply)) => {
                        let answer = self.pages_needed(&batch, &actor, &approval).await;
                        let _ = reply.send(answer);
                    }
                    Some(Command::Read(view, actor, reply)) => {
                        let answer = self.read(&view, &actor).await;
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
                let sv = self.doc.encode_state_vector();
                let sent = match encode(&Message::SyncStep1 { state_vector: sv }) {
                    Ok(bytes) => socket.send(&bytes).await,
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
            Some(socket) => socket.send(&bytes).await.is_err(),
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
                if self.apply_remote(&update).await {
                    self.mark_synced().await;
                }
            }
            Message::SyncUpdate { update } => {
                self.apply_remote(&update).await;
            }
            Message::SyncStep1 { state_vector } => match self.protocol {
                Protocol::V2 => self.on_resync(&state_vector).await,
                Protocol::V1 => {
                    if let Ok(update) = self.doc.encode_state_as_update(&state_vector) {
                        self.send(&Message::SyncStep2 { update }).await;
                    }
                }
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
                // The store refuses further rows of a quarantined lineage.
                self.poisoned = true;
            }
        }
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
            .val("approval", approval)
            .finish();
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
            Some(self.load_versions(&first, &input.batch).await)
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
            call = call.val("createFailure", failure);
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
            // A comment batch is marked too, as Node's executor does.
            self.marks_past.push(None);
            self.marks_future.clear();
        }
        let mut result_text = result_text;
        // A restore the bundle checked goes to the sync server's history route.
        if let Some(Value::String(version)) = out.value("restore") {
            let before = self.count.load(Ordering::SeqCst);
            if let Err(failed) = self.restore(&version).await {
                return Ok(Executed::Done {
                    result: result_text,
                    delivery: Delivery::Failed(failed),
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
            self.marks_past.push(Some(previous.to_owned()));
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
                self.send(&Message::SyncUpdate {
                    update: update.clone(),
                })
                .await;
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
            let mark = self.marks_past.pop().flatten();
            self.marks_future.push(mark);
        } else {
            self.done.push(step);
            let mark = self.marks_future.pop().flatten();
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
        let previous = self.marks_past.last()?.as_ref()?;
        let (code, message) = if undo {
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
                let ticket = tickets.get(fresh).await.map_err(|f| format!("{f:?}"))?;
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
                .map_err(|_| "The sync server could not be reached.".to_owned())?;
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
            out
        };
        let mut out = json!({});
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

    async fn restore(&self, version: &str) -> Result<(), HostError> {
        let fail = |message: String| {
            HostError::surface(
                "TOOL_ACTION_FAILED",
                format!("The version history failed: {message}"),
            )
        };
        let Some(path) = point_path(version) else {
            return Ok(());
        };
        let mut key = [0u8; 16];
        let _ = self.random.fill(&mut key);
        let url = format!("{}/{path}/restore", self.history_base());
        let headers = vec![("Blok-Idempotency-Key".to_owned(), uuid(&key))];
        let answer = self
            .history_send("POST", &url, headers)
            .await
            .map_err(fail)?;
        if (200..=299).contains(&answer.status) || answer.status == 404 || answer.status == 412 {
            return Ok(());
        }
        Err(fail(format!(
            "The sync server answered {}: {}",
            answer.status,
            String::from_utf8_lossy(&answer.body).trim()
        )))
    }
}

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
    fn version_paths_are_lineage_and_sequence() {
        assert_eq!(point_path("abc:3").as_deref(), Some("abc/3"));
        assert_eq!(point_path(":3"), None);
        assert_eq!(point_path("..:3"), None);
        assert_eq!(point_path("a:x"), None);
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
