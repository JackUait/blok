use crate::test_support::{must_parse, pointer, shared_executor, stable};
use crate::{Actor, Cancel};

fn server_agent() -> Actor {
    Actor {
        id: "agent-cs".to_owned(),
        name: "Server agent".to_owned(),
        on_behalf_of: None,
    }
}

// A port of C# JintComputedReadTests.AFullReadOfALargeDatabaseFinishes: a
// read of one row in a 1500-row database computes every row and must finish
// inside the production 10 s budget, not time out.
#[tokio::test]
async fn a_full_read_of_a_large_database_finishes() {
    let rows = 1500;
    let content: Vec<String> = (0..rows).map(|i| format!("\"r{i}\"")).collect();
    let blocks: String = (0..rows)
        .map(|i| format!(r#",{{"id":"r{i}","type":"database-row","parent":"db","data":{{"position":"a{i:05}","properties":{{"t":"Row {i}","n":{i}}}}}}}"#))
        .collect();
    let document = format!(
        r#"{{"blocks":[{{"id":"db","type":"database","data":{{"title":"Big","activeViewId":"v1","views":[{{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}}],"schema":[{{"id":"t","name":"Name","type":"title","position":"a0"}},{{"id":"n","name":"Est","type":"number","position":"a1"}},{{"id":"f","name":"Double","type":"formula","position":"a2","formula":{{"expression":"prop(\"Est\") * 2"}}}},{{"id":"uid","name":"ID","type":"uniqueId","position":"a3"}}]}},"content":[{}]}}{}]}}"#,
        content.join(","),
        blocks
    );
    let execution = shared_executor()
        .execute(
            &Cancel::new(),
            &document,
            r#"{"commands":[{"name":"doc.read","args":{"ids":["r1499"]}}]}"#,
            &server_agent(),
            None,
        )
        .await
        .expect("execute");
    let result = must_parse(&execution.result_json);
    let shown: String = execution.result_json.chars().take(2000).collect();
    assert_eq!(stable(pointer(&result, "/ok")), "true", "not ok: {shown}");
    let blocks = pointer(&result, "/results/0/blocks").expect("blocks");
    assert_eq!(blocks.items.len(), 1, "want one block: {shown}");
    assert_eq!(
        stable(pointer(&result, "/results/0/blocks/0/computed")),
        stable(Some(&must_parse(r#"{"f":2998,"uid":1500}"#)))
    );
}
