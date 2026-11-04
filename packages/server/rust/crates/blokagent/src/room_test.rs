use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use blok_collab::BoxFuture;
use blok_collab_convert::{EditOp, RichTextHtmlSlot};
use blok_collab_room::{
    Converter, EditStatus, Error as RoomError, HistoryConverter, HistoryStatus, StateStatus,
};
use blok_jsjson::{Node, Object, Str, Value};
use blok_yjs::Doc;

use crate::normalize_test::{id_of, records};
use crate::room::new_guid;
use crate::roomharness_test::{RealConverter, TestRoom, new_test_room, new_test_room_with};
use crate::roomhistory::{ROOM_IDLE_LIMIT, RoomHistory, RoomStep, key_of, serialized};
use crate::session::MAX_STEPS;
use crate::test_support::{lookup, must_parse, string_of};
use crate::wire::write;
use crate::{
    Actor, Cancel, CancelReason, Error, Execution, HostFuture, InvokeFuture, Invoker, Options,
    PageCreator, PageLocation, PageTarget,
};

// Twins of the C# room tests a scenario cannot express: timing,
// concurrency, a clock, and runtimes that answer for the bundle.

const HISTORY_SEED: &str = r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello"}},{"id":"q","type":"paragraph","data":{"text":"Other"}}]}"#;

pub(crate) fn room_agent() -> Actor {
    Actor {
        id: "agent-cs".to_owned(),
        name: "Agent".to_owned(),
        on_behalf_of: None,
    }
}

pub(crate) async fn run_in(
    r: &TestRoom,
    doc: &str,
    batch: &str,
    actor: &Actor,
) -> (Execution, String) {
    let execution = r
        .executor
        .execute_in_room(&Cancel::new(), doc, batch, actor, None)
        .await
        .unwrap_or_else(|err| panic!("{batch}: {err}"));
    let code = code_of(&execution);
    (execution, code)
}

fn code_of(execution: &Execution) -> String {
    string_of(lookup(
        lookup(Some(&must_parse(&execution.result_json)), "error"),
        "code",
    ))
    .unwrap_or_default()
}

pub(crate) async fn ok_in(r: &TestRoom, doc: &str, batch: &str) -> Execution {
    let (execution, code) = run_in(r, doc, batch, &room_agent()).await;
    assert!(code.is_empty(), "{batch}: {}", execution.result_json);
    execution
}

pub(crate) async fn ids(r: &TestRoom, doc: &str) -> String {
    let exported = r.export(doc).await;
    records(lookup(Some(&exported), "blocks"))
        .into_iter()
        .map(|block| id_of(block).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(",")
}

pub(crate) const UNDO_BATCH: &str = r#"{"commands":[{"name":"history.undo","args":{}}]}"#;
pub(crate) const REDO_BATCH: &str = r#"{"commands":[{"name":"history.redo","args":{}}]}"#;

pub(crate) fn insert_batch(id: &str, text: &str) -> String {
    format!(
        r#"{{"commands":[{{"name":"block.insert","args":{{"id":"{id}","type":"paragraph","data":{{"text":"{text}"}},"position":"end"}}}}]}}"#
    )
}

fn lineage_of(revision: &str) -> &str {
    &revision[..revision.rfind(':').expect("a head")]
}

fn history(r: &TestRoom) -> &RoomHistory {
    &r.executor.live.as_ref().expect("rooms").history
}

// T6 (C# AStepCarriesItsLineageWhenItIsAdded): a step is shared the moment
// it is added, so its lineage is set by then.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_step_carries_its_lineage_when_it_is_added() {
    let r = new_test_room(false, None);
    r.docs.hold("d", HISTORY_SEED);
    let added = Arc::new(Mutex::new(Vec::new()));
    let seen = added.clone();
    history(&r).lock().added = Some(Box::new(move |step: &RoomStep| {
        seen.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(step.lineage.clone().unwrap_or_else(|| "<nil>".to_owned()));
    }));
    let execution = ok_in(&r, "d", &insert_batch("a", "Agent")).await;
    let lineage = lineage_of(&execution.revision).to_owned();
    assert_eq!(*added.lock().expect("lock"), vec![lineage]);
}

