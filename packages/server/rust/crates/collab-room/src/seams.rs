use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

use blok_collab::BoxFuture;
use blok_collab_convert::{DocConverter, EditOp, HtmlReader, RichTextHtmlSlot};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{
    Context, LineageDeleteOutcome, LineageInfo, OpenOutcome, PurgeOutcome, RecordHeader,
};
use blok_collab_operation::{
    AppendResult, Candidate, Checkpoint, Head, Lookup, OpenResult, Record, Reset,
};
use blok_collab_workingset::{Set, Tag};
use blok_jsjson::{Node, Object, Value};
use blok_yjs::Doc;

use crate::Error;

/// ICollabWorkingSetStore; LocalStore and S3Store are both one.
pub trait WorkingSetStore: Send + Sync {
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, Error>>;
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), Error>>;
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>>;
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>>;
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>>;
}

impl WorkingSetStore for blok_collab_workingset::LocalStore {
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, Error>> {
        Box::pin(async move { Ok(self.read(doc_id).await?) })
    }
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.write(doc_id, updates, tag).await?) })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.reset(doc_id, tag).await?) })
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.retire(doc_id).await?) })
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.delete(doc_id).await?) })
    }
}

impl<O: blok_collab_workingset::ObjectStore> WorkingSetStore
    for blok_collab_workingset::S3Store<O>
{
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, Error>> {
        Box::pin(async move { Ok(self.read(doc_id).await?) })
    }
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.write(doc_id, updates, tag).await?) })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.reset(doc_id, tag).await?) })
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.retire(doc_id).await?) })
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(self.delete(doc_id).await?) })
    }
}

/// IDocEndpointClient.
pub trait Endpoint: Send + Sync {
    fn load<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, Error>>;
    fn save<'a>(
        &'a self,
        doc_id: &'a str,
        output_data: &'a Value,
        version: Option<&'a str>,
        projection: Option<&'a Projection>,
    ) -> BoxFuture<'a, Result<Option<String>, Error>>;
}

impl Endpoint for blok_collab_docendpoint::Client {
    fn load<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, Error>> {
        Box::pin(async move { Ok(self.load(doc_id).await?) })
    }
    fn save<'a>(
        &'a self,
        doc_id: &'a str,
        output_data: &'a Value,
        version: Option<&'a str>,
        projection: Option<&'a Projection>,
    ) -> BoxFuture<'a, Result<Option<String>, Error>> {
        Box::pin(async move { Ok(self.save(doc_id, output_data, version, projection).await?) })
    }
}

/// ICollabDocConverter. A caller cancels a call by dropping its future.
pub trait Converter: Send + Sync {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>>;
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>>;
    fn apply_ops<'a>(&'a self, doc: &'a Doc, ops: &'a [EditOp])
    -> BoxFuture<'a, Result<(), Error>>;
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>>;
    /// What the changes replay needs beyond this; None when it cannot.
    fn history(&self) -> Option<&dyn HistoryConverter> {
        None
    }
}

/// What the changes replay needs beyond Converter.
pub trait HistoryConverter: Send + Sync {
    fn export_blocks(
        &self,
        doc: &Doc,
        warned: &mut HashSet<String>,
    ) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), Error>;
    /// Writes each slot's segments into `blocks`, the array they were
    /// exported with.
    fn resolve<'a>(
        &'a self,
        blocks: &'a mut [Value],
        slots: &'a [RichTextHtmlSlot],
    ) -> BoxFuture<'a, Result<(), Error>>;
}

impl<R: HtmlReader + Send + Sync> Converter for DocConverter<R> {
    fn seed<'a>(&'a self, doc: &'a Doc, output_data: &'a Node) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(DocConverter::seed(self, doc, output_data).await?) })
    }
    fn export<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<Object, Error>> {
        Box::pin(async move { Ok(DocConverter::export(self, doc).await?) })
    }
    fn apply_ops<'a>(
        &'a self,
        doc: &'a Doc,
        ops: &'a [EditOp],
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(DocConverter::apply_ops(self, doc, ops).await?) })
    }
    fn migrate_rich_text<'a>(&'a self, doc: &'a Doc) -> BoxFuture<'a, Result<usize, Error>> {
        Box::pin(async move { Ok(DocConverter::migrate_rich_text(self, doc).await?) })
    }
    fn history(&self) -> Option<&dyn HistoryConverter> {
        Some(self)
    }
}

