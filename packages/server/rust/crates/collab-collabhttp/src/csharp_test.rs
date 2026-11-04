use std::sync::atomic::Ordering;
use std::time::Duration;

use blok_jsjson::{Str, Value, parse};

use crate::test_support::{
    Answer, AppOptions, EditFailure, Failure, RecordingAuthorization, start_app, start_history,
};

// Twins of C# Edit, State, Reset and HistoryEndpointTests cases with no Go
// test and no collab-http-contract case. The guard's own refusals (missing
// or read-only pass) live in blokserver; here a test header signs the
// caller in, as the guard would.

const APPEND_ONE: &str = r#"{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "z": "ignored", "text": "!" } } } ] }"#;
const KEY_REQUIRED: &str = "a valid Blok-Idempotency-Key header is required\n";
const BAD_IF_MATCH: &str = "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n";

fn assert_error(answer: &Answer, status: u16, body: &str) {
    assert_eq!(
        (answer.status, answer.text().as_str()),
        (status, body),
        "headers {:?}",
        answer.headers
    );
}

fn journal() -> AppOptions {
    AppOptions {
        journal: true,
        ..AppOptions::default()
    }
}

fn ticket(authorization: &std::sync::Arc<RecordingAuthorization>) -> AppOptions {
    AppOptions {
        ticket_mode: true,
        authorization: Some(authorization.clone()),
        ..AppOptions::default()
    }
}

const COMPATIBLE: [(&str, &str); 2] = [("X-User", "u1"), ("X-Doc", "doc")];
const DOC_MISMATCH: [(&str, &str); 2] = [("X-User", "u1"), ("X-Doc", "other-doc")];