// C# TwoUndosAtOnceTakeTheStepBackOnce.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_undos_at_once_take_the_step_back_once() {
    let r = new_test_room(false, None);
    r.docs.hold("d", HISTORY_SEED);
    ok_in(&r, "d", &insert_batch("a", "Agent")).await;
    let undo = || {
        let executor = r.executor.clone();
        tokio::spawn(async move {
            let execution = executor
                .execute_in_room(&Cancel::new(), "d", UNDO_BATCH, &room_agent(), None)
                .await
                .expect("undo");
            code_of(&execution)
        })
    };
    let (first, second) = (undo(), undo());
    let codes = [first.await.expect("join"), second.await.expect("join")];
    let mut won = 0;
    for code in &codes {
        match code.as_str() {
            "" => won += 1,
            "NOTHING_TO_UNDO" | "CONFLICT" => {}
            _ => panic!("codes {codes:?}"),
        }
    }
    assert_eq!(won, 1, "codes {codes:?}, want one undo");
    assert_eq!(ids(&r, "d").await, "p,q");
    ok_in(&r, "d", REDO_BATCH).await;
    assert_eq!(ids(&r, "d").await, "p,q,a", "blocks after redo");
}

// T18: the idle limit is lazy, on top and add, against the clock.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn steps_go_after_an_hour_without_a_call() {
    let r = new_test_room(false, None);
    r.docs.hold("d", HISTORY_SEED);
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock = now.clone();
    history(&r).lock().now = Box::new(move || *clock.lock().expect("lock"));
    let advance = |d: Duration| *now.lock().expect("lock") += d;
    ok_in(&r, "d", &insert_batch("a", "One")).await;
    advance(Duration::from_secs(3600));
    // Exactly the limit is not past it, and the call touches the steps.
    ok_in(&r, "d", &insert_batch("b", "Two")).await;
    advance(Duration::from_secs(3600) + Duration::from_millis(1));
    let (_, code) = run_in(&r, "d", UNDO_BATCH, &room_agent()).await;
    assert_eq!(code, "NOTHING_TO_UNDO", "after the idle limit");
    assert_eq!(ids(&r, "d").await, "p,q,a,b");
}

fn step(other: bool) -> Arc<RoomStep> {
    let mut step = RoomStep::new(None, None).expect("measure");
    step.other = other;
    Arc::new(step)
}

// C# RoomAgentHistoryTests.StepsGoAfterAnHourWithoutACall: both add and top
// count as a call.
#[test]
fn top_and_add_keep_the_steps_for_another_hour() {
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock = now.clone();
    let h = RoomHistory::new(Box::new(move || *clock.lock().expect("lock")));
    let advance = |d: Duration| *now.lock().expect("lock") += d;
    let (first, second) = (step(false), step(false));
    h.add("d", &room_agent(), first.clone());
    for _ in 0..2 {
        advance(ROOM_IDLE_LIMIT);
        let top = h.top("d", &room_agent(), true).expect("a step");
        assert!(Arc::ptr_eq(&top, &first), "top is not the first step");
    }
    h.add("d", &room_agent(), second.clone());
    advance(ROOM_IDLE_LIMIT);
    let top = h.top("d", &room_agent(), true).expect("a step");
    assert!(Arc::ptr_eq(&top, &second), "top is not the second step");
    advance(ROOM_IDLE_LIMIT + Duration::from_millis(1));
    assert!(
        h.top("d", &room_agent(), true).is_none(),
        "a step after the idle limit"
    );
}

