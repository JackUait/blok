//! The room side of the executor: batches on live collaboration rooms.

use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Instant;

use blok_collab_convert::{EditOp, PageMap, read_page_maps};
use blok_collab_room::{
    Applied, EditResult, EditStatus, Manager, PlanOps, Precondition, Receipt, StateStatus,
};
use blok_jsjson::{Kind, Node, Object, Value, new_array, new_bool, new_object};
use blok_yjs::Doc;
use sha2::{Digest, Sha256};

use crate::cancel::Cancel;
use crate::errors::{Error, from_json, into_room, no_answer};
use crate::executor::{Executor, Invoker, agent_execute_on, has_command};
use crate::pagecreate::{Created, stopped_after_creating, stranded};
use crate::roomhistory::{RoomHistory, RoomStep, between};
use crate::translate::translate;
use crate::types::{Actor, Execution, Options};
use crate::wire::{
    actor_node, common, failure, field, get, is_true, member, parse, str_node, string_value, text,
    unavailable, write,
};

/// The collaboration server's live rooms, which `execute_in_room` edits.
/// blokserver builds an executor over its own rooms; a host does not make
/// one.
#[derive(Clone)]
pub struct Rooms {
    manager: Manager,
    policy: Option<HistoryPolicy>,
}

impl Rooms {
    /// Wraps a room manager. It is for blokserver, which owns the manager.
    pub fn new(manager: Manager) -> Rooms {
        Rooms {
            manager,
            policy: None,
        }
    }

    /// `new` with the host's history hooks, asked on every agent history
    /// command. It is for blokserver.
    pub fn with_history(manager: Manager, policy: HistoryPolicy) -> Rooms {
        Rooms {
            manager,
            policy: Some(policy),
        }
    }
}

/// What the host's history hooks allow one agent call. `can_read` false
/// refuses history.versions, history.read, history.changes, history.restore
/// and history.previewRestore; `window`
/// None shows the whole history.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryAccess {
    pub can_read: bool,
    pub window: Option<std::time::Duration>,
}

/// Asks the host's history hooks for a user on a document: the person the
/// agent acts for, else the agent.
pub type HistoryPolicy = Arc<
    dyn Fn(
            String,
            String,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<
                        Output = Result<HistoryAccess, Box<dyn std::error::Error + Send + Sync>>,
                    > + Send,
            >,
        > + Send
        + Sync,
>;

impl fmt::Debug for Rooms {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Rooms")
    }
}

/// The rooms an executor edits and its agents' undo steps in them.
pub(crate) struct Live {
    pub manager: Manager,
    pub history: Arc<RoomHistory>,
    pub policy: Option<HistoryPolicy>,
}

impl Live {
    /// C#'s rooms constructor: the room steps forget a document the room
    /// replaced (a reset, an applied restore, a purge).
    pub(crate) fn attach(rooms: Rooms) -> Live {
        let history = Arc::new(RoomHistory::new(Box::new(Instant::now)));
        let forget = history.clone();
        rooms
            .manager
            .on_document_replaced(move |doc_id| forget.forget(doc_id));
        Live {
            manager: rooms.manager,
            history,
            policy: rooms.policy,
        }
    }
}

/// Stops the plan inside the lane when there is nothing to write, so the
/// room writes nothing.
#[derive(Debug)]
struct NoRoomWrite;

impl fmt::Display for NoRoomWrite {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("blokagent: nothing to write in the room")
    }
}

impl std::error::Error for NoRoomWrite {}

pub(crate) fn is_other<T: std::error::Error + 'static>(err: &blok_collab_room::Error) -> bool {
    matches!(err, blok_collab_room::Error::Other(inner) if inner.is::<T>())
}

/// What one plan call saw; a retried plan overwrites it.
#[derive(Default)]
struct Planned {
    result: Option<Node>,
    before: Option<Object>,
    before_maps: Vec<PageMap>,
    wrote: bool,
}

