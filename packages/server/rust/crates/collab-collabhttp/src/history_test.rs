use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_collab_room::{MAX_CHANGE_BYTES, MAX_CHANGE_RECORDS};
use blok_jsjson::{Str, Value, parse};

use crate::test_support::{Answer, App, AppOptions, Failure, start_app, start_history};

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

// The rest of HistoryEndpointTests, over the real converter and journal.

const UNKNOWN_LINEAGE: &str = "ffffffffffffffffffffffffffffffff";

fn json(answer: &Answer) -> Value {
    parse(&answer.body).unwrap_or_else(|err| panic!("{err}: {}", answer.text()))
}

fn at<'a>(value: &'a Value, path: &[&str]) -> &'a Value {
    path.iter().fold(value, |value, key| {
        field(value, key).unwrap_or_else(|| panic!("no {key} in {value:?}"))
    })
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    match field(value, key) {
        Some(Value::Array(items)) => items,
        other => panic!("{key} is not an array: {other:?}"),
    }
}

fn keys(value: &Value) -> Vec<String> {
    match value {
        Value::Object(object) => object
            .members()
            .iter()
            .map(|member| member.key.to_string())
            .collect(),
        other => panic!("not an object: {other:?}"),
    }
}

fn string(value: &Value) -> String {
    match value {
        Value::String(text) => text.to_string(),
        other => panic!("not a string: {other:?}"),
    }
}

fn assert_unix_milliseconds(value: Option<&Value>) {
    let millis = number(value);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let low = (now - Duration::from_secs(300)).as_millis() as u64;
    let high = (now + Duration::from_secs(60)).as_millis() as u64;
    assert!((low..=high).contains(&millis), "{millis} is not near now");
}

fn sequences(changes: &[Value]) -> Vec<u64> {
    changes
        .iter()
        .map(|change| number(field(change, "sequence")))
        .collect()
}

async fn state_blocks(app: &App) -> Vec<Value> {
    let state = app.send("GET", "/state", "", "", "").await;
    assert_eq!(state.status, 200, "state = {}", state.text());
    array(&json(&state), "blocks").to_vec()
}

fn assert_no_store(name: &str, answer: &Answer) {
    assert_eq!(answer.header("Cache-Control"), "no-store", "{name}");
}

fn assert_error(answer: &Answer, status: u16, body: &str) {
    assert_eq!(
        (answer.status, answer.text().as_str()),
        (status, body),
        "headers {:?}",
        answer.headers
    );
}

const TICKET: [(&str, &str); 2] = [("X-User", "u1"), ("X-Doc", "doc")];

async fn ticket_edit(app: &App, key: &str, body: &str) {
    let mut headers = vec![("Blok-Idempotency-Key", key)];
    headers.extend(TICKET);
    let response = app.request("POST", "/edit", &headers, body).await;
    assert_eq!(response.status, 204, "edit {key} = {}", response.text());
}

