use std::sync::{Arc, Mutex};

use blok_collab::BoxFuture;
use blok_collab_journal::{Context, PurgeOutcome};

use crate::test_support::*;
use crate::*;

/// An S3 bucket that records every key it is asked for.
#[derive(Default)]
struct EmptyObjects {
    keys: Mutex<Vec<String>>,
}

struct SharedObjects(Arc<EmptyObjects>);

impl blok_collab_workingset::ObjectStore for SharedObjects {
    async fn get_object(
        &self,
        key: &str,
    ) -> Result<Option<Vec<u8>>, blok_collab_workingset::Error> {
        lock(&self.0.keys).push(key.to_owned());
        Ok(None)
    }
    async fn put_object(
        &self,
        key: &str,
        _content: &[u8],
    ) -> Result<(), blok_collab_workingset::Error> {
        lock(&self.0.keys).push(key.to_owned());
        Ok(())
    }
    async fn delete_object(&self, key: &str) -> Result<(), blok_collab_workingset::Error> {
        lock(&self.0.keys).push(key.to_owned());
        Ok(())
    }
}

/// A host purge store that records the ids it is handed.
#[derive(Default)]
struct EmptyIdPurger {
    purged: Mutex<Vec<String>>,
}

impl OperationStore for EmptyIdPurger {
    fn open<'a>(
        &'a self,
        _ctx: &'a Context,
        _doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        Box::pin(async { Err(Error::message("unused")) })
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "*room.emptyIDPurger"
    }
}

impl PurgeStore for EmptyIdPurger {
    fn purge<'a>(
        &'a self,
        _ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>> {
        lock(&self.purged).push(doc_id.to_owned());
        Box::pin(async { Ok(PurgeOutcome::Purged) })
    }
}

type Case = (
    &'static str,
    Arc<dyn WorkingSetStore>,
    Option<Arc<dyn OperationStore>>,
);

// C# CollabRoomManager.PurgeDocumentAsync and RecheckAccessAsync throw
// ArgumentException on an empty id before anything else runs.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_empty_doc_id_is_refused_before_authorize_on_every_store() {
    let bucket = Arc::new(EmptyObjects::default());
    let s3 = blok_collab_workingset::S3Store::new(SharedObjects(bucket.clone()), "collab", None)
        .expect("an S3 store");
    let s3: Arc<dyn WorkingSetStore> = Arc::new(s3);
    let existing = TempDir::new();
    let missing = TempDir::new();
    let local = |path: &std::path::Path| -> Arc<dyn WorkingSetStore> {
        Arc::new(blok_collab_workingset::LocalStore::new(path, None))
    };
    let host = Arc::new(EmptyIdPurger::default());
    let (journal, _dir) = open_journal();
    let cases: Vec<Case> = vec![
        (
            "local store, directory exists",
            local(existing.path()),
            None,
        ),
        (
            "local store, no directory yet",
            local(&missing.path().join("missing")),
            None,
        ),
        ("S3 store", s3, None),
        ("built-in journal", local(existing.path()), Some(journal)),
        (
            "host purge store",
            local(existing.path()),
            Some(host.clone()),
        ),
    ];
    for (name, store, operations) in cases {
        let manager = Manager::new(ManagerOptions {
            store,
            endpoint: FakeEndpoint::null(),
            converter: Arc::new(TextConverter::default()),
            room: Options::default(),
            log: None,
            operations,
            activity: None,
            notes: None,
        });
        let replaced = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = replaced.clone();
        manager.on_document_replaced(move |doc| lock(&seen).push(doc.to_owned()));
        let authorized = Arc::new(Mutex::new(false));
        let ran = authorized.clone();
        let err = manager
            .purge("", async move {
                *lock(&ran) = true;
                Ok(true)
            })
            .await
            .expect_err("an empty id");
        assert!(matches!(err, Error::EmptyDocId), "{name}: {err}");
        assert_eq!(
            err.to_string(),
            "The value cannot be an empty string. (Parameter 'documentId')"
        );
        assert!(
            !*lock(&authorized) && lock(&replaced).is_empty(),
            "{name}: authorize or DocumentReplaced ran"
        );
        let recheck = manager.recheck_access("").await;
        assert!(matches!(recheck, Err(Error::EmptyDocId)), "{name}: recheck");
    }
    assert!(
        lock(&bucket.keys).is_empty() && lock(&host.purged).is_empty(),
        "a store saw the empty id"
    );
}

// C# refuses an empty doc id (ArgumentException) at every manager door,
// and an empty operation id at the edit doors, before any room exists.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_door_refuses_an_empty_doc_id_before_any_room_exists() {
    let (manager, _, endpoint) = test_manager(Options::default(), None);
    let no_plan: PlanOps = Arc::new(|_| Box::pin(async { Ok(Vec::new()) }));
    let doc_id = "The value cannot be an empty string. (Parameter 'docId')";
    let doors: Vec<(&str, Result<(), Error>)> = vec![
        (
            "join",
            manager
                .join(
                    "",
                    FakeMember::new("", blok_collab::OperationSource::ClientV1, true),
                )
                .await
                .map(drop),
        ),
        ("reset", manager.reset("").await.map(drop)),
        (
            "edit",
            manager
                .edit("", Vec::new(), "op", &[], "", None)
                .await
                .map(drop),
        ),
        (
            "agent edit",
            manager
                .agent_edit("", no_plan.clone(), "op", &[], "", None, None, None)
                .await
                .map(drop),
        ),
        ("state", manager.state("").await.map(drop)),
        ("checkpoint", manager.checkpoint("").await.map(drop)),
    ];
    for (name, result) in doors {
        let err = result.expect_err(name);
        assert!(matches!(err, Error::EmptyDocIdArgument), "{name}: {err}");
        assert_eq!(err.to_string(), doc_id, "{name}");
    }
    let operation_id = "The value cannot be an empty string. (Parameter 'operationId')";
    let edit = manager.edit("doc", Vec::new(), "", &[], "", None).await;
    assert!(matches!(&edit, Err(Error::EmptyOperationId)), "edit");
    assert_eq!(edit.err().unwrap().to_string(), operation_id);
    let agent = manager
        .agent_edit("doc", no_plan, "", &[], "", None, None, None)
        .await;
    assert!(matches!(agent, Err(Error::EmptyOperationId)), "agent edit");
    assert_eq!(manager.live_room_count(), 0);
    assert_eq!(endpoint.loaded(), 0);
}
