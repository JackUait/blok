//! blok-mcp's engines are charged the bytes a call holds, not every byte
//! it allocates: a big batch that frees as it goes passes, one that keeps
//! more than the limit stops.

use blok_mcp::bundle::Bundle;
use serde_json::json;

const LIMIT: i64 = 48 << 20;

fn inserts(count: usize, chars: usize) -> serde_json::Value {
    let text = "0é".repeat(chars / 2);
    let commands: Vec<_> = (0..count)
        .map(|i| json!({ "name": "block.insert", "args": { "type": "paragraph", "id": format!("b{i}"), "position": "end", "data": { "text": text } } }))
        .collect();
    json!({
        "mcp": { "mode": "stored", "write": true, "source": true },
        "document": { "blocks": [] },
        "actor": { "id": "a", "name": "A", "kind": "agent" },
        "batch": { "commands": commands },
    })
}

#[tokio::test]
async fn a_batch_that_churns_past_the_limit_passes() {
    let bundle = Bundle::with_budget(1, LIMIT).expect("a bundle");
    // About 620 MiB allocated in all, under 32 MiB held at once.
    let out = bundle
        .call("agentExecute", &inserts(300, 2000).to_string())
        .await
        .expect("the batch runs");
    assert_eq!(out["result"]["ok"], true);
}

#[tokio::test]
async fn a_batch_that_holds_twice_the_limit_is_refused() {
    let bundle = Bundle::with_budget(1, LIMIT).expect("a bundle");
    // About 100 MB of text kept in the document.
    let refused = bundle
        .call("agentExecute", &inserts(50, 2_000_000).to_string())
        .await;
    let error = refused.expect_err("the batch is refused").to_string();
    assert!(error.contains("memory budget"), "{error}");
}
