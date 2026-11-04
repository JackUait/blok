use std::sync::{Arc, Mutex, PoisonError};

use blok_collab::BoxFuture;
use blok_collab_convert::parse_edit_ops;
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo, PurgeOutcome};
use blok_collab_room::{
    EditStatus, Error as RoomError, Headers, HistoryStatus, HistoryStore, LocalJournal, Opened,
    OperationStore, PurgeStore, Records, StateStatus,
};
use blok_jsjson::{Kind, Node};

use crate::normalize_test::{id_of, normalize_document, records};
use crate::room::{new_guid, receipt_head};
use crate::roomharness_test::{TestRoom, new_local_journal, new_test_room_on};
use crate::test_support::{lookup, must_parse, stable, string_of};
use crate::wire::{str_node, write};
use crate::{Actor, Execution};

// The room half of the scenario runner; the contract is on the C# reader,
// AgentServerScenarioTests.cs.

/// The scenario's journal with the failListings knob.
pub(crate) struct FailingJournal {
    inner: LocalJournal,
    /// Some(left) while armed: that many more listings pass, then they fail.
    armed: Mutex<Option<i64>>,
}

impl FailingJournal {
    fn arm(&self, after: i64) {
        *self.armed.lock().unwrap_or_else(PoisonError::into_inner) = Some(after);
    }

    fn heal(&self) {
        *self.armed.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

impl OperationStore for FailingJournal {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, RoomError>> {
        self.inner.open(ctx, doc_id)
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(self)
    }
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "blok_blokagent::FailingJournal"
    }
}

impl PurgeStore for FailingJournal {
    fn purge<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, RoomError>> {
        PurgeStore::purge(&self.inner, ctx, doc_id)
    }
}

impl HistoryStore for FailingJournal {
    fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, RoomError> {
        self.inner.is_purged(ctx, doc_id)
    }
    fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, RoomError> {
        let fail = {
            let mut armed = self.armed.lock().unwrap_or_else(PoisonError::into_inner);
            match armed.as_mut() {
                Some(left) => {
                    let fail = *left <= 0;
                    *left -= 1;
                    fail
                }
                None => false,
            }
        };
        if fail {
            return Err(RoomError::Journal(
                blok_collab_journal::Error::InvalidData {
                    message: "The scenario's journal cannot list lineages.".to_owned(),
                    source: None,
                },
            ));
        }
        self.inner.list_lineages(ctx, doc_id)
    }
    fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, RoomError> {
        self.inner.read_baseline(ctx, doc_id, lineage)
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        self.inner.read_headers(ctx, doc_id, lineage)
    }
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
        self.inner.read_records(ctx, doc_id, lineage, through)
    }
    fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, RoomError> {
        self.inner.delete_lineage(ctx, doc_id, lineage)
    }
}

pub(crate) struct ScenarioRoom {
    pub room: TestRoom,
    pub doc: String,
    journal: Option<Arc<FailingJournal>>,
}

pub(crate) fn open_scenario_room(spec: &Node, seed: &Node) -> ScenarioRoom {
    let mut journal = None;
    let room = if lookup(Some(spec), "journal").is_some_and(|j| j.kind == Kind::False) {
        new_test_room_on(None, None, None, None)
    } else {
        let (inner, dir) = new_local_journal();
        let store = Arc::new(FailingJournal {
            inner,
            armed: Mutex::new(None),
        });
        journal = Some(store.clone());
        new_test_room_on(Some(store), Some(dir), None, None)
    };
    let doc = string_of(lookup(Some(spec), "doc")).unwrap_or_else(|| "agent-room".to_owned());
    room.docs.hold(&doc, &write(seed).expect("write"));
    if let Some(held) = lookup(Some(spec), "held") {
        for m in &held.members {
            let key = m.key().expect("key").to_string();
            room.docs.hold(&key, &write(&m.value).expect("write"));
        }
    }
    ScenarioRoom { room, doc, journal }
}

