//! One MCP server: the tool dispatcher of src/mcp/dispatcher.ts, opener.ts
//! and stored-session.ts, over the bundle's MCP operations.

use std::sync::Arc;
use std::time::Duration;

use blok_blokagent::Executor;
use serde_json::{Map, Value, json};

use crate::authorize::{Authorize, Webhook};
use crate::bundle::{Bundle, Obj, RawObject};
use crate::document_source::{CustomSource, DocumentCaller, document_caller};
use crate::errors::{Fault, HostError};
use crate::handle_store::{Acquired, HandleLease, HandleRecord, HandleStore, StoreError};
use crate::handles::Handles;
use crate::live::{Live, TicketRequest};
use crate::options::{AgentActorFn, Hooks};
use crate::outbound::Outbound;
use crate::remote::{
    Delivery, ExecuteInput, Executed, Fate, LiveShared, Presence, Protocol, RemoteRoom,
    presence_color,
};
use crate::rooms::{RoomSession, Rooms, delivery};
use crate::sources::{EndpointSource, ListRequest, Source};

/// Who is calling: the principal, the client's raw name, and OAuth scopes.
#[derive(Debug, Clone)]
pub struct Caller {
    pub principal: String,
    pub client_name: Option<String>,
    /// None without OAuth.
    pub scopes: Option<Vec<String>>,
}

/// What a tool call can ask the person through, and the answers it brings.
#[derive(Debug, Clone, Default)]
pub struct Approval {
    pub capabilities: Value,
    pub replies: Option<Value>,
}

/// A tool answer: `structuredContent` as JSON text, and `isError`.
#[derive(Debug, Clone)]
pub struct Answer {
    pub structured: String,
    pub is_error: bool,
}

/// A question for the person; nothing was applied.
#[derive(Debug, Clone)]
pub struct Ask {
    pub key: String,
    pub message: Value,
    pub requested_schema: Value,
}

#[derive(Debug, Clone)]
pub enum Outcome {
    Answer(Answer),
    /// JSON-RPC -32602 with this message.
    UnknownTool(String),
    Ask(Ask),
}

/// What tools/list, initialize and prompts/list show; built once at start.
#[derive(Debug, Clone)]
pub struct Surface {
    pub tools: Vec<Value>,
    pub instructions: String,
    pub prompts: Vec<Value>,
    pub stored_revision: Value,
    pub live_revision: Value,
    pub live_unavailable: Value,
}

/// A stored handle's document, kept between calls as Node keeps its agent.
pub struct Stored {
    write: bool,
    document: String,
    history: String,
    version: Option<String>,
    /// A save failed and the reload did too: reload before the next call.
    stale: bool,
    /// Who opened the handle: a host's source acts for them (opener.ts sourceFor).
    opener: Arc<DocumentCaller>,
    /// The opener's agent actor, as a handle store keeps it.
    actor: Value,
}

impl Stored {
    /// A handle a shared store kept, rebuilt for its opener: the record
    /// carries the document, so nothing is loaded.
    fn from_record(record: &HandleRecord) -> Stored {
        let text = |key: &str| {
            record
                .actor
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        Stored {
            write: record.write,
            document: record.document.get().to_owned(),
            history: record.history.get().to_owned(),
            version: record.version.clone(),
            stale: record.stale,
            opener: Arc::new(DocumentCaller {
                principal: record.principal.clone(),
                client_name: record.client_name.clone(),
                scopes: record.scopes.clone(),
                actor: crate::options::AgentActor {
                    id: text("id").unwrap_or_default(),
                    name: text("name").unwrap_or_default(),
                    on_behalf_of: text("onBehalfOf"),
                    color: text("color"),
                },
            }),
            actor: record.actor.clone(),
        }
    }

    /// What changes between calls; a record is saved only when it did.
    fn state(&self) -> (&str, &str, Option<&str>, bool) {
        (
            &self.document,
            &self.history,
            self.version.as_deref(),
            self.stale,
        )
    }
}

pub enum Session {
    Stored(Stored),
    Room(RoomSession),
    Remote(RemoteRoom),
}

pub struct Mcp {
    bundle: Arc<Bundle>,
    /// Turns taken as stdio read each tools/call, by the JSON text of its id.
    reserved: std::sync::Mutex<crate::handles::Booked<Session>>,
    uploads: Option<crate::uploads::Uploads>,
    calls: Arc<crate::inflight::InFlight>,
    pub surface: Surface,
    flags: Value,
    pub principal: String,
    idle_ms: Value,
    handles: Arc<Handles<Session>>,
    source: Option<Source>,
    authorize: Option<Arc<dyn Authorize>>,
    agent_actor: Option<AgentActorFn>,
    page_creator: Option<Arc<dyn blok_blokagent::PageCreator>>,
    /// Where stored handles live; None keeps them in `handles`.
    store: Option<Arc<dyn HandleStore>>,
    max_handles: usize,
    idle: Duration,
    store_sweep_every: Duration,
    /// How long one store sweep may run before it is dropped.
    store_sweep_limit: Duration,
    /// Held while the store is swept, so a stop can wait for a sweep.
    sweeping: Arc<tokio::sync::Mutex<()>>,
    /// Set by a stop; cancels the sweep in flight.
    stop_sweeps: tokio::sync::watch::Sender<bool>,
    live: Option<Live>,
    live_shared: Option<Arc<LiveShared>>,
    rooms: Option<Rooms>,
}

const DEFAULT_IDLE_MS: u64 = 600_000;
// Above the slowest stored call (a 30 s endpoint load); a longer wait is better told to retry.
const LEASE_WAIT: Duration = Duration::from_secs(30);
// Well inside the files store's 30 s lease, so a slow call keeps its lease.
const LEASE_RENEW_EVERY: Duration = Duration::from_secs(5);
const STORE_SWEEP_EVERY: Duration = Duration::from_secs(60);
// Ends a sweep well before the next is due, as Go and C# do.
const STORE_SWEEP_LIMIT: Duration = Duration::from_secs(30);
// How long a stop waits for a cancelled sweep; one that will not end is left behind.
const SWEEP_STOP_WAIT: Duration = Duration::from_secs(1);
const STORE_DOWN: &str = "The handle store is unavailable. Retry shortly.";

/// A store failure: logged in full, and retryable for the agent, since a
/// store outage passes.
fn store_failed(err: StoreError) -> Fault {
    eprintln!("blok-mcp: the handle store failed: {err}");
    HostError::surface("SOURCE_UNAVAILABLE", STORE_DOWN).into()
}

/// Keeps a lease while a call runs; never ends. A failed renew is logged
/// and the call goes on: a lost lease shows when the call saves or removes.
async fn keep_renewing(lease: &dyn HandleLease) {
    loop {
        tokio::time::sleep(LEASE_RENEW_EVERY).await;
        if let Err(err) = lease.renew().await {
            eprintln!("blok-mcp: renewing a handle lease failed: {err}");
        }
    }
}

async fn release(lease: &dyn HandleLease) {
    if let Err(err) = lease.release().await {
        eprintln!("blok-mcp: releasing a handle lease failed: {err}");
    }
}

/// A store lease that is given back even when its call is dropped (a client
/// gone mid-call), so the next call does not wait it out.
struct HeldLease(Option<Box<dyn HandleLease>>);

impl HeldLease {
    fn lease(&self) -> &dyn HandleLease {
        self.0.as_deref().expect("a held lease")
    }

    async fn release(mut self) {
        if let Some(lease) = self.0.take() {
            release(&*lease).await;
        }
    }
}

impl Drop for HeldLease {
    fn drop(&mut self) {
        if let Some(lease) = self.0.take()
            && let Ok(runtime) = tokio::runtime::Handle::try_current()
        {
            runtime.spawn(async move { release(&*lease).await });
        }
    }
}

fn opt<'a>(options: &'a Value, key: &str) -> Option<&'a Value> {
    options.get(key).filter(|v| !v.is_null())
}

/// The start flags every surface and session call passes (08 §1 mcpSurface).
pub fn surface_flags(options: &Value) -> Value {
    let mut flags = Map::new();
    for key in [
        "pageTitles",
        "manifest",
        "overrides",
        "richTextFields",
        "schema",
        "handleIdleMs",
    ] {
        if let Some(value) = opt(options, key) {
            flags.insert(key.to_owned(), value.clone());
        }
    }
    flags.insert(
        "sync".to_owned(),
        Value::Bool(opt(options, "sync").is_some()),
    );
    flags.insert(
        "source".to_owned(),
        Value::Bool(opt(options, "source").is_some()),
    );
    flags.insert("uploads".to_owned(), Value::Bool(false));
    if opt(options, "comments") == Some(&Value::Bool(false)) {
        flags.insert("comments".to_owned(), Value::Bool(false));
    }
    Value::Object(flags)
}

fn answer_of(raw: &RawObject) -> Result<Answer, Fault> {
    let answer = raw
        .text("answer")
        .ok_or_else(|| Fault::Internal("the bundle gave no answer".to_owned()))?;
    let answer = RawObject::parse(answer).map_err(|e| Fault::Internal(e.to_string()))?;
    Ok(Answer {
        structured: answer.text("structuredContent").unwrap_or("{}").to_owned(),
        is_error: answer.value("isError") == Some(Value::Bool(true)),
    })
}

/// How many page documents to make before a batch runs: the count, or the
/// pages a refused batch had already prepared (Node made those too).
pub fn pages_to_make(counted: &Value) -> u64 {
    match counted.get("result") {
        // Nothing is made before a question or an approval refusal.
        Some(result)
            if result.pointer("/error/code").and_then(Value::as_str)
                == Some("APPROVAL_REQUIRED") =>
        {
            0
        }
        Some(_) => counted.get("prepared").and_then(Value::as_u64).unwrap_or(0),
        None => counted.get("count").and_then(Value::as_u64).unwrap_or(0),
    }
}

/// The page writes the pre-pass named: page.rename and page.setIcon write
/// the page's own document first.
fn page_writes(counted: &Value) -> Vec<(String, Value)> {
    counted
        .get("writes")
        .and_then(Value::as_array)
        .map(|writes| {
            writes
                .iter()
                .filter_map(|w| Some((str_of(w, "pageId")?.to_owned(), w.get("batch")?.clone())))
                .collect()
        })
        .unwrap_or_default()
}

/// What the host did for a batch before the bundle runs it.
#[derive(Default)]
struct HostWork {
    created: Vec<String>,
    create_failure: Option<Value>,
    /// The host's creator was cancelled after it made `created`.
    cancelled: bool,
    page_writes: Vec<Value>,
    /// A live page write went out but was not acknowledged.
    unconfirmed: bool,
}

/// As page-titles.ts: a batch whose page write the room did not confirm is
/// not durable, though it succeeded.
fn unconfirmed_delivery(unconfirmed: bool, result: &str, delivery: Option<Value>) -> Option<Value> {
    {
        let ok = serde_json::from_str::<Value>(result)
            .is_ok_and(|r| r.get("ok") == Some(&Value::Bool(true)));
        if !unconfirmed || !ok {
            return delivery;
        }
        let mut delivery = delivery.unwrap_or_else(|| {
            json!({ "durable": false, "pending": false, "serverSequence": null, "savedVersion": null })
        });
        delivery["durable"] = json!(false);
        delivery["pending"] = json!(true);
        Some(delivery)
    }
}

/// Holds the saved version's place in an answer built before the save.
/// Random, so no batch text holds it by chance.
fn saved_version_stand_in() -> String {
    use std::hash::{BuildHasher, Hasher};
    let random = |n: u64| {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u64(n);
        hasher.finish()
    };
    format!("blok-saved-version-{:016x}{:016x}", random(1), random(2))
}

/// A host error as Node's surface error carries it, with its retryable flag.
fn agent_error_of(error: &HostError) -> Value {
    let mut agent = error.error.clone();
    if error.helper != crate::errors::Helper::AsIs {
        agent["retryable"] = json!(matches!(
            error.code(),
            "ROOM_SYNC_TIMEOUT" | "SOURCE_UNAVAILABLE" | "DOCUMENT_CHANGED" | "HANDLE_LIMIT"
        ));
    }
    agent
}