impl Executor {
    pub(crate) fn live(&self) -> Option<&Live> {
        self.live.as_ref()
    }

    /// C#'s RoomCommon: a room keeps the agent's steps on the server, so its
    /// contract says so. Rooms whose journal keeps history also add
    /// versionHistory and restores.
    pub(crate) fn room_common(&self, options: Option<&Options>) -> Result<Node, Error> {
        let mut input = common(options)?;
        input
            .members
            .push(member("runtime", str_node("csharp-live")));
        if self.live().is_some_and(|live| live.manager.has_history()) {
            if let Some(services) = input.lookup_mut("services").map_err(from_json)? {
                services.items.push(str_node("versionHistory"));
            }
            input.members.push(member("restores", new_bool(true)));
        }
        Ok(input)
    }

    /// Runs a batch on a live room. The bundle plans it inside the room
    /// lane against the live document, and the revision is the journal head
    /// "lineage:sequence", never the bundle's content hash. Without rooms it
    /// answers COMMAND_UNAVAILABLE and never runs the bundle.
    pub async fn execute_in_room(
        &self,
        cancel: &Cancel,
        doc_id: &str,
        batch_json: &str,
        actor: &Actor,
        options: Option<&Options>,
    ) -> Result<Execution, Error> {
        if doc_id.is_empty() {
            return Err(Error::Argument {
                param: "docId".to_owned(),
                message: "The value cannot be an empty string.".to_owned(),
            });
        }
        let Some(live) = self.live() else {
            return unavailable("Live rooms need collaboration on this server.");
        };
        let mut parsed = parse(batch_json)?;
        let mut expect = None;
        if parsed.kind == Kind::Object {
            // Removed before the bundle, which would compare a journal head
            // with its content hash.
            let expected = parsed.lookup("expectRevision").map_err(from_json)?.cloned();
            if let Some(expected) = expected {
                parsed.remove("expectRevision");
                expect = parse_head(Some(&expected))?;
                if expect.is_none() {
                    return failure(
                        "INVALID_ARGS",
                        "In a room, expectRevision is the journal head \"lineage:sequence\" a result returned. Read the room again and pass its revision.",
                        false,
                        None,
                        "",
                    );
                }
            }
        }
        let batch = parsed;

        let mut input = self.room_common(options)?;
        input.members.push(member("batch", batch.clone()));
        input.members.push(member("actor", actor_node(actor)));

        if let Some((name, args)) = version_command(&batch)? {
            return self
                .run_version_read(cancel, doc_id, input, &name, &args, expect)
                .await;
        }

        // The source room is only read; the host action writes the target.
        let page_target = options
            .filter(|options| options.page_titles)
            .and_then(|options| options.page_target.as_deref());
        if let Some(target) = page_target
            && has_command(&batch, &["page.rename", "page.setIcon"])?
        {
            let (document, current, _) = self.room_status(Some(cancel), doc_id).await?;
            let Some(document) = document else {
                return room_unreadable();
            };
            if expect.as_ref().is_some_and(|e| head_of(e) != current) {
                return stale(&current);
            }
            input.members.push(member("document", document));
            let acted = Box::pin(self.run_page_action(cancel, &input, actor, target)).await?;
            let result = parse(&acted.result_json)?;
            if is_true(Some(&result), "ok")? {
                let mut other = RoomStep::new(Some(Object::new()), Some(Object::new()))?;
                other.other = true;
                live.history.add(doc_id, actor, Arc::new(other));
            }
            return with_head(acted, &current);
        }

        if let Some(history_name) = history_command(&batch)? {
            // The bundle checks the batch against the contract the options
            // build; only its "nothing to replay" answer, from a session with
            // no steps, lets the room replay.
            input.members.push(member(
                "document",
                new_object(vec![member("blocks", new_array(Vec::new()))]),
            ));
            let answer = self.invoke(cancel, "agentExecute", &input).await?;
            let output = parse(&answer)?;
            let Some(gate) = field(Some(&output), "result")?.filter(|g| g.kind == Kind::Object)
            else {
                return Err(no_answer("agent result"));
            };
            let code = error_code(gate)?;
            if code != "NOTHING_TO_UNDO" && code != "NOTHING_TO_REDO" {
                let mut gate = gate.clone();
                gate.remove("revision");
                return Ok(Execution {
                    result_json: write(&gate)?,
                    document_json: None,
                    revision: String::new(),
                });
            }
            // A host with an approval channel asks before an unlock.
            let asks = options.is_some_and(|o| o.approval_json.is_some());
            return self
                .run_room_history(
                    cancel,
                    doc_id,
                    history_name == "history.undo",
                    actor,
                    expect,
                    asks.then_some(&input),
                )
                .await;
        }

        let mut created = Vec::new();
        if let Some(target) = page_target
            && target.as_creator().is_some()
            && has_command(&batch, &["block.insert"])?
        {
            let (state, current, _) = self.room_status(Some(cancel), doc_id).await?;
            let Some(state) = state else {
                return room_unreadable();
            };
            // The bundle never sees expectRevision here, so a stale batch
            // must stop before the host creates pages.
            if expect.as_ref().is_some_and(|e| head_of(e) != current) {
                return self
                    .stale_with_current(cancel, doc_id, &input, &current)
                    .await;
            }
            // Made outside the room lane, so a slow host never holds the
            // room. The lane run checks the count again.
            input.members.push(member("document", state));
            let made = self
                .create_pages(cancel, &mut input, options, actor, Some(doc_id))
                .await?;
            input.remove("document");
            match made {
                Created::Refused(refusal) => return with_head(refusal, ""),
                Created::Pages(made) => created = made,
            }
        }

        let slot = Arc::new(Mutex::new(Planned::default()));
        let digest = Sha256::digest(format!("agent\n{}\n{batch_json}", actor.id).as_bytes());
        let plan = plan_batch(
            self.runtime.clone(),
            live.manager.clone(),
            input.clone(),
            slot.clone(),
        );
        let applied = record_step(
            live.manager.clone(),
            live.history.clone(),
            doc_id,
            actor,
            slot.clone(),
        );
        cancel.check()?;
        let edit = live
            .manager
            .agent_edit_noted(
                doc_id,
                plan,
                &new_guid(),
                &digest,
                &actor.id,
                expect,
                Some(applied),
                crate::roomreplay::agent_note(actor),
            )
            .await;
        let planned = slot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .result
            .take();
        let edit = match edit {
            Ok(edit) => edit,
            Err(err) => {
                let nothing = is_other::<NoRoomWrite>(&err);
                if let (true, Some(planned)) = (nothing, &planned) {
                    // A refusal, or a read with no journal head. The bundle's
                    // content hash means nothing in a room.
                    return with_head(
                        Execution {
                            result_json: write(planned)?,
                            ..Execution::default()
                        },
                        "",
                    );
                }
                let err = Error::from(err);
                if !created.is_empty() && !nothing {
                    // The room may have written before the error, and a page
                    // it links is in use.
                    if !self.room_links_none(doc_id, &created).await? {
                        return Err(err);
                    }
                    return stopped_after_creating(&err, &created);
                }
                return Err(err);
            }
        };

        let head = receipt_head(edit.receipt.as_ref());
        if !created.is_empty() && edit.status != EditStatus::Applied {
            let refused = self
                .room_refusal(cancel, &edit, doc_id, &input, &head)
                .await?;
            if self.room_links_none(doc_id, &created).await? {
                return stranded(refused, &created);
            }
            return Ok(refused);
        }
        if let (EditStatus::Applied, Some(planned)) = (edit.status, &planned) {
            return with_head(
                Execution {
                    result_json: write(planned)?,
                    document_json: None,
                    revision: head.clone(),
                },
                &head,
            );
        }
        self.room_refusal(cancel, &edit, doc_id, &input, &head)
            .await
    }

