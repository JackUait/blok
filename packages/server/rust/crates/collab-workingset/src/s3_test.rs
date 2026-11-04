use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::*;

pub(crate) const DOC_ID: &str = "doc-1";
pub(crate) const DOC_KEY_HEX: &str =
    "bb0e4f49443794d901e8969ff11bd112e34208a0dcdf0e1eedb480cc9b3c7293";

pub(crate) fn store_tag() -> Tag {
    Tag {
        format: CURRENT_FORMAT,
        epoch: 3,
        lineage: "fedcba9876543210fedcba9876543210".to_owned(),
    }
}

pub(crate) fn section_of(updates: &[&[u8]]) -> Vec<u8> {
    encode_frames(updates).unwrap()
}

#[derive(Default)]
pub(crate) struct BucketState {
    pub objects: HashMap<String, Vec<u8>>,
    pub requests: Vec<String>,
    pub fail: Option<String>,
}

/// The raw-key surface of the S3 store; signing is the blob crate's.
#[derive(Clone, Default)]
pub(crate) struct MemoryBucket(pub Arc<Mutex<BucketState>>);

impl MemoryBucket {
    fn record(&self, request: String) -> Result<std::sync::MutexGuard<'_, BucketState>, Error> {
        let mut state = self.0.lock().unwrap();
        state.requests.push(request);
        match &state.fail {
            Some(failure) => Err(Error::Other(failure.clone().into())),
            None => Ok(state),
        }
    }

    pub fn requests(&self) -> Vec<String> {
        self.0.lock().unwrap().requests.clone()
    }

    pub fn object(&self, key: &str) -> Option<Vec<u8>> {
        self.0.lock().unwrap().objects.get(key).cloned()
    }

    pub fn seed(&self, key: &str, content: &[u8]) {
        self.0
            .lock()
            .unwrap()
            .objects
            .insert(key.to_owned(), content.to_vec());
    }
}

impl ObjectStore for MemoryBucket {
    async fn get_object(&self, key: &str) -> Result<Option<Vec<u8>>, Error> {
        Ok(self.record(format!("GET {key}"))?.objects.get(key).cloned())
    }

    async fn put_object(&self, key: &str, content: &[u8]) -> Result<(), Error> {
        self.record(format!("PUT {key}"))?
            .objects
            .insert(key.to_owned(), content.to_vec());
        Ok(())
    }

    async fn delete_object(&self, key: &str) -> Result<(), Error> {
        self.record(format!("DELETE {key}"))?.objects.remove(key);
        Ok(())
    }
}

pub(crate) fn s3_key() -> String {
    format!("collab/{DOC_KEY_HEX}")
}

pub(crate) type Logs = Arc<Mutex<Vec<String>>>;

pub(crate) fn s3_store(bucket: &MemoryBucket, prefix: &str) -> (S3Store<MemoryBucket>, Logs) {
    let logs: Logs = Arc::default();
    let sink = logs.clone();
    let store = S3Store::new(
        bucket.clone(),
        prefix,
        Some(Arc::new(move |message: &str| {
            sink.lock().unwrap().push(message.to_owned())
        })),
    )
    .unwrap();
    (store, logs)
}

#[tokio::test]
async fn s3_reads_absent_as_null() {
    let bucket = MemoryBucket::default();
    let (store, logs) = s3_store(&bucket, "collab");
    assert_eq!(store.read(DOC_ID).await.unwrap(), None);
    assert_eq!(bucket.requests(), [format!("GET {}", s3_key())]);
    assert!(logs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn s3_writes_then_reads_back_with_one_put() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "collab");
    let updates = section_of(&[&[1, 2], &[3]]);
    store.write(DOC_ID, &updates, &store_tag()).await.unwrap();
    assert_eq!(bucket.requests(), [format!("PUT {}", s3_key())]);
    assert_eq!(
        bucket.object(&s3_key()),
        Some(encode_document(&store_tag(), &updates).unwrap())
    );
    let stored = store.read(DOC_ID).await.unwrap().unwrap();
    assert_eq!(stored.updates, updates);
    assert_eq!(stored.tag, store_tag());
}

