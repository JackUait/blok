//! Live handles on rooms in this process, for a host that embeds blok-mcp
//! next to its own Blok collab server (`Server::agent_executor()`). No
//! ticket and no socket: batches run through `Executor::execute_in_room`.

use std::sync::Arc;

use blok_blokagent::{Actor, Cancel, Executor, Options};
use serde_json::{Value, json};

use crate::errors::{Fault, HostError};

pub struct Rooms {
    executor: Arc<Executor>,
    options: Options,
    flags: Value,
}

/// What one room batch gave.
#[derive(Debug, Clone)]
pub struct Ran {
    /// The AgentResult as JSON text.
    pub result: String,
    /// The journal head "lineage:sequence", when the room keeps a journal.
    pub head: Option<(String, u64)>,
}

/// A journal head "lineage:sequence"; a room without a journal has none.
pub fn parse_head(revision: &str) -> Option<(String, u64)> {
    let (lineage, sequence) = revision.rsplit_once(':')?;
    let sequence = sequence.parse().ok()?;
    (!lineage.is_empty()).then(|| (lineage.to_owned(), sequence))
}

/// The actor JSON mcpActor gives, as the executor takes it.
pub fn actor_of(actor: &Value) -> Actor {
    let text = |key: &str| actor.get(key).and_then(Value::as_str).map(str::to_owned);
    Actor {
        id: text("id").unwrap_or_default(),
        name: text("name").unwrap_or_default(),
        on_behalf_of: text("onBehalfOf"),
    }
}

fn opt_text(value: Option<&Value>) -> Option<String> {
    value.filter(|v| !v.is_null()).map(Value::to_string)
}

impl Rooms {
    /// `flags` are the start flags mcpSurface took: the room contract gets
    /// the same custom tools, overrides and comment switch.
    pub fn new(executor: Arc<Executor>, flags: &Value) -> Rooms {
        Rooms {
            executor,
            options: Options {
                custom_tools_json: opt_text(flags.get("manifest")),
                overrides_json: opt_text(flags.get("overrides")),
                disable_built_in_comments: flags.get("comments") == Some(&Value::Bool(false)),
                ..Options::default()
            },
            flags: flags.clone(),
        }
    }

    /// The bundle gets the handle's own mcp input, so a room batch meets
    /// the contract blok_describe shows, and `approval` lets it ask.
    pub async fn run(
        &self,
        document_id: &str,
        batch: &Value,
        actor: &Value,
        write: bool,
        approval: Option<&Value>,
    ) -> Result<Ran, Fault> {
        let mut mcp = self.flags.clone();
        mcp["mode"] = json!("live");
        mcp["write"] = json!(write);
        let options = Options {
            mcp_json: Some(mcp.to_string()),
            approval_json: approval.map(Value::to_string),
            ..self.options.clone()
        };
        let execution = self
            .executor
            .execute_in_room(
                &Cancel::new(),
                document_id,
                &batch.to_string(),
                &actor_of(actor),
                Some(&options),
            )
            .await
            .map_err(|err| Fault::Internal(format!("{err:?}")))?;
        Ok(Ran {
            head: parse_head(&execution.revision),
            result: execution.result_json,
        })
    }

    /// `blok_read` as a one-command batch: `{ ok, results: [view] }`.
    pub async fn read(
        &self,
        document_id: &str,
        view: &Value,
        actor: &Value,
        write: bool,
    ) -> Result<(Value, Ran), Fault> {
        let batch = json!({ "commands": [{ "name": "doc.read", "args": view }] });
        let ran = self.run(document_id, &batch, actor, write, None).await?;
        let result: Value =
            serde_json::from_str(&ran.result).map_err(|e| Fault::Internal(e.to_string()))?;
        if result.get("ok") != Some(&Value::Bool(true)) {
            let error = result.get("error").cloned().unwrap_or(Value::Null);
            return Err(HostError::as_is(error).into());
        }
        let view = result.pointer("/results/0").cloned().unwrap_or(Value::Null);
        Ok((view, ran))
    }
}

/// A live handle on an in-process room.
pub struct RoomSession {
    pub write: bool,
    /// Latched after APPLY_FAILED, as Node's live session does.
    pub read_only: bool,
    /// The room keeps a journal: writes are acknowledged with a sequence.
    pub journaled: bool,
}

/// What a room batch delivered, as Node's live session reports it.
pub fn delivery(ran: &Ran, ok: bool, writes: bool, journaled: bool) -> Option<Value> {
    if !ok || !writes || !journaled {
        return None;
    }
    Some(json!({
        "durable": true,
        "pending": false,
        "serverSequence": ran.head.as_ref().map(|(_, sequence)| *sequence),
        "savedVersion": null,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_journal_head() {
        assert_eq!(parse_head("abc:12"), Some(("abc".to_owned(), 12)));
        assert_eq!(parse_head("a:b:3"), Some(("a:b".to_owned(), 3)));
        assert_eq!(parse_head("h18aeb1425ab3a4"), None);
        assert_eq!(parse_head(":3"), None);
    }

    #[test]
    fn only_an_acknowledged_write_has_a_delivery() {
        let ran = Ran {
            result: String::new(),
            head: Some(("l".to_owned(), 4)),
        };
        assert_eq!(
            delivery(&ran, true, true, true),
            Some(
                json!({ "durable": true, "pending": false, "serverSequence": 4, "savedVersion": null })
            )
        );
        assert_eq!(delivery(&ran, true, false, true), None);
        assert_eq!(delivery(&ran, false, true, true), None);
        assert_eq!(delivery(&ran, true, true, false), None);
    }

    #[test]
    fn takes_the_actor_mcp_actor_gives() {
        let actor = actor_of(
            &json!({ "id": "agent:a:c", "name": "c (for a)", "kind": "agent", "onBehalfOf": "a" }),
        );
        assert_eq!(actor.id, "agent:a:c");
        assert_eq!(actor.on_behalf_of.as_deref(), Some("a"));
    }
}