// T2: the room trims done steps only, so with the redo side full, a page
// action (which keeps the redo side) evicts the very step it adds.
#[test]
fn the_room_trims_only_done_steps() {
    let h = RoomHistory::new(Box::new(Instant::now));
    for _ in 0..MAX_STEPS {
        h.add("d", &room_agent(), step(false));
    }
    for _ in 0..MAX_STEPS {
        let top = h.top("d", &room_agent(), true).expect("a step");
        assert!(
            h.replayed("d", &room_agent(), &top, true, None)
                .expect("replayed")
        );
    }
    h.add("d", &room_agent(), step(true));
    let counts = |h: &RoomHistory| {
        let state = h.lock();
        let steps = &state.rooms[&key_of("d", &room_agent())];
        (steps.done.len(), steps.undone.len())
    };
    assert_eq!(counts(&h), (0, MAX_STEPS));
    // A batch clears the redo side and stays.
    let kept = step(false);
    h.add("d", &room_agent(), kept.clone());
    assert_eq!(counts(&h), (1, 0));
    let state = h.lock();
    assert!(Arc::ptr_eq(
        &state.rooms[&key_of("d", &room_agent())].done[0],
        &kept
    ));
}

/// Answers a history batch as a contract without history.* would (C#
/// NoHistoryRuntime).
struct HistoryRuntime(Arc<dyn Invoker>);