#[tokio::test(flavor = "multi_thread")]
async fn edit_requires_an_idempotency_key() {
    let app = start_app(AppOptions::default()).await;
    let long = "a".repeat(129);
    for key in [None, Some(""), Some("bad\u{7f}key"), Some(long.as_str())] {
        let headers: Vec<(&str, &str)> = key
            .map(|key| vec![("Blok-Idempotency-Key", key)])
            .unwrap_or_default();
        let answer = app.request("POST", "/edit", &headers, APPEND_ONE).await;
        assert_eq!(
            (answer.status, answer.text().as_str()),
            (400, KEY_REQUIRED),
            "key {key:?}"
        );
    }
    let multiple = app
        .request(
            "POST",
            "/edit",
            &[
                ("Blok-Idempotency-Key", "first"),
                ("Blok-Idempotency-Key", "second"),
            ],
            APPEND_ONE,
        )
        .await;
    assert_eq!(
        (multiple.status, multiple.text().as_str()),
        (400, KEY_REQUIRED)
    );
    let boundary = "~".repeat(128);
    let accepted = app.send("POST", "/edit", &boundary, "", APPEND_ONE).await;
    assert_eq!(accepted.status, 204, "{}", accepted.text());
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_malformed_if_match_answers400_before_the_room_is_touched() {
    let app = start_app(journal()).await;
    for if_match in [
        "*",
        "0123456789abcdef0123456789abcdef:1",
        "W/\"0123456789abcdef0123456789abcdef:1\"",
        "\"0123456789abcdef0123456789abcdef:1\", \"0123456789abcdef0123456789abcdef:2\"",
        "\"0123456789abcdef0123456789abcdef\"",
        "\"0123456789abcdef0123456789abcdef:\"",
        "\"0123456789abcdef0123456789abcdef:-1\"",
        "\"0123456789abcdef0123456789abcdef:01\"",
        "\"0123456789abcdef0123456789abcdef:1:2\"",
        "\"0123456789ABCDEF0123456789ABCDEF:1\"",
        "\"not-a-lineage:1\"",
        "\"\"",
    ] {
        let answer = app
            .send("POST", "/edit", "edit-key", if_match, APPEND_ONE)
            .await;
        assert_eq!(
            (answer.status, answer.text().as_str()),
            (400, BAD_IF_MATCH),
            "If-Match {if_match}"
        );
    }
    assert_eq!(app.endpoint.gets.load(Ordering::SeqCst), 0);
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn two_if_match_headers_answer400() {
    let app = start_app(journal()).await;
    let tag = format!("\"{}:0\"", "0".repeat(32));
    let answer = app
        .request(
            "POST",
            "/edit",
            &[
                ("Blok-Idempotency-Key", "edit-key"),
                ("If-Match", &tag),
                ("If-Match", &tag),
            ],
            APPEND_ONE,
        )
        .await;
    assert_eq!(answer.status, 400);
    assert_eq!(app.endpoint.gets.load(Ordering::SeqCst), 0);
    app.drain().await;
}

/// The actors of the newest version in the history list.
async fn newest_actors(app: &crate::test_support::App, headers: &[(&str, &str)]) -> Vec<String> {
    let list = app.request("GET", "/history", headers, "").await;
    let parsed = parse(&list.body).unwrap_or_else(|err| panic!("{err}: {}", list.text()));
    let Value::Object(object) = parsed else {
        panic!("not an object");
    };
    let Some(Value::Array(versions)) = object.get(&Str::from("versions")) else {
        panic!("no versions");
    };
    let Some(Value::Object(first)) = versions.first() else {
        panic!("no version");
    };
    let Some(Value::Array(actors)) = first.get(&Str::from("actors")) else {
        panic!("no actors");
    };
    actors
        .iter()
        .map(|actor| match actor {
            Value::String(s) => s.to_string(),
            other => panic!("{other:?}"),
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_journal_actor_comes_from_the_principal() {
    let ticket_app = start_app(AppOptions {
        journal: true,
        ticket_mode: true,
        ..AppOptions::default()
    })
    .await;
    let mut headers = vec![("Blok-Idempotency-Key", "ticket-actor")];
    headers.extend(COMPATIBLE);
    let response = ticket_app
        .request("POST", "/edit", &headers, APPEND_ONE)
        .await;
    assert_eq!(response.status, 204, "{}", response.text());
    assert_eq!(
        newest_actors(&ticket_app, &COMPATIBLE).await,
        vec!["u1".to_owned()]
    );
    ticket_app.drain().await;

    let principal_app = start_app(journal()).await;
    let response = principal_app
        .request(
            "POST",
            "/edit",
            &[
                ("Blok-Idempotency-Key", "principal-actor"),
                ("X-User", "stable-user"),
            ],
            APPEND_ONE,
        )
        .await;
    assert_eq!(response.status, 204, "{}", response.text());
    assert_eq!(
        newest_actors(&principal_app, &[]).await,
        vec!["stable-user".to_owned()]
    );
    principal_app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn in_ticket_mode_the_ticket_must_be_a_write_pass_for_this_document() {
    let app = start_app(AppOptions {
        ticket_mode: true,
        ..AppOptions::default()
    })
    .await;
    let mut mismatch = vec![("Blok-Idempotency-Key", "edit-key")];
    mismatch.extend(DOC_MISMATCH);
    let other = app.request("POST", "/edit", &mismatch, APPEND_ONE).await;
    assert_error(&other, 403, "pass is for another document\n");
    let mut compatible = vec![("Blok-Idempotency-Key", "edit-key")];
    compatible.extend(COMPATIBLE);
    let accepted = app.request("POST", "/edit", &compatible, APPEND_ONE).await;
    assert_eq!(accepted.status, 204, "{}", accepted.text());
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_consults_application_authorization_for_write() {
    let authorization = RecordingAuthorization::new(true, false);
    let app = start_app(ticket(&authorization)).await;
    let mut headers = vec![("Blok-Idempotency-Key", "edit-key")];
    headers.extend(COMPATIBLE);

    let denied = app.request("POST", "/edit", &headers, APPEND_ONE).await;
    assert_error(&denied, 403, "forbidden\n");
    assert!(
        authorization
            .calls()
            .contains(&("write".into(), "u1".into(), "doc".into()))
    );

    authorization.set(true, true);
    let allowed = app.request("POST", "/edit", &headers, APPEND_ONE).await;
    assert_eq!(allowed.status, 204, "{}", allowed.text());
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_refuses_read_denied_caller_even_when_write_is_allowed() {
    let authorization = RecordingAuthorization::new(false, true);
    let app = start_app(ticket(&authorization)).await;
    let mut headers = vec![("Blok-Idempotency-Key", "edit-key")];
    headers.extend(COMPATIBLE);
    let response = app.request("POST", "/edit", &headers, APPEND_ONE).await;
    assert_error(&response, 403, "forbidden\n");
    assert_eq!(app.endpoint.gets.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_nul_in_the_request_is_refused() {
    let app = start_app(AppOptions::default()).await;
    let response = app
        .send(
            "POST",
            "/edit",
            "edit-key",
            "",
            r#"{ "ops": [ { "op": "remove", "id": "a\u0000b" } ] }"#,
        )
        .await;
    assert_eq!(response.status, 422);
    assert!(response.text().contains("NUL"), "{}", response.text());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_document_that_cannot_be_seeded_answers_service_unavailable() {
    let app = start_app(AppOptions::default()).await;
    app.endpoint.load_fails.store(true, Ordering::SeqCst);
    let response = app.send("POST", "/edit", "edit-key", "", APPEND_ONE).await;
    assert_error(&response, 503, "the document could not be loaded\n");
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_whose_html_read_ran_past_the_runtimes_limits_is_a_retryable503() {
    let app = start_app(journal()).await;
    *app.converter.next_edit.lock().unwrap() = Some(EditFailure::Transient);

    let overloaded = app
        .send("POST", "/edit", "overloaded-edit", "", APPEND_ONE)
        .await;
    let retried = app
        .send("POST", "/edit", "overloaded-edit", "", APPEND_ONE)
        .await;

    assert_error(
        &overloaded,
        503,
        "the server ran past its limits reading this edit's rich text, retry\n",
    );
    assert_eq!(overloaded.header("Retry-After"), "2");
    assert_eq!(retried.status, 204, "{}", retried.text());
    assert_eq!(retried.header("Blok-Doc-Sequence"), "1");
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_retry_after_of_an_overloaded_edit_is_the_rooms_retry_backoff() {
    let app = start_app(AppOptions {
        journal: true,
        retry_backoff: Duration::from_millis(4500),
        ..AppOptions::default()
    })
    .await;
    *app.converter.next_edit.lock().unwrap() = Some(EditFailure::Transient);
    let overloaded = app.send("POST", "/edit", "slow-edit", "", APPEND_ONE).await;
    assert_eq!(overloaded.status, 503);
    assert_eq!(overloaded.header("Retry-After"), "5");
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_the_converter_refuses_stays_a422() {
    let app = start_app(AppOptions::default()).await;
    *app.converter.next_edit.lock().unwrap() = Some(EditFailure::Refused(
        "collab: the rich text HTML in this edit could not be read: bad",
    ));
    let refused = app
        .send("POST", "/edit", "refused-edit", "", APPEND_ONE)
        .await;
    assert_error(
        &refused,
        422,
        "collab: the rich text HTML in this edit could not be read: bad\n",
    );
    assert_eq!(refused.header("Retry-After"), "");
    app.drain().await;
}

/// The exposed names, sorted, after checking the answer is a CORS one.
fn exposed_headers(answer: &Answer) -> Vec<String> {
    assert_eq!(
        answer.header("Access-Control-Allow-Origin"),
        "https://app.example.com"
    );
    let mut names: Vec<String> = answer
        .headers
        .iter()
        .filter(|(n, _)| n.eq_ignore_ascii_case("Access-Control-Expose-Headers"))
        .flat_map(|(_, v)| v.split(',').map(|name| name.trim().to_owned()))
        .collect();
    names.sort();
    names
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cross_origin_page_can_read_the_head_headers_on_state_and_edit() {
    let app = start_app(journal()).await;
    let origin = ("Origin", "https://app.example.com");
    let state = app.request("GET", "/state", &[origin], "").await;
    let applied = app
        .request(
            "POST",
            "/edit",
            &[origin, ("Blok-Idempotency-Key", "exposed-edit")],
            APPEND_ONE,
        )
        .await;
    let stale = app
        .request(
            "POST",
            "/edit",
            &[
                origin,
                ("Blok-Idempotency-Key", "exposed-stale"),
                ("If-Match", state.header("ETag")),
            ],
            APPEND_ONE,
        )
        .await;
    assert_eq!(applied.status, 204);
    assert_eq!(stale.status, 412);
    let want = vec!["Blok-Doc-Lineage", "Blok-Doc-Sequence", "ETag"];
    assert_eq!(exposed_headers(&state), want);
    assert_eq!(exposed_headers(&applied), want);
    assert_eq!(exposed_headers(&stale), want);
    app.drain().await;
}

// A host's own CORS layer may expose headers first; ours are added, not
// swapped in.
#[tokio::test(flavor = "multi_thread")]
async fn the_head_headers_join_headers_the_app_already_exposes() {
    let app = start_app(journal()).await;
    let cors = [
        ("Origin", "https://app.example.com"),
        ("X-Expose", "X-Request-Id, etag"),
    ];
    let state = app.request("GET", "/state", &cors, "").await;
    let mut headers = cors.to_vec();
    headers.push(("Blok-Idempotency-Key", "joined-edit"));
    let edit = app.request("POST", "/edit", &headers, APPEND_ONE).await;
    let want = vec![
        "Blok-Doc-Lineage",
        "Blok-Doc-Sequence",
        "X-Request-Id",
        "etag",
    ];
    assert_eq!(exposed_headers(&state), want);
    assert_eq!(exposed_headers(&edit), want);
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn state_needs_read_access_but_not_write_access() {
    let authorization = RecordingAuthorization::new(false, true);
    let app = start_app(AppOptions {
        authorization: Some(authorization.clone()),
        ..AppOptions::default()
    })
    .await;
    let denied = app.send("GET", "/state", "", "", "").await;
    assert_error(&denied, 403, "forbidden\n");
    assert_eq!(app.endpoint.gets.load(Ordering::SeqCst), 0);

    authorization.set(true, false);
    let allowed = app.send("GET", "/state", "", "", "").await;
    assert_eq!(allowed.status, 200);
    assert!(
        !authorization
            .calls()
            .iter()
            .any(|(gate, ..)| gate == "write")
    );
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn state_while_draining_is_unavailable() {
    let app = start_app(AppOptions::default()).await;
    app.drain().await;
    let response = app.send("GET", "/state", "", "", "").await;
    assert_eq!(response.status, 503);
}

// An export that ran past the runtime's limits may pass on a retry; one
// that can never be written is a 500.
#[tokio::test(flavor = "multi_thread")]
async fn a_state_export_past_the_runtimes_limits_is_a_retryable503() {
    let app = start_app(AppOptions::default()).await;
    app.converter.set(Failure::Transient, None);
    let overloaded = app.send("GET", "/state", "", "", "").await;
    app.converter.set(Failure::NotJson, None);
    let failed = app.send("GET", "/state", "", "", "").await;
    app.converter.set(Failure::None, None);
    let served = app.send("GET", "/state", "", "", "").await;

    assert_error(
        &overloaded,
        503,
        "the server ran past its limits exporting this document, retry\n",
    );
    assert_eq!(overloaded.header("Retry-After"), "2");
    assert_error(&failed, 500, "the document could not be exported\n");
    assert_eq!(failed.header("Retry-After"), "");
    assert_eq!(served.status, 200);
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn reset_consults_application_authorization_for_write() {
    let authorization = RecordingAuthorization::new(true, false);
    let app = start_app(ticket(&authorization)).await;
    let denied = app.request("POST", "/reset", &COMPATIBLE, "").await;
    assert_error(&denied, 403, "forbidden\n");
    assert!(
        authorization
            .calls()
            .contains(&("write".into(), "u1".into(), "doc".into()))
    );
    authorization.set(true, true);
    let allowed = app.request("POST", "/reset", &COMPATIBLE, "").await;
    assert_eq!(allowed.status, 204, "{}", allowed.text());
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn reset_refuses_read_denied_caller_even_when_write_is_allowed() {
    let authorization = RecordingAuthorization::new(false, true);
    let app = start_app(ticket(&authorization)).await;
    let response = app.request("POST", "/reset", &COMPATIBLE, "").await;
    assert_error(&response, 403, "forbidden\n");
    assert_eq!(app.endpoint.gets.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_corrupt_record_is_a_server_error_logged_at_error() {
    let history = start_history().await;
    let lineage = history.open().await;
    history.edit_text("two").await;
    let journal = history.journal.clone().unwrap();
    journal.corrupt_records.store(true, Ordering::SeqCst);

    let read = history
        .send("GET", &format!("/history/{lineage}/1"), "", "", "")
        .await;
    let restore = history.restore(&lineage, "1", "corrupt", "").await;
    let changes = history
        .send("GET", &format!("/history/{lineage}/1/changes"), "", "", "")
        .await;
    journal.corrupt_records.store(false, Ordering::SeqCst);
    journal.corrupt_lineages.store(true, Ordering::SeqCst);
    let list = history.send("GET", "/history", "", "", "").await;

    let message = "a stored version could not be read\n";
    assert_error(&read, 500, message);
    assert_eq!(read.header("Retry-After"), "");
    assert_error(&restore, 500, message);
    assert_error(&list, 500, message);
    assert_error(&changes, 500, message);
    assert_eq!(*history.corrupt.lock().unwrap(), vec!["doc"; 4]);
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pass_for_another_document_is_refused_on_every_route() {
    let app = start_app(AppOptions {
        journal: true,
        ticket_mode: true,
        ..AppOptions::default()
    })
    .await;
    let state = app.request("GET", "/state", &COMPATIBLE, "").await;
    let lineage = state.header("Blok-Doc-Lineage").to_owned();
    let mut restore = DOC_MISMATCH.to_vec();
    restore.push(("Blok-Idempotency-Key", "mismatch"));
    for answer in [
        app.request("GET", "/history", &DOC_MISMATCH, "").await,
        app.request("GET", &format!("/history/{lineage}/0"), &DOC_MISMATCH, "")
            .await,
        app.request("DELETE", &format!("/history/{lineage}"), &DOC_MISMATCH, "")
            .await,
        app.request(
            "POST",
            &format!("/history/{lineage}/0/restore"),
            &restore,
            "",
        )
        .await,
        app.request(
            "GET",
            &format!("/history/{lineage}/0/changes"),
            &DOC_MISMATCH,
            "",
        )
        .await,
    ] {
        assert_error(&answer, 403, "pass is for another document\n");
    }
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_ask_only_the_read_gate_and_writes_ask_both() {
    let authorization = RecordingAuthorization::new(true, true);
    let history = start_app(AppOptions {
        journal: true,
        authorization: Some(authorization.clone()),
        ..AppOptions::default()
    })
    .await;
    let lineage = history.open().await;
    authorization.set(false, true);
    authorization.calls.lock().unwrap().clear();

    let list = history.send("GET", "/history", "", "", "").await;
    let read = history
        .send("GET", &format!("/history/{lineage}/0"), "", "", "")
        .await;
    let delete = history
        .send("DELETE", &format!("/history/{lineage}"), "", "", "")
        .await;
    let restore = history.restore(&lineage, "0", "denied", "").await;
    let changes = history
        .send("GET", &format!("/history/{lineage}/0/changes"), "", "", "")
        .await;
    for answer in [&changes, &list, &read, &delete, &restore] {
        assert_error(answer, 403, "forbidden\n");
    }

    authorization.set(true, false);
    authorization.calls.lock().unwrap().clear();
    let allowed_list = history.send("GET", "/history", "", "", "").await;
    let allowed_read = history
        .send("GET", &format!("/history/{lineage}/0"), "", "", "")
        .await;
    let allowed_changes = history
        .send("GET", &format!("/history/{lineage}/0/changes"), "", "", "")
        .await;
    assert_eq!(allowed_changes.status, 200);
    assert_eq!(allowed_list.status, 200);
    assert_eq!(allowed_read.status, 200);
    assert!(
        !authorization
            .calls()
            .iter()
            .any(|(gate, ..)| gate == "write")
    );

    let write_denied = history
        .send("DELETE", &format!("/history/{lineage}"), "", "", "")
        .await;
    assert_error(&write_denied, 403, "forbidden\n");
    history.drain().await;
}

// EditEndpointTests cases a member socket or the journal's append proves.

fn journal_of(app: &crate::test_support::App) -> &crate::test_support::TestJournal {
    app.journal.as_deref().expect("a journal")
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_returns_only_after_durable_commit() {
    let app = start_app(journal()).await;
    let (member, membership, mirror) = app.connect().await;
    let journal = journal_of(&app);
    journal.hook.hold.store(true, Ordering::SeqCst);

    let address = app.running.address;
    let pending = tokio::spawn(async move {
        crate::test_support::send(
            address,
            "POST /sync/doc/edit HTTP/1.1\r\nBlok-Idempotency-Key: durable-edit",
            APPEND_ONE.as_bytes(),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(10), journal.hook.entered.notified())
        .await
        .expect("the append was never entered");

    assert!(
        !pending.is_finished(),
        "answered before the append returned"
    );
    assert!(journal.committed("doc").is_empty());
    assert!(member.updates().is_empty(), "relayed before the append");

    journal.hook.release.notify_one();
    let response = pending.await.unwrap();

    assert_eq!(response.status, 204, "{}", response.text());
    let updates = member.updates();
    assert_eq!(updates.len(), 1);
    mirror.apply_update(&updates[0]).unwrap();
    assert_eq!(app.export(&mirror).await, ["new=!", "a=one"]);
    let committed = journal.committed("doc");
    assert_eq!(committed.len(), 1);
    assert_eq!(
        committed[0].source,
        blok_collab_operation::Source::HTTP_EDIT
    );
    let id = &committed[0].operation_id;
    assert!(
        id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "operation id {id}"
    );
    assert_ne!(id, "durable-edit");
    assert_eq!(response.header("Blok-Doc-Sequence"), "1");
    assert_eq!(response.header("Blok-Doc-Lineage"), app.open().await);
    membership.leave();
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stale_if_match_answers412_with_the_head_and_applies_nothing() {
    let app = start_app(journal()).await;
    let first = app
        .send("POST", "/edit", "first-edit", "", APPEND_ONE)
        .await;
    let lineage = first.header("Blok-Doc-Lineage").to_owned();
    let (member, membership, mirror) = app.connect().await;

    let stale = app
        .send(
            "POST",
            "/edit",
            "stale-edit",
            &format!("\"{lineage}:0\""),
            r#"{ "ops": [ { "op": "insert", "id": "stale", "block": { "type": "p", "data": { "text": "?" } } } ] }"#,
        )
        .await;

    assert_error(
        &stale,
        412,
        "the document is no longer at the If-Match head\n",
    );
    assert_eq!(stale.header("Blok-Doc-Lineage"), lineage);
    assert_eq!(stale.header("Blok-Doc-Sequence"), "1");
    assert_eq!(journal_of(&app).committed("doc").len(), 1);
    assert_eq!(app.converter.apply_calls.load(Ordering::SeqCst), 1);

    let matching = app
        .send(
            "POST",
            "/edit",
            "matching-edit",
            &format!("\"{lineage}:1\""),
            r#"{ "ops": [ { "op": "insert", "id": "next", "block": { "type": "p", "data": { "text": "!" } } } ] }"#,
        )
        .await;
    assert_eq!(matching.status, 204, "{}", matching.text());
    assert_eq!(matching.header("Blok-Doc-Sequence"), "2");
    let updates = member.updates();
    assert_eq!(updates.len(), 1, "the refused edit relayed");
    mirror.apply_update(&updates[0]).unwrap();
    assert_eq!(app.export(&mirror).await, ["next=!", "new=!", "a=one"]);
    membership.leave();
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn if_match_is_checked_against_the_head_a_cold_room_loads_from_the_journal() {
    let dir = crate::test_support::temp_dir();
    let cold = || AppOptions {
        journal: true,
        journal_dir: Some(dir.clone()),
        ..AppOptions::default()
    };
    let lineage = {
        let first_app = start_app(cold()).await;
        let first = first_app
            .send("POST", "/edit", "before-reload", "", APPEND_ONE)
            .await;
        assert_eq!(first.status, 204, "{}", first.text());
        first_app.drain().await;
        first.header("Blok-Doc-Lineage").to_owned()
    };

    let app = start_app(cold()).await;
    let stale = app
        .send(
            "POST",
            "/edit",
            "stale-after-reload",
            &format!("\"{lineage}:0\""),
            APPEND_ONE,
        )
        .await;
    let matching = app
        .send(
            "POST",
            "/edit",
            "after-reload",
            &format!("\"{lineage}:1\""),
            r#"{ "ops": [ { "op": "insert", "id": "next", "block": { "type": "p", "data": { "text": "!" } } } ] }"#,
        )
        .await;

    assert_eq!(stale.status, 412, "{}", stale.text());
    assert_eq!(stale.header("Blok-Doc-Sequence"), "1");
    assert_eq!(matching.status, 204, "{}", matching.text());
    assert_eq!(matching.header("Blok-Doc-Lineage"), lineage);
    assert_eq!(matching.header("Blok-Doc-Sequence"), "2");
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_late_duplicate_append_closes_without_relaying_or_writing_back() {
    let app = start_app(journal()).await;
    let (member, membership, _mirror) = app.connect().await;
    let journal = journal_of(&app);
    journal.hook.duplicate.store(true, Ordering::SeqCst);

    let response = app
        .send("POST", "/edit", "late-duplicate", "", APPEND_ONE)
        .await;

    assert!(member.messages().is_empty(), "sent {:?}", member.messages());
    assert_eq!(
        *member.closed.lock().unwrap(),
        vec![blok_collab::CloseReason::CommitUnavailable]
    );
    assert_eq!(response.status, 503, "{}", response.text());
    assert!(journal.committed("doc").is_empty());
    assert_eq!(app.endpoint.saves.load(Ordering::SeqCst), 0);
    membership.leave();
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn edit_journals_a_batch_as_one_operation() {
    let app = start_app(journal()).await;

    let response = app
        .send(
            "POST",
            "/edit",
            "batched-edit",
            "",
            r#"{ "ops": [ { "op": "insert", "id": "first", "block": { "type": "p", "data": { "text": "!" } } }, { "op": "insert", "id": "second", "block": { "type": "p", "data": { "text": "?" } } } ] }"#,
        )
        .await;

    assert_eq!(response.status, 204, "{}", response.text());
    assert_eq!(journal_of(&app).committed("doc").len(), 1);
    app.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_lands_on_every_open_socket_and_in_the_document() {
    for options in [AppOptions::default(), journal()] {
        let app = start_app(options).await;
        let (member, membership, mirror) = app.connect().await;
        assert_eq!(app.export(&mirror).await, ["a=one"]);

        let response = app.send("POST", "/edit", "edit-key", "", APPEND_ONE).await;

        assert_eq!(response.status, 204, "{}", response.text());
        let updates = member.updates();
        assert_eq!(updates.len(), 1);
        mirror.apply_update(&updates[0]).unwrap();
        assert_eq!(app.export(&mirror).await, ["new=!", "a=one"]);
        membership.leave();
        app.drain().await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_encoded_backslash_document_is_rejected_or_can_be_purged_after_edit() {
    for path in ["/sync/a%5Cb/edit", "/sync/a%255cb/edit"] {
        let app = start_app(AppOptions::default()).await;

        let response = crate::test_support::send(
            app.running.address,
            &format!("POST {path} HTTP/1.1\r\nBlok-Idempotency-Key: encoded-backslash"),
            APPEND_ONE.as_bytes(),
        )
        .await;

        assert_error(
            &response,
            400,
            "document ids must be a single path segment\n",
        );
        assert_eq!(app.endpoint.gets.load(Ordering::SeqCst), 0, "{path}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_whose_html_ran_past_the_allocation_budget_is_a413_without_retry_after() {
    let app = start_app(journal()).await;
    *app.converter.next_edit.lock().unwrap() = Some(EditFailure::TooLarge(
        "collab: the rich text HTML in this edit could not be read: too large",
    ));

    let too_large = app
        .send("POST", "/edit", "too-large-edit", "", APPEND_ONE)
        .await;

    assert_error(
        &too_large,
        413,
        "collab: the rich text HTML in this edit could not be read: too large\n",
    );
    assert_eq!(too_large.header("Retry-After"), "");
    assert!(journal_of(&app).committed("doc").is_empty());
    app.drain().await;
}
