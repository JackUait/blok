use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};

use blok_collab_convert::{EditOp, describe_structure, read_page_maps};
use blok_collab_room::{EditStatus, Manager, PlanOps, Precondition, plan_restore};
use blok_jsjson::{Kind, Node, Object, Value, new_array, new_bool, new_object};
use blok_yjs::Doc;
use sha2::{Digest, Sha256};

use crate::cancel::Cancel;
use crate::errors::{Error, from_json, into_room, no_answer};
use crate::executor::{Executor, Invoker, agent_execute_on, invoke_on};
use crate::room::{
    error_code, new_guid, parse_head_text, receipt_head, retryable_edit, stale, to_node_json,
    with_head,
};
use crate::roomhistory::{
    RoomHistory, RoomStep, project, restore_target, same, shares, stamps, unlocks,
};
use crate::types::{Actor, Execution};
use crate::wire::{failure, field, is_true, member, parse, str_node, write};

#[cfg(test)]
pub(crate) type Hook =
    Box<dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send + Sync>;

/// Stops a replay inside the room lane; the room writes nothing.
#[derive(Debug)]
struct HistoryRefusal {
    code: &'static str,
    message: String,
    retryable: bool,
    details: Option<Node>,
    /// The bundle's own answer to send as it is: its question or refusal.
    answer: Option<Node>,
}

impl fmt::Display for HistoryRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for HistoryRefusal {}

fn refused(code: &'static str, message: String, retryable: bool) -> Box<HistoryRefusal> {
    Box::new(HistoryRefusal {
        code,
        message,
        retryable,
        details: None,
        answer: None,
    })
}

fn nothing_message(undo: bool) -> (&'static str, &'static str) {
    if undo {
        ("NOTHING_TO_UNDO", "This session has no step to undo.")
    } else {
        (
            "NOTHING_TO_REDO",
            "This session has no undone step to redo.",
        )
    }
}

fn lineage_changed(verb: &str) -> String {
    format!(
        "The room was reset or reloaded since this step, so it can no longer be {verb}. Re-read the document."
    )
}