impl Invoker for HistoryRuntime {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        if op == "agentExecute"
            && (input.contains(r#""name":"history.undo""#)
                || input.contains(r#""name":"history.redo""#))
        {
            return Box::pin(async {
                Ok(r#"{"result":{"ok":false,"error":{"code":"COMMAND_UNAVAILABLE","message":"\"history.undo\" is not available here.","retryable":false,"details":{"reason":"runtime"}},"warnings":[],"revision":"h1"},"document":{"blocks":[]},"edits":[]}"#.to_owned())
            });
        }
        self.0.invoke(cancel, op, input, timeout)
    }
}

// F28 (C# RefusesUndoTheContractDoesNotOffer): the gate's refusal goes back
// as the bundle wrote it, without its revision, and nothing is replayed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_undo_the_contract_does_not_offer() {
    let r = new_test_room(
        false,
        Some(Box::new(|inner| Arc::new(HistoryRuntime(inner)))),
    );
    r.docs.hold("d", HISTORY_SEED);
    ok_in(&r, "d", &insert_batch("a", "Agent")).await;
    let (execution, code) = run_in(&r, "d", UNDO_BATCH, &room_agent()).await;
    assert!(
        code == "COMMAND_UNAVAILABLE"
            && execution.revision.is_empty()
            && !execution.result_json.contains(r#""revision""#),
        "{} {:?}",
        execution.result_json,
        execution.revision
    );
    assert_eq!(ids(&r, "d").await, "p,q,a");
}

// C# AFailedRestoreIsRetryableOnlyWhenTheSharedRuntimeWouldSaySo.
#[test]
fn a_failed_restore_is_retryable_only_when_the_shared_runtime_would_say_so() {
    for (status, want) in [
        (HistoryStatus::ExportFailed, false),
        (HistoryStatus::Corrupt, false),
        (HistoryStatus::None, false),
        (HistoryStatus::Purged, false),
        (HistoryStatus::Unavailable, true),
    ] {
        assert_eq!(crate::versions::restore_retryable(status), want, "{status}");
    }
}

// C# AReadWithoutAJournalWritesNothingBack.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_without_a_journal_writes_nothing_back() {
    let r = new_test_room(true, None);
    r.docs.hold("d", HISTORY_SEED);
    r.export("d").await;
    let writes = r.sets.write_count();
    ok_in(&r, "d", r#"{"commands":[{"name":"doc.read","args":{}}]}"#).await;
    assert_eq!(r.sets.write_count(), writes);
}

type Peer = Box<dyn FnOnce() -> BoxFuture<'static, ()> + Send>;

/// Runs `peer` right after the bundle answers a restore, before the room
/// restores (C# PeerWriteAfterRestoreCheck, and the drain of
/// ARestoreTheRoomRefusesIsApplyFailedWithItsStatus).
struct AfterRestoreCheck {
    inner: Arc<dyn Invoker>,
    peer: Arc<Mutex<Option<Peer>>>,
}

impl Invoker for AfterRestoreCheck {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        Box::pin(async move {
            let output = self.inner.invoke(cancel, op, input, timeout).await;
            let peer = match &output {
                Ok(text) if op == "agentExecute" && text.contains(r#""restore":"#) => self
                    .peer
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .take(),
                _ => None,
            };
            if let Some(peer) = peer {
                peer().await;
            }
            output
        })
    }
}

fn after_restore_check() -> (Arc<Mutex<Option<Peer>>>, crate::roomharness_test::Wrap) {
    let peer: Arc<Mutex<Option<Peer>>> = Arc::new(Mutex::new(None));
    let slot = peer.clone();
    (
        peer,
        Box::new(move |inner| Arc::new(AfterRestoreCheck { inner, peer: slot })),
    )
}

fn first_text(block: &Node) -> String {
    let text = lookup(lookup(Some(block), "data"), "text").expect("text");
    string_of(lookup(text.items.first(), "text")).unwrap_or_default()
}

// C# ARoomChangeBetweenTheRestoreCheckAndTheRestoreIsStaleAndWritesNothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_change_between_the_restore_check_and_the_restore_is_stale() {
    let (peer, wrap) = after_restore_check();
    let r = Arc::new(new_test_room(false, Some(wrap)));
    r.docs.hold(
        "d",
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}},{"id":"q","type":"paragraph","data":{"text":"Second"}}]}"#,
    );
    let edit = ok_in(
        &r,
        "d",
        r#"{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}"#,
    )
    .await;
    let lineage = lineage_of(&edit.revision).to_owned();
    let after_peer = Arc::new(Mutex::new(String::new()));
    let (room, seen) = (r.clone(), after_peer.clone());
    *peer.lock().expect("lock") = Some(Box::new(move || {
        Box::pin(async move {
            ok_in(
                &room,
                "d",
                r#"{"commands":[{"name":"text.replace","args":{"id":"q","with":"Peer"}}]}"#,
            )
            .await;
            *seen.lock().expect("lock") = room.head("d").await;
        })
    }));
    let (_, code) = run_in(
        &r,
        "d",
        &format!(
            r#"{{"commands":[{{"name":"history.restore","args":{{"version":"{lineage}:0"}}}}]}}"#
        ),
        &room_agent(),
    )
    .await;
    assert_eq!(code, "STALE");
    let exported = r.export("d").await;
    let blocks = lookup(Some(&exported), "blocks").expect("blocks");
    let (first, second) = (first_text(&blocks.items[0]), first_text(&blocks.items[1]));
    let head = r.head("d").await;
    assert!(
        first == "Changed" && second == "Peer" && head == *after_peer.lock().expect("lock"),
        "p {first:?} q {second:?} head {head}, after the peer {}",
        after_peer.lock().expect("lock")
    );
}