/// A server error that stopped a batch after its pages were made. The cause
/// is blokagent's (pagecreate.rs stopped_after_creating), as the C# and Go
/// servers give it; the error itself goes only to stderr.
fn runtime_failure(message: &str) -> HostError {
    eprintln!("blok-mcp: a batch stopped after its pages were made: {message}");
    HostError::as_is(json!({
        "code": "APPLY_FAILED",
        "message": "The batch stopped on a server error. Nothing was written.",
        "retryable": true,
    }))
}

// runtime_failure's log line for a creator failure, which is already logged in full.
const HOST_STOPPED: &str = "the host could not create a page";

/// The pages of `created` that `document` links from no page block; None
/// when it is no document.
fn unlinked_pages<'a>(document: &str, created: &'a [String]) -> Option<Vec<&'a String>> {
    let document: Value = serde_json::from_str(document).ok()?;
    let blocks = document.get("blocks")?.as_array()?;
    let linked: std::collections::HashSet<&str> = blocks
        .iter()
        .filter(|block| str_of(block, "type") == Some("page"))
        .filter_map(|block| block.pointer("/data/pageId").and_then(Value::as_str))
        .collect();
    Some(
        created
            .iter()
            .filter(|page_id| !linked.contains(page_id.as_str()))
            .collect(),
    )
}

/// The bundle's isBatchEnvelope: commands of {name, args, ref?}.
pub fn is_batch_envelope(batch: &Value) -> bool {
    batch
        .get("commands")
        .and_then(Value::as_array)
        .is_some_and(|commands| {
            commands.iter().all(|command| {
                command.get("name").is_some_and(Value::is_string)
                    && command.get("args").is_some_and(Value::is_object)
                    && command.get("ref").is_none_or(Value::is_string)
            })
        })
}

// src/shared/mint-id.ts's alphabet, so ids look the same.
const PAGE_ID_ALPHABET: &[u8; 64] =
    b"57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9";

fn mint_page_id() -> String {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut bytes = [0u8; 10];
    let _ = SystemRandom::new().fill(&mut bytes);
    bytes
        .iter()
        .map(|b| PAGE_ID_ALPHABET[usize::from(b & 63)] as char)
        .collect()
}

/// live-session.ts's ack wait: past it the batch is pending.
const DELIVERY_WAIT: Duration = Duration::from_secs(10);

/// A room's `{ structuredContent, isError }` answer text.
fn room_answer(text: &str) -> Result<Answer, Fault> {
    let answer = RawObject::parse(text).map_err(|e| Fault::Internal(e.to_string()))?;
    Ok(Answer {
        structured: answer.text("structuredContent").unwrap_or("{}").to_owned(),
        is_error: answer.value("isError") == Some(Value::Bool(true)),
    })
}

