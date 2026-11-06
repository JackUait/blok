//! One MCP server: the tool dispatcher of src/mcp/dispatcher.ts, opener.ts
//! and stored-session.ts, over the bundle's MCP operations.

use std::sync::Arc;
use std::time::Duration;

use blok_blokagent::Executor;
use serde_json::{Map, Value, json};

use crate::authorize::Webhook;
use crate::bundle::{Bundle, Obj, RawObject};
use crate::errors::{Fault, HostError};
use crate::handles::Handles;
use crate::live::{Live, TicketRequest};
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
    pub surface: Surface,
    flags: Value,
    pub principal: String,
    idle_ms: Value,
    handles: Arc<Handles<Session>>,
    source: Option<Source>,
    authorize: Option<Webhook>,
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

fn str_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
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
        let mut flags = surface_flags(options);
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
        let live_shared = live.as_ref().map(|_| {
            Arc::new(LiveShared::new(
                bundle.clone(),
                outbound.clone(),
                flags.clone(),
            ))
        });
        Ok(Mcp {
            bundle,
            surface,
            principal: str_of(options, "principal").unwrap_or("local").to_owned(),
            idle_ms,
            handles: Handles::new(idle, max),
            source,
            authorize,
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

    pub fn close_all(&self) {
        self.handles.close_all();
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
                drop(self.on_handle(caller, handle, false).await?);
                let session = self.handles.remove(handle, &caller.principal).await?;
                let summary = match &*session {
                    Session::Remote(room) => room.close().await,
                    // A journaled room records the batch before the host's own copy does.
                    Session::Room(room) => {
                        json!({ "unsavedBatches": 0, "hostRecordLags": room.journaled })
                    }
                    Session::Stored(_) => json!({ "unsavedBatches": 0, "hostRecordLags": false }),
                };
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

    /// A sync URL or the host's own rooms: live mode is on.
    fn syncs(&self) -> bool {
        self.live.is_some() || self.rooms.is_some()
    }

    async fn allowed(&self, principal: &str, document_id: &str, write: bool) -> bool {
        match &self.authorize {
            None => true,
            Some(hook) => hook.allows(principal, document_id, write).await,
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
        Ok((
            out.get("actor").cloned().unwrap_or(Value::Null),
            str_of(&out, "clientName").unwrap_or_default().to_owned(),
        ))
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
        let actor_id = str_of(actor, "id").unwrap_or_default().to_owned();
        let presence = Presence {
            color: presence_color(&actor_id),
            name: client_name.to_owned(),
            on_behalf_of: str_of(actor, "onBehalfOf").unwrap_or(&actor_id).to_owned(),
            actor_id: actor_id.clone(),
        };
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

    async fn on_remote(
        &self,
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
                let executed = room
                    .execute(ExecuteInput {
                        batch: call.get("batch").cloned().unwrap_or(Value::Null),
                        actor: actor.clone(),
                        approval: asking,
                        created_pages: Vec::new(),
                    })
                    .await?;
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
                };
                let mut answer = Obj::new().raw("result", &result);
                match delivery {
                    Delivery::None => {}
                    Delivery::Now(value) => answer = answer.val("delivery", &value),
                    Delivery::Failed(error) => answer = answer.val("failed", &error.failed_input()),
                    Delivery::Wait(fate) => match tokio::time::timeout(DELIVERY_WAIT, fate).await {
                        Ok(Ok(Fate::Acked(sequence))) => {
                            answer = answer.val(
                                "delivery",
                                &json!({ "durable": true, "pending": false, "serverSequence": sequence, "savedVersion": null }),
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
                            answer = answer.val(
                                "delivery",
                                &json!({ "durable": false, "pending": true, "serverSequence": null, "savedVersion": null }),
                            );
                        }
                    },
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
            .read(document_id, view_args.as_ref().unwrap_or(&json!({})), actor)
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
                    .read(document_id, call.get("view").unwrap_or(&json!({})), actor)
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
                let ran = rooms.run(document_id, &batch, actor).await?;
                let result: Value = serde_json::from_str(&ran.result)
                    .map_err(|e| Fault::Internal(e.to_string()))?;
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
                return self.on_room(&document_id, room, &call, &actor).await;
            }
            Session::Remote(room) => {
                return self
                    .on_remote(room, &call, &actor, &client_name, approval)
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
                self.execute(&document_id, stored, &call, &actor, &client_name, approval)
                    .await
            }
        }
    }

    async fn execute(
        &self,
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
        let input = self
            .session_input("stored", stored.write, &stored.document, actor)
            .raw("history", &stored.history)
            .val("batch", call.get("batch").unwrap_or(&Value::Null))
            .str("documentText", source.document_text_form())
            .val("approval", &asking)
            .finish();
        let out = self.bundle.call_raw("agentExecute", &input).await?;
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
                    answer = answer.val(
                        "delivery",
                        &json!({ "durable": true, "pending": false, "serverSequence": null, "savedVersion": version }),
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
        let raw = self
            .bundle
            .call_raw("mcpExecuteAnswer", &answer.finish())
            .await?;
        Ok(Outcome::Answer(answer_of(&raw)?))
    }
}