// H1/T9: an undo that pinned the head itself tries again, three times in
// all, when a peer writes between its read and its lane; one that sent its
// own expectRevision is never retried.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_undo_retries_its_own_stale_head_three_times() {
    for (name, writes, expect, want, want_calls) in [
        ("one peer write", 1, false, "", 2),
        ("a peer write every time", 99, false, "STALE", 3),
        ("the caller's own head", 99, true, "STALE", 1),
    ] {
        let mut r = new_test_room(false, None);
        r.docs.hold("d", HISTORY_SEED);
        ok_in(&r, "d", &insert_batch("a", "Agent")).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let (counted, manager) = (calls.clone(), r.manager.clone());
        Arc::get_mut(&mut r.executor)
            .expect("one owner")
            .before_history_lane = Some(Box::new(move || {
            let call = counted.fetch_add(1, Ordering::SeqCst) + 1;
            let manager = manager.clone();
            Box::pin(async move {
                if call <= writes {
                    let edit = manager
                        .edit(
                            "d",
                            vec![EditOp::Update {
                                id: Str::from("q"),
                                data: must_parse(&format!(r#"{{"text":"Peer {call}"}}"#)),
                            }],
                            &new_guid(),
                            &[0u8; 32],
                            "human-2",
                            None,
                        )
                        .await
                        .expect("peer");
                    assert_eq!(edit.status, EditStatus::Applied, "peer {:?}", edit.err);
                }
            })
        }));
        let batch = if expect {
            format!(
                r#"{{"expectRevision":"{}","commands":[{{"name":"history.undo","args":{{}}}}]}}"#,
                r.head("d").await
            )
        } else {
            UNDO_BATCH.to_owned()
        };
        let (_, code) = run_in(&r, "d", &batch, &room_agent()).await;
        let got = calls.load(Ordering::SeqCst);
        assert!(
            code == want && got == want_calls,
            "{name}: code {code:?} after {got} tries, want {want:?} after {want_calls}"
        );
    }
}

/// Makes host-1, host-2, ... and records them; `during` runs inside each
/// create.
#[derive(Default)]
pub(crate) struct Pages {
    pub created: Mutex<Vec<String>>,
    pub during: Option<Box<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>>,
}

impl Pages {
    fn created(&self) -> Vec<String> {
        self.created.lock().expect("lock").clone()
    }
}

impl PageTarget for Pages {
    fn resolve<'a>(
        &'a self,
        _: &'a Cancel,
        _: &'a str,
        _: &'a Actor,
    ) -> HostFuture<'a, Option<PageLocation>> {
        Box::pin(async { Ok(None) })
    }

    fn as_creator(&self) -> Option<&dyn PageCreator> {
        Some(self)
    }
}

impl PageCreator for Pages {
    fn create<'a>(&'a self, _: &'a Cancel, _: &'a Actor) -> HostFuture<'a, Option<String>> {
        Box::pin(async move {
            if let Some(during) = &self.during {
                during().await;
            }
            let mut created = self.created.lock().expect("lock");
            let id = format!("host-{}", created.len() + 1);
            created.push(id.clone());
            Ok(Some(id))
        })
    }
}

const INSERT_PAGE_BATCH: &str =
    r#"{"commands":[{"name":"block.insert","args":{"type":"page","id":"np","position":"end"}}]}"#;

fn page_options(pages: Arc<Pages>) -> Options {
    Options {
        page_titles: true,
        page_target: Some(pages),
        ..Options::default()
    }
}

/// Lets the page count run, then fails the batch run itself.
struct FailingExecute {
    inner: Arc<dyn Invoker>,
    err: fn() -> Error,
}

impl Invoker for FailingExecute {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        if op == "agentExecute" {
            let err = (self.err)();
            return Box::pin(async move { Err(err) });
        }
        self.inner.invoke(cancel, op, input, timeout)
    }
}

fn orphaned_cause(execution: &Execution) -> (String, String) {
    let result = must_parse(&execution.result_json);
    let error = lookup(Some(&result), "error");
    let code = string_of(lookup(error, "code")).unwrap_or_default();
    let cause =
        string_of(lookup(lookup(lookup(error, "details"), "cause"), "code")).unwrap_or_default();
    (code, cause)
}

fn engine_broke() -> Error {
    Error::Host("The engine broke.".into())
}

