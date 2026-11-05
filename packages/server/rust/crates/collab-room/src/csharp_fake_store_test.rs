// Twins of the C# FakeCollabOperationStoreTests.cs cases (Go: room/csharp_fake_store_test.go),
// run against test_support's FakeJournal.

use std::sync::Arc;

use blok_collab::BoxFuture;
use blok_collab_journal::{
    Context, LineageDeleteOutcome, LineageInfo, OpenOutcome, PurgeOutcome, RecordHeader,
};
use blok_collab_operation::{AppendOutcome, Candidate, Checkpoint, LookupOutcome, Reset, Source};
use blok_collab_workingset::CURRENT_FORMAT;
use sha2::{Digest, Sha256};

use crate::test_support::*;
use crate::*;

const DOC: &str = "doc";

fn ctx() -> Context {
    Context::background()
}

fn digest(update: u8) -> Vec<u8> {
    Sha256::digest([update]).to_vec()
}

fn candidate(operation_id: &str, update: u8) -> Candidate {
    Candidate {
        operation_id: operation_id.to_owned(),
        actor_id: Some("actor".to_owned()),
        source: Source::CLIENT_V2,
        update: vec![update],
        digest: digest(update),
    }
}

fn reset(epoch: i64, lineage: Option<&str>) -> Reset {
    Reset {
        format: CURRENT_FORMAT,
        epoch,
        lineage: lineage.map_or_else(|| "a".repeat(32), str::to_owned),
        baseline: Vec::new(),
    }
}

async fn open(store: &FakeJournal) -> (OpenOutcome, Option<Arc<dyn OperationSession>>) {
    OperationStore::open(store, &ctx(), DOC)
        .await
        .expect("open")
}

async fn open_seeded(store: &FakeJournal) -> Arc<dyn OperationSession> {
    let session = open(store).await.1.expect("a session");
    session.reset(&ctx(), reset(0, None)).await.expect("reset");
    session
}

fn is_fence_lost(err: &Error) -> bool {
    matches!(err, Error::Journal(blok_collab_journal::Error::FenceLost))
}

fn is_disposed(err: &Error) -> bool {
    matches!(err, Error::Message(m) if m == "the session is disposed")
}

