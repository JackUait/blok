use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime};

use blok_collab_room::{
    EditStatus, HistoryStatus, Precondition, RestoreOptions, StateStatus, hides_point, history_cut,
};
use blok_jsjson::{Kind, Node, new_array, new_bool, new_null, new_number, new_object};

use crate::cancel::Cancel;
use crate::errors::{Error, from_json, no_answer};
use crate::executor::Executor;
use crate::room::{
    head_of, new_guid, parse_head_text, receipt_head, retryable_edit, room_unreadable, stale,
    with_head,
};
use crate::types::Execution;
use crate::wire::{failure, field, member, parse, str_node, string_value, text, write};

impl Executor {
    /// A version history call: the journal's answer goes into the bundle's
    /// input, which shapes it as every runtime does. A read runs outside the
    /// edit lane and writes nothing. A restore the bundle accepted then goes
    /// to the room as the history route's restore does.
    pub(crate) async fn run_version_read(
        &self,
        cancel: &Cancel,
        doc_id: &str,
        mut input: Node,
        name: &str,
        args: &Node,
        expect: Option<Precondition>,
    ) -> Result<Execution, Error> {
        let (document, current, status) = self.room_status(Some(cancel), doc_id).await?;
        if status == StateStatus::Purged {
            return failure(
                "TOOL_ACTION_FAILED",
                "The version history failed: this document was deleted.",
                false,
                None,
                "",
            );
        }
        let Some(document) = document else {
            return room_unreadable();
        };
        if expect.as_ref().is_some_and(|e| head_of(e) != current) {
            return stale(&current);
        }
        // No history journal: the contract says unavailable and the bundle
        // refuses it.
        let live = self.live().expect("rooms");
        let mut floors = None;
        if live.manager.has_history() {
            let (refused, hidden) = self.history_access(doc_id, &input).await?;
            floors = hidden;
            // A restore reads the version it writes, so the read hook
            // refuses it too.
            let versions = match refused {
                Some(refused) => refused,
                _ => Box::pin(self.load_versions(doc_id, name, args, floors.as_ref())).await?,
            };
            input.members.push(member("versionHistory", versions));
        }
        input.members.push(member("document", document));
        let output = self.agent_execute(cancel, &input).await?;
        let Some(result) = field(Some(&output), "result")?.filter(|r| r.kind == Kind::Object)
        else {
            return Err(no_answer("agent result"));
        };
        if let Some(version) = text(field(Some(&output), "restore")?)? {
            // The bundle checked the room at current; the restore must land
            // on that head or not at all.
            let expect = expect.or_else(|| parse_head_text(&current));
            return self
                .restore(
                    cancel,
                    doc_id,
                    &version,
                    result,
                    &input,
                    expect,
                    floors.as_ref(),
                )
                .await;
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

    /// The restore the bundle checked, as one journalled edit by the agent:
    /// the same restore the history route runs.
    #[allow(
        clippy::too_many_arguments,
        reason = "the restore's request and the window's floors"
    )]
    async fn restore(
        &self,
        cancel: &Cancel,
        doc_id: &str,
        version: &str,
        result: &Node,
        input: &Node,
        expect: Option<Precondition>,
        floors: Option<&HistoryWindow>,
    ) -> Result<Execution, Error> {
        let Some(colon) = version.rfind(':') else {
            return Err(Error::Argument {
                param: "length".to_owned(),
                message: "Specified argument was out of the range of valid values.".to_owned(),
            });
        };
        let tail = &version[colon + 1..];
        let Some(sequence) = blok_dotnet::parse_uint64_none(tail) else {
            return Err(Error::InvalidOperation(format!(
                "The input string '{tail}' was not in a correct format."
            )));
        };
        let actor = field(Some(input), "actor")?;
        let actor_id = string_value(field(actor, "id")?)?;
        let live = self.live().expect("rooms");
        cancel.check()?;
        let hidden = floors.is_some_and(|window| window.hides(&version[..colon], sequence));
        let outcome = live
            .manager
            .restore_with(
                doc_id,
                &version[..colon],
                sequence,
                &new_guid(),
                &actor_id,
                expect,
                None,
                RestoreOptions {
                    hidden,
                    ..RestoreOptions::default()
                },
            )
            .await?;
        let (status, edit) = (outcome.status, outcome.edit);
        match status {
            HistoryStatus::Ready => {}
            HistoryStatus::NotFound => {
                return failure(
                    "VERSION_NOT_FOUND",
                    &format!("There is no version \"{version}\". history.versions lists them."),
                    false,
                    None,
                    "",
                );
            }
            status => {
                return failure(
                    "TOOL_ACTION_FAILED",
                    &format!("The version history failed: the restore could not run ({status})."),
                    restore_retryable(status),
                    None,
                    "",
                );
            }
        }
        let Some(edit) = edit else {
            return Err(Error::InvalidOperation(
                "A ready restore carries its edit.".to_owned(),
            ));
        };
        let head = receipt_head(edit.receipt.as_ref());
        match edit.status {
            EditStatus::Applied => with_head(
                Execution {
                    result_json: write(result)?,
                    document_json: None,
                    revision: head.clone(),
                },
                &head,
            ),
            EditStatus::PreconditionFailed => stale(&head),
            status => failure(
                "APPLY_FAILED",
                &format!("The room refused the restore ({status}). Nothing was written."),
                retryable_edit(status),
                Some(new_object(vec![member(
                    "status",
                    str_node(&status.to_string()),
                )])),
                &head,
            ),
        }
    }

