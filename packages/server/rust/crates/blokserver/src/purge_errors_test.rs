use std::sync::Arc;

use blok_collab::BoxFuture;
use blok_collab_journal::Context;
use blok_collab_room::{Error, Opened, OperationStore};

use crate::collab_test::collab_options;
use crate::testutil::temp_dir;
use crate::{CollabError, Options, Server};

/// A host journal that cannot purge.
struct OpenOnly;

impl OperationStore for OpenOnly {
    fn open<'a>(&'a self, _: &'a Context, _: &'a str) -> BoxFuture<'a, Result<Opened, Error>> {
        Box::pin(async { Err(Error::message("not opened in this test")) })
    }
    fn type_name(&self) -> &'static str {
        "blokserver_test.openOnly"
    }
}

async fn allow() -> Result<bool, Error> {
    Ok(true)
}

async fn deny() -> Result<bool, Error> {
    Ok(false)
}

// C# hosts catch ArgumentException, UnauthorizedAccessException and
// NotSupportedException from PurgeDocumentAsync; a Rust host matches the
// CollabError variants.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_can_tell_every_purge_refusal_apart() {
    let s = Server::new(collab_options()).unwrap();
    let none: Option<std::future::Ready<Result<bool, Error>>> = None;
    assert!(
        matches!(
            s.purge_document("", none).await,
            Err(CollabError::Room(Error::EmptyDocId))
        ),
        "an empty id"
    );
    assert!(
        matches!(
            s.recheck_access("").await,
            Err(CollabError::Room(Error::EmptyDocId))
        ),
        "recheck of an empty id"
    );
    assert!(
        matches!(
            s.purge_document("a/b", Some(allow())).await,
            Err(CollabError::Room(Error::NotSingleSegment))
        ),
        "a two-segment id"
    );
    assert!(
        matches!(
            s.purge_document("doc", Some(deny())).await,
            Err(CollabError::Room(Error::PurgeNotAuthorized))
        ),
        "a denied purge"
    );

    let s = Server::new(Options {
        collab_operation_store: Some(Arc::new(OpenOnly)),
        collab_directory: temp_dir().display().to_string(),
        ..collab_options()
    })
    .unwrap();
    let err = s.purge_document("doc", Some(allow())).await.unwrap_err();
    assert!(
        matches!(err, CollabError::Room(Error::PurgeUnsupported(_))),
        "a store that cannot purge: {err}"
    );
    assert_eq!(
        err.to_string(),
        "the operation journal cannot purge documents: the registered collabstore.OperationStore (blokserver_test.openOnly) must also implement collabstore.PurgeStore"
    );
}
