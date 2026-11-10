use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_collab::BoxFuture;
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo};
use blok_collab_room::{
    Error as RoomError, Headers, HistoryStore, LocalJournal, Opened, OperationStore, PurgeStore,
    Records,
};

use crate::room_test::{ok_in, room_agent, run_in};
use crate::roomharness_test::{TestRoom, new_local_journal, new_test_room_on};
use crate::test_support::{lookup, must_parse, string_of};
use crate::types::Actor;
use crate::{HistoryAccess, HistoryPolicy};

// Twins of C# BlokAgentVersionHistoryTests.Hooks: the host's history read and
// window hooks reach an agent's history commands.

const SEED: &str = r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello"}},{"id":"q","type":"paragraph","data":{"text":"Other"}}]}"#;

/// Record N reads as committed at the Unix epoch plus N spacings.
struct SpacedJournal(LocalJournal, Duration);

impl OperationStore for SpacedJournal {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, RoomError>> {
        self.0.open(ctx, doc_id)
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(&self.0)
    }
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "SpacedJournal"
    }
}

impl HistoryStore for SpacedJournal {
    fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, RoomError> {
        self.0.is_purged(ctx, doc_id)
    }
    fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, RoomError> {
        self.0.list_lineages(ctx, doc_id)
    }
    fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, RoomError> {
        self.0.read_baseline(ctx, doc_id, lineage)
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        Box::new(self.0.read_headers(ctx, doc_id, lineage).map(|header| {
            header.map(|mut header| {
                header.committed_at = UNIX_EPOCH + self.1 * header.sequence as u32;
                header
            })
        }))
    }
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
        self.0.read_records(ctx, doc_id, lineage, through)
    }
    fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, RoomError> {
        self.0.delete_lineage(ctx, doc_id, lineage)
    }
}

/// Answers the hooks from `can_read` and `cut`, and keeps who was asked.
fn hooked_room(can_read: bool, cut: Option<SystemTime>) -> (TestRoom, Arc<Mutex<Vec<String>>>) {
    hooked_room_spaced(can_read, cut, Duration::from_secs(86_400))
}

fn hooked_room_spaced(
    can_read: bool,
    cut: Option<SystemTime>,
    spacing: Duration,
) -> (TestRoom, Arc<Mutex<Vec<String>>>) {
    let (journal, dir) = new_local_journal();
    let r = new_test_room_on(
        Some(Arc::new(SpacedJournal(journal, spacing))),
        Some(dir),
        None,
        None,
    );
    r.docs.hold("d", SEED);
    let asked = Arc::new(Mutex::new(Vec::new()));
    let seen = asked.clone();
    let policy: HistoryPolicy = Arc::new(move |user, doc| {
        seen.lock().unwrap().push(format!("{user} {doc}"));
        Box::pin(async move {
            Ok(HistoryAccess {
                can_read,
                window: cut.map(|cut| SystemTime::now().duration_since(cut).unwrap()),
            })
        })
    });
    (r.with_policy(policy), asked)
}