#[tokio::test]
async fn s3_write_does_not_read_the_object_to_guard_the_epoch() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "collab");
    bucket.seed(&s3_key(), &encode_document(&store_tag(), &[]).unwrap());
    let lower = Tag {
        epoch: store_tag().epoch - 1,
        ..store_tag()
    };
    store.write(DOC_ID, &[], &lower).await.unwrap();
    assert_eq!(bucket.requests(), [format!("PUT {}", s3_key())]);
}

#[tokio::test]
async fn s3_reset_rewrites_to_an_empty_log_and_requires_a_higher_epoch() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "collab");
    store
        .write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let refused = store.reset(DOC_ID, &store_tag()).await.unwrap_err();
    assert!(refused.to_string().contains("must raise"), "{refused}");
    let bumped = Tag {
        epoch: store_tag().epoch + 1,
        ..store_tag()
    };
    store.reset(DOC_ID, &bumped).await.unwrap();
    assert_eq!(
        bucket.object(&s3_key()),
        Some(encode_document(&bumped, &[]).unwrap())
    );
}

#[tokio::test]
async fn s3_treats_a_corrupt_object_as_absent_and_logs_it() {
    let bucket = MemoryBucket::default();
    let (store, logs) = s3_store(&bucket, "collab");
    bucket.seed(&s3_key(), b"not a working set");
    assert_eq!(store.read(DOC_ID).await.unwrap(), None);
    assert!(
        logs.lock()
            .unwrap()
            .iter()
            .any(|line| line.contains(DOC_ID))
    );
}

#[tokio::test]
async fn s3_trims_slashes_around_the_prefix_and_refuses_an_empty_one() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "/collab/");
    let _ = store.read(DOC_ID).await;
    assert_eq!(bucket.requests(), [format!("GET {}", s3_key())]);
    for prefix in ["", "///"] {
        assert!(
            S3Store::new(MemoryBucket::default(), prefix, None).is_err(),
            "{prefix:?} accepted"
        );
    }
}

#[tokio::test]
async fn s3_delete_targets_only_the_exact_object_and_may_be_repeated() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "collab");
    let other = format!("collab/{}", doc_key("doc-2"));
    bucket.seed(&s3_key(), &[1]);
    bucket.seed(&other, &[2]);
    store.delete(DOC_ID).await.unwrap();
    store.delete(DOC_ID).await.unwrap();
    assert_eq!(bucket.object(&s3_key()), None);
    assert_eq!(bucket.object(&other), Some(vec![2]));
    assert_eq!(
        bucket.requests(),
        [
            format!("DELETE {}", s3_key()),
            format!("DELETE {}", s3_key())
        ]
    );
}

#[tokio::test]
async fn s3_retire_deletes_a_readable_object_and_keeps_a_corrupt_one() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "collab");
    let corrupt = format!("collab/{}", doc_key("doc-2"));
    bucket.seed(&s3_key(), &encode_document(&store_tag(), &[]).unwrap());
    bucket.seed(&corrupt, b"not a working set");
    store.retire(DOC_ID).await.unwrap();
    store.retire("doc-2").await.unwrap();
    store.retire(DOC_ID).await.unwrap();
    assert_eq!(bucket.object(&s3_key()), None);
    assert_eq!(bucket.object(&corrupt), Some(b"not a working set".to_vec()));
}

#[tokio::test]
async fn s3_delete_propagates_a_failure() {
    let bucket = MemoryBucket::default();
    bucket.0.lock().unwrap().fail = Some("500".to_owned());
    let (store, _) = s3_store(&bucket, "collab");
    match store.delete(DOC_ID).await {
        Err(Error::Other(err)) => assert_eq!(err.to_string(), "500"),
        other => panic!("{other:?}"),
    }
}
