//! Replaying a live step asks the person when the bundle would: undoing a
//! lock unlocks a database.

use std::sync::Arc;

use blok_mcp::bundle::Bundle;
use blok_mcp::remote::{Gate, StepGate, gate_step};
use serde_json::{Value, json};

const LOCKABLE: &str = r#"{"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v","schema":[{"id":"t","name":"Name","type":"title","position":"a0"}],"views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}"#;

fn mcp() -> Value {
    json!({ "sync": true, "source": false, "uploads": false, "mode": "live", "write": true })
}

fn actor() -> Value {
    json!({ "id": "agent:alice:Desk", "name": "Desk (for alice)", "kind": "agent", "onBehalfOf": "alice" })
}

#[tokio::test(flavor = "multi_thread")]
async fn undoing_a_lock_asks_like_an_unlock_and_runs_with_the_yes() {
    let bundle = Arc::new(Bundle::new(1).unwrap());
    let lock = json!({ "commands": [{ "name": "database.setLock", "args": { "id": "db", "locked": true } }] });
    let input = json!({ "mcp": mcp(), "document": serde_json::from_str::<Value>(LOCKABLE).unwrap(), "actor": actor(), "batch": lock, "history": {} });
    let out: Value = bundle
        .call("agentExecute", &input.to_string())
        .await
        .unwrap();
    assert_eq!(out["result"]["ok"], true, "{out}");
    let gate = StepGate {
        document: out["document"].to_string(),
        history: out["history"].to_string(),
    };
    let undo = json!({ "commands": [{ "name": "history.undo", "args": {} }] });
    let asking = json!({ "capabilities": { "elicitation": {} }, "clientName": "Desk" });
    let asked = gate_step(
        &bundle,
        &mcp(),
        &json!({ "now": "l1", "afterWrite": "l2" }),
        &gate,
        &undo,
        &actor(),
        &asking,
    )
    .await
    .unwrap();
    let Gate::Ask(question) = asked else {
        panic!("expected a question")
    };
    assert_eq!(question["key"], r#"["database.unlock","db","Payroll"]"#);

    let mut yes = asking.clone();
    yes["replies"] = json!({ r#"["database.unlock","db","Payroll"]"#: { "action": "accept", "content": { "unlock": true } } });
    let passed = gate_step(
        &bundle,
        &mcp(),
        &json!({ "now": "l1", "afterWrite": "l2" }),
        &gate,
        &undo,
        &actor(),
        &yes,
    )
    .await
    .unwrap();
    assert!(matches!(passed, Gate::Passed(_)));

    let no_channel = json!({ "capabilities": {}, "clientName": "Desk" });
    let refused = gate_step(
        &bundle,
        &mcp(),
        &json!({ "now": "l1", "afterWrite": "l2" }),
        &gate,
        &undo,
        &actor(),
        &no_channel,
    )
    .await
    .unwrap();
    let Gate::Refused(result) = refused else {
        panic!("expected a refusal")
    };
    assert!(result.contains("APPROVAL_REQUIRED"), "{result}");
}