async fn ticket_lineage(app: &App) -> String {
    let state = app.request("GET", "/state", &TICKET, "").await;
    assert_eq!(state.status, 200, "state = {}", state.text());
    state.header("Blok-Doc-Lineage").to_owned()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_list_names_every_lineage_and_its_versions() {
    let history = start_app(AppOptions {
        journal: true,
        ticket_mode: true,
        ..AppOptions::default()
    })
    .await;
    let first = ticket_lineage(&history).await;
    ticket_edit(
        &history,
        "text-two",
        r#"{ "ops": [ { "op": "update", "id": "a", "data": { "text": "two" } } ] }"#,
    )
    .await;
    let reset = history.request("POST", "/reset", &TICKET, "").await;
    assert_eq!(reset.status, 204, "reset = {}", reset.text());
    let second = ticket_lineage(&history).await;

    let response = history.request("GET", "/history", &TICKET, "").await;

    assert_eq!(response.status, 200, "{}", response.text());
    assert_eq!(response.header("Content-Type"), "application/json");
    assert_no_store("list", &response);
    let body = json(&response);
    assert_eq!(keys(&body), ["lineages", "versions"]);
    let lineages = array(&body, "lineages");
    assert_eq!(
        lineages
            .iter()
            .map(|entry| string(at(entry, &["lineage"])))
            .collect::<Vec<_>>(),
        [first.clone(), second.clone()]
    );
    assert_eq!(
        lineages
            .iter()
            .map(|entry| at(entry, &["current"]).clone())
            .collect::<Vec<_>>(),
        [Value::Bool(false), Value::Bool(true)]
    );
    let lineage = &lineages[0];
    assert_eq!(
        keys(lineage),
        ["lineage", "epoch", "format", "createdAt", "current"]
    );
    assert!(matches!(field(lineage, "epoch"), Some(Value::Number(n)) if *n >= 0.0));
    assert_eq!(
        number(field(lineage, "format")),
        blok_collab_workingset::CURRENT_FORMAT as u64
    );
    assert_unix_milliseconds(field(lineage, "createdAt"));

    let versions = array(&body, "versions");
    assert_eq!(
        versions
            .iter()
            .map(|entry| (
                string(at(entry, &["lineage"])),
                number(field(entry, "sequence"))
            ))
            .collect::<Vec<_>>(),
        [(second, 0), (first.clone(), 1), (first, 0)]
    );
    let edited = &versions[1];
    assert_eq!(
        keys(edited),
        ["lineage", "sequence", "startedAt", "savedAt", "actors"]
    );
    assert_unix_milliseconds(field(edited, "startedAt"));
    assert_unix_milliseconds(field(edited, "savedAt"));
    assert_eq!(
        array(edited, "actors")
            .iter()
            .map(string)
            .collect::<Vec<_>>(),
        ["u1"]
    );
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_group_query_chooses_the_grouping_window() {
    let history = start_history().await;
    history.open().await;
    history.edit_text("two").await;
    history.edit_text("three").await;
    let journal = history.journal.as_deref().unwrap();
    *journal.header_spacing.lock().unwrap() = Some(Duration::from_secs(90));

    let versions = |query: &'static str| {
        let history = &history;
        async move {
            let response = history
                .send("GET", &format!("/history{query}"), "", "", "")
                .await;
            assert_eq!(response.status, 200, "{query}: {}", response.text());
            sequences(array(&json(&response), "versions"))
        }
    };

    assert_eq!(versions("").await, [2, 0]);
    assert_eq!(versions("?group=1").await, [2, 1, 0]);
    assert_eq!(versions("?group=15").await, [2, 0]);
    assert_eq!(versions("?group=60").await, [2, 0]);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_group_other_than_one_fifteen_or_sixty_is_a_bad_request() {
    let history = start_history().await;
    history.open().await;
    for query in [
        "?group=",
        "?group=0",
        "?group=5",
        "?group=-1",
        "?group=%2B1",
        "?group=%201",
        "?group=one",
        "?group=1&group=1",
    ] {
        let response = history
            .send("GET", &format!("/history{query}"), "", "", "")
            .await;

        assert_error(&response, 400, "group must be 1, 15 or 60\n");
        assert_no_store(query, &response);
    }
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_serves_the_version_with_its_point_and_no_entity_tag() {
    let history = start_history().await;
    let lineage = history.open().await;
    let at_zero = state_blocks(&history).await;
    history.edit_text("two").await;

    let response = history
        .send("GET", &format!("/history/{lineage}/0"), "", "", "")
        .await;

    assert_eq!(response.status, 200, "{}", response.text());
    assert_eq!(response.header("Content-Type"), "application/json");
    assert_no_store("read", &response);
    assert_eq!(response.header("Blok-History-Lineage"), lineage);
    assert_eq!(response.header("Blok-History-Sequence"), "0");
    for absent in ["ETag", "Blok-Doc-Lineage", "Blok-Doc-Sequence"] {
        assert!(
            !response
                .headers
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case(absent)),
            "{absent} is set"
        );
    }
    let body = json(&response);
    assert_eq!(array(&body, "blocks"), at_zero.as_slice());
    assert_unix_milliseconds(field(&body, "time"));
    assert!(field(&body, "page").is_none());
    assert!(field(&body, "values").is_none());
    history.drain().await;
}

/// Sends one v1 SyncUpdate written by write on the mirror, then waits for
/// the record.
async fn send_write(
    history: &App,
    sequence: u64,
    write: impl FnOnce(&blok_yjs::Doc, &blok_yjs::Transaction<'_>) -> Result<(), blok_yjs::EngineError>,
) {
    let (_member, membership, mirror) = history.connect().await;
    let update = mirror
        .transact(|txn| write(&mirror, txn))
        .unwrap()
        .expect("an update");
    let frame =
        blok_collab_wire::encode(&blok_collab_wire::Message::SyncUpdate { update }).unwrap();
    membership.receive(frame).await.unwrap();
    history.wait_for_sequence(sequence).await;
    membership.leave();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_carries_the_plain_keys_of_the_page_and_values_maps() {
    let history = start_history().await;
    let lineage = history.open().await;
    send_write(&history, 1, |mirror, txn| {
        let page = mirror.get_map("page")?;
        let values = mirror.get_map("values")?;
        let icon: blok_jsjson::Object = [
            (Str::from("type"), Value::String(Str::from("emoji"))),
            (Str::from("value"), Value::String(Str::from("🚀"))),
        ]
        .into_iter()
        .collect();
        page.set(txn, "title", Value::String(Str::from("Plan")))?;
        page.set(txn, "icon", Value::Object(icon))?;
        page.set(txn, "cover", Value::String(Str::from("blue")))?;
        values.set(txn, "title", Value::String(Str::from("Old title")))?;
        values.set(txn, "nested", blok_yjs::Map::new(Vec::new()))?;
        values.set(txn, "gone", Value::Undefined)
    })
    .await;

    let response = history
        .send("GET", &format!("/history/{lineage}/1"), "", "", "")
        .await;

    assert_eq!(response.status, 200, "{}", response.text());
    let body = json(&response);
    assert_eq!(string(at(&body, &["title"])), "Plan");
    assert_eq!(
        at(&body, &["icon"]),
        &parse(r#"{"type":"emoji","value":"🚀"}"#.as_bytes()).unwrap()
    );
    assert_eq!(
        blok_jsjson::stringify(at(&body, &["page"])).unwrap(),
        r#"{"cover":"blue"}"#
    );
    assert_eq!(
        blok_jsjson::stringify(at(&body, &["values"])).unwrap(),
        r#"{"title":"Old title"}"#
    );
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_of_an_unknown_point_is_not_found() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;

    let past_head = history
        .send("GET", &format!("/history/{lineage}/2"), "", "", "")
        .await;
    let unknown = history
        .send("GET", &format!("/history/{UNKNOWN_LINEAGE}/0"), "", "", "")
        .await;

    assert_eq!(past_head.status, 404, "{}", past_head.text());
    assert_eq!(unknown.status, 404, "{}", unknown.text());
    assert_no_store("past head", &past_head);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sequence_that_is_not_an_unsigned_long_is_a_bad_request() {
    let history = start_history().await;
    let lineage = history.open().await;
    for sequence in ["one", "-1", "%2B1", "18446744073709551616"] {
        let read = history
            .send("GET", &format!("/history/{lineage}/{sequence}"), "", "", "")
            .await;
        let restore = history
            .restore(&lineage, sequence, "bad-sequence", "")
            .await;

        assert_eq!(read.status, 400, "read {sequence}: {}", read.text());
        assert_eq!(
            restore.status,
            400,
            "restore {sequence}: {}",
            restore.text()
        );
    }
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_list_each_records_edits_oldest_first() {
    let history = start_app(AppOptions {
        journal: true,
        ticket_mode: true,
        ..AppOptions::default()
    })
    .await;
    let lineage = ticket_lineage(&history).await;
    let blocks = || async {
        let state = history.request("GET", "/state", &TICKET, "").await;
        array(&json(&state), "blocks").to_vec()
    };
    let at_zero = blocks().await;
    ticket_edit(
        &history,
        "text-two",
        r#"{ "ops": [ { "op": "update", "id": "a", "data": { "text": "two" } } ] }"#,
    )
    .await;
    ticket_edit(
        &history,
        "insert-header",
        r#"{ "ops": [ { "op": "insert", "id": "b", "after": "a", "block": { "type": "header", "data": { "text": "h", "level": 2 } } } ] }"#,
    )
    .await;
    let at_two = blocks().await;

    let path = format!("/history/{lineage}/2/changes");
    let response = history.request("GET", &path, &TICKET, "").await;
    let since = history
        .request("GET", &format!("{path}?since=1"), &TICKET, "")
        .await;

    assert_eq!(response.status, 200, "{}", response.text());
    assert_eq!(response.header("Content-Type"), "application/json");
    assert_no_store("changes", &response);
    assert_eq!(response.header("Blok-History-Lineage"), lineage);
    assert_eq!(response.header("Blok-History-Sequence"), "2");
    let body = json(&response);
    assert_eq!(keys(&body), ["changes"]);
    let changes = array(&body, "changes");
    assert_eq!(sequences(changes), [1, 2]);

    let first = &changes[0];
    assert_eq!(keys(first), ["sequence", "committedAt", "actor", "blocks"]);
    assert_unix_milliseconds(field(first, "committedAt"));
    assert_eq!(string(at(first, &["actor"])), "u1");
    let changed = array(first, "blocks");
    assert_eq!(changed.len(), 1);
    let changed = &changed[0];
    assert_eq!(keys(changed), ["id", "type", "kind", "before", "after"]);
    assert_eq!(
        ["id", "type", "kind"].map(|key| string(at(changed, &[key]))),
        ["a", "paragraph", "changed"]
    );
    assert_eq!(at(changed, &["before"]), &at_zero[0]);

    let added = array(&changes[1], "blocks");
    assert_eq!(added.len(), 1);
    let added = &added[0];
    assert_eq!(keys(added), ["id", "type", "kind", "after"]);
    assert_eq!(
        ["id", "type", "kind"].map(|key| string(at(added, &[key]))),
        ["b", "header", "added"]
    );
    assert_eq!(at(added, &["after"]), &at_two[1]);

    assert_eq!(since.status, 200, "{}", since.text());
    assert_eq!(sequences(array(&json(&since), "changes")), [2]);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_name_page_keys_only_for_a_record_that_changed_them() {
    let history = start_history().await;
    let lineage = history.open().await;
    send_write(&history, 1, |mirror, txn| {
        mirror
            .get_map("page")?
            .set(txn, "title", Value::String(Str::from("Plan")))?;
        mirror.get_map("values")?.set(txn, "k", Value::Number(1.0))
    })
    .await;
    history.edit_text("two").await;

    let response = history
        .send("GET", &format!("/history/{lineage}/2/changes"), "", "", "")
        .await;

    assert_eq!(response.status, 200, "{}", response.text());
    let body = json(&response);
    let changes = array(&body, "changes");
    assert_eq!(
        blok_jsjson::stringify(at(&changes[0], &["page"])).unwrap(),
        r#"["title","values.k"]"#
    );
    assert!(array(&changes[0], "blocks").is_empty());
    assert!(field(&changes[1], "page").is_none(), "{:?}", changes[1]);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_block_changed_in_two_records_in_a_row_reads_the_same_in_both() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    let at_one = state_blocks(&history).await;
    history.edit_text("three").await;
    let at_two = state_blocks(&history).await;

    let response = history
        .send("GET", &format!("/history/{lineage}/2/changes"), "", "", "")
        .await;

    assert_eq!(response.status, 200, "{}", response.text());
    let body = json(&response);
    let changes = array(&body, "changes");
    let block = |row: usize| &array(&changes[row], "blocks")[0];
    assert_eq!(at(block(0), &["after"]), &at_one[0]);
    assert_eq!(at(block(1), &["before"]), &at_one[0]);
    assert_eq!(at(block(1), &["after"]), &at_two[0]);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_past_the_cap_are_the_newest_and_say_truncated() {
    let history = start_history().await;
    let lineage = history.open().await;
    for edit in 1..=MAX_CHANGE_RECORDS + 1 {
        history.edit_text(&format!("v{edit}")).await;
    }

    let at_cap = history
        .send(
            "GET",
            &format!("/history/{lineage}/{MAX_CHANGE_RECORDS}/changes"),
            "",
            "",
            "",
        )
        .await;
    let over_cap = history
        .send(
            "GET",
            &format!("/history/{lineage}/{}/changes", MAX_CHANGE_RECORDS + 1),
            "",
            "",
            "",
        )
        .await;

    let under = json(&at_cap);
    assert!(field(&under, "truncated").is_none());
    assert_eq!(array(&under, "changes").len(), MAX_CHANGE_RECORDS);
    let over = json(&over_cap);
    assert_eq!(field(&over, "truncated"), Some(&Value::Bool(true)));
    let rows = array(&over, "changes");
    assert_eq!(rows.len(), MAX_CHANGE_RECORDS);
    assert_eq!(number(field(&rows[0], "sequence")), 2);
    let before = at(&array(&rows[0], "blocks")[0], &["before", "data", "text"]);
    assert_eq!(
        blok_jsjson::stringify(before).unwrap(),
        r#"[{"text":"v1"}]"#
    );
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_past_the_byte_budget_are_the_newest_and_the_rest_come_by_paging() {
    let history = start_history().await;
    let lineage = history.open().await;
    history
        .edit(
            "insert",
            r#"{ "ops": [ { "op": "insert", "id": "b", "block": { "type": "rawblob", "data": { "blob": "x" } } } ] }"#,
        )
        .await;
    for edit in 0..6u8 {
        let blob = char::from(b'a' + edit).to_string().repeat(600_000);
        history
            .edit(
                &format!("blob-{edit}"),
                &format!(
                    r#"{{ "ops": [ {{ "op": "update", "id": "b", "data": {{ "blob": "{blob}" }} }} ] }}"#
                ),
            )
            .await;
    }

    let first = history
        .send(
            "GET",
            &format!("/history/{lineage}/7/changes?since=0"),
            "",
            "",
            "",
        )
        .await;

    assert_eq!(first.status, 200, "{}", first.status);
    assert!(
        first.body.len() as i64 <= MAX_CHANGE_BYTES,
        "{} bytes",
        first.body.len()
    );
    let mut body = json(&first);
    assert_eq!(field(&body, "truncated"), Some(&Value::Bool(true)));
    let mut collected = sequences(array(&body, "changes"));
    assert_eq!(collected.last(), Some(&7));

    // Records have no gaps, so the next page ends just below the oldest row.
    while field(&body, "truncated").is_some() {
        let next = history
            .send(
                "GET",
                &format!("/history/{lineage}/{}/changes?since=0", collected[0] - 1),
                "",
                "",
                "",
            )
            .await;
        assert_eq!(next.status, 200, "{}", next.status);
        body = json(&next);
        let mut page = sequences(array(&body, "changes"));
        page.extend(collected);
        collected = page;
    }

    assert_eq!(collected, [1, 2, 3, 4, 5, 6, 7]);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_of_the_baseline_are_empty_and_an_unknown_point_is_not_found() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;

    let baseline = history
        .send("GET", &format!("/history/{lineage}/0/changes"), "", "", "")
        .await;
    let past_head = history
        .send("GET", &format!("/history/{lineage}/2/changes"), "", "", "")
        .await;
    let unknown = history
        .send(
            "GET",
            &format!("/history/{UNKNOWN_LINEAGE}/0/changes"),
            "",
            "",
            "",
        )
        .await;

    assert_eq!(baseline.status, 200);
    assert_eq!(baseline.text(), r#"{"changes":[]}"#);
    assert_error(&past_head, 404, "no such version\n");
    assert_error(&unknown, 404, "no such version\n");
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_with_a_bad_since_or_sequence_are_a_bad_request() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    for path in [
        "1/changes?since=2",
        "1/changes?since=",
        "1/changes?since=-1",
        "1/changes?since=%2B1",
        "1/changes?since=one",
        "1/changes?since=0&since=0",
        "one/changes",
    ] {
        let response = history
            .send("GET", &format!("/history/{lineage}/{path}"), "", "", "")
            .await;

        assert_eq!(response.status, 400, "{path}: {}", response.text());
        assert_no_store(path, &response);
    }
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_delete_removes_an_old_lineage_and_refuses_the_current_one() {
    let history = start_history().await;
    let old = history.open().await;
    let reset = history.send("POST", "/reset", "", "", "").await;
    assert_eq!(reset.status, 204, "reset = {}", reset.text());
    let current = history.open().await;

    let deleted = history
        .send("DELETE", &format!("/history/{old}"), "", "", "")
        .await;
    let again = history
        .send("DELETE", &format!("/history/{old}"), "", "", "")
        .await;
    let refused = history
        .send("DELETE", &format!("/history/{current}"), "", "", "")
        .await;

    assert_eq!(deleted.status, 204, "{}", deleted.text());
    assert_no_store("delete", &deleted);
    assert_eq!(again.status, 404, "{}", again.text());
    assert_eq!(refused.status, 409, "{}", refused.text());
    let list = history.send("GET", "/history", "", "", "").await;
    assert_eq!(
        array(&json(&list), "lineages")
            .iter()
            .map(|entry| string(at(entry, &["lineage"])))
            .collect::<Vec<_>>(),
        [current]
    );
    history.drain().await;
}

fn without_stamps(blocks: &[Value]) -> Vec<Value> {
    blocks
        .iter()
        .map(|block| match block {
            Value::Object(object) => Value::Object(
                object
                    .members()
                    .iter()
                    .filter(|member| {
                        member.key != Str::from("lastEditedAt")
                            && member.key != Str::from("lastEditedBy")
                    })
                    .map(|member| (member.key.clone(), member.value.clone()))
                    .collect(),
            ),
            other => other.clone(),
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_makes_the_live_document_equal_the_version() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    let version = history
        .send("GET", &format!("/history/{lineage}/0"), "", "", "")
        .await;
    let version_blocks = array(&json(&version), "blocks").to_vec();

    let restore = history.restore(&lineage, "0", "restore-zero", "").await;

    assert_eq!(restore.status, 204, "{}", restore.text());
    assert_no_store("restore", &restore);
    assert_eq!(restore.header("Blok-Doc-Lineage"), lineage);
    assert_eq!(restore.header("Blok-Doc-Sequence"), "2");
    assert_eq!(
        without_stamps(&version_blocks),
        without_stamps(&state_blocks(&history).await)
    );
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_reusing_a_key_for_another_point_is_a_conflict() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    history.edit_text("three").await;

    let first = history.restore(&lineage, "0", "restore-key", "").await;
    let other = history.restore(&lineage, "1", "restore-key", "").await;

    assert_eq!(first.status, 204, "{}", first.text());
    assert_error(
        &other,
        409,
        "the idempotency key was already used for a different edit\n",
    );
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_of_an_unknown_point_is_not_found() {
    let history = start_history().await;
    let lineage = history.open().await;

    let past_head = history.restore(&lineage, "1", "restore-past", "").await;
    let unknown = history
        .restore(UNKNOWN_LINEAGE, "0", "restore-unknown", "")
        .await;

    assert_eq!(past_head.status, 404, "{}", past_head.text());
    assert_eq!(unknown.status, 404, "{}", unknown.text());
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_behind_a_stale_if_match_is_refused() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;

    let stale = history
        .restore(&lineage, "0", "restore-stale", &format!("\"{lineage}:0\""))
        .await;
    let malformed = history
        .restore(&lineage, "0", "restore-malformed", "*")
        .await;
    let current = history
        .restore(
            &lineage,
            "0",
            "restore-current",
            &format!("\"{lineage}:1\""),
        )
        .await;

    assert_error(
        &stale,
        412,
        "the document is no longer at the If-Match head\n",
    );
    assert_eq!(stale.header("Blok-Doc-Sequence"), "1");
    assert_eq!(malformed.status, 400, "{}", malformed.text());
    assert_eq!(current.status, 204, "{}", current.text());
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_malformed_lineage_is_not_found_and_never_reaches_the_store() {
    for lineage in ["..%2Fx", "abc", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"] {
        let history = start_history().await;
        history.open().await;

        let read = history
            .send("GET", &format!("/history/{lineage}/0"), "", "", "")
            .await;
        let delete = history
            .send("DELETE", &format!("/history/{lineage}"), "", "", "")
            .await;
        let restore = history
            .restore(lineage, "0", "restore-malformed-lineage", "")
            .await;

        for (name, response) in [("read", &read), ("delete", &delete), ("restore", &restore)] {
            assert_eq!(
                (response.status, response.text().as_str()),
                (404, "no such version\n"),
                "{name} {lineage}"
            );
        }
        let journal = history.journal.as_deref().unwrap();
        assert!(
            journal.lineages_asked.lock().unwrap().is_empty(),
            "{lineage}: asked {:?}",
            journal.lineages_asked.lock().unwrap()
        );
        history.drain().await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn every_route_needs_a_journal_that_keeps_history() {
    let no_journal = start_app(AppOptions::default()).await;
    let journal_only = start_app(AppOptions {
        journal: true,
        no_history: true,
        ..AppOptions::default()
    })
    .await;
    for (name, app) in [("no journal", &no_journal), ("journal only", &journal_only)] {
        for (method, path, key) in [
            ("GET", "/history".to_owned(), ""),
            ("GET", format!("/history/{UNKNOWN_LINEAGE}/0"), ""),
            ("DELETE", format!("/history/{UNKNOWN_LINEAGE}"), ""),
            (
                "POST",
                format!("/history/{UNKNOWN_LINEAGE}/0/restore"),
                "no-history",
            ),
            ("GET", format!("/history/{UNKNOWN_LINEAGE}/0/changes"), ""),
        ] {
            let response = app.send(method, &path, key, "", "").await;

            assert_eq!(
                (response.status, response.text().as_str()),
                (501, "history needs a journal that keeps it\n"),
                "{name}: {method} {path}"
            );
            assert_no_store(&path, &response);
        }
    }
    no_journal.drain().await;
    journal_only.drain().await;
}