    /// The answer for a batch edit the room did not apply.
    async fn room_refusal(
        &self,
        cancel: &Cancel,
        edit: &EditResult,
        doc_id: &str,
        input: &Node,
        head: &str,
    ) -> Result<Execution, Error> {
        match edit.status {
            EditStatus::PreconditionFailed => {
                self.stale_with_current(cancel, doc_id, input, head).await
            }
            EditStatus::PreconditionRequired => failure(
                "INVALID_ARGS",
                "This room keeps no journal, so expectRevision cannot be checked. Send the batch without it.",
                false,
                None,
                "",
            ),
            status => failure(
                "APPLY_FAILED",
                &format!("The room refused the edit ({status}). Nothing was written."),
                retryable_edit(status),
                Some(new_object(vec![member(
                    "status",
                    str_node(&status.to_string()),
                )])),
                head,
            ),
        }
    }

    /// True only when a fresh read of the room shows none of these pages
    /// linked. A room that cannot be read counts as linking them, so a host
    /// never deletes a page that may be in use. The read ignores the
    /// caller's cancel.
    async fn room_links_none(&self, doc_id: &str, created: &[Node]) -> Result<bool, Error> {
        let Ok((document, _, _)) = self.room_status(None, doc_id).await else {
            return Ok(false);
        };
        let Ok(Some(blocks)) = field(document.as_ref(), "blocks") else {
            return Ok(false);
        };
        if blocks.kind != Kind::Array {
            return Ok(false);
        }
        let mut ids = std::collections::HashSet::new();
        for id in created {
            ids.insert(string_value(Some(id))?);
        }
        for block in blocks.items.iter().filter(|b| b.kind == Kind::Object) {
            if string_value(get(block, "type")?)? != "page" {
                continue;
            }
            let data = field(Some(block), "data")?;
            let page_id = field(data, "pageId")?;
            if text(page_id)?.is_some_and(|value| ids.contains(&value)) {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The room's export and its journal head, read in one lane hold. The
    /// document is None unless the room is ready. A cancel stops the wait;
    /// the read itself runs on the room's task.
    pub(crate) async fn room_status(
        &self,
        cancel: Option<&Cancel>,
        doc_id: &str,
    ) -> Result<(Option<Node>, String, StateStatus), Error> {
        let manager = &self.live().expect("rooms").manager;
        let state = match cancel {
            Some(cancel) => {
                cancel.check()?;
                tokio::select! {
                    reason = cancel.cancelled() => return Err(Error::Cancelled(reason)),
                    state = manager.state(doc_id) => state?,
                }
            }
            None => manager.state(doc_id).await?,
        };
        let head = receipt_head(state.head.as_ref());
        if state.status != StateStatus::Ready {
            return Ok((None, head, state.status));
        }
        let document = parse(&String::from_utf8_lossy(&state.json))?;
        let document = (document.kind == Kind::Object).then_some(document);
        Ok((document, head, state.status))
    }

    /// STALE with details.current: the bundle re-checks the batch against
    /// the room as it is now, with the head as its expected revision. A head
    /// never equals the bundle's content hash, so the bundle builds the
    /// stale context itself.
    pub(crate) async fn stale_with_current(
        &self,
        cancel: &Cancel,
        doc_id: &str,
        input: &Node,
        head: &str,
    ) -> Result<Execution, Error> {
        let (document, current, _) = self.room_status(Some(cancel), doc_id).await?;
        let mut input = input.clone();
        let batch_is_object = matches!(
            input.lookup("batch").ok().flatten(),
            Some(batch) if batch.kind == Kind::Object
        );
        let Some(document) = document.filter(|_| batch_is_object) else {
            return stale(head);
        };
        if let Some(batch) = input.lookup_mut("batch").map_err(from_json)? {
            batch
                .set("expectRevision", str_node(&current))
                .map_err(from_json)?;
        }
        input.set("document", document).map_err(from_json)?;
        let answer = self.invoke(cancel, "agentExecute", &input).await?;
        let output = parse(&answer)?;
        let Some(result) = field(Some(&output), "result")?.filter(|r| r.kind == Kind::Object)
        else {
            return stale(head);
        };
        if error_code(result)? != "STALE" {
            return stale(head);
        }
        with_head(
            Execution {
                result_json: write(result)?,
                document_json: None,
                revision: current.clone(),
            },
            &current,
        )
    }
}

/// The plan the room runs in its lane: the bundle plans the batch on the
/// live export. It runs on the room's own lifetime, so the caller's cancel
/// never reaches the runtime here.
fn plan_batch(
    runtime: Arc<dyn Invoker>,
    manager: Manager,
    input: Node,
    slot: Arc<Mutex<Planned>>,
) -> PlanOps {
    let input = Arc::new(input);
    Arc::new(move |doc: Doc| {
        let (runtime, manager, input, slot) = (
            runtime.clone(),
            manager.clone(),
            input.clone(),
            slot.clone(),
        );
        Box::pin(async move {
            plan_once(runtime.as_ref(), &manager, &input, &slot, &doc)
                .await
                .map_err(|err| match err {
                    PlanError::Agent(err) => into_room(err),
                    PlanError::Nothing => blok_collab_room::Error::Other(Box::new(NoRoomWrite)),
                })
        })
    })
}

enum PlanError {
    Agent(Error),
    Nothing,
}

impl<E: Into<Error>> From<E> for PlanError {
    fn from(err: E) -> PlanError {
        PlanError::Agent(err.into())
    }
}

async fn plan_once(
    runtime: &dyn Invoker,
    manager: &Manager,
    input: &Node,
    slot: &Mutex<Planned>,
    doc: &Doc,
) -> Result<Vec<EditOp>, PlanError> {
    *slot.lock().unwrap_or_else(PoisonError::into_inner) = Planned::default();
    let exported = manager.converter().export(doc).await.map_err(Error::from)?;
    let before_maps = read_page_maps(doc).map_err(Error::from)?;
    let document = to_node_json(&exported)?;
    {
        let mut slot = slot.lock().unwrap_or_else(PoisonError::into_inner);
        slot.before = Some(exported);
        slot.before_maps = before_maps;
    }
    let mut input = input.clone();
    input.set("document", document).map_err(from_json)?;
    let output = agent_execute_on(runtime, &Cancel::new(), &input).await?;
    // A batch waiting on a person's yes applied nothing.
    if let Some(ask) = field(Some(&output), "ask")?.filter(|a| a.kind == Kind::Object) {
        slot.lock().unwrap_or_else(PoisonError::into_inner).result =
            Some(new_object(vec![member("ask", ask.clone())]));
        return Err(PlanError::Nothing);
    }
    let Some(result) = field(Some(&output), "result")?.filter(|r| r.kind == Kind::Object) else {
        return Err(no_answer("agent result").into());
    };
    slot.lock().unwrap_or_else(PoisonError::into_inner).result = Some(result.clone());
    // A failed batch must not reach the room.
    if !is_true(Some(result), "ok")? {
        return Err(PlanError::Nothing);
    }
    let Some(edits) = field(Some(&output), "edits")?.filter(|e| e.kind == Kind::Array) else {
        return Err(no_answer("edits").into());
    };
    let Some(after) = field(Some(&output), "document")?.filter(|d| d.kind == Kind::Object) else {
        return Err(no_answer("document").into());
    };
    let ops = translate(edits, after, result)?;
    // A journal room answers zero ops with its head and writes nothing; a
    // plain room would persist.
    if ops.is_empty() && !manager.has_journal() {
        return Err(PlanError::Nothing);
    }
    // A read is no step, as the stored session marks only batches with
    // edits.
    slot.lock().unwrap_or_else(PoisonError::into_inner).wrote = !edits.items.is_empty();
    Ok(ops)
}

/// Runs in the lane after the edit lands: the step the batch made.
fn record_step(
    manager: Manager,
    history: Arc<RoomHistory>,
    doc_id: &str,
    actor: &Actor,
    slot: Arc<Mutex<Planned>>,
) -> Applied {
    let (doc_id, actor) = (doc_id.to_owned(), actor.clone());
    Arc::new(move |doc: Doc, receipt: Option<Receipt>| {
        let (manager, history, doc_id, actor, slot) = (
            manager.clone(),
            history.clone(),
            doc_id.clone(),
            actor.clone(),
            slot.clone(),
        );
        Box::pin(async move {
            let (before, before_maps) = {
                let slot = slot.lock().unwrap_or_else(PoisonError::into_inner);
                match (&slot.before, slot.wrote) {
                    (Some(before), true) => (before.clone(), slot.before_maps.clone()),
                    _ => return Ok(()),
                }
            };
            let after = manager.converter().export(&doc).await?;
            let after_maps = read_page_maps(&doc)?;
            let mut recorded =
                between(&before, &before_maps, &after, &after_maps).map_err(into_room)?;
            // Set before the step is shared: an undo reads it from another
            // call.
            if let Some(receipt) = receipt {
                recorded.lineage = Some(receipt.tag.lineage);
            }
            history.add(&doc_id, &actor, Arc::new(recorded));
            Ok(())
        })
    })
}

pub(crate) fn retryable_edit(status: EditStatus) -> bool {
    matches!(
        status,
        EditStatus::Overloaded
            | EditStatus::Unavailable
            | EditStatus::Draining
            | EditStatus::SeedFailed
    )
}

/// A batch that is only history.undo or history.redo with no args;
/// anything else goes to the bundle, which checks it.
pub(crate) fn history_command(batch: &Node) -> Result<Option<String>, Error> {
    let Some(command) = only_command(batch)? else {
        return Ok(None);
    };
    if command.members.len() > 2 {
        return Ok(None);
    }
    let Some(value) = text(get(command, "name")?)? else {
        return Ok(None);
    };
    if value != "history.undo" && value != "history.redo" {
        return Ok(None);
    }
    let args = command.lookup("args").map_err(from_json)?;
    if !args.is_some_and(|args| args.kind == Kind::Object && args.members.is_empty()) {
        return Ok(None);
    }
    Ok(Some(value))
}

fn only_command(batch: &Node) -> Result<Option<&Node>, Error> {
    if batch.kind != Kind::Object {
        return Ok(None);
    }
    let Some(commands) = get(batch, "commands")? else {
        return Ok(None);
    };
    if commands.kind != Kind::Array || commands.items.len() != 1 {
        return Ok(None);
    }
    Ok(Some(&commands.items[0]).filter(|c| c.kind == Kind::Object))
}

/// Only commands[0] is checked for a version command.
pub(crate) fn version_command(batch: &Node) -> Result<Option<(String, Node)>, Error> {
    if batch.kind != Kind::Object {
        return Ok(None);
    }
    let Some(commands) = get(batch, "commands")? else {
        return Ok(None);
    };
    if commands.kind != Kind::Array || commands.items.is_empty() {
        return Ok(None);
    }
    let command = &commands.items[0];
    if command.kind != Kind::Object {
        return Ok(None);
    }
    let Some(value) = text(get(command, "name")?)? else {
        return Ok(None);
    };
    if !matches!(
        value.as_str(),
        "history.versions"
            | "history.read"
            | "history.changes"
            | "history.restore"
            | "history.previewRestore"
    ) {
        return Ok(None);
    }
    let args = match get(command, "args")? {
        Some(args) if args.kind == Kind::Object => args.clone(),
        _ => new_object(Vec::new()),
    };
    Ok(Some((value, args)))
}

/// result["error"]?["code"]?.GetValue<string>().
pub(crate) fn error_code(result: &Node) -> Result<String, Error> {
    let error = field(Some(result), "error")?;
    string_value(field(error, "code")?)
}

pub(crate) fn stale(head: &str) -> Result<Execution, Error> {
    failure(
        "STALE",
        "The room changed since you read it. Read it again, then retry.",
        true,
        Some(new_object(vec![member("revision", str_node(head))])),
        head,
    )
}

pub(crate) fn room_unreadable() -> Result<Execution, Error> {
    failure(
        "APPLY_FAILED",
        "The room could not be read. Nothing was written.",
        true,
        None,
        "",
    )
}

/// Makes every revision a room result carries the journal head: the top
/// level, each read result, and a STALE error's details. An agent passes
/// these back as expectRevision. An empty head removes them.
pub(crate) fn with_head(execution: Execution, head: &str) -> Result<Execution, Error> {
    let mut result = parse(&execution.result_json)?;
    if result.kind != Kind::Object {
        return Err(Error::InvalidOperation(
            "The agent result is not an object.".to_owned(),
        ));
    }
    let rewrite = |holder: &mut Node| -> Result<(), Error> {
        if head.is_empty() {
            holder.remove("revision");
            Ok(())
        } else {
            holder.set("revision", str_node(head)).map_err(from_json)
        }
    };
    rewrite(&mut result)?;
    let has_results = matches!(get(&result, "results")?, Some(r) if r.kind == Kind::Array);
    let has_details = {
        let error = field(Some(&result), "error")?;
        matches!(field(error, "details")?, Some(d) if d.kind == Kind::Object)
    };
    if has_results && let Some(results) = result.lookup_mut("results").map_err(from_json)? {
        for item in results.items.iter_mut().filter(|i| i.kind == Kind::Object) {
            if item.lookup("revision").map_err(from_json)?.is_some() {
                rewrite(item)?;
            }
        }
    }
    if has_details
        && let Some(error) = result.lookup_mut("error").map_err(from_json)?
        && let Some(details) = error.lookup_mut("details").map_err(from_json)?
        && details.lookup("revision").map_err(from_json)?.is_some()
    {
        rewrite(details)?;
    }
    Ok(Execution {
        result_json: write(&result)?,
        document_json: execution.document_json,
        revision: head.to_owned(),
    })
}

/// C#'s ParseHead: lax on purpose (the last colon splits, a leading zero is
/// fine, the lineage is not checked), unlike HTTP If-Match.
pub(crate) fn parse_head(value: Option<&Node>) -> Result<Option<Precondition>, Error> {
    Ok(text(value)?.and_then(|head| parse_head_text(&head)))
}

pub(crate) fn parse_head_text(head: &str) -> Option<Precondition> {
    let colon = head.rfind(':').filter(|at| *at > 0)?;
    let sequence = blok_dotnet::parse_uint64_none(&head[colon + 1..])?;
    Some(Precondition {
        lineage: head[..colon].to_owned(),
        sequence,
    })
}

pub(crate) fn head_of(expect: &Precondition) -> String {
    format!("{}:{}", expect.lineage, expect.sequence)
}

pub(crate) fn receipt_head(receipt: Option<&Receipt>) -> String {
    receipt.map_or(String::new(), |receipt| {
        format!("{}:{}", receipt.tag.lineage, receipt.server_sequence)
    })
}

/// Guid.NewGuid().ToString("N").
pub(crate) fn new_guid() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("the OS random source failed");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    b.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// An export written as the C# node it is and read back as one.
pub(crate) fn to_node_json(exported: &Object) -> Result<Node, Error> {
    let written = blok_collab_docendpoint::serialize(&Value::Object(exported.clone()))?;
    parse(&String::from_utf8_lossy(&written))
}
