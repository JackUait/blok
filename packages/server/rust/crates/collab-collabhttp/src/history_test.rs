use blok_collab_room::MAX_CHANGE_BYTES;
use blok_jsjson::{Str, Value, parse};

use crate::test_support::{Answer, Failure, start_history};

// Twins of C# HistoryEndpointTests cases that had no Go or TS proof: the
// answer's byte cap after HTML is read, a restore pinned with If-Match, and
// the 503 for an export past the runtime's limits.

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => object.get(&Str::from(key)),
        _ => None,
    }
}

fn number(value: Option<&Value>) -> u64 {
    match value {
        Some(Value::Number(n)) => *n as u64,
        Some(Value::BigInt(n)) => *n as u64,
        other => panic!("not a number: {other:?}"),
    }
}

fn change_sequences(body: &[u8]) -> (Vec<u64>, bool) {
    let parsed = parse(body).unwrap_or_else(|err| {
        panic!(
            "{err}: {:.200}",
            String::from_utf8_lossy(body)
                .chars()
                .take(200)
                .collect::<String>()
        )
    });
    let Some(Value::Array(changes)) = field(&parsed, "changes") else {
        panic!("no changes array");
    };
    let sequences = changes
        .iter()
        .map(|change| number(field(change, "sequence")))
        .collect();
    let truncated = matches!(field(&parsed, "truncated"), Some(Value::Bool(true)));
    (sequences, truncated)
}

// Reading a row's HTML can make it larger than the replay measured; the
// answer still keeps to the budget.
#[tokio::test(flavor = "multi_thread")]
async fn rows_that_grow_when_their_html_is_read_still_keep_to_the_byte_budget() {
    let history = start_history().await;
    let lineage = history.open().await;
    history
        .edit(
            "insert",
            r#"{ "ops": [ { "op": "insert", "id": "b", "block": { "type": "rawblob", "data": { "blob": "0" } } } ] }"#,
        )
        .await;
    for edit in 1..=4 {
        history
            .edit(
                &format!("blob-{edit}"),
                &format!(
                    r#"{{ "ops": [ {{ "op": "update", "id": "b", "data": {{ "blob": "{edit}" }} }} ] }}"#
                ),
            )
            .await;
    }

    history
        .converter
        .set(Failure::None, Some("z".repeat(1_000_000)));
    let response = history
        .send(
            "GET",
            &format!("/history/{lineage}/5/changes?since=0"),
            "",
            "",
            "",
        )
        .await;

    assert!(
        response.body.len() as i64 <= MAX_CHANGE_BYTES,
        "{} bytes, past the {MAX_CHANGE_BYTES} budget",
        response.body.len()
    );
    let (sequences, truncated) = change_sequences(&response.body);
    assert!(truncated, "the answer does not say truncated");
    assert_eq!(sequences, vec![4, 5]);
    history.drain().await;
}

// An agent pins its restore to the newest listed version: that point is the
// If-Match head until the room moves.
#[tokio::test(flavor = "multi_thread")]
async fn a_restore_pinned_to_the_newest_listed_version_lands_until_the_room_moves() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    history.edit_text("three").await;
    let newest = || async {
        let list = history.send("GET", "/history", "", "", "").await;
        let parsed = parse(&list.body).unwrap_or_else(|err| panic!("{err}: {}", list.text()));
        let Some(Value::Array(versions)) = field(&parsed, "versions") else {
            panic!("list = {} {}", list.status, list.text());
        };
        let first = versions.first().expect("a version");
        let Some(Value::String(lineage)) = field(first, "lineage") else {
            panic!("no lineage");
        };
        format!("\"{}:{}\"", lineage, number(field(first, "sequence")))
    };

    let landed = history
        .restore(&lineage, "1", "pinned-current", &newest().await)
        .await;
    assert_eq!(landed.status, 204, "pinned restore = {}", landed.text());
    let restored = history.blocks().await;
    assert!(
        restored.contains("two") && !restored.contains("three"),
        "restored = {restored}"
    );

    let again = newest().await;
    history.edit_text("peer").await;
    let stale = history.restore(&lineage, "0", "pinned-stale", &again).await;
    assert!(
        stale.status == 412 && stale.text() == "the document is no longer at the If-Match head\n",
        "stale restore = {} {:?}",
        stale.status,
        stale.text()
    );
    assert!(
        history.blocks().await.contains("peer"),
        "the stale restore landed"
    );
    history.drain().await;
}

// As /state: an export past the runtime's limits may pass on a retry; one
// that never can is a 500.
#[tokio::test(flavor = "multi_thread")]
async fn an_export_past_the_runtimes_limits_is_a_retryable503() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;

    history.converter.set(Failure::Transient, None);
    let overloaded = history
        .send("GET", &format!("/history/{lineage}/0"), "", "", "")
        .await;
    let restore_overloaded = history.restore(&lineage, "0", "overloaded", "").await;
    let changes_overloaded = history
        .send("GET", &format!("/history/{lineage}/1/changes"), "", "", "")
        .await;
    history.converter.set(Failure::NotJson, None);
    let failed = history
        .send("GET", &format!("/history/{lineage}/0"), "", "", "")
        .await;
    let changes_failed = history
        .send("GET", &format!("/history/{lineage}/1/changes"), "", "", "")
        .await;
    history.converter.set(Failure::None, None);

    let retry = "the server ran past its limits exporting this version, retry\n";
    let check_overloaded = |name: &str, a: &Answer| {
        assert!(
            a.status == 503 && a.text() == retry && a.header("Retry-After") == "2",
            "{name} overloaded = {} {:?} Retry-After {:?}",
            a.status,
            a.text(),
            a.header("Retry-After")
        );
    };
    check_overloaded("changes", &changes_overloaded);
    check_overloaded("read", &overloaded);
    assert!(
        restore_overloaded.status == 503 && restore_overloaded.header("Retry-After") == "2",
        "restore overloaded = {} {:?} Retry-After {:?}",
        restore_overloaded.status,
        restore_overloaded.text(),
        restore_overloaded.header("Retry-After")
    );
    for (name, a) in [("changes", &changes_failed), ("read", &failed)] {
        assert!(
            a.status == 500 && a.text() == "the version could not be exported\n",
            "{name} failed = {} {:?}",
            a.status,
            a.text()
        );
    }
    assert_eq!(
        failed.header("Retry-After"),
        "",
        "a failed export says retry"
    );
    history.drain().await;
}