impl Executor {
    /// Undo or redo of this actor's last room step, planned in the room lane
    /// like a version restore, so a peer write cannot land between check and
    /// apply. The head it pins itself can go stale under a peer's write, so
    /// it tries three times; the caller's own expectRevision is never
    /// retried.
    pub(crate) async fn run_room_history(
        &self,
        cancel: &Cancel,
        doc_id: &str,
        undo: bool,
        actor: &Actor,
        expect: Option<Precondition>,
        asking: Option<&Node>,
    ) -> Result<Execution, Error> {
        let mut attempt = 0;
        loop {
            let execution = self
                .run_room_history_once(cancel, doc_id, undo, actor, expect.clone(), asking)
                .await?;
            if expect.is_some() || attempt == 2 {
                return Ok(execution);
            }
            let result = parse(&execution.result_json)?;
            if error_code(&result)? != "STALE" {
                return Ok(execution);
            }
            attempt += 1;
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_room_history_once(
        &self,
        cancel: &Cancel,
        doc_id: &str,
        undo: bool,
        actor: &Actor,
        mut expect: Option<Precondition>,
        asking: Option<&Node>,
    ) -> Result<Execution, Error> {
        let live = self.live().expect("rooms");
        let (verb, short) = if undo {
            ("undone", "undo")
        } else {
            ("redone", "redo")
        };
        let nothing = || {
            let (code, message) = nothing_message(undo);
            failure(code, message, false, None, "")
        };

        // Checked before the room: a purged document refuses every edit,
        // and this answer is the true one.
        let Some(top) = live.history.top(doc_id, actor, undo) else {
            return nothing();
        };
        if let Some(lineage) = &top.lineage {
            if expect.is_none() {
                let (_, current, _) = self.room_status(Some(cancel), doc_id).await?;
                let colon = current.rfind(':').filter(|at| *at > 0);
                if colon.is_none_or(|at| current[..at] != *lineage) {
                    return failure("CONFLICT", &lineage_changed(verb), true, None, "");
                }
                // Pins the lineage in the lane; a peer write since this read
                // only asks for another try.
                expect = parse_head_text(&current);
            }
            if expect.as_ref().is_some_and(|e| e.lineage != *lineage) {
                return failure("CONFLICT", &lineage_changed(verb), true, None, "");
            }
        }

        #[cfg(test)]
        if let Some(hook) = &self.before_history_lane {
            hook().await;
        }
        let slot: Arc<Mutex<Option<Arc<RoomStep>>>> = Arc::new(Mutex::new(None));
        let digest =
            Sha256::digest(format!("agent-{verb}\n{}\n{}", actor.id, new_guid()).as_bytes());
        let plan = plan_replay(
            live.manager.clone(),
            live.history.clone(),
            doc_id,
            actor,
            undo,
            expect.clone(),
            asking.map(|input| (self.runtime.clone(), input.clone())),
            slot.clone(),
        );
        let applied = replayed_step(
            live.manager.clone(),
            live.history.clone(),
            doc_id,
            actor,
            undo,
            slot,
        );
        cancel.check()?;
        let edit = live
            .manager
            .agent_edit(
                doc_id,
                plan,
                &new_guid(),
                &digest,
                &actor.id,
                expect,
                Some(applied),
                agent_note(actor),
            )
            .await;
        let edit = match edit {
            Ok(edit) => edit,
            Err(blok_collab_room::Error::Other(inner)) if inner.is::<HistoryRefusal>() => {
                let refusal = inner.downcast::<HistoryRefusal>().expect("a refusal");
                if let Some(answer) = &refusal.answer {
                    let execution = Execution {
                        result_json: write(answer)?,
                        ..Execution::default()
                    };
                    if field(Some(answer), "ask")?.is_some() {
                        return Ok(execution);
                    }
                    return with_head(execution, "");
                }
                return failure(
                    refusal.code,
                    &refusal.message,
                    refusal.retryable,
                    refusal.details,
                    "",
                );
            }
            Err(err) => return Err(Error::from(err)),
        };

        let head = receipt_head(edit.receipt.as_ref());
        match edit.status {
            EditStatus::Applied => {
                let result = new_object(vec![
                    member("ok", new_bool(true)),
                    member("revision", str_node(&head)),
                    member("results", new_array(vec![new_object(Vec::new())])),
                    member("refs", new_object(Vec::new())),
                    member(
                        "changed",
                        new_object(vec![
                            member("created", new_array(Vec::new())),
                            member("updated", new_array(Vec::new())),
                            member("moved", new_array(Vec::new())),
                            member("removed", new_array(Vec::new())),
                        ]),
                    ),
                    member("warnings", new_array(Vec::new())),
                ]);
                with_head(
                    Execution {
                        result_json: write(&result)?,
                        document_json: None,
                        revision: head.clone(),
                    },
                    &head,
                )
            }
            EditStatus::PreconditionFailed => stale(&head),
            status => failure(
                "APPLY_FAILED",
                &format!("The room refused the {short} ({status}). Nothing was written."),
                retryable_edit(status),
                Some(new_object(vec![member(
                    "status",
                    str_node(&status.to_string()),
                )])),
                &head,
            ),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn plan_replay(
    manager: Manager,
    history: Arc<RoomHistory>,
    doc_id: &str,
    actor: &Actor,
    undo: bool,
    expect: Option<Precondition>,
    gate: Option<(Arc<dyn Invoker>, Node)>,
    slot: Arc<Mutex<Option<Arc<RoomStep>>>>,
) -> PlanOps {
    let (doc_id, actor) = (doc_id.to_owned(), actor.clone());
    Arc::new(move |doc: Doc| {
        let (manager, history, doc_id, actor, expect, gate, slot) = (
            manager.clone(),
            history.clone(),
            doc_id.clone(),
            actor.clone(),
            expect.clone(),
            gate.clone(),
            slot.clone(),
        );
        Box::pin(async move {
            let step = history.top(&doc_id, &actor, undo);
            *slot.lock().unwrap_or_else(PoisonError::into_inner) = step.clone();
            let gate = gate
                .as_ref()
                .map(|(runtime, input)| (runtime.as_ref(), input));
            replay_ops(&manager, step, undo, expect.as_ref(), gate, &doc)
                .await
                .map_err(|err| match err {
                    ReplayError::Agent(err) => into_room(err),
                    ReplayError::Refused(refusal) => blok_collab_room::Error::Other(refusal),
                })
        })
    })
}

enum ReplayError {
    Agent(Error),
    Refused(Box<HistoryRefusal>),
}

impl<E: Into<Error>> From<E> for ReplayError {
    fn from(err: E) -> ReplayError {
        ReplayError::Agent(err.into())
    }
}

async fn replay_ops(
    manager: &Manager,
    step: Option<Arc<RoomStep>>,
    undo: bool,
    expect: Option<&Precondition>,
    gate: Option<(&dyn Invoker, &Node)>,
    doc: &Doc,
) -> Result<Vec<EditOp>, ReplayError> {
    let (verb, short) = if undo {
        ("undone", "undo")
    } else {
        ("redone", "redo")
    };
    if let Some(step) = &step
        && let Some(lineage) = &step.lineage
        && expect.is_none_or(|e| *lineage != e.lineage)
    {
        return Err(ReplayError::Refused(refused(
            "CONFLICT",
            lineage_changed(verb),
            true,
        )));
    }
    let Some(step) = step else {
        let (code, message) = nothing_message(undo);
        return Err(ReplayError::Refused(refused(
            code,
            message.to_owned(),
            false,
        )));
    };
    if step.other {
        return Err(ReplayError::Refused(refused(
            "UNDO_OTHER_DOCUMENT",
            "The last batch wrote another document (a sub-page title or icon). history.undo cannot undo it. To revert it, run that command again with the old value.".to_owned(),
            false,
        )));
    }
    let export = manager.converter().export(doc).await.map_err(Error::from)?;
    let maps = read_page_maps(doc).map_err(Error::from)?;
    let projected = project(&export, &maps, &step.ids, &step.page_keys)?;
    let (expected, wanted, page) = {
        let sides = step.sides();
        if undo {
            (sides.after.clone(), sides.before.clone(), &step.page_before)
        } else {
            (sides.before.clone(), sides.after.clone(), &step.page_after)
        }
    };
    if !same(&projected, expected.as_ref())? {
        return Err(ReplayError::Refused(refused(
            "CONFLICT",
            format!(
                "Someone else changed what this step wrote, so it can no longer be {verb}. Re-read the document before retrying."
            ),
            true,
        )));
    }
    let unlocking = unlocks(&projected, wanted.as_ref())?;
    let sharing = shares(&projected, wanted.as_ref())?;
    let (blocks, target) = restore_target(&export, &maps, &step, wanted.as_ref(), page)?;
    // A host that can ask runs the bundle's own history gate here, in the
    // lane, on the state that is replayed: it asks as database.setLock and
    // a sharing change do, and a yes applies now.
    if let Some((runtime, input)) = gate
        && (!unlocking.is_empty() || sharing.is_some())
    {
        let mut wanted_doc = export.clone();
        wanted_doc.set("blocks".into(), Value::Array(blocks.clone()));
        if let Some(answer) = history_gate(runtime, input, &export, &wanted_doc, undo).await? {
            return Err(ReplayError::Refused(Box::new(HistoryRefusal {
                code: "APPROVAL_REQUIRED",
                message: String::new(),
                retryable: false,
                details: None,
                answer: Some(answer),
            })));
        }
    } else if let Some(unlocked) = unlocking.first() {
        // Undoing a lock or redoing an unlock unlocks; with no one to ask, it is refused.
        return Err(ReplayError::Refused(Box::new(HistoryRefusal {
            code: "APPROVAL_REQUIRED",
            message: format!(
                "This {short} would unlock database \"{unlocked}\". Unlocking needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to unlock it themselves."
            ),
            retryable: false,
            answer: None,
            details: Some(new_object(vec![
                member("reason", str_node("no-channel")),
                member(
                    "approval",
                    new_object(vec![
                        member("kind", str_node("database.unlock")),
                        member("blockId", str_node(&unlocked.to_string())),
                    ]),
                ),
            ])),
        })));
    }
    // Who can see or fill out a view is the person's too.
    if let Some((block_id, view_id)) = sharing.filter(|_| gate.is_none()) {
        return Err(ReplayError::Refused(Box::new(HistoryRefusal {
            code: "APPROVAL_REQUIRED",
            message: format!(
                "This {short} would change who can see or fill out view \"{view_id}\" of database \"{block_id}\". That needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to do it themselves."
            ),
            retryable: false,
            answer: None,
            details: Some(new_object(vec![
                member("reason", str_node("no-channel")),
                member(
                    "approval",
                    new_object(vec![
                        member("kind", str_node("database.share")),
                        member("blockId", str_node(&block_id.to_string())),
                        member("viewId", str_node(&view_id.to_string())),
                    ]),
                ),
            ])),
        })));
    }
    let current = match export.get(&"blocks".into()) {
        Some(Value::Array(current)) => current.clone(),
        _ => Vec::new(),
    };
    let structure = describe_structure(doc).map_err(Error::from)?;
    let mut ops = plan_restore(&current, &structure, &blocks, &maps, &target);
    ops.extend(stamps(wanted.as_ref())?);
    Ok(ops)
}

/// The bundle's history.undo (or redo) on the room's document, with what
/// the replay writes as the session's one step. None when it may run;
/// otherwise its question (`{ ask }`) or refusal, to answer as it is.
async fn history_gate(
    runtime: &dyn Invoker,
    input: &Node,
    now: &Object,
    wanted: &Object,
    undo: bool,
) -> Result<Option<Node>, Error> {
    let cancel = Cancel::new();
    let document = to_node_json(now)?;
    let target = to_node_json(wanted)?;
    let pick = |key: &str| -> Result<Node, Error> {
        Ok(field(Some(input), key)?
            .cloned()
            .unwrap_or_else(|| new_object(Vec::new())))
    };
    // The bundle keeps a carried step only at the document's own revision.
    let read = parse(
        &invoke_on(
            runtime,
            &cancel,
            "mcpRead",
            &new_object(vec![
                member("mcp", pick("mcp")?),
                member("document", document.clone()),
                member("actor", pick("actor")?),
                member("view", new_object(Vec::new())),
            ]),
        )
        .await?,
    )?;
    let revision = field(
        field(field(Some(&read), "answer")?, "structuredContent")?,
        "revision",
    )?
    .cloned()
    .unwrap_or_else(|| str_node(""));
    let (past, future) = if undo {
        (vec![target], Vec::new())
    } else {
        (Vec::new(), vec![target])
    };
    let mut asking = input.clone();
    asking.set("document", document).map_err(from_json)?;
    asking
        .set(
            "history",
            new_object(vec![
                member("past", new_array(past)),
                member("future", new_array(future)),
                member("revision", revision),
            ]),
        )
        .map_err(from_json)?;
    let output = agent_execute_on(runtime, &cancel, &asking).await?;
    if let Some(ask) = field(Some(&output), "ask")?.filter(|a| a.kind == Kind::Object) {
        return Ok(Some(new_object(vec![member("ask", ask.clone())])));
    }
    let Some(result) = field(Some(&output), "result")?.filter(|r| r.kind == Kind::Object) else {
        return Err(no_answer("agent result"));
    };
    if is_true(Some(result), "ok")? {
        return Ok(None);
    }
    Ok(Some(result.clone()))
}

/// What the room holds now is what the opposite replay checks against.
fn replayed_step(
    manager: Manager,
    history: Arc<RoomHistory>,
    doc_id: &str,
    actor: &Actor,
    undo: bool,
    slot: Arc<Mutex<Option<Arc<RoomStep>>>>,
) -> blok_collab_room::Applied {
    let (doc_id, actor) = (doc_id.to_owned(), actor.clone());
    Arc::new(move |doc: Doc, _| {
        let (manager, history, doc_id, actor, slot) = (
            manager.clone(),
            history.clone(),
            doc_id.clone(),
            actor.clone(),
            slot.clone(),
        );
        Box::pin(async move {
            let Some(step) = slot.lock().unwrap_or_else(PoisonError::into_inner).clone() else {
                return Ok(());
            };
            let now: Object = manager.converter().export(&doc).await?;
            let maps = read_page_maps(&doc)?;
            let actual = project(&now, &maps, &step.ids, &step.page_keys).map_err(into_room)?;
            history
                .replayed(&doc_id, &actor, &step, undo, Some(actual))
                .map_err(into_room)?;
            Ok(())
        })
    })
}

/// The record note of an in-process agent's write.
pub(crate) fn agent_note(actor: &crate::types::Actor) -> Option<blok_collab_room::RecordNote> {
    blok_collab_room::classify_actor(&actor.id, true, actor.on_behalf_of.as_deref().unwrap_or(""))
}
