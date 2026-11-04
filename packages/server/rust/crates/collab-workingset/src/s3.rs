use std::future::Future;
use std::sync::Arc;

use crate::{
    Error, Set, Tag, decode_or_absent, doc_key, encode_document, ensure_reset_raises_epoch, guard,
};

/// A sink for the store's warnings.
pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

/// The raw-key half of the S3 blob store (blob.S3). `get_object` answers
/// `None` for a missing key; `delete_object` treats one as deleted.
pub trait ObjectStore: Send + Sync {
    fn get_object(&self, key: &str) -> impl Future<Output = Result<Option<Vec<u8>>, Error>> + Send;
    fn put_object(
        &self,
        key: &str,
        content: &[u8],
    ) -> impl Future<Output = Result<(), Error>> + Send;
    fn delete_object(&self, key: &str) -> impl Future<Output = Result<(), Error>> + Send;
}

/// One object per document at {prefix}/{doc key} (C# S3CollabStore). A write
/// does not read first: the room owns the epoch law, and a guard GET would
/// double an edit's traffic.
pub struct S3Store<O> {
    store: O,
    prefix: String,
    log: Option<Log>,
}

// A dropped future is the caller's own cancellation, so nothing reaching
// `guard` from here was cancelled by the caller.
const CALLER_CANCELLED: bool = false;

impl<O: ObjectStore> S3Store<O> {
    /// Trims slashes around `prefix` and refuses an empty one.
    pub fn new(store: O, prefix: &str, log: Option<Log>) -> Result<Self, Error> {
        let trimmed = prefix.trim_matches('/');
        if trimmed.is_empty() {
            return Err(Error::Refused(
                "collab: the S3 prefix must not be empty. (Parameter 'prefix')".to_owned(),
            ));
        }
        Ok(Self {
            store,
            prefix: trimmed.to_owned(),
            log,
        })
    }

    fn key_for(&self, doc_id: &str) -> String {
        format!("{}/{}", self.prefix, doc_key(doc_id))
    }

    fn decode(&self, doc_id: &str, document: &[u8]) -> Option<Set> {
        decode_or_absent(
            doc_id,
            document,
            self.log.as_deref().map(|log| log as &dyn Fn(&str)),
        )
    }

    pub async fn read(&self, doc_id: &str) -> Result<Option<Set>, Error> {
        let result = match self.store.get_object(&self.key_for(doc_id)).await {
            Ok(Some(document)) => Ok(self.decode(doc_id, &document)),
            Ok(None) => Ok(None),
            Err(err) => Err(err),
        };
        guard(CALLER_CANCELLED, doc_id, "read", result)
    }

    pub async fn write(&self, doc_id: &str, updates: &[u8], tag: &Tag) -> Result<(), Error> {
        let result = async {
            let document = encode_document(tag, updates)?;
            self.store
                .put_object(&self.key_for(doc_id), &document)
                .await
        }
        .await;
        guard(CALLER_CANCELLED, doc_id, "write", result)
    }

    pub async fn reset(&self, doc_id: &str, tag: &Tag) -> Result<(), Error> {
        let result = async {
            let document = encode_document(tag, &[])?;
            let stored = self.read(doc_id).await?;
            ensure_reset_raises_epoch(doc_id, stored.as_ref(), tag)?;
            self.store
                .put_object(&self.key_for(doc_id), &document)
                .await
        }
        .await;
        guard(CALLER_CANCELLED, doc_id, "reset", result)
    }

    /// Deletes a readable object; a corrupt one is the only copy left to repair.
    pub async fn retire(&self, doc_id: &str) -> Result<(), Error> {
        let result = async {
            let document = self.store.get_object(&self.key_for(doc_id)).await?;
            match document {
                Some(document) if self.decode(doc_id, &document).is_some() => {
                    self.store.delete_object(&self.key_for(doc_id)).await
                }
                _ => Ok(()),
            }
        }
        .await;
        guard(CALLER_CANCELLED, doc_id, "retire", result)
    }

    pub async fn delete(&self, doc_id: &str) -> Result<(), Error> {
        let result = self.store.delete_object(&self.key_for(doc_id)).await;
        guard(CALLER_CANCELLED, doc_id, "delete", result)
    }
}