impl<R: HtmlReader + Send + Sync> HistoryConverter for DocConverter<R> {
    fn export_blocks(
        &self,
        doc: &Doc,
        warned: &mut HashSet<String>,
    ) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), Error> {
        Ok(DocConverter::export_blocks(self, doc, warned)?)
    }
    fn resolve<'a>(
        &'a self,
        blocks: &'a mut [Value],
        slots: &'a [RichTextHtmlSlot],
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { Ok(DocConverter::resolve(self, blocks, slots).await?) })
    }
}

/// What an open answers: a session only for OpenOutcome::Opened.
pub type Opened = (OpenOutcome, Option<Arc<dyn OperationSession>>);

/// ICollabOperationStore.
pub trait OperationStore: Send + Sync {
    /// Answers a session only for OpenOutcome::Opened.
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>>;
    /// ICollabOperationPurgeStore, when the store is one.
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        None
    }
    /// ICollabOperationHistoryStore, when the store is one.
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        None
    }
    /// The store's type, for the purge refusal.
    fn type_name(&self) -> &'static str;
}

/// ICollabOperationSession. The room serialises its use.
pub trait OperationSession: Send + Sync {
    fn open_result(&self) -> &OpenResult;
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>>;
    fn append<'a>(
        &'a self,
        ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>>;
    fn write_checkpoint<'a>(
        &'a self,
        ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>>;
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>>;
    fn close(&self) -> BoxFuture<'_, Result<(), Error>>;
}

/// ICollabOperationPurgeStore.
pub trait PurgeStore: Send + Sync {
    fn purge<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>>;
}

pub type Records<'a> = Box<dyn Iterator<Item = Result<Record, Error>> + Send + 'a>;
pub type Headers<'a> = Box<dyn Iterator<Item = Result<RecordHeader, Error>> + Send + 'a>;

/// ICollabOperationHistoryStore: the reads behind the history routes. The
/// reads block, as the built-in journal does; the iterators are lazy, so a
/// reader that stops early never reads (or fails on) what follows.
pub trait HistoryStore: Send + Sync {
    fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, Error>;
    fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, Error>;
    fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, Error>;
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a>;
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a>;
    fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, Error>;
}

/// The built-in journal as an OperationStore, a PurgeStore and a
/// HistoryStore. Its calls block, so they run on blocking threads.
#[derive(Clone)]
pub struct LocalJournal(pub blok_collab_journal::Store);

struct LocalSession {
    opened: OpenResult,
    session: Arc<Mutex<blok_collab_journal::Session>>,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, blok_collab_journal::Error> + Send + 'static,
) -> Result<T, Error> {
    match tokio::task::spawn_blocking(work).await {
        Ok(result) => Ok(result?),
        Err(err) => Err(Error::message(format!(
            "collab: the journal call failed: {err}"
        ))),
    }
}

impl LocalSession {
    async fn with<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut blok_collab_journal::Session) -> Result<T, blok_collab_journal::Error>
        + Send
        + 'static,
    ) -> Result<T, Error> {
        let session = self.session.clone();
        blocking(move || work(&mut session.lock().unwrap_or_else(PoisonError::into_inner))).await
    }
}