// C# ARoomRunThatStopsAfterTheHostMadePagesListsThem (cancel, error).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_run_that_stops_after_the_host_made_pages_lists_them() {
    let cancelled: fn() -> Error = || Error::Cancelled(CancelReason::Cancelled);
    for (err, want) in [
        (cancelled, "CANCELLED"),
        (engine_broke as fn() -> Error, "APPLY_FAILED"),
    ] {
        let r = new_test_room(
            false,
            Some(Box::new(move |inner| {
                Arc::new(FailingExecute { inner, err })
            })),
        );
        r.docs.hold("d", r#"{"blocks":[]}"#);
        let pages = Arc::new(Pages::default());
        let execution = r
            .executor
            .execute_in_room(
                &Cancel::new(),
                "d",
                INSERT_PAGE_BATCH,
                &room_agent(),
                Some(&page_options(pages.clone())),
            )
            .await
            .expect("execute");
        let (code, cause) = orphaned_cause(&execution);
        assert!(
            code == "ORPHANED_SIDE_EFFECT"
                && cause == want
                && execution.result_json.contains("host-1")
                && execution.document_json.is_none(),
            "{}",
            execution.result_json
        );
        assert_eq!(pages.created(), vec!["host-1"]);
        assert_eq!(ids(&r, "d").await, "");
    }
}

/// The real converter with one call made to fail.
struct Faulty {
    inner: RealConverter,
    after_apply: bool,
    exports: Arc<AtomicUsize>,
    fail_export: usize,
}

impl Converter for Faulty {
    fn seed<'a>(&'a self, doc: &'a Doc, data: &'a Node) -> BoxFuture<'a, Result<(), RoomError>> {
        Converter::seed(&self.inner, doc, data)
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, RoomError>> {
        let count = self.exports.fetch_add(1, Ordering::SeqCst) + 1;
        if count == self.fail_export {
            return Box::pin(async { Err(RoomError::message("Post-processing failed.")) });
        }
        Converter::export(&self.inner, doc)
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), RoomError>> {
        Box::pin(async move {
            self.inner.apply_ops(doc, ops).await?;
            if self.after_apply {
                return Err(RoomError::message("The disk filled after the write."));
            }
            Ok(())
        })
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, RoomError>> {
        Converter::migrate_rich_text(&self.inner, doc)
    }
    fn history(&self) -> Option<&dyn HistoryConverter> {
        Some(self)
    }
}

impl HistoryConverter for Faulty {
    fn export_blocks(
        &self,
        doc: &Doc,
        warned: &mut std::collections::HashSet<String>,
    ) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), RoomError> {
        HistoryConverter::export_blocks(&self.inner, doc, warned)
    }
    fn resolve<'a>(
        &'a self,
        blocks: &'a mut [Value],
        slots: &'a [RichTextHtmlSlot],
    ) -> BoxFuture<'a, Result<(), RoomError>> {
        HistoryConverter::resolve(&self.inner, blocks, slots)
    }
}

