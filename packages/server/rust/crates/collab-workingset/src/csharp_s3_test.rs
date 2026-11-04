use crate::s3_test::*;
use crate::*;

#[tokio::test]
async fn reset_requires_a_strictly_higher_epoch() {
    let bucket = MemoryBucket::default();
    let (store, _) = s3_store(&bucket, "collab");
    bucket.seed(&s3_key(), &encode_document(&store_tag(), &[]).unwrap());
    assert!(matches!(
        store.reset(DOC_ID, &store_tag()).await,
        Err(Error::Refused(_))
    ));
    assert!(
        !bucket
            .requests()
            .iter()
            .any(|request| request.starts_with("PUT "))
    );
}

#[tokio::test]
async fn treats_a_corrupt_object_as_absent_and_logs_it() {
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
    let zero = Tag {
        epoch: 0,
        ..store_tag()
    };
    store.write(DOC_ID, &[], &zero).await.unwrap();
    assert_eq!(
        bucket.object(&s3_key()),
        Some(encode_document(&zero, &[]).unwrap())
    );
}
