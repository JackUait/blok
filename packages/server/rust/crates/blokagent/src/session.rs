use blok_jsjson::{Kind, Node, new_array, new_object};

use crate::cancel::Cancel;
use crate::errors::{Error, from_json};
use crate::executor::Executor;
use crate::types::{Actor, Execution, Options};
use crate::wire::{common, get_mut, member, set, str_node};

// Same caps as AGENT_HISTORY_LIMITS in src/shared/agent/document-session.ts.
pub(crate) const MAX_STEPS: usize = 100;
// Counted in the UTF-16 units of each step as System.Text.Json writes it
// (non-ASCII escaped), not in bytes or chars.
pub(crate) const MAX_CHARS: usize = 4 * 1024 * 1024;

/// One agent's batches on stored documents, kept in memory so history.undo
/// and history.redo can take them back and write them again. Its steps stay
/// usable while each call passes the document the session last returned;
/// when someone else saved in between, undo and redo answer CONFLICT. Takes
/// `&mut self`: finish each call before the next.
pub struct Session<'e> {
    executor: &'e Executor,
    options: Option<Options>,
    actor: Actor,
    history: Node,
}

impl Executor {
    /// Opens a session for one agent on stored documents.
    pub fn open_session(&self, actor: Actor, options: Option<Options>) -> Session<'_> {
        Session {
            executor: self,
            options,
            actor,
            history: new_object(Vec::new()),
        }
    }
}

impl Session<'_> {
    /// The agent every batch runs as.
    pub fn actor(&self) -> &Actor {
        &self.actor
    }

    /// The command contract for this session. Unlike a plain call's, it
    /// offers history.undo and history.redo.
    pub async fn contract(&self, cancel: &Cancel) -> Result<String, Error> {
        let mut input = common(self.options.as_ref())?;
        input
            .members
            .push(member("history", new_object(Vec::new())));
        self.executor.contract_for(cancel, &input).await
    }

    /// Runs a batch. The answer holds a document to save only when the batch
    /// succeeded.
    pub async fn execute(
        &mut self,
        cancel: &Cancel,
        document_json: &str,
        batch_json: &str,
    ) -> Result<Execution, Error> {
        let (execution, next) = Box::pin(self.executor.run(
            cancel,
            document_json,
            batch_json,
            &self.actor,
            self.options.as_ref(),
            Some(&self.history),
        ))
        .await?;
        if let Some(next) = next {
            self.history = bounded(next)?;
        }
        Ok(execution)
    }
}

/// Drops the oldest steps, past before future, until both caps hold; the
/// newest step stays.
fn bounded(mut history: Node) -> Result<Node, Error> {
    let mut past = take_steps(&mut history, "past")?;
    let mut future = take_steps(&mut history, "future")?;
    let mut chars = 0;
    for entry in past.iter().chain(future.iter()) {
        chars += chars_of(entry)?;
    }
    let mut count = past.len() + future.len();
    while count > MAX_STEPS || (count > 1 && chars > MAX_CHARS) {
        let from = if past.is_empty() {
            &mut future
        } else {
            &mut past
        };
        chars -= chars_of(&from[0])?;
        from.remove(0);
        count -= 1;
    }
    put_steps(&mut history, "past", past)?;
    put_steps(&mut history, "future", future)?;
    Ok(history)
}

/// `history[key] as JsonArray ?? []`: a missing list is a detached one, so
/// it is never written back.
fn take_steps(history: &mut Node, key: &str) -> Result<Vec<Node>, Error> {
    match get_mut(history, key)? {
        Some(list) if list.kind == Kind::Array => Ok(std::mem::take(&mut list.items)),
        _ => Ok(Vec::new()),
    }
}

fn put_steps(history: &mut Node, key: &str, steps: Vec<Node>) -> Result<(), Error> {
    if let Some(list) = get_mut(history, key)?
        && list.kind == Kind::Array
    {
        list.items = steps;
    }
    Ok(())
}

/// `entry?.ToJsonString().Length`: a JSON null counts 0. The written form
/// is ASCII, so its bytes are its UTF-16 units.
fn chars_of(entry: &Node) -> Result<usize, Error> {
    if entry.kind == Kind::Null {
        return Ok(0);
    }
    let mut written = Vec::new();
    entry.append_json(&mut written).map_err(from_json)?;
    Ok(written.len())
}

/// Marks a page action's step. It writes the target, not this document, so
/// the step holds no snapshot: "other" makes history.undo answer
/// UNDO_OTHER_DOCUMENT.
pub(crate) fn wrote_another_document(history: &Node) -> Result<Node, Error> {
    let mut next = history.clone();
    match get_mut(&mut next, "past")? {
        Some(past) if past.kind == Kind::Array => past.items.push(str_node("other")),
        _ => set(&mut next, "past", new_array(vec![str_node("other")]))?,
    }
    Ok(next)
}
