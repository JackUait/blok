use blok_jsjson::{Str, Value, parse, stringify};

use crate::test_support::start_history;

// Twins of C# HistoryEndpointTests.Scope: databases=keep|restore.

const TABLE_DATA: &str = r#"{ "schema": [{ "id": "t", "type": "title" }], "views": [] }"#;

fn blocks_of(text: &str) -> Value {
    match parse(text.as_bytes()) {
        Ok(Value::Object(state)) => state
            .get(&Str::from("blocks"))
            .cloned()
            .unwrap_or(Value::Null),
        other => panic!("state: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn only_one_exact_keep_keeps_databases_and_the_shipped_restore_ignores_any_other_value() {
    for query in [
        "?databases=",
        "?databases=Keep",
        "?databases=none",
        "?databases=keep&databases=keep",
    ] {
        let history = start_history().await;
        let lineage = history.open().await;
        history
            .edit(
                "database",
                &format!(
                    r#"{{ "ops": [ {{ "op": "insert", "id": "d", "block": {{ "type": "database", "data": {TABLE_DATA} }} }} ] }}"#
                ),
            )
            .await;
        // The shipped route ignored unknown values: anything but one exact
        // keep is a plain restore.
        let restore = history
            .send(
                "POST",
                &format!("/history/{lineage}/0/restore{query}"),
                "other",
                "",
                "",
            )
            .await;
        assert_eq!(restore.status, 204, "restore {query} = {}", restore.text());
        assert!(
            !history.blocks().await.contains(r#""id":"d""#),
            "restore {query} kept the database"
        );
        // The preview route is new, so it refuses what it does not know.
        let preview = history
            .send(
                "POST",
                &format!("/history/{lineage}/0/restore/preview{query}"),
                "",
                "",
                "",
            )
            .await;
        assert!(
            preview.status == 400 && preview.text() == "databases must be keep or restore\n",
            "preview {query} = {} {:?}",
            preview.status,
            preview.text()
        );
        history.drain().await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_keep_restore_that_would_orphan_a_database_is_refused_even_with_every_confirm() {
    let history = start_history().await;
    let lineage = history.open().await;
    history
        .edit(
            "toggle",
            r#"{ "ops": [ { "op": "insert", "id": "t", "block": { "type": "toggle", "data": {} } } ] }"#,
        )
        .await;
    history
        .edit(
            "database",
            &format!(
                r#"{{ "ops": [ {{ "op": "insert", "id": "d", "parent": "t", "block": {{ "type": "database", "data": {TABLE_DATA} }} }} ] }}"#
            ),
        )
        .await;
    let before = blocks_of(&history.blocks().await);

    let refused = history
        .request(
            "POST",
            &format!("/history/{lineage}/0/restore?databases=keep"),
            &[
                ("Blok-Idempotency-Key", "orphan"),
                (
                    "X-Blok-Restore-Confirm",
                    "share, unlock, lockedReshape, orphanedDatabase",
                ),
            ],
            "",
        )
        .await;
    assert!(
        refused.status == 409
            && refused.header("X-Blok-Restore-Refusal") == "restore_refused"
            && refused.text()
                == r#"{"error":"restore_refused","guards":[{"kind":"orphanedDatabase","blockId":"d"}]}"#,
        "refused = {} {:?} {}",
        refused.status,
        refused.header("X-Blok-Restore-Refusal"),
        refused.text()
    );
    assert_eq!(
        blocks_of(&history.blocks().await),
        before,
        "the refused restore wrote"
    );

    let preview = history
        .send(
            "POST",
            &format!("/history/{lineage}/0/restore/preview?databases=keep"),
            "",
            "",
            "",
        )
        .await;
    let guards = match parse(&preview.body) {
        Ok(Value::Object(body)) => body
            .get(&Str::from("guards"))
            .cloned()
            .unwrap_or(Value::Null),
        other => panic!("preview: {other:?}"),
    };
    assert_eq!(
        stringify(&guards).unwrap(),
        r#"[{"kind":"orphanedDatabase","blockId":"d"}]"#
    );
    // Without keep, the same restore runs as it always did.
    let restored = history.restore(&lineage, "0", "orphan", "").await;
    assert_eq!(restored.status, 204, "restore = {}", restored.text());
    history.drain().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_keep_restore_leaves_a_database_as_it_is_now() {
    let history = start_history().await;
    let lineage = history.open().await;
    history
        .edit(
            "database",
            &format!(
                r#"{{ "ops": [ {{ "op": "insert", "id": "d", "block": {{ "type": "database", "data": {TABLE_DATA} }} }} ] }}"#
            ),
        )
        .await;
    history.edit_text("two").await;

    let restore = history
        .send(
            "POST",
            &format!("/history/{lineage}/0/restore?databases=keep"),
            "keep",
            "",
            "",
        )
        .await;
    assert_eq!(restore.status, 204, "restore = {}", restore.text());
    let Value::Array(blocks) = blocks_of(&history.blocks().await) else {
        panic!("no blocks");
    };
    let ids: Vec<String> = blocks
        .iter()
        .map(|block| match block {
            Value::Object(block) => match block.get(&Str::from("id")) {
                Some(Value::String(id)) => id.to_string(),
                other => panic!("id: {other:?}"),
            },
            other => panic!("block: {other:?}"),
        })
        .collect();
    // An insert with no anchor went first; the kept database stays there.
    assert_eq!(ids, ["d", "a"]);
    assert!(history.blocks().await.contains(r#""one""#));
    history.drain().await;
}