    /// What one read needs: the version list, or the documents it names
    /// (null when there is no such version).
    async fn load_versions(
        &self,
        doc_id: &str,
        name: &str,
        args: &Node,
        floors: Option<&HistoryWindow>,
    ) -> Result<Node, Error> {
        let manager = &self.live().expect("rooms").manager;
        let hidden = |lineage: &str, sequence: u64| {
            floors.is_some_and(|window| window.hides(lineage, sequence))
        };
        // A restore names the version that was current before, so it needs
        // the list too.
        if name == "history.restore" {
            let listed = Box::pin(self.load_versions(
                doc_id,
                "history.versions",
                &new_object(Vec::new()),
                floors,
            ))
            .await?;
            if listed.lookup("failed").ok().flatten().is_some() {
                return Ok(listed);
            }
            let mut named =
                Box::pin(self.load_versions(doc_id, "history.read", args, floors)).await?;
            let versions = listed
                .lookup("versions")
                .map_err(from_json)?
                .cloned()
                .unwrap_or_else(new_null);
            named.set("versions", versions).map_err(from_json)?;
            return Ok(named);
        }

        if name == "history.versions" {
            let mut group = Duration::ZERO;
            // Only a JSON int counts: 15.0 is refused, as TryGetValue<int>
            // refuses it, and the list keeps its default grouping.
            if let Some(node) = field(Some(args), "group")?.filter(|g| g.kind == Kind::Number)
                && let Some(minutes) = std::str::from_utf8(node.raw())
                    .ok()
                    .and_then(|raw| raw.parse::<i32>().ok())
                && matches!(minutes, 1 | 15 | 60)
            {
                group = Duration::from_secs(60 * minutes as u64);
            }
            let list = manager
                .history_windowed(doc_id, group, false, floors.map(|window| window.cut))
                .await?;
            if list.status != HistoryStatus::Ready {
                return Ok(version_failure(
                    &format!("The version history could not be read ({}).", list.status),
                    list.status,
                ));
            }
            let current: HashSet<&str> = list
                .lineages
                .iter()
                .filter(|lineage| lineage.current)
                .map(|lineage| lineage.lineage.as_str())
                .collect();
            let mut versions = Vec::new();
            for version in list
                .versions
                .iter()
                .filter(|version| !hidden(&version.lineage, version.sequence))
            {
                let actors = version.actors.iter().map(|a| str_node(a)).collect();
                let mut entry = new_object(vec![
                    member(
                        "version",
                        str_node(&format!("{}:{}", version.lineage, version.sequence)),
                    ),
                    member("savedAt", unix_millis(version.saved_at)),
                    member("startedAt", unix_millis(version.started_at)),
                    member("actors", new_array(actors)),
                ]);
                if !current.contains(version.lineage.as_str()) {
                    entry.members.push(member("beforeReset", new_bool(true)));
                }
                versions.push(entry);
            }
            return Ok(new_object(vec![member("versions", new_array(versions))]));
        }

        let keys: &[&str] = if name == "history.read" {
            &["version"]
        } else {
            &["from", "to"]
        };
        let mut names = Vec::new();
        for key in keys {
            let Some(value) = field(Some(args), key)? else {
                continue;
            };
            if matches!(value.kind, Kind::Object | Kind::Array) {
                continue;
            }
            if let Some(text) = text(Some(value))?
                && !names.contains(&text)
            {
                names.push(text);
            }
        }
        let mut documents = new_object(Vec::new());
        for version in &names {
            let parsed = version.rfind(':').filter(|at| *at > 0).and_then(|colon| {
                blok_dotnet::parse_uint64_none(&version[colon + 1..])
                    .map(|sequence| (&version[..colon], sequence))
            });
            // A version the host's window hides reads as one that does not
            // exist.
            let Some((lineage, sequence)) =
                parsed.filter(|(lineage, sequence)| !hidden(lineage, *sequence))
            else {
                documents.members.push(member(version, new_null()));
                continue;
            };
            let read = manager.read_version(doc_id, lineage, sequence).await?;
            match read.status {
                HistoryStatus::Ready => {
                    let document = parse(&String::from_utf8_lossy(&read.json))?;
                    documents.members.push(member(version, document));
                }
                HistoryStatus::NotFound => documents.members.push(member(version, new_null())),
                status => {
                    return Ok(version_failure(
                        &format!("Version \"{version}\" could not be read ({status})."),
                        status,
                    ));
                }
            }
        }
        Ok(new_object(vec![member("documents", documents)]))
    }
}