async fn edit_twice(r: &TestRoom) -> String {
    ok_in(
        r,
        "d",
        r#"{"commands":[{"name":"text.replace","args":{"id":"p","with":"One"}}]}"#,
    )
    .await;
    let second = ok_in(
        r,
        "d",
        r#"{"commands":[{"name":"text.replace","args":{"id":"p","with":"Two"}}]}"#,
    )
    .await;
    second.revision[..second.revision.rfind(':').unwrap()].to_owned()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_window_hides_older_versions_from_an_agent() {
    // Records 1 and 2 land at the epoch plus 1 and 2 days: the cut hides
    // record 1 and the baseline below it.
    let (r, asked) = hooked_room(true, Some(UNIX_EPOCH + Duration::from_secs(36 * 3600)));
    let lineage = edit_twice(&r).await;
    let head = r.head("d").await;

    let (listed, code) = run_in(
        &r,
        "d",
        r#"{"commands":[{"name":"history.versions","args":{"group":1}}]}"#,
        &room_agent(),
    )
    .await;
    assert!(code.is_empty(), "list: {}", listed.result_json);
    let parsed = must_parse(&listed.result_json);
    let versions = lookup(
        lookup(Some(&parsed), "results").and_then(|r| r.items.first()),
        "versions",
    )
    .unwrap();
    assert_eq!(versions.items.len(), 1, "{}", listed.result_json);
    assert_eq!(
        string_of(lookup(versions.items.first(), "version")),
        Some(format!("{lineage}:2"))
    );
    let read =
        format!(r#"{{"commands":[{{"name":"history.read","args":{{"version":"{lineage}:1"}}}}]}}"#);
    assert_eq!(
        run_in(&r, "d", &read, &room_agent()).await.1,
        "INVALID_ARGS"
    );
    let restore = format!(
        r#"{{"commands":[{{"name":"history.restore","args":{{"version":"{lineage}:1"}}}}]}}"#
    );
    assert_eq!(
        run_in(&r, "d", &restore, &room_agent()).await.1,
        "VERSION_NOT_FOUND"
    );
    assert_eq!(r.head("d").await, head, "the hidden restore wrote");
    assert_eq!(
        asked.lock().unwrap().first().map(String::as_str),
        Some("agent-cs d")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_hook_that_says_no_refuses_an_agents_list_read_and_restore() {
    let (r, _) = hooked_room(false, None);
    let lineage = edit_twice(&r).await;

    let (_, code) = run_in(
        &r,
        "d",
        r#"{"commands":[{"name":"history.versions","args":{}}]}"#,
        &room_agent(),
    )
    .await;
    assert_eq!(code, "TOOL_ACTION_FAILED");
    let read =
        format!(r#"{{"commands":[{{"name":"history.read","args":{{"version":"{lineage}:0"}}}}]}}"#);
    assert_eq!(
        run_in(&r, "d", &read, &room_agent()).await.1,
        "TOOL_ACTION_FAILED"
    );
    let restore = format!(
        r#"{{"commands":[{{"name":"history.restore","args":{{"version":"{lineage}:0"}}}}]}}"#
    );
    let head = r.head("d").await;
    let (restored, code) = run_in(&r, "d", &restore, &room_agent()).await;
    assert_eq!(
        code, "TOOL_ACTION_FAILED",
        "restore: {}",
        restored.result_json
    );
    assert_eq!(r.head("d").await, head, "the refused restore wrote");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_agent_acting_for_a_person_is_asked_about_as_that_person() {
    let (r, asked) = hooked_room(true, None);
    let actor = Actor {
        on_behalf_of: Some("person-1".to_owned()),
        ..room_agent()
    };

    run_in(
        &r,
        "d",
        r#"{"commands":[{"name":"history.versions","args":{}}]}"#,
        &actor,
    )
    .await;

    assert_eq!(*asked.lock().unwrap(), vec!["person-1 d".to_owned()]);
}

// A group that straddles the cut shows only its visible records to an agent.
#[tokio::test(flavor = "multi_thread")]
async fn an_agents_list_shows_nothing_of_a_hidden_record() {
    // Records 1 and 2 land a minute apart, in one 15-minute group; the cut
    // hides 1.
    let (r, _) = hooked_room_spaced(
        true,
        Some(UNIX_EPOCH + Duration::from_secs(90)),
        Duration::from_secs(60),
    );
    let lineage = edit_twice(&r).await;

    let (listed, code) = run_in(
        &r,
        "d",
        r#"{"commands":[{"name":"history.versions","args":{"group":15}}]}"#,
        &room_agent(),
    )
    .await;
    assert!(code.is_empty(), "list: {}", listed.result_json);
    let parsed = must_parse(&listed.result_json);
    let versions = lookup(
        lookup(Some(&parsed), "results").and_then(|r| r.items.first()),
        "versions",
    )
    .unwrap();
    assert_eq!(versions.items.len(), 1, "{}", listed.result_json);
    assert_eq!(
        string_of(lookup(versions.items.first(), "version")),
        Some(format!("{lineage}:2"))
    );
    assert_eq!(
        std::str::from_utf8(lookup(versions.items.first(), "startedAt").unwrap().raw()).unwrap(),
        "120000",
        "{}",
        listed.result_json
    );
}