impl ScenarioRoom {
    pub(crate) fn heal_listings(&self) {
        if let Some(journal) = &self.journal {
            journal.heal();
        }
    }

    pub(crate) fn step_doc(&self, step: &Node) -> String {
        string_of(lookup(Some(step), "doc")).unwrap_or_else(|| self.doc.clone())
    }

    pub(crate) async fn head(&self, doc: &str) -> String {
        let state = self.room.manager.state(doc).await.expect("state");
        receipt_head(state.head.as_ref())
    }

    async fn state(&self, doc: &str) -> Option<Node> {
        let state = self.room.manager.state(doc).await.expect("state");
        (state.status == StateStatus::Ready)
            .then(|| must_parse(&String::from_utf8_lossy(&state.json)))
    }

    pub(crate) async fn blocks(&self, doc: &str) -> String {
        let state = self.state(doc).await;
        lookup(state.as_ref(), "blocks").map_or(String::new(), |b| write(b).expect("write"))
    }

    pub(crate) async fn host_step(
        &self,
        place: &str,
        run: &str,
        step: &Node,
        fill: &dyn Fn(&str) -> String,
    ) {
        let doc = self.step_doc(step);
        let manager = &self.room.manager;
        match run {
            "peer" => {
                let body = write(lookup(Some(step), "ops").expect("ops")).expect("write");
                let ops = parse_edit_ops(fill(&body).as_bytes())
                    .unwrap_or_else(|err| panic!("{place}: {err}"));
                let mut digest = [0u8; 32];
                getrandom::fill(&mut digest).expect("random");
                let edit = manager
                    .edit(&doc, ops, &new_guid(), &digest, "human-2", None)
                    .await
                    .unwrap_or_else(|err| panic!("{place}: {err}"));
                assert_eq!(edit.status, EditStatus::Applied, "{place}: peer edit");
            }
            "reset" => {
                manager
                    .reset(&doc)
                    .await
                    .unwrap_or_else(|err| panic!("{place}: {err}"));
            }
            "drain" => manager
                .drain()
                .await
                .unwrap_or_else(|err| panic!("{place}: {err}")),
            "failListings" => {
                let after = std::str::from_utf8(lookup(Some(step), "after").expect("after").raw())
                    .expect("utf-8")
                    .parse()
                    .expect("a count");
                self.journal.as_ref().expect("a journal").arm(after);
            }
            "purge" => {
                manager
                    .purge(&doc, async { Ok(true) })
                    .await
                    .unwrap_or_else(|err| panic!("{place}: {err}"));
            }
            "restore" => {
                let version = fill(&string_of(lookup(Some(step), "version")).unwrap_or_default());
                let colon = version.rfind(':').expect("a version");
                let sequence = version[colon + 1..].parse().expect("a sequence");
                let (status, edit) = manager
                    .restore(
                        &doc,
                        &version[..colon],
                        sequence,
                        &new_guid(),
                        "human-2",
                        None,
                    )
                    .await
                    .unwrap_or_else(|err| panic!("{place}: {err}"));
                assert!(
                    status == HistoryStatus::Ready
                        && edit
                            .as_ref()
                            .is_some_and(|e| e.status == EditStatus::Applied),
                    "{place}: restore {status} {edit:?}"
                );
            }
            other => panic!("{place}: unknown host step {other}"),
        }
    }