impl Executor {
    /// The host's hooks for this call: a versionHistory refusal when the
    /// read hook says no, and each lineage's floor when it sets a window.
    async fn history_access(
        &self,
        doc_id: &str,
        input: &Node,
    ) -> Result<(Option<Node>, Option<HistoryWindow>), Error> {
        let live = self.live().expect("rooms");
        let Some(policy) = &live.policy else {
            return Ok((None, None));
        };
        let actor = field(Some(input), "actor")?;
        let user = match field(actor, "onBehalfOf")? {
            Some(person) => string_value(Some(person))?,
            None => string_value(field(actor, "id")?)?,
        };
        let access = policy(user, doc_id.to_owned()).await.map_err(Error::Host)?;
        let mut refused = (!access.can_read).then(|| {
            new_object(vec![
                member(
                    "failed",
                    str_node("The version history could not be read (not allowed)."),
                ),
                member("status", new_number("403")),
            ])
        });
        let Some(window) = access.window else {
            return Ok((refused, None));
        };
        // A .NET tick is 100ns.
        let ticks = i64::try_from(window.as_nanos() / 100).unwrap_or(i64::MAX);
        let cut = history_cut(live.manager.now(), ticks);
        let (status, floors) = live.manager.history_floors_at(doc_id, cut).await?;
        if status != HistoryStatus::Ready {
            refused.get_or_insert_with(|| {
                version_failure(
                    &format!("The version history could not be read ({status})."),
                    status,
                )
            });
            return Ok((refused, None));
        }
        Ok((refused, Some(HistoryWindow { cut, floors })))
    }
}

/// The host's window for one agent call: its cut and each lineage's floor.
struct HistoryWindow {
    cut: SystemTime,
    floors: HashMap<String, Option<u64>>,
}

impl HistoryWindow {
    fn hides(&self, lineage: &str, sequence: u64) -> bool {
        hides_point(&self.floors, lineage, sequence)
    }
}

fn version_failure(message: &str, status: HistoryStatus) -> Node {
    new_object(vec![
        member("failed", str_node(message)),
        member("status", new_number(&http_status(status).to_string())),
    ])
}

fn unix_millis(at: Option<SystemTime>) -> Node {
    let Some(at) = at else {
        return new_null();
    };
    let millis = match at.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(after) => after.as_millis() as i64,
        Err(before) => -(before.duration().as_millis() as i64),
    };
    new_number(&millis.to_string())
}

/// What HistoryEndpoint answers for this refusal. The bundle decides from
/// it whether a retry can help, as it does for MCP's HTTP reads, so the two
/// must stay the same.
fn http_status(status: HistoryStatus) -> u16 {
    match status {
        HistoryStatus::None => 501,
        HistoryStatus::NotFound => 404,
        HistoryStatus::Purged => 403,
        HistoryStatus::Unavailable => 503,
        _ => 500,
    }
}

/// The shared runtime's restore: never asked twice, so a plain 500 is not
/// retryable. Mirrors ask(..., retry = false) in
/// src/shared/agent/version-history.ts.
pub(crate) fn restore_retryable(status: HistoryStatus) -> bool {
    let code = http_status(status);
    code == 429 || code > 501
}
