use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_blokagent::{Actor, Cancel};
use blok_http::{Request, ResponseWriter};
use blok_jsruntime::Pool;

use crate::collab_test::collab_options;
use crate::testutil::{send, start};
use crate::{Options, Server};

// C# registers one agent executor beside the documents runtime, with the
// rooms only when collaboration is on (BlokDocumentsServiceCollectionExtensions.cs:79-86),
// and its HTML reader takes that same runtime (BlokServerServiceCollectionExtensions.cs:164).

fn actor(id: &str, name: &str) -> Actor {
    Actor {
        id: id.into(),
        name: name.into(),
        on_behalf_of: None,
    }
}

fn no_collab_options() -> Options {
    Options {
        auth: "none".into(),
        storage_directory: String::new(),
        ..Options::default()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_agent_executor_edits_the_servers_own_rooms_on_one_engine_pool() {
    let endpoint = start(
        |request: Request, mut response: ResponseWriter| async move {
            response
                .headers_mut()
                .set("Content-Type", "application/json");
            if request.method() == "GET" {
                let _ = response
                    .write(
                        br#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}"#,
                    )
                    .await;
            }
        },
    )
    .await;
    let s = Server::new(Options {
        auth: "none".into(),
        storage_directory: String::new(),
        doc_endpoint: format!("http://{}/docs", endpoint.address),
        collab_journal: true,
        ..collab_options()
    })
    .unwrap();
    let builds = Arc::new(Mutex::new(0));
    let counted = builds.clone();
    *s.inner.runtime.build.lock().unwrap() = Arc::new(move |options| {
        *counted.lock().unwrap() += 1;
        Pool::new(options)
    });
    let host = start(s.handler("")).await;

    let executor = s.agent_executor().unwrap();
    let again = s.agent_executor().unwrap();
    assert!(
        Arc::ptr_eq(&executor, &again),
        "a second call built another executor"
    );
    let execution = executor
        .execute_in_room(
            &Cancel::new(),
            "doc",
            r#"{"commands":[{"name":"doc.setTitle","args":{"title":"From the agent"}}]}"#,
            &actor("agent", "Agent"),
            None,
        )
        .await
        .unwrap();
    assert!(
        execution.result_json.contains(r#""ok":true"#) && !execution.revision.is_empty(),
        "{execution:?}"
    );
    let state = send(host.address, "GET /sync/doc/state HTTP/1.1", b"").await;
    assert!(
        state.text().contains(r#""title":"From the agent""#),
        "state {}",
        state.text()
    );
    assert_eq!(*builds.lock().unwrap(), 1, "engine pools built, want 1");
    s.drain(Duration::from_secs(10)).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn the_agent_executor_without_collaboration_has_no_rooms() {
    let s = Server::new(no_collab_options()).unwrap();
    let executor = s.agent_executor().unwrap();
    let cancel = Cancel::new();
    let execution = executor
        .execute_in_room(&cancel, "doc", r#"{"commands":[]}"#, &actor("a", "A"), None)
        .await
        .unwrap();
    assert!(
        execution
            .result_json
            .contains(r#""code":"COMMAND_UNAVAILABLE""#),
        "{execution:?}"
    );
    let stored = executor
        .execute(
            &cancel,
            r#"{"blocks":[]}"#,
            r#"{"commands":[{"name":"doc.setTitle","args":{"title":"T"}}]}"#,
            &actor("a", "A"),
            None,
        )
        .await
        .unwrap();
    assert!(stored.document_json.is_some(), "{stored:?}");
}

// Twin of C# DocumentsOnlyRegistrationResolvesAnExecutorThatRunsTheEmbeddedRuntime;
// the blob store line is DI only.
#[tokio::test(flavor = "multi_thread")]
async fn the_agent_executor_runs_the_embedded_runtime_beside_the_converter() {
    let document = r#"{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}"#;
    let s = Server::new(no_collab_options()).unwrap();
    let executor = s.agent_executor().unwrap();
    let cancel = Cancel::new();
    let contract = executor.contract(&cancel, None).await.unwrap();
    assert!(
        contract.contains(r#""name":"block.insert""#),
        "contract has no block.insert"
    );
    let execution = executor
        .execute(
            &cancel,
            document,
            r#"{"commands":[{"name":"doc.setTitle","args":{"title":"Server title"}}]}"#,
            &actor("agent-cs", "Server agent"),
            None,
        )
        .await
        .unwrap();
    let saved = execution.document_json.clone().expect("a saved document");
    assert!(saved.contains(r#""title":"Server title""#), "saved {saved}");
    assert!(
        execution.result_json.contains(r#""ok":true"#),
        "{execution:?}"
    );
    assert!(
        !execution.revision.is_empty()
            && execution
                .result_json
                .contains(&format!(r#""revision":"{}""#, execution.revision)),
        "{execution:?}"
    );
    let text = s
        .document_converter()
        .to_plain_text(document, false)
        .await
        .unwrap();
    assert_eq!(text, "Hello world");
}

// Twin of C# ACollabServerGivesTheExecutorItsRoomsInEitherRegistrationOrder:
// the order is DI only. Port 1 refuses at once, so the seed fails.
#[tokio::test(flavor = "multi_thread")]
async fn a_collab_server_gives_the_executor_its_rooms() {
    let s = Server::new(collab_options()).unwrap();
    let execution = s
        .agent_executor()
        .unwrap()
        .execute_in_room(
            &Cancel::new(),
            "doc",
            r#"{"commands":[{"name":"doc.read","args":{"detail":"full"}}]}"#,
            &actor("agent-cs", "Server agent"),
            None,
        )
        .await
        .unwrap();
    assert!(
        execution.result_json.contains(r#""code":"APPLY_FAILED""#)
            && execution.result_json.contains(r#""status":"SeedFailed""#),
        "{execution:?}"
    );
    s.drain(Duration::from_secs(10)).await.unwrap();
}

#[test]
#[ignore = "blokserver takes no host runtime: its engine pool is always the embedded bundle"]
fn executor_and_converter_both_use_the_registered_runtime_instead_of_separate_pools() {}
