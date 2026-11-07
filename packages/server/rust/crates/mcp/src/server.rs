//! One MCP server: the tool dispatcher of src/mcp/dispatcher.ts, opener.ts
//! and stored-session.ts, over the bundle's MCP operations.

use std::sync::Arc;
use std::time::Duration;

use blok_blokagent::Executor;
use serde_json::{Map, Value, json};

use crate::authorize::{Authorize, Webhook};
use crate::bundle::{Bundle, Obj, RawObject};
use crate::errors::{Fault, HostError};
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
    live: Option<Live>,
    live_shared: Option<Arc<LiveShared>>,
    rooms: Option<Rooms>,
}

const DEFAULT_IDLE_MS: u64 = 600_000;

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
/// host: the CLI's checks hold for a library host too.
async fn check_options(
    bundle: &Bundle,
    options: &Value,
    authorize: bool,
    uploads: Option<&crate::uploads::Uploads>,
) -> Result<(), Fault> {
    let mut checked = options.clone();
    if authorize {
        checked["authorize"] = Value::Bool(true);
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
    match answer.get("error").and_then(Value::as_str) {
        Some(error) => Err(Fault::Internal(error.to_owned())),
        None => Ok(()),
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
            agent_actor: None,
            uploads,
            rooms,
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
        let Hooks {
            authorize,
            agent_actor,
            uploads,
            rooms,
        } = hooks;
        check_options(&bundle, options, authorize.is_some(), uploads.as_ref()).await?;
        if let Some(root) = uploads.as_ref().and_then(|u| u.root.as_ref()) {
            crate::uploads::check_root(root).map_err(Fault::Internal)?;
        }
        let mut flags = surface_flags(options);
        if uploads.is_some() {
            flags["uploads"] = Value::Bool(true);
        }
        if rooms.is_some() {
            flags["sync"] = Value::Bool(true);
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
        let source = match opt(options, "source") {
            Some(source) if str_of(source, "kind") == Some("files") => {
                Some(Source::Files(crate::files::FilesSource::new(
                    str_of(source, "dir").unwrap_or("."),
                    bundle.clone(),
                )))
            }
            Some(source) => Some(Source::Endpoint(Box::new(EndpointSource::new(
                str_of(source, "url").unwrap_or_default().to_owned(),
                str_of(source, "endpointAuth")
                    .unwrap_or_default()
                    .to_owned(),
                str_of(source, "list").map(str::to_owned),
                outbound.clone(),
            )))),
            None => None,
        };
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
            calls: Arc::default(),
            reserved: std::sync::Mutex::default(),
            uploads,
            source,
            authorize,
            agent_actor,
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
    }

    /// Node's stop: each handle closes once its calls are done, so a room
    /// gets its presence departure and close frame. Gives up after `limit`.
    pub async fn close_all(&self, limit: Duration) {
        let mut closing = tokio::task::JoinSet::new();
        for session in self.handles.take_all() {
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

    /// Node's opener.createPage: a new id, authorized like a write open; a
    /// stored page is saved empty, a live one is joined once and must be.
    async fn create_page(
        &self,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
    ) -> Result<String, Fault> {
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
            let loaded = source.load(&page_id).await?;
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
                )
                .await?;
            Ok(())
        };
        match made.await {
            Ok(()) => Ok(page_id),
            Err(fault) => Err(named(fault)),
        }
    }

    /// Makes the pages and does the page write a batch needs, in Node's
    /// order: a creation that fails stops there and goes to the bundle,
    /// which refuses that insert inside the batch.
    async fn host_work(
        &self,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
        open_document: &str,
        live_parent: bool,
        counted: &Value,
    ) -> Result<HostWork, Fault> {
        let mut work = HostWork::default();
        for _ in 0..pages_to_make(counted) {
            match self.create_page(caller, actor, client_name).await {
                Ok(page_id) => work.created.push(page_id),
                Err(Fault::Host(error)) => {
                    work.create_failure = Some(error.failed_input());
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
            let loaded = source.load(page_id).await?;
            let mut stored = Stored {
                write: true,
                document: loaded.document,
                history: "{}".to_owned(),
                version: loaded.version,
                stale: false,
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
        let Some(listing) = source.list(&ListRequest::from_value(request)).await else {
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
        self.handles.assert_room(&caller.principal)?;
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
        let loaded = source.load(document_id).await?;
        let stored = Stored {
            write,
            document: loaded.document,
            history: "{}".to_owned(),
            version: loaded.version,
            stale: false,
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
            .handles
            .add(&caller.principal, document_id, Session::Stored(stored))?;
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
            .handles
            .add(&caller.principal, document_id, Session::Remote(room))?;
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
                    work = self
                        .host_work(caller, actor, client_name, document_id, true, &counted)
                        .await?;
                }
                let unconfirmed = work.unconfirmed;
                let mut input = ExecuteInput {
                    batch: batch.clone(),
                    actor: actor.clone(),
                    approval: asking,
                    created_pages: work.created,
                    create_failure: work.create_failure,
                    page_writes: work.page_writes,
                    uploads: None,
                };
                // Uploads run by replay, as on a stored handle.
                let mut answers = Vec::new();
                let mut reads = Vec::new();
                let executed = loop {
                    input.uploads = self.uploads.as_ref().map(|uploads| uploads.input(&answers));
                    let executed = room.execute(input.clone()).await?;
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
            .handles
            .add(&caller.principal, document_id, Session::Room(room))?;
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
        let loaded = source.load(document_id).await?;
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
        let mut lease = self.on_handle(caller, handle, write).await?;
        let document_id = lease.document_id.clone();
        let (actor, client_name) = self.actor(caller).await?;
        let stored = match &mut *lease.session {
            Session::Stored(stored) => stored,
            Session::Room(room) => {
                return self
                    .on_room(&document_id, room, &call, &actor, &client_name, approval)
                    .await;
            }
            Session::Remote(room) => {
                return self
                    .on_remote(
                        caller,
                        &document_id,
                        room,
                        &call,
                        &actor,
                        &client_name,
                        approval,
                    )
                    .await;
            }
        };
        match str_of(&call, "name") {
            Some("blok_read") => {
                if stored.stale {
                    self.reload(&document_id, stored).await?;
                }
                let input = self
                    .session_input("stored", stored.write, &stored.document, &actor)
                    .val("view", call.get("view").unwrap_or(&json!({})))
                    .finish();
                Ok(Outcome::Answer(answer_of(
                    &self.bundle.call_raw("mcpRead", &input).await?,
                )?))
            }
            Some("blok_describe") => {
                let input = self
                    .session_input("stored", stored.write, &stored.document, &actor)
                    .val("query", call.get("query").unwrap_or(&json!({})))
                    .finish();
                Ok(Outcome::Answer(answer_of(
                    &self.bundle.call_raw("mcpDescribe", &input).await?,
                )?))
            }
            _ => {
                self.execute(
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
            work = self
                .host_work(caller, actor, client_name, document_id, false, &counted)
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
            let out = self.bundle.call_raw("agentExecute", &call.finish()).await?;
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
        let result = out
            .text("result")
            .ok_or_else(|| Fault::Internal("agentExecute gave no result".to_owned()))?
            .to_owned();
        if let Some(document) = out.text("document") {
            stored.document = document.to_owned();
        }
        if let Some(history) = out.text("history") {
            stored.history = history.to_owned();
        }
        let mut answer = Obj::new().raw("result", &result);
        let mut delivery = None;
        if out.value("save") == Some(Value::Bool(true)) {
            let text = out
                .value("documentText")
                .and_then(|v| v.as_str().map(str::to_owned))
                .ok_or_else(|| Fault::Internal("agentExecute gave no documentText".to_owned()))?;
            match source
                .save(document_id, &text, stored.version.as_deref())
                .await
            {
                Ok(version) => {
                    stored.version = version.clone();
                    delivery = Some(
                        json!({ "durable": true, "pending": false, "serverSequence": null, "savedVersion": version }),
                    );
                }
                Err(fault) => {
                    // Memory must match the source: drop the refused work.
                    stored.stale = true;
                    let _ = self.reload(document_id, stored).await;
                    match fault {
                        Fault::Host(error) => answer = answer.val("failed", &error.failed_input()),
                        Fault::Internal(message) => return Err(Fault::Internal(message)),
                    }
                }
            }
        }
        if let Some(delivery) = unconfirmed_delivery(work.unconfirmed, &result, delivery) {
            answer = answer.val("delivery", &delivery);
        }
        let raw = self
            .bundle
            .call_raw("mcpExecuteAnswer", &answer.finish())
            .await?;
        Ok(Outcome::Answer(answer_of(&raw)?))
    }
}