/// Node's isPresenceColor: #rgb, #rgba, #rrggbb or #rrggbbaa.
fn is_presence_color(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|hex| {
        matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

fn str_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// stdio reads calls in order and the server runs each in its own task, so a
/// call takes its place on its handle as it is read.
impl crate::stdio::Requests for Mcp {
    fn read(&self, id: &str, arguments: &Value) {
        let Some(handle) = str_of(arguments, "handle") else {
            return;
        };
        let turn = self.handles.reserve(handle, &self.principal);
        self.reserved
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .read(id, &arguments.to_string(), turn);
    }

    fn ended(&self, id: &str) {
        self.reserved
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .ended(id);
    }
}

/// Node's checkOptionSafety, which createBlokMcpServer runs for every
/// host: the CLI's checks hold for a library host too. Some: its refusal.
pub(crate) async fn option_refusal(
    bundle: &Bundle,
    options: &Value,
    hooks: &Hooks,
) -> Result<Option<String>, crate::bundle::BundleError> {
    let (authorize, uploads, custom_source) = (
        hooks.authorize.is_some(),
        hooks.uploads.as_ref(),
        hooks.source.is_some(),
    );
    let mut checked = options.clone();
    if authorize {
        checked["authorize"] = Value::Bool(true);
    }
    if hooks.page_creator.is_some() {
        checked["createPage"] = Value::Bool(true);
    }
    // No handleStore here: the bundle only checks that a host store has
    // count, tryAdd, acquire and sweep, which the Rust trait always has.
    // A host's source is a source: with a ticket URL it still needs a per-document check.
    if custom_source {
        checked["source"] = json!({ "kind": "custom" });
    }
    if let Some(uploads) = uploads {
        let mut described = json!({ "uploadByFile": true, "limits": uploads.limits });
        if let Some(root) = &uploads.root {
            described["root"] = json!(root.to_string_lossy());
        }
        checked["uploads"] = described;
    }
    let answer = bundle
        .call(
            "mcpCheckOptions",
            &json!({ "options": checked }).to_string(),
        )
        .await?;
    Ok(answer
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_owned))
}

/// Why `Mcp::build` made no server.
#[derive(Debug)]
pub enum BuildError {
    /// The options or hooks are refused (Node's McpConfigError): exit code 2.
    Config(String),
    /// Anything else, such as an engine failure: exit code 1.
    Failed(String),
}

impl BuildError {
    pub fn message(&self) -> &str {
        match self {
            BuildError::Config(message) | BuildError::Failed(message) => message,
        }
    }
}

impl From<crate::bundle::BundleError> for BuildError {
    fn from(err: crate::bundle::BundleError) -> Self {
        BuildError::Failed(err.0)
    }
}

impl Mcp {
    /// `rooms`: the embedding host's own collab rooms (`Server::agent_executor()`).
    /// Live handles then run in this process, with no ticket and no socket.
    pub async fn new(
        bundle: Arc<Bundle>,
        options: &Value,
        authorize: Option<Webhook>,
        rooms: Option<Arc<Executor>>,
    ) -> Result<Mcp, Fault> {
        Mcp::with_uploads(bundle, options, authorize, rooms, None).await
    }

    /// `uploads`: the host's own uploader, as Node's programmatic `uploads`
    /// option. It turns on `<kind>.uploadFile`, and `<tool>.setSource`
    /// copies a linked file when the uploader takes URLs.
    pub async fn with_uploads(
        bundle: Arc<Bundle>,
        options: &Value,
        authorize: Option<Webhook>,
        rooms: Option<Arc<Executor>>,
        uploads: Option<crate::uploads::Uploads>,
    ) -> Result<Mcp, Fault> {
        let hooks = Hooks {
            authorize: authorize.map(|hook| Arc::new(hook) as Arc<dyn Authorize>),
            uploads,
            rooms,
            ..Hooks::default()
        };
        Mcp::with_hooks(bundle, options, hooks).await
    }

    /// `options` as mcpParseArgs gives them (see `McpOptions::to_value`),
    /// and the options that are functions in Node.
    pub async fn with_hooks(
        bundle: Arc<Bundle>,
        options: &Value,
        hooks: Hooks,
    ) -> Result<Mcp, Fault> {
        Mcp::build(bundle, options, hooks)
            .await
            .map_err(|err| Fault::Internal(err.message().to_owned()))
    }

    /// As `with_hooks`, telling a refused option from a failure.
    pub async fn build(
        bundle: Arc<Bundle>,
        options: &Value,
        hooks: Hooks,
    ) -> Result<Mcp, BuildError> {
        if hooks.source.is_some() && opt(options, "source").is_some() {
            return Err(BuildError::Config(
                "hooks.source (the host's own document source) cannot be combined with options.source".to_owned(),
            ));
        }
        if let Some(refusal) = option_refusal(&bundle, options, &hooks).await? {
            return Err(BuildError::Config(refusal));
        }
        // The bundle sees no rooms in the options; they are live rooms too.
        if hooks.page_creator.is_some() && hooks.rooms.is_some() {
            return Err(BuildError::Config(
                "--create-page works in stored mode only: it cannot be used with live rooms (hooks.rooms)".to_owned(),
            ));
        }
        if let Some(root) = hooks.uploads.as_ref().and_then(|u| u.root.as_ref()) {
            crate::uploads::check_root(root).map_err(BuildError::Config)?;
        }
        let Hooks {
            authorize,
            agent_actor,
            uploads,
            rooms,
            source: custom,
            page_creator,
            handle_store: store,
        } = hooks;
        let mut flags = surface_flags(options);
        if uploads.is_some() {
            flags["uploads"] = Value::Bool(true);
        }
        if rooms.is_some() {
            flags["sync"] = Value::Bool(true);
        }
        if custom.is_some() {
            flags["source"] = Value::Bool(true);
        }
        let surface = bundle.call("mcpSurface", &flags.to_string()).await?;
        let list = |key: &str| {
            surface
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        let surface = Surface {
            tools: list("tools"),
            prompts: list("prompts"),
            instructions: str_of(&surface, "instructions")
                .unwrap_or_default()
                .to_owned(),
            stored_revision: surface
                .pointer("/contractRevision/stored")
                .cloned()
                .unwrap_or(Value::Null),
            live_revision: surface
                .pointer("/contractRevision/live")
                .cloned()
                .unwrap_or(Value::Null),
            live_unavailable: surface
                .get("liveUnavailableCommands")
                .cloned()
                .unwrap_or(json!([])),
        };
        let outbound = Outbound::new();
        let source = match (custom, opt(options, "source")) {
            (Some(custom), _) => Some(Source::Custom(CustomSource::new(custom))),
            // A host's source is a trait object; options alone cannot carry one.
            (None, Some(source)) if str_of(source, "kind") == Some("custom") => {
                return Err(BuildError::Config(
                    "source kind \"custom\" needs the host's source in hooks.source".to_owned(),
                ));
            }
            (None, Some(source)) if str_of(source, "kind") == Some("files") => {
                Some(Source::Files(crate::files::FilesSource::new(
                    str_of(source, "dir").unwrap_or("."),
                    bundle.clone(),
                )))
            }
            (None, Some(source)) => Some(Source::Endpoint(Box::new(EndpointSource::new(
                str_of(source, "url").unwrap_or_default().to_owned(),
                str_of(source, "endpointAuth")
                    .unwrap_or_default()
                    .to_owned(),
                str_of(source, "list").map(str::to_owned),
                outbound.clone(),
            )))),
            (None, None) => None,
        };
        // After every option check: the files store makes its directory here.
        if let Some(store) = &store {
            store.start().map_err(BuildError::Config)?;
        }
        let idle_ms = opt(options, "handleIdleMs")
            .cloned()
            .unwrap_or(json!(DEFAULT_IDLE_MS));
        let idle = Duration::from_millis(idle_ms.as_f64().unwrap_or(DEFAULT_IDLE_MS as f64) as u64);
        let max = opt(options, "maxHandlesPerPrincipal")
            .and_then(Value::as_f64)
            .unwrap_or(8.0) as usize;
        let live = opt(options, "sync")
            .map(|sync| Live::new(sync, opt(options, "tickets"), outbound.clone()));
        let live_shared = match &live {
            None => None,
            Some(_) => {
                let fields = bundle.call("mcpRichTextFields", &flags.to_string()).await?;
                Some(Arc::new(LiveShared::new(
                    bundle.clone(),
                    outbound.clone(),
                    flags.clone(),
                    fields.get("fields").unwrap_or(&Value::Null),
                )))
            }
        };
        Ok(Mcp {
            bundle,
            surface,
            principal: str_of(options, "principal").unwrap_or("local").to_owned(),
            idle_ms,
            handles: Handles::new(idle, max),
            store,
            max_handles: max,
            idle,
            store_sweep_every: STORE_SWEEP_EVERY,
            store_sweep_limit: STORE_SWEEP_LIMIT,
            sweeping: Arc::default(),
            stop_sweeps: tokio::sync::watch::Sender::new(false),
            calls: Arc::default(),
            reserved: std::sync::Mutex::default(),
            uploads,
            source,
            authorize,
            agent_actor,
            page_creator,
            live_shared,
            live,
            rooms: rooms.map(|executor| Rooms::new(executor, &flags)),
            flags,
        })
    }

    /// Drops idle handles now and then, as Node's sweeper does.
    pub fn spawn_sweeper(self: &Arc<Self>) {
        let idle =
            Duration::from_millis(self.idle_ms.as_f64().unwrap_or(DEFAULT_IDLE_MS as f64) as u64);
        let every = idle
            .min(Duration::from_secs(30))
            .max(Duration::from_millis(1));
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut ticks = tokio::time::interval(every);
            ticks.tick().await;
            loop {
                ticks.tick().await;
                let Some(mcp) = weak.upgrade() else { return };
                mcp.handles.sweep();
            }
        });
        let Some(store) = self.store.clone() else {
            return;
        };
        let weak = Arc::downgrade(self);
        let (every, limit) = (self.store_sweep_every, self.store_sweep_limit);
        tokio::spawn(async move {
            let mut ticks = tokio::time::interval(every);
            ticks.tick().await;
            loop {
                ticks.tick().await;
                let Some(mcp) = weak.upgrade() else { return };
                let _sweeping = mcp.sweeping.lock().await;
                // Checked under the lock: a stop that took it first ends the sweeps.
                if mcp.handles.is_closed() {
                    return;
                }
                let mut stop = mcp.stop_sweeps.subscribe();
                let outcome = tokio::select! {
                    outcome = tokio::time::timeout(limit, store.sweep(mcp.idle)) => outcome,
                    _ = stop.wait_for(|stopped| *stopped) => return,
                };
                match outcome {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => {
                        eprintln!("blok-mcp: sweeping the handle store failed: {err}");
                    }
                    Err(_) => eprintln!(
                        "blok-mcp: sweeping the handle store took over {} s, so it was stopped",
                        limit.as_secs_f64()
                    ),
                }
            }
        });
    }

    /// Node's stop: each handle closes once its calls are done, so a room
    /// gets its presence departure and close frame. Gives up after `limit`.
    /// A sweep of the handle store in flight is cancelled and waited for up
    /// to 1 s; none starts after.
    pub async fn close_all(&self, limit: Duration) {
        let mut closing = tokio::task::JoinSet::new();
        let sessions = self.handles.take_all();
        self.stop_sweeps.send_replace(true);
        let sweeping = self.sweeping.clone();
        closing.spawn(async move {
            if tokio::time::timeout(SWEEP_STOP_WAIT, sweeping.lock())
                .await
                .is_err()
            {
                eprintln!(
                    "blok-mcp: a handle store sweep ignored its cancel; shutting down without it"
                );
            }
        });
        for session in sessions {
            closing.spawn(async move {
                let session = session.lock_owned().await;
                if let Session::Remote(room) = &*session {
                    room.close().await;
                }
            });
        }
        let _ = tokio::time::timeout(limit, closing.join_all()).await;
    }

    /// The turn of the call with this id on its handle: the one stdio took
    /// as it read the call, or a new one.
    pub fn turn_for(
        &self,
        id: &str,
        args: &Value,
        principal: &str,
    ) -> Option<crate::handles::Turn<Session>> {
        let reserved = self
            .reserved
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take(id, &args.to_string());
        reserved.or_else(|| {
            str_of(args, "handle").map(|handle| self.handles.reserve(handle, principal))
        })
    }

    /// Waits for every tool call in flight, or `limit`.
    pub async fn calls_drained(&self, limit: std::time::Duration) -> bool {
        self.calls.drained(limit).await
    }

    /// A stop began: an open now answers "The server is shutting down.".
    pub fn stop_opening(&self) {
        self.handles.stop_opening();
    }

    pub async fn prompt(&self, name: &str, arguments: &Value) -> Result<Value, Fault> {
        Ok(self
            .bundle
            .call(
                "mcpPrompt",
                &json!({ "name": name, "arguments": arguments }).to_string(),
            )
            .await?)
    }

    async fn error_answer(&self, tool: &str, error: &HostError) -> Result<Answer, Fault> {
        let raw = self
            .bundle
            .call_raw("mcpErrorAnswer", &error.answer_input(tool))
            .await?;
        answer_of(&raw)
    }

    /// One tools/call. Err is a JSON-RPC -32603.
    pub async fn call(
        &self,
        name: &str,
        args: &Value,
        caller: &Caller,
        approval: &Approval,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Outcome, String> {
        let _call = self.calls.enter();
        match self.dispatch(name, args, caller, approval, cancelled).await {
            Ok(outcome) => Ok(outcome),
            Err(Fault::Host(error)) => self
                .error_answer(name, &error)
                .await
                .map(Outcome::Answer)
                .map_err(|f| match f {
                    Fault::Internal(m) => m,
                    Fault::Host(h) => h.error.to_string(),
                }),
            Err(Fault::Internal(message)) => Err(message),
        }
    }

    async fn dispatch(
        &self,
        name: &str,
        args: &Value,
        caller: &Caller,
        approval: &Approval,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Outcome, Fault> {
        let scopes = caller.scopes.as_ref().map_or(Value::Null, |s| json!(s));
        let checked = self
            .bundle
            .call_raw(
                "mcpCheckCall",
                &Obj::new()
                    .str("name", name)
                    .val("arguments", args)
                    .val("scopes", &scopes)
                    .finish(),
            )
            .await?;
        if let Some(Value::String(message)) = checked.value("unknownTool") {
            return Ok(Outcome::UnknownTool(message));
        }
        if checked.has("answer") {
            return Ok(Outcome::Answer(answer_of(&checked)?));
        }
        let step = checked
            .value("step")
            .ok_or_else(|| Fault::Internal("mcpCheckCall gave no step".to_owned()))?;
        let answer = match str_of(&step, "tool") {
            Some("blok_list_documents") => {
                let request = step.get("list").cloned().unwrap_or(json!({ "limit": 25 }));
                let listing = self.list_documents(&request, caller).await?;
                Answer {
                    structured: listing.to_string(),
                    is_error: false,
                }
            }
            Some("blok_open") => self.open(&step, caller, cancelled).await?,
            Some("blok_close") => {
                let handle = str_of(&step, "handle").unwrap_or_default();
                if self.shared(handle) {
                    return self.close_shared(handle, caller).await;
                }
                // A refused check still closes, so the handle does not keep its
                // --max-handles slot; an unknown handle fails again in remove.
                let refusal = self.on_handle(caller, handle, false).await.map(drop).err();
                let session = self.handles.remove(handle, &caller.principal).await?;
                let summary = match &*session {
                    Session::Remote(room) => room.close().await,
                    // A journaled room records the batch before the host's own copy does.
                    Session::Room(room) => {
                        json!({ "unsavedBatches": 0, "hostRecordLags": room.journaled })
                    }
                    Session::Stored(_) => json!({ "unsavedBatches": 0, "hostRecordLags": false }),
                };
                if let Some(refusal) = refusal {
                    return Err(refusal);
                }
                Answer {
                    structured: json!({
                        "closed": true,
                        "unsavedBatches": summary["unsavedBatches"],
                        "hostRecordLags": summary["hostRecordLags"],
                    })
                    .to_string(),
                    is_error: false,
                }
            }
            Some(_) => return self.on_document(&step, caller, approval).await,
            None => {
                return Err(Fault::Internal(
                    "mcpCheckCall gave a step without a tool".to_owned(),
                ));
            }
        };
        Ok(Outcome::Answer(answer))
    }

    /// Page blocks get their own documents (Node's createsPages).
    fn creates_pages(&self) -> bool {
        str_of(&self.flags, "pageTitles") == Some("page-map")
            && (self.live.is_some() || self.source.is_some())
    }

    /// The host's creator, as Node's createHostPage: None refuses, and any
    /// other failure is logged in full while the agent sees only
    /// HOST_PAGE_FAILED. A cancel is the failure() CANCELLED.
    async fn host_page(
        &self,
        creator: &dyn blok_blokagent::PageCreator,
        caller: &Caller,
        opener: &DocumentCaller,
        parent: &str,
    ) -> Result<String, Fault> {
        let request = blok_blokagent::PageCreateRequest {
            parent_document_id: Some(parent.to_owned()),
            principal: Some(caller.principal.clone()),
            actor: blok_blokagent::Actor {
                id: opener.actor.id.clone(),
                name: opener.actor.name.clone(),
                on_behalf_of: opener.actor.on_behalf_of.clone(),
            },
            suggested_page_id: mint_page_id(),
        };
        let host_failed = || {
            Fault::Host(HostError::surface(
                "SOURCE_UNAVAILABLE",
                crate::create_page::HOST_PAGE_FAILED,
            ))
        };
        // MCP never cancels a stored batch (a cancelled call is still applied).
        match creator
            .create(&blok_blokagent::Cancel::new(), &request)
            .await
        {
            Ok(None) => Err(HostError::surface(
                "FORBIDDEN",
                "You may not create a page document here.",
            )
            .into()),
            Ok(Some(page_id)) if crate::create_page::is_page_id(&page_id) => Ok(page_id),
            Ok(Some(page_id)) => {
                eprintln!(
                    "blok-mcp: the host page creator answered no valid page id (1-512 code points, no control characters, not \".\" or \"..\"): {page_id:?}"
                );
                Err(host_failed())
            }
            Err(err) if err.is_cancel() => {
                Err(HostError::failure("CANCELLED", crate::create_page::CANCELLED).into())
            }
            Err(err) => {
                eprintln!("blok-mcp: the host could not create a page: {err}");
                Err(host_failed())
            }
        }
    }

    /// Node's opener.createPage: a new id, authorized like a write open; a
    /// stored page is saved empty, a live one is joined once and must be.
    /// With the host's creator, the host makes it (`host_page`).
    async fn create_page(
        &self,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
        opener: &DocumentCaller,
        parent: &str,
    ) -> Result<String, Fault> {
        if let Some(creator) = &self.page_creator {
            return self.host_page(&**creator, caller, opener, parent).await;
        }
        let page_id = mint_page_id();
        let named = |fault: Fault| match fault {
            Fault::Host(mut error) => {
                // Node re-wraps the error keeping its flag, with the page named.
                let mut agent = agent_error_of(&error);
                let mut details = agent.get("details").cloned().unwrap_or(json!({}));
                details["pageId"] = json!(page_id);
                agent["details"] = details;
                error = HostError::as_is(agent);
                Fault::Host(error)
            }
            other => other,
        };
        let made = async {
            if !self.allowed(&caller.principal, &page_id, true).await {
                return Err(HostError::surface(
                    "FORBIDDEN",
                    "You may not create a page document here.",
                )
                .into());
            }
            if let (Some(live), Some(shared)) = (&self.live, &self.live_shared) {
                let presence = self.presence(actor, client_name);
                let actor_id = presence.actor_id.clone();
                let request = TicketRequest {
                    document_id: page_id.clone(),
                    write: true,
                    principal: caller.principal.clone(),
                    client_name: client_name.to_owned(),
                    actor_id,
                };
                let room = live.open(shared.clone(), request, presence).await?;
                let empty = room.is_empty().await;
                room.close().await;
                if !empty? {
                    return Err(HostError::surface(
                        "SOURCE_UNAVAILABLE",
                        "The new page id is taken. Try again.",
                    )
                    .into());
                }
                return Ok(());
            }
            let Some(source) = &self.source else {
                return Err(HostError::surface(
                    "SOURCE_UNAVAILABLE",
                    "No document source is configured, so no page document can be created.",
                )
                .into());
            };
            let loaded = source.load(&page_id, Some(opener)).await?;
            // The endpoint source saves without a version check, so this is its only guard.
            if !loaded.missing {
                return Err(HostError::surface(
                    "SOURCE_UNAVAILABLE",
                    "The new page id is taken. Try again.",
                )
                .into());
            }
            let text = self
                .bundle
                .call(
                    "mcpDocumentText",
                    &json!({ "document": { "blocks": [] }, "form": source.document_text_form() })
                        .to_string(),
                )
                .await?;
            source
                .save(
                    &page_id,
                    text.get("text").and_then(Value::as_str).unwrap_or_default(),
                    loaded.version.as_deref(),
                    Some(opener),
                )
                .await?;
            Ok(())
        };
        match made.await {
            Ok(()) => Ok(page_id),
            Err(fault) => Err(named(fault)),
        }
    }

    /// A batch failed after its pages were made: it fails as Node's
    /// withUnusedPages fails it, naming the pages `parent` (the parent as
    /// saved, or the room read again) does not link, with `fault` as cause.
    /// With no parent to read, or every page linked, `fault` passes on: a
    /// host must never delete a page the parent may use (blokagent's
    /// room_links_none).
    async fn orphaned(&self, created: &[String], parent: Option<&str>, fault: Fault) -> Fault {
        let Some(unused) = parent.and_then(|parent| unlinked_pages(parent, created)) else {
            return fault;
        };
        if unused.is_empty() {
            return fault;
        }
        let cause = match &fault {
            Fault::Host(error) => error.clone(),
            Fault::Internal(message) => runtime_failure(message),
        };
        // The bundle sets the cause's retryable by the helper that built it.
        let cause = match self.error_answer("blok_read", &cause).await {
            Ok(answer) => serde_json::from_str::<Value>(&answer.structured)
                .ok()
                .and_then(|answer| answer.get("error").cloned()),
            Err(_) => None,
        };
        let Some(cause) = cause else {
            return fault;
        };
        let orphaned: Vec<Value> = unused
            .iter()
            .map(|page_id| json!({ "command": "block.insert", "type": "page", "prepared": { "pageId": page_id } }))
            .collect();
        let message = format!(
            "The batch failed after the host did work for it ({}). Clean up the listed items.",
            str_of(&cause, "message").unwrap_or_default()
        );
        Fault::Host(HostError {
            helper: crate::errors::Helper::Failure,
            error: json!({
                "code": "ORPHANED_SIDE_EFFECT",
                "message": message,
                "details": { "orphaned": orphaned, "cause": cause },
            }),
        })
    }

    /// Makes the pages and does the page write a batch needs, in Node's
    /// order: a creation that fails stops there and goes to the bundle,
    /// which refuses that insert inside the batch.
    #[allow(clippy::too_many_arguments)]
    async fn host_work(
        &self,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
        opener: &DocumentCaller,
        open_document: &str,
        live_parent: bool,
        counted: &Value,
    ) -> Result<HostWork, Fault> {
        let mut work = HostWork::default();
        for _ in 0..pages_to_make(counted) {
            match self
                .create_page(caller, actor, client_name, opener, open_document)
                .await
            {
                Ok(page_id) => work.created.push(page_id),
                // A host failure past the first page is a server stop, as Node answers it.
                Err(Fault::Host(error))
                    if !work.created.is_empty()
                        && error.code() == "SOURCE_UNAVAILABLE"
                        && error.error.get("message")
                            == Some(&json!(crate::create_page::HOST_PAGE_FAILED)) =>
                {
                    work.create_failure = Some(runtime_failure(HOST_STOPPED).failed_input());
                    break;
                }
                Err(Fault::Host(error)) => {
                    work.cancelled = error.code() == "CANCELLED" && !work.created.is_empty();
                    work.create_failure = Some(error.failed_input());
                    break;
                }
                // The bundle refuses the insert and names the pages made so far.
                Err(Fault::Internal(message)) if !work.created.is_empty() => {
                    work.create_failure = Some(runtime_failure(&message).failed_input());
                    break;
                }
                Err(other) => return Err(other),
            }
        }
        for (page_id, batch) in page_writes(counted) {
            let outcome = Box::pin(self.write_page(
                caller,
                actor,
                client_name,
                opener,
                open_document,
                live_parent,
                &page_id,
                &batch,
            ))
            .await?;
            let failed = outcome.get("error").is_some();
            work.unconfirmed |= outcome.get("unconfirmed") == Some(&Value::Bool(true));
            let mut outcome = outcome;
            if let Some(outcome) = outcome.as_object_mut() {
                outcome.remove("unconfirmed");
            }
            work.page_writes.push(outcome);
            if failed {
                break;
            }
        }
        Ok(work)
    }

    /// Node's openPageDocument (src/mcp/page-titles.ts): the page's own
    /// document, opened as blok_open opens it but with no handle, written
    /// and closed. Answers `{ pageId, result }` or `{ pageId, error }`.
    #[allow(clippy::too_many_arguments)]
    async fn write_page(
        &self,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
        opener: &DocumentCaller,
        open_document: &str,
        live_parent: bool,
        page_id: &str,
        batch: &Value,
    ) -> Result<Value, Fault> {
        // A room id has no aliases; a file can be a symlink or a case alias.
        let same = page_id == open_document
            || (!live_parent
                && match &self.source {
                    Some(source) => source.same_document(page_id, open_document).await,
                    None => false,
                });
        if same {
            return Ok(json!({ "pageId": page_id, "error": {
                "code": "INVALID_ARGS",
                "message": "This page block points at the document you have open. Use doc.setTitle or doc.setIcon instead.",
                "retryable": false,
            } }));
        }
        let call = json!({ "name": "blok_execute", "batch": batch });
        let ran = async {
            if !self.allowed(&caller.principal, page_id, true).await {
                return Err(HostError::surface(
                    "FORBIDDEN",
                    "You may not open this document with this access.",
                )
                .into());
            }
            let resolved = self
                .bundle
                .call(
                    "mcpResolveMode",
                    &json!({ "requested": "auto", "sync": self.syncs() }).to_string(),
                )
                .await?;
            if let Some(error) = resolved.get("error") {
                return Err(HostError::as_is(error.clone()).into());
            }
            if str_of(&resolved, "mode") == Some("live") {
                let (Some(live), Some(shared)) = (&self.live, &self.live_shared) else {
                    return Err(HostError::surface(
                        "INVALID_ARGS",
                        "Live mode needs blok-mcp to run with --sync-url.",
                    )
                    .into());
                };
                let presence = self.presence(actor, client_name);
                let actor_id = presence.actor_id.clone();
                let request = TicketRequest {
                    document_id: page_id.to_owned(),
                    write: true,
                    principal: caller.principal.clone(),
                    client_name: client_name.to_owned(),
                    actor_id,
                };
                let room = live.open(shared.clone(), request, presence).await?;
                let ran = Box::pin(self.on_remote(
                    caller,
                    page_id,
                    &room,
                    &call,
                    actor,
                    client_name,
                    &Approval::default(),
                ))
                .await;
                room.close().await;
                return ran;
            }
            let Some(source) = &self.source else {
                return Err(HostError::surface(
                    "SOURCE_UNAVAILABLE",
                    "No document source is configured. Start blok-mcp with --source.",
                )
                .into());
            };
            let loaded = source.load(page_id, Some(opener)).await?;
            let mut stored = Stored {
                write: true,
                document: loaded.document,
                history: "{}".to_owned(),
                version: loaded.version,
                stale: false,
                opener: Arc::new(opener.clone()),
                actor: actor.clone(),
            };
            Box::pin(self.execute(
                caller,
                page_id,
                &mut stored,
                &call,
                actor,
                client_name,
                &Approval::default(),
            ))
            .await
        };
        match ran.await {
            Ok(Outcome::Answer(answer)) => {
                let mut result: Value = serde_json::from_str(&answer.structured)
                    .map_err(|e| Fault::Internal(e.to_string()))?;
                // The write went out but no ack came; it may still land, and the
                // batch that made it says so in its delivery.
                let unconfirmed = result.get("ok") == Some(&Value::Bool(true))
                    && result.pointer("/delivery/pending") == Some(&Value::Bool(true));
                if let Some(result) = result.as_object_mut() {
                    result.remove("delivery");
                }
                Ok(json!({ "pageId": page_id, "result": result, "unconfirmed": unconfirmed }))
            }
            Ok(_) => Err(Fault::Internal(
                "a page write did not answer as blok_execute".to_owned(),
            )),
            Err(Fault::Host(error)) => {
                Ok(json!({ "pageId": page_id, "error": agent_error_of(&error) }))
            }
            Err(other) => Err(other),
        }
    }

    /// A sync URL or the host's own rooms: live mode is on.
    fn syncs(&self) -> bool {
        self.live.is_some() || self.rooms.is_some()
    }

    async fn allowed(&self, principal: &str, document_id: &str, write: bool) -> bool {
        match &self.authorize {
            None => true,
            Some(hook) => {
                hook.allows(principal.to_owned(), document_id.to_owned(), write)
                    .await
            }
        }
    }

    /// A handle this process does not hold lives in the shared store.
    fn shared(&self, handle: &str) -> bool {
        self.store.is_some() && !self.handles.has(handle)
    }

    /// The cap before an open: the store's handles of the principal and this
    /// process's live ones.
    async fn assert_room(&self, principal: &str) -> Result<(), Fault> {
        let Some(store) = &self.store else {
            return Ok(self.handles.assert_room(principal)?);
        };
        if self.handles.is_closed() {
            return Err(crate::handles::shutting_down().into());
        }
        let stored = store
            .count(principal.to_owned(), self.idle)
            .await
            .map_err(store_failed)?;
        if stored + self.handles.count(principal) >= self.max_handles {
            return Err(crate::handles::handle_limit(self.max_handles).into());
        }
        Ok(())
    }

    /// A live handle holds a socket, so it stays in this process.
    async fn add_live(
        &self,
        principal: &str,
        document_id: &str,
        session: Session,
    ) -> Result<String, Fault> {
        if self.store.is_some() {
            self.assert_room(principal).await?;
        }
        Ok(self.handles.add(principal, document_id, session)?)
    }

    /// A stored handle goes into the store when there is one: counted and
    /// added as one step there, beside this process's live handles.
    async fn add_stored(
        &self,
        principal: &str,
        document_id: &str,
        stored: Stored,
    ) -> Result<String, Fault> {
        let Some(store) = &self.store else {
            return Ok(self
                .handles
                .add(principal, document_id, Session::Stored(stored))?);
        };
        if self.handles.is_closed() {
            return Err(crate::handles::shutting_down().into());
        }
        let handle = crate::handles::new_handle();
        let room = self
            .max_handles
            .saturating_sub(self.handles.count(principal));
        let record = self.record_of(document_id, &stored)?;
        let added = store
            .try_add(handle.clone(), record, room, self.idle)
            .await
            .map_err(store_failed)?;
        if !added {
            return Err(crate::handles::handle_limit(self.max_handles).into());
        }
        Ok(handle)
    }

    fn record_of(&self, document_id: &str, stored: &Stored) -> Result<HandleRecord, Fault> {
        let raw = |text: &str| {
            serde_json::value::RawValue::from_string(text.to_owned())
                .map_err(|err| Fault::Internal(format!("a handle record: {err}")))
        };
        Ok(HandleRecord {
            v: 1,
            contract_revision: self
                .surface
                .stored_revision
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            principal: stored.opener.principal.clone(),
            client_name: stored.opener.client_name.clone(),
            scopes: stored.opener.scopes.clone(),
            actor: stored.actor.clone(),
            document_id: document_id.to_owned(),
            write: stored.write,
            version: stored.version.clone(),
            stale: stored.stale,
            document: raw(&stored.document)?,
            history: raw(&stored.history)?,
        })
    }

    /// The store's lease on a handle of `principal`. A handle Blok never
    /// minted is unknown before the store is asked.
    async fn lease_of(&self, handle: &str, principal: &str) -> Result<HeldLease, Fault> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| Fault::Internal("no handle store".to_owned()))?;
        if !crate::handle_store::is_store_handle(handle) {
            return Err(crate::handles::unknown_handle().into());
        }
        let acquired = store
            .acquire(handle.to_owned(), self.idle, LEASE_WAIT)
            .await
            .map_err(store_failed)?;
        let lease = match acquired {
            Acquired::Lease(lease) => lease,
            Acquired::Unknown => return Err(crate::handles::unknown_handle().into()),
            Acquired::Busy => {
                return Err(HostError::surface(
                    "SOURCE_UNAVAILABLE",
                    "Another call is using this handle. Retry shortly.",
                )
                .into());
            }
        };
        // Checked here, not by the store: a store bug must not hand one user's handle to another.
        let lease = HeldLease(Some(lease));
        if lease.lease().record().v != 1 || lease.lease().record().principal != principal {
            lease.release().await;
            return Err(crate::handles::unknown_handle().into());
        }
        Ok(lease)
    }

    /// One call on a handle in the store: lease it, rebuild the session from
    /// its record, run (the source save happens here), save the record if it
    /// changed, release. A record that cannot be saved after the source save
    /// is removed: the answer stands, and the next call answers UNKNOWN_HANDLE.
    async fn on_shared(
        &self,
        handle: &str,
        write: bool,
        call: &Value,
        caller: &Caller,
        approval: &Approval,
    ) -> Result<Outcome, Fault> {
        let held = self.lease_of(handle, &caller.principal).await?;
        let lease = held.lease();
        let ran = async {
            let record = lease.record();
            if Some(record.contract_revision.as_str()) != self.surface.stored_revision.as_str() {
                return Err(HostError::surface(
                    "VERSION_SKEW",
                    "This handle was opened on a server with another tool contract. Call blok_open again.",
                )
                .into());
            }
            if !self
                .allowed(&caller.principal, &record.document_id, write)
                .await
            {
                return Err(HostError::surface(
                    "FORBIDDEN",
                    "You no longer have access to this document.",
                )
                .into());
            }
            let mut stored = Stored::from_record(record);
            let outcome = self
                .on_stored(
                    caller,
                    &record.document_id,
                    &mut stored,
                    call,
                    &record.actor,
                    &record.client_name,
                    approval,
                )
                .await;
            let before = (
                record.document.get(),
                record.history.get(),
                record.version.as_deref(),
                record.stale,
            );
            if stored.state() != before {
                self.keep(lease, &record.document_id, &stored).await;
            }
            outcome
        };
        let ran = tokio::select! {
            ran = ran => ran,
            () = keep_renewing(lease) => unreachable!("renewing never ends"),
        };
        held.release().await;
        ran
    }

    async fn keep(&self, lease: &dyn HandleLease, document_id: &str, stored: &Stored) {
        let saved = match self.record_of(document_id, stored) {
            Ok(record) => lease.save(record).await,
            Err(fault) => Err(StoreError(format!("{fault:?}"))),
        };
        if let Err(err) = saved {
            // The source already has the work; a record left behind would save with an old version.
            eprintln!(
                "blok-mcp: saving a handle to the handle store failed, so the handle is closed: {err}"
            );
            if let Err(err) = lease.remove().await {
                eprintln!("blok-mcp: removing a handle from the handle store failed: {err}");
            }
        }
    }

    /// blok_close on a handle in the store. A refused check still closes, so
    /// the handle does not keep its place under the cap.
    async fn close_shared(&self, handle: &str, caller: &Caller) -> Result<Outcome, Fault> {
        let held = self.lease_of(handle, &caller.principal).await?;
        let allowed = self
            .allowed(&caller.principal, &held.lease().record().document_id, false)
            .await;
        let removed = held.lease().remove().await;
        held.release().await;
        removed.map_err(store_failed)?;
        if !allowed {
            return Err(HostError::surface(
                "FORBIDDEN",
                "You no longer have access to this document.",
            )
            .into());
        }
        Ok(Outcome::Answer(Answer {
            structured: json!({ "closed": true, "unsavedBatches": 0, "hostRecordLags": false })
                .to_string(),
            is_error: false,
        }))
    }

    async fn on_handle(
        &self,
        caller: &Caller,
        handle: &str,
        write: bool,
    ) -> Result<crate::handles::Lease<Session>, Fault> {
        let lease = self.handles.use_handle(handle, &caller.principal).await?;
        if !self
            .allowed(&caller.principal, &lease.document_id, write)
            .await
        {
            return Err(HostError::surface(
                "FORBIDDEN",
                "You no longer have access to this document.",
            )
            .into());
        }
        Ok(lease)
    }

    /// The source listing, filtered by the authorize hook, with `live`.
    async fn list(&self, request: &Value, caller: &Caller) -> Result<Value, Fault> {
        let unsupported = json!({ "documents": [], "nextCursor": null, "supported": false });
        let Some(source) = &self.source else {
            return Ok(unsupported);
        };
        // A host's source lists for the current caller.
        let lister = if source.acts_for_caller() {
            let (actor, client_name) = self.actor(caller).await?;
            Some(document_caller(caller, &actor, &client_name))
        } else {
            None
        };
        let Some(listing) = source
            .list(&ListRequest::from_value(request), lister.as_ref())
            .await
        else {
            return Ok(unsupported);
        };
        let listing = listing?;
        let live = self.syncs();
        let mut documents = Vec::new();
        for (id, title) in listing.documents {
            if self.allowed(&caller.principal, &id, false).await {
                documents.push(json!({ "id": id, "title": title, "live": live }));
            }
        }
        Ok(json!({ "documents": documents, "nextCursor": listing.next_cursor, "supported": true }))
    }

    async fn list_documents(&self, request: &Value, caller: &Caller) -> Result<Value, Fault> {
        let first = self.list(request, caller).await?;
        let follow = self
            .bundle
            .call(
                "mcpListAnswer",
                &json!({ "request": request, "listing": first }).to_string(),
            )
            .await?;
        if let Some(relist) = follow.get("relist") {
            let second = self.list(relist, caller).await?;
            let answer = self
                .bundle
                .call(
                    "mcpListAnswer",
                    &json!({ "request": request, "listing": first, "relisted": second })
                        .to_string(),
                )
                .await?;
            return Ok(answer.get("listing").cloned().unwrap_or(Value::Null));
        }
        Ok(follow.get("listing").cloned().unwrap_or(Value::Null))
    }

    async fn actor(&self, caller: &Caller) -> Result<(Value, String), Fault> {
        let mut input = json!({ "principal": caller.principal });
        if let Some(name) = &caller.client_name {
            input["clientName"] = Value::String(name.clone());
        }
        let out = self.bundle.call("mcpActor", &input.to_string()).await?;
        let client_name = str_of(&out, "clientName").unwrap_or_default().to_owned();
        let actor = match &self.agent_actor {
            Some(hook) => hook(&caller.principal, &client_name).to_value(),
            None => out.get("actor").cloned().unwrap_or(Value::Null),
        };
        Ok((actor, client_name))
    }

    /// The agent's presence, as Node's: a host's own actor shows its name and
    /// colour; the default one the client's name.
    fn presence(&self, actor: &Value, client_name: &str) -> Presence {
        let actor_id = str_of(actor, "id").unwrap_or_default().to_owned();
        let custom = self.agent_actor.is_some();
        let color = str_of(actor, "color")
            .filter(|c| custom && is_presence_color(c))
            .map_or_else(|| presence_color(&actor_id), str::to_owned);
        Presence {
            color,
            name: if custom {
                str_of(actor, "name").unwrap_or_default().to_owned()
            } else {
                client_name.to_owned()
            },
            on_behalf_of: str_of(actor, "onBehalfOf").unwrap_or(&actor_id).to_owned(),
            actor_id,
        }
    }

    fn session_input(&self, mode: &str, write: bool, document: &str, actor: &Value) -> Obj {
        let mut mcp = self.flags.clone();
        mcp["mode"] = Value::String(mode.to_owned());
        mcp["write"] = Value::Bool(write);
        Obj::new()
            .val("mcp", &mcp)
            .raw("document", document)
            .val("actor", actor)
    }

    async fn open(
        &self,
        step: &Value,
        caller: &Caller,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Answer, Fault> {
        let Some(find) = step.get("find") else {
            let id = str_of(step, "documentId").unwrap_or_default();
            return self.open_found(step, id, None, caller, cancelled).await;
        };
        let mut request = json!({ "limit": 25 });
        if let Some(query) = find.get("query") {
            request["query"] = query.clone();
        }
        let listing = self.list_documents(&request, caller).await?;
        let picked = self
            .bundle
            .call_raw(
                "mcpPickDocument",
                &json!({ "find": find, "listing": listing }).to_string(),
            )
            .await?;
        if picked.has("answer") {
            return answer_of(&picked);
        }
        let open = picked.value("open").unwrap_or(Value::Null);
        let id = str_of(&open, "documentId").unwrap_or_default().to_owned();
        self.open_found(step, &id, Some(open), caller, cancelled)
            .await
    }

    async fn open_found(
        &self,
        step: &Value,
        document_id: &str,
        found: Option<Value>,
        caller: &Caller,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Answer, Fault> {
        // Opening can mint a ticket and join a room, so refuse at the cap first.
        self.assert_room(&caller.principal).await?;
        let write = step.get("write") == Some(&Value::Bool(true));
        let requested = str_of(step, "mode").unwrap_or("auto");
        if !self.allowed(&caller.principal, document_id, write).await {
            return Err(HostError::surface(
                "FORBIDDEN",
                "You may not open this document with this access.",
            )
            .into());
        }
        let resolved = self
            .bundle
            .call(
                "mcpResolveMode",
                &json!({ "requested": requested, "sync": self.syncs() }).to_string(),
            )
            .await?;
        if let Some(error) = resolved.get("error") {
            return Err(HostError::as_is(error.clone()).into());
        }
        let (actor, client_name) = self.actor(caller).await?;
        if str_of(&resolved, "mode") == Some("live") {
            if let Some(rooms) = &self.rooms {
                return self
                    .open_room(
                        rooms,
                        step,
                        document_id,
                        write,
                        found,
                        caller,
                        &actor,
                        cancelled,
                    )
                    .await;
            }
            let Some(live) = &self.live else {
                return Err(HostError::surface(
                    "INVALID_ARGS",
                    "Live mode needs blok-mcp to run with --sync-url.",
                )
                .into());
            };
            return self
                .open_remote(
                    live,
                    step,
                    document_id,
                    write,
                    found,
                    caller,
                    &actor,
                    &client_name,
                    cancelled,
                )
                .await;
        }
        let Some(source) = &self.source else {
            return Err(HostError::surface(
                "SOURCE_UNAVAILABLE",
                "No document source is configured. Start blok-mcp with --source.",
            )
            .into());
        };
        let opener = document_caller(caller, &actor, &client_name);
        let loaded = source.load(document_id, Some(&opener)).await?;
        let stored = Stored {
            write,
            document: loaded.document,
            history: "{}".to_owned(),
            version: loaded.version,
            stale: false,
            opener: Arc::new(opener),
            actor: actor.clone(),
        };
        let view = match step.get("view") {
            None => None,
            Some(view) => {
                let raw = self
                    .bundle
                    .call_raw(
                        "mcpRead",
                        &self
                            .session_input("stored", write, &stored.document, &actor)
                            .val("view", view)
                            .finish(),
                    )
                    .await?;
                let answer = answer_of(&raw)?;
                if answer.is_error {
                    return Ok(answer);
                }
                Some(answer.structured)
            }
        };
        if cancelled() {
            return Err(HostError::failure(
                "CANCELLED",
                "The request was cancelled before the document opened.",
            )
            .into());
        }
        let session = json!({
            "mode": "stored",
            "write": write,
            "durability": "saved-on-execute",
            "contractRevision": self.surface.stored_revision,
            "exists": !loaded.missing,
        });
        let handle = self
            .add_stored(&caller.principal, document_id, stored)
            .await?;
        let mut input = Obj::new()
            .str("handle", &handle)
            .val("expiresAfterIdleMs", &self.idle_ms)
            .val("session", &session);
        if let Some(found) = &found {
            input = input.val("found", found);
        }
        if let Some(view) = &view {
            input = input.raw("view", view);
        }
        let raw = self
            .bundle
            .call_raw("mcpOpenAnswer", &input.finish())
            .await?;
        answer_of(&raw)
    }

    #[allow(clippy::too_many_arguments)]
    async fn open_remote(
        &self,
        live: &Live,
        step: &Value,
        document_id: &str,
        write: bool,
        found: Option<Value>,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Answer, Fault> {
        let shared = self
            .live_shared
            .clone()
            .ok_or_else(|| Fault::Internal("live mode without its engines".to_owned()))?;
        let presence = self.presence(actor, client_name);
        let actor_id = presence.actor_id.clone();
        let request = TicketRequest {
            document_id: document_id.to_owned(),
            write,
            principal: caller.principal.clone(),
            client_name: client_name.to_owned(),
            actor_id,
        };
        let room = live.open(shared, request, presence).await?;
        let view = match step.get("view") {
            None => None,
            Some(view) => {
                let answer = room_answer(&room.read(view.clone(), actor.clone()).await?)?;
                if answer.is_error {
                    room.close().await;
                    return Ok(answer);
                }
                Some(answer.structured)
            }
        };
        if cancelled() {
            room.close().await;
            return Err(HostError::failure(
                "CANCELLED",
                "The request was cancelled before the document opened.",
            )
            .into());
        }
        let mut session = json!({
            "mode": "live",
            "write": write,
            "durability": if room.protocol == Protocol::V2 { "acknowledged" } else { "best-effort" },
            "contractRevision": self.surface.live_revision,
        });
        if self
            .surface
            .live_unavailable
            .as_array()
            .is_some_and(|a| !a.is_empty())
        {
            session["unavailableCommands"] = self.surface.live_unavailable.clone();
        }
        let handle = self
            .add_live(&caller.principal, document_id, Session::Remote(room))
            .await?;
        let mut input = Obj::new()
            .str("handle", &handle)
            .val("expiresAfterIdleMs", &self.idle_ms)
            .val("session", &session);
        if let Some(found) = &found {
            input = input.val("found", found);
        }
        if let Some(view) = &view {
            input = input.raw("view", view);
        }
        answer_of(
            &self
                .bundle
                .call_raw("mcpOpenAnswer", &input.finish())
                .await?,
        )
    }

    #[allow(clippy::too_many_arguments)]
    async fn on_remote(
        &self,
        caller: &Caller,
        document_id: &str,
        room: &RemoteRoom,
        call: &Value,
        actor: &Value,
        client_name: &str,
        approval: &Approval,
    ) -> Result<Outcome, Fault> {
        match str_of(call, "name") {
            Some("blok_read") => {
                let view = call.get("view").cloned().unwrap_or(json!({}));
                Ok(Outcome::Answer(room_answer(
                    &room.read(view, actor.clone()).await?,
                )?))
            }
            Some("blok_describe") => {
                let mut mcp = self.flags.clone();
                mcp["mode"] = json!("live");
                mcp["write"] = json!(true);
                let input = Obj::new()
                    .val("mcp", &mcp)
                    .raw("document", r#"{"blocks":[]}"#)
                    .val("actor", actor)
                    .val("query", call.get("query").unwrap_or(&json!({})))
                    .finish();
                Ok(Outcome::Answer(answer_of(
                    &self.bundle.call_raw("mcpDescribe", &input).await?,
                )?))
            }
            _ => {
                let mut asking =
                    json!({ "capabilities": approval.capabilities, "clientName": client_name });
                if let Some(replies) = &approval.replies {
                    asking["replies"] = replies.clone();
                }
                let batch = call.get("batch").cloned().unwrap_or(Value::Null);
                let mut work = HostWork::default();
                if self.creates_pages() && is_batch_envelope(&batch) {
                    let counted = room
                        .pages_needed(batch.clone(), actor.clone(), asking.clone())
                        .await?;
                    let opener = document_caller(caller, actor, client_name);
                    work = self
                        .host_work(
                            caller,
                            actor,
                            client_name,
                            &opener,
                            document_id,
                            true,
                            &counted,
                        )
                        .await?;
                }
                let unconfirmed = work.unconfirmed;
                let mut input = ExecuteInput {
                    batch: batch.clone(),
                    actor: actor.clone(),
                    approval: asking,
                    created_pages: work.created.clone(),
                    create_failure: work.create_failure,
                    page_writes: work.page_writes,
                    uploads: None,
                };
                // Uploads run by replay, as on a stored handle.
                let mut answers = Vec::new();
                let mut reads = Vec::new();
                let executed = loop {
                    input.uploads = self.uploads.as_ref().map(|uploads| uploads.input(&answers));
                    let executed = match room.execute(input.clone()).await {
                        Ok(executed) => executed,
                        Err(fault) => {
                            // The room may have written before the error.
                            let parent = room.document().await.ok();
                            return Err(self
                                .orphaned(&work.created, parent.as_deref(), fault)
                                .await);
                        }
                    };
                    match (executed, &self.uploads) {
                        (Executed::Upload(upload), Some(uploads)) if answers.len() < 4 => {
                            answers.push(uploads.answer(&upload, &batch, &mut reads).await);
                        }
                        (Executed::Upload(_), _) => {
                            return Err(Fault::Internal(
                                "an upload the host cannot answer".to_owned(),
                            ));
                        }
                        (executed, _) => break executed,
                    }
                };
                let (result, delivery) = match executed {
                    Executed::Ask(ask) => {
                        return Ok(Outcome::Ask(Ask {
                            key: str_of(&ask, "key").unwrap_or_default().to_owned(),
                            message: ask.get("message").cloned().unwrap_or(Value::Null),
                            requested_schema: ask
                                .get("requestedSchema")
                                .cloned()
                                .unwrap_or(Value::Null),
                        }));
                    }
                    Executed::Done { result, delivery } => (result, delivery),
                    Executed::Upload(_) => unreachable!("the loop answers every upload"),
                };
                let mut answer = Obj::new().raw("result", &result);
                let mut delivered = None;
                match delivery {
                    Delivery::None => {}
                    Delivery::Now(value) => delivered = Some(value),
                    Delivery::Failed(error) => answer = answer.val("failed", &error.failed_input()),
                    Delivery::Wait(fate) => match tokio::time::timeout(DELIVERY_WAIT, fate).await {
                        Ok(Ok(Fate::Acked(sequence))) => {
                            delivered = Some(
                                json!({ "durable": true, "pending": false, "serverSequence": sequence, "savedVersion": null }),
                            );
                        }
                        Ok(Ok(Fate::Ended(error))) => {
                            answer = answer.val("failed", &error.failed_input());
                        }
                        Ok(Ok(Fate::Quarantined(reason))) => {
                            let error = if reason == "read-only" {
                                HostError::surface(
                                    "READ_ONLY",
                                    "The room refused the write: this agent may only read. The batch was not saved.",
                                )
                            } else {
                                HostError::surface_with(
                                    "REJECTED",
                                    "The room refused this batch. It was not saved.",
                                    json!({ "rejectionCode": reason }),
                                )
                            };
                            answer = answer.val("failed", &error.failed_input());
                        }
                        _ => {
                            delivered = Some(
                                json!({ "durable": false, "pending": true, "serverSequence": null, "savedVersion": null }),
                            );
                        }
                    },
                }
                if let Some(delivery) = unconfirmed_delivery(unconfirmed, &result, delivered) {
                    answer = answer.val("delivery", &delivery);
                }
                let raw = self
                    .bundle
                    .call_raw("mcpExecuteAnswer", &answer.finish())
                    .await?;
                Ok(Outcome::Answer(answer_of(&raw)?))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn open_room(
        &self,
        rooms: &Rooms,
        step: &Value,
        document_id: &str,
        write: bool,
        found: Option<Value>,
        caller: &Caller,
        actor: &Value,
        cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Answer, Fault> {
        // Loads the room, as Node's open waits for the room to sync.
        let view_args = step.get("view").cloned();
        let (view, ran) = rooms
            .read(
                document_id,
                view_args.as_ref().unwrap_or(&json!({})),
                actor,
                write,
            )
            .await?;
        if cancelled() {
            return Err(HostError::failure(
                "CANCELLED",
                "The request was cancelled before the document opened.",
            )
            .into());
        }
        let journaled = ran.head.is_some();
        let mut session = json!({
            "mode": "live",
            "write": write,
            "durability": if journaled { "acknowledged" } else { "best-effort" },
            "contractRevision": self.surface.live_revision,
        });
        if self
            .surface
            .live_unavailable
            .as_array()
            .is_some_and(|a| !a.is_empty())
        {
            session["unavailableCommands"] = self.surface.live_unavailable.clone();
        }
        let room = RoomSession {
            write,
            read_only: !write,
            journaled,
        };
        let handle = self
            .add_live(&caller.principal, document_id, Session::Room(room))
            .await?;
        let mut input = Obj::new()
            .str("handle", &handle)
            .val("expiresAfterIdleMs", &self.idle_ms)
            .val("session", &session);
        if let Some(found) = &found {
            input = input.val("found", found);
        }
        if view_args.is_some() {
            input = input.val("view", &view);
        }
        answer_of(
            &self
                .bundle
                .call_raw("mcpOpenAnswer", &input.finish())
                .await?,
        )
    }

    async fn on_room(
        &self,
        document_id: &str,
        room: &mut RoomSession,
        call: &Value,
        actor: &Value,
        client_name: &str,
        approval: &Approval,
    ) -> Result<Outcome, Fault> {
        let rooms = self
            .rooms
            .as_ref()
            .ok_or_else(|| Fault::Internal("a room handle without rooms".to_owned()))?;
        let answer = |structured: &Value| Answer {
            structured: structured.to_string(),
            is_error: false,
        };
        match str_of(call, "name") {
            Some("blok_read") => {
                let (view, _) = rooms
                    .read(
                        document_id,
                        call.get("view").unwrap_or(&json!({})),
                        actor,
                        room.write,
                    )
                    .await?;
                Ok(Outcome::Answer(answer(&view)))
            }
            // The answer depends on the contract only, so an empty document does.
            Some("blok_describe") => {
                let input = self
                    .session_input("live", room.write, r#"{"blocks":[]}"#, actor)
                    .val("query", call.get("query").unwrap_or(&json!({})))
                    .finish();
                Ok(Outcome::Answer(answer_of(
                    &self.bundle.call_raw("mcpDescribe", &input).await?,
                )?))
            }
            _ => {
                let batch = call.get("batch").cloned().unwrap_or(Value::Null);
                // A dry run on an empty read-only copy says whether the batch writes.
                let probe = self
                    .bundle
                    .call_raw(
                        "agentExecute",
                        &self
                            .session_input("live", false, r#"{"blocks":[]}"#, actor)
                            .val("batch", &batch)
                            .finish(),
                    )
                    .await?;
                let writes = probe.value("writes") == Some(Value::Bool(true));
                if writes && room.read_only {
                    let result = probe.text("result").unwrap_or("null").to_owned();
                    let raw = self
                        .bundle
                        .call_raw(
                            "mcpExecuteAnswer",
                            &Obj::new().raw("result", &result).finish(),
                        )
                        .await?;
                    return Ok(Outcome::Answer(answer_of(&raw)?));
                }
                let mut asking =
                    json!({ "capabilities": approval.capabilities, "clientName": client_name });
                if let Some(replies) = &approval.replies {
                    asking["replies"] = replies.clone();
                }
                let ran = rooms
                    .run(document_id, &batch, actor, room.write, Some(&asking))
                    .await?;
                let result: Value = serde_json::from_str(&ran.result)
                    .map_err(|e| Fault::Internal(e.to_string()))?;
                if let Some(ask) = result.get("ask") {
                    return Ok(Outcome::Ask(Ask {
                        key: str_of(ask, "key").unwrap_or_default().to_owned(),
                        message: ask.get("message").cloned().unwrap_or(Value::Null),
                        requested_schema: ask
                            .get("requestedSchema")
                            .cloned()
                            .unwrap_or(Value::Null),
                    }));
                }
                let ok = result.get("ok") == Some(&Value::Bool(true));
                if result.pointer("/error/code").and_then(Value::as_str) == Some("APPLY_FAILED") {
                    room.read_only = true;
                }
                let mut input = Obj::new().raw("result", &ran.result);
                if let Some(delivery) = delivery(&ran, ok, writes, room.journaled) {
                    input = input.val("delivery", &delivery);
                }
                let raw = self
                    .bundle
                    .call_raw("mcpExecuteAnswer", &input.finish())
                    .await?;
                Ok(Outcome::Answer(answer_of(&raw)?))
            }
        }
    }

    async fn reload(&self, document_id: &str, stored: &mut Stored) -> Result<(), Fault> {
        let source = self
            .source
            .as_ref()
            .ok_or_else(|| Fault::Internal("a stored handle without a source".to_owned()))?;
        let loaded = source.load(document_id, Some(&*stored.opener)).await?;
        stored.document = loaded.document;
        stored.version = loaded.version;
        // A reload starts a fresh agent in Node: its undo steps are gone.
        stored.history = "{}".to_owned();
        stored.stale = false;
        Ok(())
    }

    async fn on_document(
        &self,
        step: &Value,
        caller: &Caller,
        approval: &Approval,
    ) -> Result<Outcome, Fault> {
        let handle = str_of(step, "handle").unwrap_or_default();
        let write = step.get("write") == Some(&Value::Bool(true));
        let call = step.get("call").cloned().unwrap_or(Value::Null);
        if self.shared(handle) {
            return self.on_shared(handle, write, &call, caller, approval).await;
        }
        let mut lease = self.on_handle(caller, handle, write).await?;
        let document_id = lease.document_id.clone();
        match &mut *lease.session {
            // A stored handle writes as its opener, as with a handle store (on_shared).
            Session::Stored(stored) => {
                let (actor, client_name) =
                    (stored.actor.clone(), stored.opener.client_name.clone());
                self.on_stored(
                    caller,
                    &document_id,
                    stored,
                    &call,
                    &actor,
                    &client_name,
                    approval,
                )
                .await
            }
            Session::Room(room) => {
                let (actor, client_name) = self.actor(caller).await?;
                self.on_room(&document_id, room, &call, &actor, &client_name, approval)
                    .await
            }
            Session::Remote(room) => {
                let (actor, client_name) = self.actor(caller).await?;
                self.on_remote(
                    caller,
                    &document_id,
                    room,
                    &call,
                    &actor,
                    &client_name,
                    approval,
                )
                .await
            }
        }
    }

    /// One call on a stored handle's document.
    #[allow(clippy::too_many_arguments)]
    async fn on_stored(
        &self,
        caller: &Caller,
        document_id: &str,
        stored: &mut Stored,
        call: &Value,
        actor: &Value,
        client_name: &str,
        approval: &Approval,
    ) -> Result<Outcome, Fault> {
        match str_of(call, "name") {
            Some("blok_read") => {
                if stored.stale {
                    self.reload(document_id, stored).await?;
                }
                let input = self
                    .session_input("stored", stored.write, &stored.document, actor)
                    .val("view", call.get("view").unwrap_or(&json!({})))
                    .finish();
                Ok(Outcome::Answer(answer_of(
                    &self.bundle.call_raw("mcpRead", &input).await?,
                )?))
            }
            Some("blok_describe") => {
                let input = self
                    .session_input("stored", stored.write, &stored.document, actor)
                    .val("query", call.get("query").unwrap_or(&json!({})))
                    .finish();
                Ok(Outcome::Answer(answer_of(
                    &self.bundle.call_raw("mcpDescribe", &input).await?,
                )?))
            }
            _ => {
                self.execute(
                    caller,
                    document_id,
                    stored,
                    call,
                    actor,
                    client_name,
                    approval,
                )
                .await
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn execute(
        &self,
        caller: &Caller,
        document_id: &str,
        stored: &mut Stored,
        call: &Value,
        actor: &Value,
        client_name: &str,
        approval: &Approval,
    ) -> Result<Outcome, Fault> {
        let source = self
            .source
            .as_ref()
            .ok_or_else(|| Fault::Internal("a stored handle without a source".to_owned()))?;
        if stored.stale {
            self.reload(document_id, stored).await?;
        }
        let mut asking =
            json!({ "capabilities": approval.capabilities, "clientName": client_name });
        if let Some(replies) = &approval.replies {
            asking["replies"] = replies.clone();
        }
        let batch = call.get("batch").unwrap_or(&Value::Null);
        let mut work = HostWork::default();
        // A read-only handle or a malformed batch is refused before any page.
        if self.creates_pages() && stored.write && is_batch_envelope(batch) {
            let counting = self
                .session_input("stored", stored.write, &stored.document, actor)
                .val("batch", batch)
                .val("approval", &asking)
                .finish();
            let counted = self.bundle.call("agentPagesNeeded", &counting).await?;
            let opener = stored.opener.clone();
            work = self
                .host_work(
                    caller,
                    actor,
                    client_name,
                    &opener,
                    document_id,
                    false,
                    &counted,
                )
                .await?;
        }
        let mut input = self
            .session_input("stored", stored.write, &stored.document, actor)
            .raw("history", &stored.history)
            .val("batch", batch)
            .str("documentText", source.document_text_form())
            .val("approval", &asking);
        if let Some(failure) = &work.create_failure {
            input = input.val("createPageFailure", failure);
        }
        if !work.page_writes.is_empty() {
            input = input.val("pageWrites", &json!(work.page_writes));
        }
        if !work.created.is_empty() {
            input = input.val("createdPages", &json!(work.created));
        }
        // Uploads run by replay: the bundle stops at each uploader call, the
        // host makes it, and the batch runs again with one more answer.
        let mut answers = Vec::new();
        let mut reads = Vec::new();
        let out = loop {
            let mut call = input.clone();
            if let Some(uploads) = &self.uploads {
                call = call.val("uploads", &uploads.input(&answers));
            }
            let out = match self.bundle.call_raw("agentExecute", &call.finish()).await {
                Ok(out) => out,
                Err(err) => {
                    return Err(self
                        .orphaned(&work.created, Some(&stored.document), err.into())
                        .await);
                }
            };
            match (out.value("upload"), &self.uploads) {
                // A read, then its upload: never more than a few turns.
                (Some(upload), Some(uploads)) if answers.len() < 4 => {
                    answers.push(uploads.answer(&upload, batch, &mut reads).await);
                }
                _ => break out,
            }
        };
        if let Some(ask) = out.value("ask") {
            return Ok(Outcome::Ask(Ask {
                key: str_of(&ask, "key").unwrap_or_default().to_owned(),
                message: ask.get("message").cloned().unwrap_or(Value::Null),
                requested_schema: ask.get("requestedSchema").cloned().unwrap_or(Value::Null),
            }));
        }
        let Some(mut result) = out.text("result").map(str::to_owned) else {
            let fault = Fault::Internal("agentExecute gave no result".to_owned());
            return Err(self
                .orphaned(&work.created, Some(&stored.document), fault)
                .await);
        };
        if self.page_creator.is_some()
            && !work.created.is_empty()
            && let Some(reported) = crate::create_page::report_orphaned(
                &result,
                &stored.document,
                &work.created,
                work.cancelled,
            )
        {
            result = reported;
        }
        // Memory takes a batch to save only once the source has it, so a
        // failed save leaves no edit and no undo step behind.
        let keep = |stored: &mut Stored| {
            if let Some(document) = out.text("document") {
                stored.document = document.to_owned();
            }
            if let Some(history) = out.text("history") {
                stored.history = history.to_owned();
            }
        };
        let mut answer = Obj::new().raw("result", &result);
        let mut refused = false;
        if out.value("save") == Some(Value::Bool(true)) {
            let Some(text) = out
                .value("documentText")
                .and_then(|v| v.as_str().map(str::to_owned))
            else {
                stored.stale = true;
                let fault = Fault::Internal("agentExecute gave no documentText".to_owned());
                return Err(self
                    .orphaned(&work.created, Some(&stored.document), fault)
                    .await);
            };
            // As Node: the answer is built before the save, so nothing that can
            // fail follows it, and a failed answer saved nothing a retry repeats.
            let stand_in = saved_version_stand_in();
            let durable = json!({ "durable": true, "pending": false, "serverSequence": null, "savedVersion": stand_in });
            let delivery =
                unconfirmed_delivery(work.unconfirmed, &result, Some(durable)).unwrap_or_default();
            let built = match self
                .bundle
                .call_raw(
                    "mcpExecuteAnswer",
                    &answer.clone().val("delivery", &delivery).finish(),
                )
                .await
                .map_err(Fault::from)
                .and_then(|raw| answer_of(&raw))
            {
                Ok(built) => built,
                Err(fault) => {
                    stored.stale = true;
                    return Err(self
                        .orphaned(&work.created, Some(&stored.document), fault)
                        .await);
                }
            };
            match source
                .save(
                    document_id,
                    &text,
                    stored.version.as_deref(),
                    Some(&*stored.opener),
                )
                .await
            {
                Ok(version) => {
                    keep(stored);
                    let saved =
                        serde_json::to_string(&version).unwrap_or_else(|_| "null".to_owned());
                    stored.version = version;
                    return Ok(Outcome::Answer(Answer {
                        structured: built.structured.replacen(
                            &format!("\"{stand_in}\""),
                            &saved,
                            1,
                        ),
                        is_error: built.is_error,
                    }));
                }
                Err(fault) => {
                    // Memory must match the source: drop the refused work.
                    stored.stale = true;
                    let _ = self.reload(document_id, stored).await;
                    // A refused save stays unreported (packages/mcp/README.md).
                    refused = true;
                    match fault {
                        Fault::Host(error) => answer = answer.val("failed", &error.failed_input()),
                        Fault::Internal(message) => return Err(Fault::Internal(message)),
                    }
                }
            }
        } else {
            keep(stored);
        }
        if let Some(delivery) = unconfirmed_delivery(work.unconfirmed, &result, None) {
            answer = answer.val("delivery", &delivery);
        }
        let built = self
            .bundle
            .call_raw("mcpExecuteAnswer", &answer.finish())
            .await
            .map_err(Fault::from)
            .and_then(|raw| answer_of(&raw));
        match built {
            Ok(built) => Ok(Outcome::Answer(built)),
            Err(fault) if refused => Err(fault),
            Err(fault) => Err(self
                .orphaned(&work.created, Some(&stored.document), fault)
                .await),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    async fn stored_write(bundle: Arc<Bundle>) -> (Mcp, std::path::PathBuf, String) {
        stored_write_with(bundle, json!({})).await
    }

    async fn stored_write_with(
        bundle: Arc<Bundle>,
        extra: Value,
    ) -> (Mcp, std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!(
            "blok-mcp-answer-{}-{}",
            std::process::id(),
            Arc::as_ptr(&bundle) as usize
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("doc.json"), r#"{"blocks":[]}"#).unwrap();
        let mut options = json!({
            "transport": { "kind": "stdio" }, "auth": { "kind": "none" },
            "source": { "kind": "files", "dir": dir.to_string_lossy() },
        });
        for (key, value) in extra.as_object().unwrap() {
            options[key] = value.clone();
        }
        let mcp = Mcp::new(bundle, &options, None, None).await.unwrap();
        let opened = execute(
            &mcp,
            "blok_open",
            json!({ "documentId": "doc", "write": true }),
        )
        .await
        .unwrap();
        let handle = serde_json::from_str::<Value>(&opened.structured).unwrap()["handle"]
            .as_str()
            .unwrap()
            .to_owned();
        (mcp, dir, handle)
    }

    async fn execute(mcp: &Mcp, name: &str, args: Value) -> Result<Answer, String> {
        let caller = Caller {
            principal: "alice".to_owned(),
            client_name: None,
            scopes: None,
        };
        match mcp
            .call(name, &args, &caller, &Approval::default(), &|| false)
            .await?
        {
            Outcome::Answer(answer) => Ok(answer),
            other => panic!("{other:?}"),
        }
    }

    fn set_title(handle: &str) -> Value {
        titled(handle, "Kept")
    }

    fn titled(handle: &str, title: &str) -> Value {
        json!({ "handle": handle, "commands": [{ "name": "doc.setTitle", "args": { "title": title } }] })
    }

    fn one(handle: &str, name: &str) -> Value {
        json!({ "handle": handle, "commands": [{ "name": name, "args": {} }] })
    }

    // A save that never happened must leave memory as the source holds it,
    // with no undo step that could bring the lost batch back.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_batch_that_fails_before_its_save_leaves_memory_as_the_source() {
        let bundle = Arc::new(Bundle::new(1).unwrap());
        let (mcp, dir, handle) = stored_write(bundle.clone()).await;
        let first = execute(&mcp, "blok_execute", titled(&handle, "First"))
            .await
            .unwrap();
        assert!(!first.is_error, "{}", first.structured);
        *bundle.drop_member.lock().unwrap() = Some(("agentExecute", "documentText"));
        let _ = execute(&mcp, "blok_execute", set_title(&handle)).await;
        *bundle.drop_member.lock().unwrap() = None;
        let file = || std::fs::read_to_string(dir.join("doc.json")).unwrap();
        assert!(
            file().contains("First") && !file().contains("Kept"),
            "{}",
            file()
        );
        let read = execute(&mcp, "blok_read", json!({ "handle": handle }))
            .await
            .unwrap();
        assert!(
            read.structured.contains("First") && !read.structured.contains("Kept"),
            "{}",
            read.structured
        );
        let _ = execute(&mcp, "blok_execute", one(&handle, "history.undo")).await;
        let _ = execute(&mcp, "blok_execute", one(&handle, "history.redo")).await;
        assert!(!file().contains("Kept"), "{}", file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn two_pages(handle: &str) -> Value {
        json!({ "handle": handle, "commands": [
            { "name": "block.insert", "args": { "type": "page", "id": "pg1", "data": {} } },
            { "name": "block.insert", "args": { "type": "page", "id": "pg2", "data": {} } },
        ] })
    }

    /// Runs a two-page batch with `break_it` set on the bundle; answers the
    /// batch's error and the page files on disk.
    async fn pages_then_failure(break_it: impl FnOnce(&Bundle)) -> (Value, Vec<String>) {
        let bundle = Arc::new(Bundle::new(1).unwrap());
        let (mcp, dir, handle) =
            stored_write_with(bundle.clone(), json!({ "pageTitles": "page-map" })).await;
        break_it(&bundle);
        let answer = execute(&mcp, "blok_execute", two_pages(&handle))
            .await
            .expect("the made pages are reported, not a JSON-RPC error");
        assert!(answer.is_error, "{}", answer.structured);
        assert_eq!(
            std::fs::read_to_string(dir.join("doc.json")).unwrap(),
            r#"{"blocks":[]}"#
        );
        let mut pages: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter_map(|name| name.strip_suffix(".json").map(str::to_owned))
            .filter(|name| name != "doc")
            .collect();
        pages.sort();
        let _ = std::fs::remove_dir_all(&dir);
        let error = serde_json::from_str::<Value>(&answer.structured).unwrap()["error"].clone();
        (error, pages)
    }

    /// blokagent's cause for a batch a server error stopped, as C# and Go
    /// report it too (pagecreate.rs stopped_after_creating).
    /// The bundle adds the failed insert's commandIndex when it fails one.
    pub(crate) fn assert_server_stop(cause: &Value) {
        let mut cause = cause.clone();
        if let Some(cause) = cause.as_object_mut() {
            cause.remove("commandIndex");
        }
        assert_eq!(
            cause,
            json!({ "code": "APPLY_FAILED", "message": "The batch stopped on a server error. Nothing was written.", "retryable": true })
        );
    }

    fn orphaned_ids(error: &Value) -> Vec<String> {
        assert_eq!(error["code"], "ORPHANED_SIDE_EFFECT", "{error}");
        assert_eq!(error["retryable"], false, "{error}");
        let mut ids: Vec<String> = error["details"]["orphaned"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| {
                assert_eq!(entry["command"], "block.insert", "{entry}");
                assert_eq!(entry["type"], "page", "{entry}");
                entry["prepared"]["pageId"].as_str().unwrap().to_owned()
            })
            .collect();
        ids.sort();
        ids
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_page_creation_that_breaks_reports_the_pages_already_made() {
        let (error, pages) = pages_then_failure(|bundle| {
            *bundle.fail.lock().unwrap() = Some(("mcpDocumentText", "blocks"));
            bundle
                .fail_after
                .store(1, std::sync::atomic::Ordering::SeqCst);
        })
        .await;
        assert_eq!(pages.len(), 1, "{pages:?}");
        assert_eq!(orphaned_ids(&error), pages);
        assert_server_stop(&error["details"]["cause"]);
        assert_eq!(error["details"]["cause"]["commandIndex"], 1, "{error}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_batch_run_that_breaks_after_its_pages_reports_them() {
        let (error, pages) = pages_then_failure(|bundle| {
            *bundle.fail.lock().unwrap() = Some(("agentExecute", "createdPages"));
        })
        .await;
        assert_eq!(pages.len(), 2, "{pages:?}");
        assert_eq!(orphaned_ids(&error), pages);
        assert_server_stop(&error["details"]["cause"]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_answer_that_breaks_after_its_pages_reports_them() {
        let (error, pages) = pages_then_failure(|bundle| {
            *bundle.fail.lock().unwrap() = Some(("mcpExecuteAnswer", r#""durable":true"#));
        })
        .await;
        assert_eq!(pages.len(), 2, "{pages:?}");
        assert_eq!(orphaned_ids(&error), pages);
        assert_server_stop(&error["details"]["cause"]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_save_text_that_is_missing_after_its_pages_reports_them() {
        let (error, pages) = pages_then_failure(|bundle| {
            *bundle.drop_member.lock().unwrap() = Some(("agentExecute", "documentText"));
        })
        .await;
        assert_eq!(pages.len(), 2, "{pages:?}");
        assert_eq!(orphaned_ids(&error), pages);
        assert_server_stop(&error["details"]["cause"]);
    }

    // Node builds the answer before it saves, so a call that fails to
    // answer saved nothing a retry would repeat.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_batch_whose_answer_fails_is_not_saved() {
        let bundle = Arc::new(Bundle::new(1).unwrap());
        *bundle.fail.lock().unwrap() = Some(("mcpExecuteAnswer", r#""durable":true"#));
        let (mcp, dir, handle) = stored_write(bundle).await;
        assert!(
            execute(&mcp, "blok_execute", set_title(&handle))
                .await
                .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("doc.json")).unwrap(),
            r#"{"blocks":[]}"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_saved_batch_answers_with_its_saved_version() {
        let (mcp, dir, handle) = stored_write(Arc::new(Bundle::new(1).unwrap())).await;
        let answer = execute(&mcp, "blok_execute", set_title(&handle))
            .await
            .unwrap();
        let delivery =
            serde_json::from_str::<Value>(&answer.structured).unwrap()["delivery"].clone();
        assert_eq!(delivery["durable"], true, "{delivery}");
        assert!(delivery["savedVersion"].is_string(), "{delivery}");
        assert!(
            !answer.structured.contains("blok-saved-version"),
            "{}",
            answer.structured
        );
        assert!(
            std::fs::read_to_string(dir.join("doc.json"))
                .unwrap()
                .contains("Kept")
        );
    }

    enum Sweeping {
        Takes(Duration),
        Hangs,
        /// Blocks its thread, so dropping it cannot end it.
        BlocksThread(Duration),
    }

    /// A store whose sweep is slow (or never ends), and counts its runs.
    struct SlowSweep {
        inner: crate::handle_store::MemoryHandleStore,
        started: std::sync::atomic::AtomicUsize,
        finished: std::sync::atomic::AtomicUsize,
        sweeping: Sweeping,
    }

    impl HandleStore for SlowSweep {
        fn count(
            &self,
            principal: String,
            idle: Duration,
        ) -> crate::uploads::BoxFuture<'_, Result<usize, StoreError>> {
            self.inner.count(principal, idle)
        }
        fn try_add(
            &self,
            handle: String,
            record: HandleRecord,
            max: usize,
            idle: Duration,
        ) -> crate::uploads::BoxFuture<'_, Result<bool, StoreError>> {
            self.inner.try_add(handle, record, max, idle)
        }
        fn acquire(
            &self,
            handle: String,
            idle: Duration,
            timeout: Duration,
        ) -> crate::uploads::BoxFuture<'_, Result<Acquired, StoreError>> {
            self.inner.acquire(handle, idle, timeout)
        }
        fn sweep(&self, _: Duration) -> crate::uploads::BoxFuture<'_, Result<(), StoreError>> {
            use std::sync::atomic::Ordering;
            Box::pin(async move {
                self.started.fetch_add(1, Ordering::SeqCst);
                match self.sweeping {
                    Sweeping::Takes(took) => tokio::time::sleep(took).await,
                    Sweeping::Hangs => std::future::pending::<()>().await,
                    Sweeping::BlocksThread(took) => std::thread::sleep(took),
                }
                self.finished.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        }
    }

    /// An Mcp on `store` that sweeps it every 20 ms, with its sweeper running.
    async fn sweeping_mcp(store: Arc<SlowSweep>, limit: Option<Duration>) -> Arc<Mcp> {
        let options = json!({ "transport": { "kind": "stdio" }, "auth": { "kind": "none" } });
        let hooks = Hooks {
            handle_store: Some(store),
            ..Hooks::default()
        };
        let mut mcp = Mcp::build(Arc::new(Bundle::new(1).unwrap()), &options, hooks)
            .await
            .unwrap();
        mcp.store_sweep_every = Duration::from_millis(20);
        if let Some(limit) = limit {
            mcp.store_sweep_limit = limit;
        }
        let mcp = Arc::new(mcp);
        mcp.spawn_sweeper();
        mcp
    }

    fn slow_sweep(sweeping: Sweeping) -> Arc<SlowSweep> {
        Arc::new(SlowSweep {
            inner: crate::handle_store::MemoryHandleStore::new(),
            started: Default::default(),
            finished: Default::default(),
            sweeping,
        })
    }

    // Polls off the runtime: its timers can stall while a sweep blocks a worker.
    fn until_a_sweep_starts(store: &SlowSweep) {
        while store.started.load(std::sync::atomic::Ordering::SeqCst) == 0 {
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    // Go and C# give a store sweep 30 s.
    #[tokio::test]
    async fn a_store_sweep_may_run_30_seconds() {
        let store = slow_sweep(Sweeping::Takes(Duration::ZERO));
        let mcp = sweeping_mcp(store, None).await;
        assert_eq!(mcp.store_sweep_limit, Duration::from_secs(30));
    }

    // A hung sweep is dropped at its time limit, so the next one runs.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_hung_store_sweep_is_cut_off_by_its_time_limit() {
        use std::sync::atomic::Ordering;
        let store = slow_sweep(Sweeping::Hangs);
        let mcp = sweeping_mcp(store.clone(), Some(Duration::from_millis(100))).await;
        let waiting = std::time::Instant::now();
        while store.started.load(Ordering::SeqCst) < 2 {
            assert!(
                waiting.elapsed() < Duration::from_secs(5),
                "no second sweep"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        mcp.close_all(Duration::from_secs(5)).await;
    }

    // A stop cancels the sweep in flight rather than waiting it out, and no
    // sweep starts after it.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_stop_cancels_the_store_sweep_and_ends_it() {
        use std::sync::atomic::Ordering;
        let store = slow_sweep(Sweeping::Takes(Duration::from_secs(5)));
        let mcp = sweeping_mcp(store.clone(), None).await;
        until_a_sweep_starts(&store);
        let stopping = std::time::Instant::now();
        mcp.close_all(Duration::from_secs(30)).await;
        assert!(
            stopping.elapsed() < Duration::from_secs(2),
            "{:?}",
            stopping.elapsed()
        );
        assert_eq!(store.finished.load(Ordering::SeqCst), 0);
        let after = store.started.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(store.started.load(Ordering::SeqCst), after);
    }

    // A hung sweep is cancelled by a stop well before its time limit.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_hung_store_sweep_never_holds_up_a_stop() {
        let store = slow_sweep(Sweeping::Hangs);
        let mcp = sweeping_mcp(store.clone(), None).await;
        until_a_sweep_starts(&store);
        let stopping = std::time::Instant::now();
        mcp.close_all(Duration::from_secs(30)).await;
        assert!(
            stopping.elapsed() < Duration::from_secs(2),
            "{:?}",
            stopping.elapsed()
        );
    }

    // A sweep that cannot be cancelled holds up a stop for about 1 s, then
    // the stop goes on without it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_stop_waits_at_most_a_second_for_a_sweep_that_ignores_its_cancel() {
        let store = slow_sweep(Sweeping::BlocksThread(Duration::from_secs(4)));
        let mcp = sweeping_mcp(store.clone(), None).await;
        until_a_sweep_starts(&store);
        let stopping = std::time::Instant::now();
        mcp.close_all(Duration::from_secs(30)).await;
        let took = stopping.elapsed();
        assert!(
            took >= Duration::from_millis(900) && took < Duration::from_secs(2),
            "{took:?}"
        );
    }
}