// C# APageTheRoomLinksIsNeverReportedOrphanedWhenTheEditThrowsAfterWriting.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_page_the_room_links_is_never_reported_orphaned_when_the_edit_throws_after_writing() {
    for no_journal in [false, true] {
        let r = new_test_room_with(
            no_journal,
            None,
            Some(Box::new(|inner| {
                Arc::new(Faulty {
                    inner,
                    after_apply: true,
                    exports: Arc::new(AtomicUsize::new(0)),
                    fail_export: 0,
                })
            })),
        );
        r.docs.hold("d", r#"{"blocks":[]}"#);
        let pages = Arc::new(Pages::default());
        let outcome = r
            .executor
            .execute_in_room(
                &Cancel::new(),
                "d",
                INSERT_PAGE_BATCH,
                &room_agent(),
                Some(&page_options(pages.clone())),
            )
            .await;
        let result = outcome
            .as_ref()
            .map(|e| e.result_json.clone())
            .unwrap_or_default();
        let state = r.manager.state("d").await.expect("state");
        let linked = state.status == StateStatus::Ready
            && String::from_utf8_lossy(&state.json).contains("host-1");
        let orphaned = result.contains(r#""orphaned":["#) && result.contains("host-1");
        assert_eq!(pages.created(), vec!["host-1"]);
        assert!(
            !(linked && orphaned),
            "journal {}: the room links host-1, yet the result lists it orphaned: {result}",
            !no_journal
        );
        assert!(
            linked || outcome.is_err() || orphaned,
            "journal {}: the room does not link host-1, so the result must list it: {result}",
            !no_journal
        );
    }
}

// C# AThrowAfterTheRoomCommitNeverReportsTheLinkedPageOrphaned: the export
// after the commit fails. The executor exports through the room's
// converter, so the state read before the page is made counts first: state
// (1), the plan (2), after the commit (3).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_throw_after_the_room_commit_never_reports_the_linked_page_orphaned() {
    let r = new_test_room_with(
        false,
        None,
        Some(Box::new(|inner| {
            Arc::new(Faulty {
                inner,
                after_apply: false,
                exports: Arc::new(AtomicUsize::new(0)),
                fail_export: 3,
            })
        })),
    );
    r.docs.hold("d", r#"{"blocks":[]}"#);
    let pages = Arc::new(Pages::default());
    let outcome = r
        .executor
        .execute_in_room(
            &Cancel::new(),
            "d",
            INSERT_PAGE_BATCH,
            &room_agent(),
            Some(&page_options(pages)),
        )
        .await;
    match &outcome {
        Ok(execution) => panic!(
            "the failed export was not passed on: {}",
            execution.result_json
        ),
        Err(err) => assert_eq!(err.to_string(), "Post-processing failed."),
    }
    let exported = r.export("d").await;
    let page = string_of(lookup(
        lookup(
            records(lookup(Some(&exported), "blocks")).first().copied(),
            "data",
        ),
        "pageId",
    ));
    assert_eq!(page.as_deref(), Some("host-1"));
}

/// Cancels the caller's token when the batch runs. The plan runs on the
/// room's own lifetime, so the caller's cancel reaches it as this error.
struct CancelOnExecute {
    inner: Arc<dyn Invoker>,
    cancel: Cancel,
}

impl Invoker for CancelOnExecute {
    fn invoke<'a>(
        &'a self,
        cancel: &'a Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Duration,
    ) -> InvokeFuture<'a> {
        if op == "agentExecute" {
            self.cancel.cancel();
            return Box::pin(async { Err(Error::Cancelled(CancelReason::Cancelled)) });
        }
        self.inner.invoke(cancel, op, input, timeout)
    }
}

// T10: the room read that decides whether the made pages are orphans
// ignores the caller's cancel, so a cancelled call still lists them.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_orphan_check_reads_the_room_after_the_caller_cancels() {
    let cancel = Cancel::new();
    let caller = cancel.clone();
    let r = new_test_room(
        false,
        Some(Box::new(move |inner| {
            Arc::new(CancelOnExecute {
                inner,
                cancel: caller,
            })
        })),
    );
    r.docs.hold("d", r#"{"blocks":[]}"#);
    let pages = Arc::new(Pages::default());
    let execution = r
        .executor
        .execute_in_room(
            &cancel,
            "d",
            INSERT_PAGE_BATCH,
            &room_agent(),
            Some(&page_options(pages)),
        )
        .await
        .expect("execute");
    let (code, cause) = orphaned_cause(&execution);
    assert!(
        code == "ORPHANED_SIDE_EFFECT" && cause == "CANCELLED",
        "{}",
        execution.result_json
    );
}