impl OperationSession for LocalSession {
    fn open_result(&self) -> &OpenResult {
        &self.opened
    }
    fn find_committed<'a>(
        &'a self,
        ctx: &'a Context,
        operation_id: &'a str,
        digest: &'a [u8],
    ) -> BoxFuture<'a, Result<Lookup, Error>> {
        let (ctx, id, digest) = (ctx.clone(), operation_id.to_owned(), digest.to_vec());
        Box::pin(self.with(move |s| s.find_committed(&ctx, &id, &digest)))
    }
    fn append<'a>(
        &'a self,
        ctx: &'a Context,
        candidate: Candidate,
    ) -> BoxFuture<'a, Result<AppendResult, Error>> {
        let ctx = ctx.clone();
        Box::pin(self.with(move |s| s.append(&ctx, &candidate)))
    }
    fn write_checkpoint<'a>(
        &'a self,
        ctx: &'a Context,
        checkpoint: Checkpoint,
    ) -> BoxFuture<'a, Result<(), Error>> {
        let ctx = ctx.clone();
        Box::pin(self.with(move |s| s.write_checkpoint(&ctx, &checkpoint)))
    }
    fn reset<'a>(&'a self, ctx: &'a Context, reset: Reset) -> BoxFuture<'a, Result<Head, Error>> {
        let ctx = ctx.clone();
        Box::pin(self.with(move |s| s.reset(&ctx, &reset)))
    }
    fn close(&self) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(self.with(|s| {
            s.close();
            Ok(())
        }))
    }
}

impl OperationStore for LocalJournal {
    fn open<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<Opened, Error>> {
        let (store, ctx, doc_id) = (self.0.clone(), ctx.clone(), doc_id.to_owned());
        Box::pin(async move {
            let (outcome, session) = blocking(move || store.open(&ctx, &doc_id)).await?;
            let session = session.map(|session| {
                Arc::new(LocalSession {
                    opened: session.open_result().clone(),
                    session: Arc::new(Mutex::new(session)),
                }) as Arc<dyn OperationSession>
            });
            Ok((outcome, session))
        })
    }
    fn as_purge(&self) -> Option<&dyn PurgeStore> {
        Some(self)
    }
    fn as_history(&self) -> Option<&dyn HistoryStore> {
        Some(self)
    }
    fn type_name(&self) -> &'static str {
        "blok_collab_room::LocalJournal"
    }
}

impl PurgeStore for LocalJournal {
    fn purge<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
    ) -> BoxFuture<'a, Result<PurgeOutcome, Error>> {
        let (store, ctx, doc_id) = (self.0.clone(), ctx.clone(), doc_id.to_owned());
        Box::pin(blocking(move || store.purge(&ctx, &doc_id)))
    }
}

impl HistoryStore for LocalJournal {
    fn is_purged(&self, ctx: &Context, doc_id: &str) -> Result<bool, Error> {
        Ok(self.0.is_purged(ctx, doc_id)?)
    }
    fn list_lineages(&self, ctx: &Context, doc_id: &str) -> Result<Vec<LineageInfo>, Error> {
        Ok(self.0.list_lineages(ctx, doc_id)?)
    }
    fn read_baseline(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, Error> {
        Ok(self.0.read_baseline(ctx, doc_id, lineage)?)
    }
    fn read_headers<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
    ) -> Headers<'a> {
        Box::new(
            self.0
                .read_headers(ctx, doc_id, lineage)
                .map(|r| r.map_err(Error::from)),
        )
    }
    fn read_records<'a>(
        &'a self,
        ctx: &'a Context,
        doc_id: &'a str,
        lineage: &'a str,
        through: u64,
    ) -> Records<'a> {
        Box::new(
            self.0
                .read_records(ctx, doc_id, lineage, through)
                .map(|r| r.map_err(Error::from)),
        )
    }
    fn delete_lineage(
        &self,
        ctx: &Context,
        doc_id: &str,
        lineage: &str,
    ) -> Result<LineageDeleteOutcome, Error> {
        Ok(self.0.delete_lineage(ctx, doc_id, lineage)?)
    }
}

/// CollabActivityKind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ActivityKind {
    Joined,
    Active,
    Edited,
    Left,
}

impl std::fmt::Display for ActivityKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ActivityKind::Joined => "Joined",
            ActivityKind::Active => "Active",
            ActivityKind::Edited => "Edited",
            ActivityKind::Left => "Left",
        })
    }
}

/// ICollabActivityObserver. Calls come off the room's lane, one at a time
/// per room, in the order the room produced them.
pub trait ActivityObserver: Send + Sync {
    fn record<'a>(
        &'a self,
        doc_id: &'a str,
        actor_id: &'a str,
        at: SystemTime,
        kind: ActivityKind,
    ) -> BoxFuture<'a, Result<(), Error>>;
}