fn is_out_of_range(err: &Error) -> bool {
    matches!(
        err,
        Error::Journal(blok_collab_journal::Error::Argument {
            out_of_range: true,
            ..
        })
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn assigns_sequences_from_one_and_exposes_committed_records() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;

    let first = session.append(&ctx(), candidate("a", 1)).await.expect("a");
    let second = session.append(&ctx(), candidate("b", 2)).await.expect("b");

    assert_eq!(
        (first.outcome, first.sequence),
        (AppendOutcome::Committed, 1)
    );
    assert_eq!(
        (second.outcome, second.sequence),
        (AppendOutcome::Committed, 2)
    );
    let ids: Vec<String> = store
        .committed(DOC)
        .into_iter()
        .map(|r| r.operation_id)
        .collect();
    assert_eq!(ids, ["a", "b"]);
    assert_eq!(store.head(DOC).map(|h| h.durable_through), Some(2));
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reports_whether_an_operation_id_is_already_committed() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;

    let unseen = session
        .find_committed(&ctx(), "a", &digest(1))
        .await
        .expect("unseen");
    session.append(&ctx(), candidate("a", 1)).await.expect("a");
    let retry = session
        .find_committed(&ctx(), "a", &digest(1))
        .await
        .expect("retry");
    let reused = session
        .find_committed(&ctx(), "a", &digest(9))
        .await
        .expect("reused");

    assert_eq!(
        (unseen.outcome, unseen.sequence),
        (LookupOutcome::NotCommitted, 0)
    );
    assert_eq!(
        (retry.outcome, retry.sequence),
        (LookupOutcome::Duplicate, 1)
    );
    assert_eq!(
        (reused.outcome, reused.sequence),
        (LookupOutcome::Conflict, 1)
    );
    assert!(session.open_result().tail.is_empty());
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deduplicates_a_retry_and_conflicts_on_a_different_digest() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    session.append(&ctx(), candidate("a", 1)).await.expect("a");

    let retry = session
        .append(&ctx(), candidate("a", 1))
        .await
        .expect("retry");
    let reused = session
        .append(&ctx(), candidate("a", 9))
        .await
        .expect("reused");

    assert_eq!(
        (retry.outcome, retry.sequence),
        (AppendOutcome::Duplicate, 1)
    );
    assert_eq!(
        (reused.outcome, reused.sequence),
        (AppendOutcome::Conflict, 1)
    );
    assert_eq!(store.committed(DOC).len(), 1);
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fails_an_append_without_journalling_it() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    store.set_fail_appends(Some(Box::new(|_| Some("disk".to_owned()))));

    let err = session
        .append(&ctx(), candidate("a", 1))
        .await
        .expect_err("the append fails");

    assert!(matches!(&err, Error::Message(m) if m == "disk"), "{err:?}");
    assert!(store.committed(DOC).is_empty());
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn keeps_an_unknown_outcome_durable_so_the_retry_reads_as_a_duplicate() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    store.set_fail_appends(Some(Box::new(|_| Some("acknowledgement lost".to_owned()))));
    store.set_commit_before_failing(true);

    let err = session
        .append(&ctx(), candidate("a", 1))
        .await
        .expect_err("the caller sees a failure");

    assert!(
        matches!(&err, Error::Message(m) if m == "acknowledgement lost"),
        "{err:?}"
    );
    // The caller saw a failure; the store is durable.
    assert_eq!(store.committed(DOC).len(), 1);
    store.set_fail_appends(None);
    store.set_commit_before_failing(false);

    let retry = session
        .append(&ctx(), candidate("a", 1))
        .await
        .expect("retry");

    assert_eq!(
        (retry.outcome, retry.sequence),
        (AppendOutcome::Duplicate, 1)
    );
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn holds_an_append_until_the_store_is_released() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    let release = Gate::new();
    store.set_before_append(Some(release.clone()));

    let held = Arc::clone(&session);
    let append = tokio::spawn(async move { held.append(&ctx(), candidate("a", 1)).await });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    assert!(!append.is_finished());
    assert!(store.committed(DOC).is_empty());
    release.open();

    let result = append.await.expect("join").expect("append");
    assert_eq!(result.outcome, AppendOutcome::Committed);
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reports_a_second_open_as_held_elsewhere_until_the_first_is_disposed() {
    let store = FakeJournal::new();
    let first = open(&store).await.1.expect("the first session");

    let (outcome, session) = open(&store).await;

    assert_eq!(outcome, OpenOutcome::DocumentOpenElsewhere);
    assert!(session.is_none());
    first.close().await.expect("close");
    assert_eq!(open(&store).await.0, OpenOutcome::Opened);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_every_call_once_the_fence_is_lost() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    store.steal_fence(DOC);

    let append = session.append(&ctx(), candidate("a", 1)).await;
    let checkpoint = session
        .write_checkpoint(
            &ctx(),
            Checkpoint {
                through: 1,
                state: vec![7],
            },
        )
        .await;
    let reset_err = session.reset(&ctx(), reset(2, None)).await;
    let lookup = session.find_committed(&ctx(), "a", &digest(1)).await;

    assert!(is_fence_lost(&append.expect_err("append")));
    assert!(is_fence_lost(&checkpoint.expect_err("checkpoint")));
    assert!(is_fence_lost(&reset_err.expect_err("reset")));
    assert!(is_fence_lost(&lookup.expect_err("lookup")));
    assert!(store.committed(DOC).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn opens_an_unseeded_document_with_no_head() {
    let store = FakeJournal::new();
    let session = open(&store).await.1.expect("a session");

    assert!(session.open_result().head.is_none());
    assert!(session.open_result().baseline.is_empty());
    assert!(session.open_result().tail.is_empty());
    assert!(session.open_result().checkpoint.is_none());

    let head = session.reset(&ctx(), reset(0, None)).await.expect("reset");

    assert_eq!(head.durable_through, 0);
    assert!(session.open_result().head.is_none());
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hands_the_checkpoint_and_the_tail_after_it_to_the_next_open() {
    let store = FakeJournal::new();
    let writer = open_seeded(&store).await;
    writer.append(&ctx(), candidate("a", 1)).await.expect("a");
    writer.append(&ctx(), candidate("b", 2)).await.expect("b");
    writer
        .write_checkpoint(
            &ctx(),
            Checkpoint {
                through: 1,
                state: vec![42],
            },
        )
        .await
        .expect("checkpoint");
    writer.close().await.expect("close");

    let session = open(&store).await.1.expect("a session");

    let opened = session.open_result();
    assert_eq!(opened.checkpoint.as_ref().map(|c| c.through), Some(1));
    let tail: Vec<&str> = opened
        .tail
        .iter()
        .map(|r| r.operation_id.as_str())
        .collect();
    assert_eq!(tail, ["b"]);
    assert_eq!(opened.head.as_ref().map(|h| h.durable_through), Some(2));
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_a_checkpoint_past_the_committed_sequence() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    session.append(&ctx(), candidate("a", 1)).await.expect("a");

    let err = session
        .write_checkpoint(
            &ctx(),
            Checkpoint {
                through: 2,
                state: vec![42],
            },
        )
        .await
        .expect_err("past the committed sequence");

    assert!(is_out_of_range(&err), "{err:?}");
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accepts_a_republished_checkpoint_at_the_same_sequence() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    session.append(&ctx(), candidate("a", 1)).await.expect("a");
    session.append(&ctx(), candidate("b", 2)).await.expect("b");
    let at = |through| Checkpoint {
        through,
        state: vec![42],
    };
    session
        .write_checkpoint(&ctx(), at(2))
        .await
        .expect("checkpoint");

    session
        .write_checkpoint(&ctx(), at(2))
        .await
        .expect("the republished checkpoint");

    let err = session
        .write_checkpoint(&ctx(), at(1))
        .await
        .expect_err("below the published checkpoint");
    assert!(is_out_of_range(&err), "{err:?}");
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forgets_operation_ids_from_a_superseded_lineage() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    session.append(&ctx(), candidate("a", 1)).await.expect("a");

    let head = session
        .reset(&ctx(), reset(1, Some(&"b".repeat(32))))
        .await
        .expect("reset");
    let lookup = session
        .find_committed(&ctx(), "a", &digest(1))
        .await
        .expect("lookup");

    assert_eq!((head.epoch, head.durable_through), (1, 0));
    assert_eq!(lookup.outcome, LookupOutcome::NotCommitted);
    let again = session.append(&ctx(), candidate("a", 1)).await.expect("a");
    assert_eq!(again.sequence, 1);
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn releases_nothing_on_dispose_once_the_fence_is_lost() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    store.steal_fence(DOC);

    session.close().await.expect("close");

    assert_eq!(open(&store).await.0, OpenOutcome::DocumentOpenElsewhere);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn throws_object_disposed_on_every_call_after_disposal() {
    let store = FakeJournal::new();
    let session = open_seeded(&store).await;
    session.close().await.expect("close");

    let lookup = session.find_committed(&ctx(), "a", &digest(1)).await;
    let append = session.append(&ctx(), candidate("a", 1)).await;
    let checkpoint = session
        .write_checkpoint(
            &ctx(),
            Checkpoint {
                through: 1,
                state: vec![7],
            },
        )
        .await;
    let reset_err = session.reset(&ctx(), reset(1, None)).await;

    assert!(is_disposed(&lookup.expect_err("lookup")));
    assert!(is_disposed(&append.expect_err("append")));
    assert!(is_disposed(&checkpoint.expect_err("checkpoint")));
    assert!(is_disposed(&reset_err.expect_err("reset")));
}

// The C# fake's history and purge stores. as_history and as_purge stay
// None, so the room tests still see the plain fake as neither.
impl FakeJournal {
    /// Oldest first, current last, one per lineage id (the newest).
    fn lineages(&self, id: &str) -> Vec<FakeLineage> {
        self.with(id, |d| {
            if d.purged {
                return Vec::new();
            }
            let mut all = d.superseded.clone();
            if let Some(head) = d.head.clone() {
                all.push(FakeLineage {
                    head,
                    baseline: d.baseline.clone(),
                    records: d.records.clone(),
                    created_at: d.created_at,
                    current: true,
                });
            }
            (0..all.len())
                .filter(|&i| {
                    !all[i + 1..]
                        .iter()
                        .any(|newer| newer.head.lineage == all[i].head.lineage)
                })
                .map(|i| all[i].clone())
                .collect()
        })
    }
    fn find(&self, id: &str, lineage: &str) -> Option<FakeLineage> {
        self.lineages(id)
            .into_iter()
            .find(|l| l.head.lineage == lineage)
    }
}

impl PurgeStore for FakeJournal {
    fn purge<'a>(
        &'a self,
        _ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>> {
        let outcome = self.with(doc_id, |d| {
            if d.open {
                return PurgeOutcome::DocumentOpenElsewhere;
            }
            d.purged = true;
            d.baseline.clear();
            d.records.clear();
            d.superseded.clear();
            d.checkpoint = None;
            d.head = None;
            PurgeOutcome::Purged
        });
        Box::pin(async move { Ok(outcome) })
    }
}

impl HistoryStore for FakeJournal {
    fn is_purged(&self, _ctx: &Context, doc_id: &str) -> Result<bool, Error> {
        Ok(self.with(doc_id, |d| d.purged))
    }
    fn list_lineages(&self, _ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, Error> {
        Ok(self
            .lineages(doc_id)
            .into_iter()
            .map(|l| LineageInfo {
                lineage: l.head.lineage,
                epoch: l.head.epoch,
                format: l.head.format,
                created_at: l.created_at,
                current: l.current,
            })
            .collect())
    }
    fn read_baseline(
        &self,
        _ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, Error> {
        Ok(self.find(doc_id, lineage).map(|l| l.baseline))
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        Box::new(self.read_records(ctx, doc_id, lineage, u64::MAX).map(|r| {
            r.map(|record| RecordHeader {
                sequence: record.sequence,
                committed_at: record.committed_at,
                actor_id: record.actor_id,
            })
        }))
    }
    fn read_records<'a>(
        &'a self,
        _ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
        let records = self
            .find(doc_id, lineage)
            .map(|l| l.records)
            .unwrap_or_default();
        Box::new(
            records
                .into_iter()
                .filter(move |r| r.sequence <= through)
                .map(Ok),
        )
    }
    fn delete_lineage(
        &self,
        _ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, Error> {
        Ok(self.with(doc_id, |d| {
            if d.purged {
                return LineageDeleteOutcome::Purged;
            }
            if d.head.as_ref().is_some_and(|h| h.lineage == lineage) {
                return LineageDeleteOutcome::Current;
            }
            // Every superseded copy goes, so an older one sharing the id is
            // not listed in its place.
            let before = d.superseded.len();
            d.superseded.retain(|old| old.head.lineage != lineage);
            if d.superseded.len() < before {
                LineageDeleteOutcome::Deleted
            } else {
                LineageDeleteOutcome::NotFound
            }
        }))
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn keeps_superseded_lineages_for_history() {
    let store = FakeJournal::new();
    let first = "a".repeat(32);
    let second = "b".repeat(32);
    let session = open(&store).await.1.expect("a session");
    session
        .reset(
            &ctx(),
            Reset {
                format: CURRENT_FORMAT,
                epoch: 1,
                lineage: first.clone(),
                baseline: vec![vec![0xb1]],
            },
        )
        .await
        .expect("first reset");
    session.append(&ctx(), candidate("a", 1)).await.expect("a");
    session.append(&ctx(), candidate("b", 2)).await.expect("b");
    session
        .reset(&ctx(), reset(2, Some(&second)))
        .await
        .expect("second reset");
    session.append(&ctx(), candidate("c", 3)).await.expect("c");

    let listed = store.list_lineages(&ctx(), DOC).expect("list");
    let headers: Vec<u64> = store
        .read_headers(&ctx(), DOC, &first)
        .map(|h| h.expect("header").sequence)
        .collect();
    let records: Vec<String> = store
        .read_records(&ctx(), DOC, &first, 1)
        .map(|r| r.expect("record").operation_id)
        .collect();

    let lineages: Vec<&str> = listed.iter().map(|i| i.lineage.as_str()).collect();
    assert_eq!(lineages, [first.as_str(), second.as_str()]);
    let current: Vec<bool> = listed.iter().map(|i| i.current).collect();
    assert_eq!(current, [false, true]);
    let epochs: Vec<i64> = listed.iter().map(|i| i.epoch).collect();
    assert_eq!(epochs, [1, 2]);
    assert_eq!(headers, [1, 2]);
    assert_eq!(records, ["a"]);
    assert_eq!(
        store.read_baseline(&ctx(), DOC, &first).expect("baseline"),
        Some(vec![vec![0xb1]])
    );
    assert_eq!(
        store
            .read_baseline(&ctx(), DOC, &"f".repeat(32))
            .expect("baseline"),
        None
    );

    // The current lineage's accessors are unchanged by the history kept beside it.
    let ids: Vec<String> = store
        .committed(DOC)
        .into_iter()
        .map(|r| r.operation_id)
        .collect();
    assert_eq!(ids, ["c"]);
    assert_eq!(store.head(DOC).map(|h| h.lineage), Some(second));
    session.close().await.expect("close");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deletes_only_a_superseded_lineage() {
    let store = FakeJournal::new();
    let first = "a".repeat(32);
    let second = "b".repeat(32);
    let session = open(&store).await.1.expect("a session");
    session
        .reset(&ctx(), reset(1, Some(&first)))
        .await
        .expect("first reset");
    session
        .reset(&ctx(), reset(2, Some(&second)))
        .await
        .expect("second reset");
    session.close().await.expect("close");

    let delete = |lineage: &str| store.delete_lineage(&ctx(), DOC, lineage).expect("delete");
    assert_eq!(delete(&second), LineageDeleteOutcome::Current);
    assert_eq!(delete(&first), LineageDeleteOutcome::Deleted);
    assert_eq!(delete(&first), LineageDeleteOutcome::NotFound);
    let listed: Vec<String> = store
        .list_lineages(&ctx(), DOC)
        .expect("list")
        .into_iter()
        .map(|i| i.lineage)
        .collect();
    assert_eq!(listed, [second.as_str()]);

    store.purge(&ctx(), DOC).await.expect("purge");

    assert_eq!(delete(&second), LineageDeleteOutcome::Purged);
    assert!(store.list_lineages(&ctx(), DOC).expect("list").is_empty());
}