// C# ARoomThatRefusesTheEditAfterThePageWasMadeListsIt (R10).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_that_refuses_the_edit_after_the_page_was_made_lists_it() {
    let r = new_test_room(false, None);
    r.docs.hold(
        "d",
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}"#,
    );
    let head = r.head("d").await;
    let manager = r.manager.clone();
    let pages = Arc::new(Pages {
        created: Mutex::new(Vec::new()),
        during: Some(Box::new(move || {
            let manager = manager.clone();
            Box::pin(async move {
                let edit = manager
                    .edit(
                        "d",
                        vec![EditOp::Update {
                            id: Str::from("p"),
                            data: must_parse(r#"{"text":"Peer"}"#),
                        }],
                        &new_guid(),
                        &[0u8; 32],
                        "human-2",
                        None,
                    )
                    .await
                    .expect("peer");
                assert_eq!(edit.status, EditStatus::Applied, "peer {:?}", edit.err);
            })
        })),
    });
    let execution = r
        .executor
        .execute_in_room(
            &Cancel::new(),
            "d",
            &format!(
                r#"{{"expectRevision":"{head}","commands":[{{"name":"block.insert","args":{{"type":"page","id":"np","position":"end"}}}}]}}"#
            ),
            &room_agent(),
            Some(&page_options(pages.clone())),
        )
        .await
        .expect("execute");
    let (code, cause) = orphaned_cause(&execution);
    let result = must_parse(&execution.result_json);
    let orphaned = write(
        lookup(
            lookup(lookup(Some(&result), "error"), "details"),
            "orphaned",
        )
        .expect("orphaned"),
    )
    .expect("write");
    assert!(
        code == "ORPHANED_SIDE_EFFECT"
            && cause == "STALE"
            && orphaned
                == r#"[{"command":"block.insert","type":"page","prepared":{"pageId":"host-1"}}]"#,
        "{}",
        execution.result_json
    );
    assert_eq!(pages.created(), vec!["host-1"]);
}

// C# ARestoreTheRoomRefusesIsApplyFailedWithItsStatus (F26).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_restore_the_room_refuses_is_apply_failed_with_its_status() {
    let (drain, wrap) = after_restore_check();
    let r = new_test_room(false, Some(wrap));
    r.docs.hold(
        "d",
        r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}"#,
    );
    let edit = ok_in(
        &r,
        "d",
        r#"{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}"#,
    )
    .await;
    let lineage = lineage_of(&edit.revision).to_owned();
    let manager = r.manager.clone();
    *drain.lock().expect("lock") = Some(Box::new(move || {
        Box::pin(async move { manager.drain().await.expect("drain") })
    }));
    let (execution, _) = run_in(
        &r,
        "d",
        &format!(
            r#"{{"commands":[{{"name":"history.restore","args":{{"version":"{lineage}:0"}}}}]}}"#
        ),
        &room_agent(),
    )
    .await;
    let want = r#"{"ok":false,"error":{"code":"APPLY_FAILED","message":"The room refused the restore (Draining). Nothing was written.","retryable":true,"details":{"status":"Draining"}},"warnings":[]}"#;
    assert!(
        execution.result_json == want && execution.revision.is_empty(),
        "{} {:?}",
        execution.result_json,
        execution.revision
    );
}

// T1: the char cap counts the escaped JSON text in UTF-16 units (C#
// RoomAgentHistoryTests.AStepCountsItsEscapedJsonText).
#[test]
fn a_step_counts_its_escaped_json_text() {
    let mut before = Object::new();
    before.set(Str::from("t"), Value::String(Str::from("\u{1F680}<a>&'+é")));
    let written = serialized(&Value::Object(before.clone())).expect("serialize");
    assert_eq!(
        String::from_utf8_lossy(&written),
        r#"{"t":"\uD83D\uDE80\u003Ca\u003E\u0026\u0027\u002B\u00E9"}"#
    );
    let step = RoomStep::new(Some(before), Some(Object::new())).expect("measure");
    assert_eq!(step.chars(), 57 + 2);
}

// The room path's futures cross tasks in a host, so they must be Send.
#[test]
fn the_room_futures_are_send() {
    fn send<T: Send>(_: T) {}
    let r = new_test_room(true, None);
    send(
        r.executor
            .execute_in_room(&Cancel::new(), "d", "{}", &room_agent(), None),
    );
}
