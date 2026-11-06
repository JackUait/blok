//! Under --page-titles page-map a page block gets its own stored document,
//! made before the batch runs, as Node makes it mid-batch.

use std::sync::Arc;

use blok_mcp::bundle::Bundle;
use blok_mcp::server::{Approval, Caller, Mcp, Outcome};
use serde_json::{Value, json};

async fn call(mcp: &Mcp, name: &str, args: Value) -> Value {
    call_with(mcp, name, args, &Approval::default()).await
}

async fn call_with(mcp: &Mcp, name: &str, args: Value, approval: &Approval) -> Value {
    let caller = Caller {
        principal: "alice".to_owned(),
        client_name: Some("Desk".to_owned()),
        scopes: None,
    };
    match mcp.call(name, &args, &caller, approval, &|| false).await {
        Ok(Outcome::Answer(answer)) => serde_json::from_str(&answer.structured).unwrap(),
        Ok(Outcome::Ask(ask)) => json!({ "asked": ask.key }),
        Ok(other) => panic!("{name}: {other:?}"),
        Err(err) => panic!("{name}: {err}"),
    }
}

fn files(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[tokio::test(flavor = "multi_thread")]
async fn a_page_insert_saves_the_page_document_and_a_refused_one_reports_it_orphaned() {
    let dir = std::env::temp_dir().join(format!("blok-mcp-pages-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("doc.json"), r#"{"blocks":[]}"#).unwrap();
    let options = json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "source": { "kind": "files", "dir": dir.to_string_lossy() },
        "pageTitles": "page-map",
    });
    let mcp = Mcp::new(Arc::new(Bundle::new(1).unwrap()), &options, None, None)
        .await
        .unwrap();
    let opened = call(
        &mcp,
        "blok_open",
        json!({ "documentId": "doc", "write": true }),
    )
    .await;
    let handle = opened["handle"].as_str().unwrap().to_owned();

    let made = call(
        &mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "block.insert", "args": { "type": "page", "id": "pg", "data": {} } }] }),
    )
    .await;
    assert_eq!(made["ok"], true, "{made}");
    let page_id = made["blocks"][0]["data"]["pageId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        files(&dir).contains(&format!("{page_id}.json")),
        "{:?}",
        files(&dir)
    );
    assert_eq!(
        std::fs::read_to_string(dir.join(format!("{page_id}.json"))).unwrap(),
        "{\n  \"blocks\": []\n}\n"
    );

    let refused = call(
        &mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "block.insert", "args": { "type": "page", "id": "pg2", "data": { "title": "x" } } }] }),
    )
    .await;
    assert_eq!(
        refused["error"]["code"], "ORPHANED_SIDE_EFFECT",
        "{refused}"
    );
    let orphan = refused["error"]["details"]["orphaned"][0]["prepared"]["pageId"]
        .as_str()
        .unwrap();
    assert!(files(&dir).contains(&format!("{orphan}.json")));

    let unknown = call(
        &mcp,
        "blok_execute",
        json!({ "handle": handle, "commands": [{ "name": "nope.nope", "args": {} }] }),
    )
    .await;
    assert_eq!(unknown["error"]["code"], "UNKNOWN_COMMAND");
    assert_eq!(files(&dir).len(), 3, "{:?}", files(&dir));
    let _ = std::fs::remove_dir_all(&dir);
}

async fn page_map(dir: &std::path::Path, document: &str) -> Mcp {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("doc.json"), document).unwrap();
    let options = json!({
        "transport": { "kind": "stdio" },
        "auth": { "kind": "none" },
        "source": { "kind": "files", "dir": dir.to_string_lossy() },
        "pageTitles": "page-map",
    });
    Mcp::new(Arc::new(Bundle::new(1).unwrap()), &options, None, None)
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_only_handle_makes_no_page() {
    let dir = std::env::temp_dir().join(format!("blok-mcp-pages-ro-{}", std::process::id()));
    let mcp = page_map(&dir, r#"{"blocks":[]}"#).await;
    let opened = call(&mcp, "blok_open", json!({ "documentId": "doc" })).await;
    let refused = call(
        &mcp,
        "blok_execute",
        json!({ "handle": opened["handle"], "commands": [{ "name": "block.insert", "args": { "type": "page", "id": "pg", "data": {} } }] }),
    )
    .await;
    assert_eq!(refused["error"]["code"], "READ_ONLY", "{refused}");
    assert_eq!(files(&dir), vec!["doc.json"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_batch_that_asks_first_makes_no_page() {
    let dir = std::env::temp_dir().join(format!("blok-mcp-pages-ask-{}", std::process::id()));
    let locked = r#"{"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v","schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],"views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}"#;
    let mcp = page_map(&dir, locked).await;
    let opened = call(
        &mcp,
        "blok_open",
        json!({ "documentId": "doc", "write": true }),
    )
    .await;
    let asking = Approval {
        capabilities: json!({ "elicitation": {} }),
        replies: None,
    };
    let asked = call_with(
        &mcp,
        "blok_execute",
        json!({ "handle": opened["handle"], "commands": [
            { "name": "block.insert", "args": { "type": "page", "id": "pg", "data": {} } },
            { "name": "database.setLock", "args": { "id": "db", "locked": false } },
        ] }),
        &asking,
    )
    .await;
    assert!(asked.get("asked").is_some(), "{asked}");
    assert_eq!(files(&dir), vec!["doc.json"]);
    let malformed = call(
        &mcp,
        "blok_execute",
        json!({ "handle": opened["handle"], "commands": "x" }),
    )
    .await;
    assert_eq!(malformed["error"]["code"], "INVALID_ARGS", "{malformed}");
    let _ = std::fs::remove_dir_all(&dir);
}