    #[allow(clippy::too_many_arguments, reason = "the Go runner's check")]
    pub(crate) async fn check(
        &self,
        failures: &mut Vec<String>,
        place: &str,
        doc: &str,
        expect: &Node,
        execution: &Execution,
        head: &str,
        before_head: &str,
        before_blocks: &str,
        saved_at: impl Fn(usize) -> String,
        seed: &Node,
    ) {
        if let Some(want) = string_of(lookup(Some(expect), "revision"))
            && want != execution.revision
        {
            failures.push(format!(
                "{place}: revision {:?}, want {want:?}\n{}",
                execution.revision, execution.result_json
            ));
        }
        if let Some(want) = lookup(Some(expect), "committed") {
            let count: i64 = std::str::from_utf8(want.raw())
                .ok()
                .and_then(|raw| raw.parse().ok())
                .unwrap_or_default();
            let got = sequence_of(head) - sequence_of(before_head);
            if got != count {
                failures.push(format!(
                    "{place}: committed {got}, want {count}\n{}",
                    execution.result_json
                ));
            }
        }
        if lookup(Some(expect), "blocksUnchanged").is_some_and(|w| w.kind == Kind::True)
            && self.blocks(doc).await != before_blocks
        {
            failures.push(format!(
                "{place}: the blocks changed\n{}",
                execution.result_json
            ));
        }
        if let Some(pointers) = lookup(Some(expect), "state") {
            let state_doc =
                string_of(lookup(Some(expect), "stateDoc")).unwrap_or_else(|| doc.to_owned());
            let state = self
                .state(&state_doc)
                .await
                .unwrap_or_else(blok_jsjson::new_null);
            crate::scenario_test::check_pointers(
                failures,
                &format!("{place} state"),
                &state,
                Some(pointers),
            );
        }
        if let Some(want) = lookup(Some(expect), "stateMatchesSaved") {
            let at: usize = std::str::from_utf8(want.raw())
                .ok()
                .and_then(|raw| raw.parse().ok())
                .unwrap_or_default();
            let ids = records(lookup(Some(seed), "blocks"))
                .into_iter()
                .filter_map(id_of)
                .collect();
            let saved = stable(Some(&normalize_document(&must_parse(&saved_at(at)), &ids)));
            let state = self.state(doc).await.unwrap_or_else(blok_jsjson::new_null);
            let live = stable(Some(&normalize_document(&state, &ids)));
            if saved != live {
                failures.push(format!(
                    "{place}: the room holds\n{live}\nthe stored runner saved\n{saved}"
                ));
            }
        }
    }
}

/// `{lineage}` is the head's lineage and `{rev:N}` the revision step N
/// answered.
pub(crate) fn fill_scenario(
    text: &str,
    revisions: &std::collections::HashMap<usize, String>,
    head: &str,
) -> String {
    let mut text = text.to_owned();
    if text.contains("{lineage}") {
        let colon = head.rfind(':').expect("a head");
        text = text.replace("{lineage}", &head[..colon]);
    }
    let mut out = String::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("{rev:") {
        out.push_str(&rest[..at]);
        let tail = &rest[at + "{rev:".len()..];
        let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && tail.as_bytes().get(digits) == Some(&b'}') {
            let index: usize = tail[..digits].parse().expect("an index");
            out.push_str(revisions.get(&index).map_or("", String::as_str));
            rest = &tail[digits + 1..];
        } else {
            out.push_str("{rev:");
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// The room head in place of every "@head" string.
pub(crate) fn headed(mut node: Node, head: &str) -> Node {
    fn walk(node: &mut Node, head: &str) {
        if string_of(Some(node)).as_deref() == Some("@head") {
            *node = str_node(head);
            return;
        }
        for item in &mut node.items {
            walk(item, head);
        }
        for m in &mut node.members {
            walk(&mut m.value, head);
        }
    }
    walk(&mut node, head);
    node
}

pub(crate) fn step_actor(step: &Node, fallback: Actor) -> Actor {
    let Some(given) = lookup(Some(step), "actor") else {
        return fallback;
    };
    Actor {
        id: string_of(lookup(Some(given), "id")).unwrap_or_default(),
        name: string_of(lookup(Some(given), "name")).unwrap_or_default(),
        on_behalf_of: string_of(lookup(Some(given), "onBehalfOf")),
    }
}

fn sequence_of(head: &str) -> i64 {
    head.rfind(':')
        .and_then(|colon| head[colon + 1..].parse().ok())
        .unwrap_or_default()
}
