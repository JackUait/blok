use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_jsruntime::{Options as PoolOptions, Pool};

use crate::{Options, Server};

// C# AddBlokServer registers one IBlokRuntime that the converter, the agent
// executor and the rooms share; a host sizes it by calling AddBlokDocuments
// first (BlokDocumentsServiceCollectionExtensions.cs, BlokDocumentsRegistrationTests).

type Seen = Arc<Mutex<Vec<PoolOptions>>>;

/// Counts the pool builds.
fn count_builds(s: &Server) -> Seen {
    let seen: Seen = Arc::default();
    let record = seen.clone();
    *s.inner.runtime.build.lock().unwrap() = Arc::new(move |options| {
        record.lock().unwrap().push(options);
        Pool::new(options)
    });
    seen
}

fn documents_options() -> Options {
    Options {
        auth: "none".into(),
        storage_directory: String::new(),
        ..Options::default()
    }
}

// Twin of RegistersOneConverterAcrossRepeatedAndMixedRegistration and
// TakesTheTimeoutTheCallerAsksFor.
#[test]
#[ignore = "needs the agent executor on the shared pool; the agent lane adds AgentExecutor"]
fn the_document_converter_shares_the_agents_engine_pool_and_takes_its_size() {}

// Twin of SkipsTheWarmUpWhenItIsNotWanted: AddBlokServer registers no warm-up.
#[tokio::test]
async fn new_builds_no_engine_pool_without_warm_up() {
    let s = Server::new(documents_options()).unwrap();
    let seen = count_builds(&s);
    let _ = s.document_converter();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(seen.lock().unwrap().len(), 0, "pools built before any call");
}

// Twin of BuildsTheConverterOffTheStartupPath and
// ConvertsSomethingAtStartupRatherThanOnlyBuildingThePool.
#[test]
fn warm_up_builds_the_shared_pool_in_the_background() {
    let builds = Arc::new(Mutex::new(0));
    let gate = Arc::new(std::sync::Barrier::new(2));
    let s = Server::new_with_runtime_builder(
        Options {
            documents: blok_blokdocs::Options {
                warm_up: true,
                ..blok_blokdocs::Options::default()
            },
            ..documents_options()
        },
        {
            let builds = builds.clone();
            let gate = gate.clone();
            Arc::new(move |options| {
                gate.wait();
                *builds.lock().unwrap() += 1;
                Pool::new(options)
            })
        },
    )
    .unwrap();
    assert_eq!(
        *builds.lock().unwrap(),
        0,
        "the pool was built while new ran"
    );
    gate.wait();
    let mut warmed = s.inner.warmed.clone().expect("a warm-up");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(60), warmed.wait_for(|done| *done))
            .await
            .expect("the warm-up never finished")
            .unwrap();
        assert_eq!(*builds.lock().unwrap(), 1);
        s.document_converter()
            .to_plain_text(r#"{"blocks":[]}"#, false)
            .await
            .unwrap();
    });
    assert_eq!(
        *builds.lock().unwrap(),
        1,
        "the converter built a second pool"
    );
}
