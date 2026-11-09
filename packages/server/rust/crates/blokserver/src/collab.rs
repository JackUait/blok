//! Collaboration: the room manager the sync door and the collab routes
//! share, the one engine pool behind the rooms and the document converter,
//! and the host calls (recheck, purge, drain). Port of Go blokserver's
//! collab.go.

use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use blok_collab::{BoxFuture, JoinResult, Member, Rooms};
use blok_collab_convert::{
    DocConverter, Invoker, RichTextFieldEntry, RichTextFields, RuntimeHtmlReader,
};
use blok_collab_room::{
    LocalJournal, Manager, ManagerOptions, OperationStore, Options as RoomOptions, WorkingSetStore,
};
use blok_jsjson::Str;
use blok_jsruntime::{ConstraintError, Failure, InvokeError, Kind, Pool, PoolError};

pub use blok_collab_journal::PurgeOutcome;

use crate::log::{COLLAB_LOG_CATEGORY, HOST_LOG_CATEGORY, Level, Logger};
use crate::options::Options;
use crate::server::{Inner, Server, lock};

/// DocEndpointRequestTimeout: 30 s per request.
const DOC_ENDPOINT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A collab call refused or failed. Its text is Go's error text.
#[derive(Debug)]
pub enum CollabError {
    /// A collab call on a server built without collab_enabled.
    Disabled,
    /// PurgeDocument needs its authorize callback.
    NoAuthorize,
    /// The room manager could not be built.
    Build(String),
    /// The rooms refused or failed: EmptyDocId and NotSingleSegment are
    /// C#'s ArgumentException, PurgeNotAuthorized its
    /// UnauthorizedAccessException, PurgeUnsupported its
    /// NotSupportedException.
    Room(blok_collab_room::Error),
}

impl std::fmt::Display for CollabError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CollabError::Disabled => f.write_str("Collaboration is disabled."),
            CollabError::NoAuthorize => {
                f.write_str("collab: document purge needs an authorize callback.")
            }
            CollabError::Build(message) => f.write_str(message),
            CollabError::Room(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for CollabError {}

/// Builds an engine pool; a test swaps it to count builds.
pub(crate) type Builder =
    Arc<dyn Fn(blok_jsruntime::Options) -> Result<Pool, PoolError> + Send + Sync>;

/// Why the pool could not be built, kept so every later call fails alike.
#[derive(Clone)]
enum BuildFailure {
    Constraint(ConstraintError),
    Message(String),
}

/// The engine pool, built on its first use (an HTML read or a conversion):
/// C# registers the runtime but does not warm it for a collaboration host.
pub(crate) struct LazyRuntime {
    options: blok_jsruntime::Options,
    pool: tokio::sync::OnceCell<Result<Arc<Pool>, BuildFailure>>,
    pub(crate) build: Mutex<Builder>,
}

impl LazyRuntime {
    pub(crate) fn new(options: blok_jsruntime::Options) -> Self {
        Self {
            options,
            pool: tokio::sync::OnceCell::new(),
            build: Mutex::new(Arc::new(Pool::new)),
        }
    }

    async fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Option<Duration>,
    ) -> Result<String, InvokeError> {
        self.pool().await?.invoke(op, input, timeout).await
    }

    /// Never raced against a cancel: a dropped build keeps loading in the
    /// blocking pool and the next caller would start a second one.
    async fn pool(&self) -> Result<Arc<Pool>, InvokeError> {
        let built = self
            .pool
            .get_or_init(|| async {
                let build = lock(&self.build).clone();
                let options = self.options;
                // Loading the engines blocks.
                match tokio::task::spawn_blocking(move || build(options)).await {
                    Ok(Ok(pool)) => Ok(Arc::new(pool)),
                    Ok(Err(PoolError::Constraint(err))) => Err(BuildFailure::Constraint(err)),
                    Ok(Err(err)) => Err(BuildFailure::Message(err.to_string())),
                    Err(err) => Err(BuildFailure::Message(err.to_string())),
                }
            })
            .await;
        match built {
            Ok(pool) => Ok(Arc::clone(pool)),
            Err(BuildFailure::Constraint(err)) => Err(InvokeError::Constraint(err.clone())),
            Err(BuildFailure::Message(message)) => Err(InvokeError::Failure(Failure {
                kind: Kind::Unknown,
                err: blok_jsruntime::Error::Engine(message.clone()),
            })),
        }
    }
}

/// One handle on the server's engine pool.
#[derive(Clone)]
pub(crate) struct SharedRuntime(pub Arc<LazyRuntime>);

impl blok_blokdocs::Runtime for SharedRuntime {
    fn invoke<'a>(
        &'a self,
        op: &'a str,
        input: &'a str,
        timeout: Option<Duration>,
    ) -> blok_blokdocs::InvokeFuture<'a> {
        Box::pin(self.0.invoke(op, input, timeout))
    }
}

impl blok_blokagent::Invoker for SharedRuntime {
    fn invoke<'a>(
        &'a self,
        cancel: &'a blok_blokagent::Cancel,
        op: &'a str,
        input: &'a str,
        timeout: Option<Duration>,
    ) -> blok_blokagent::InvokeFuture<'a> {
        Box::pin(async move {
            let pool = self.0.pool().await.map_err(|err| match err {
                InvokeError::Constraint(err) => blok_blokagent::Error::Constraint(err),
                InvokeError::Failure(failure) => {
                    blok_blokagent::Error::Conversion(blok_blokdocs::ConversionError {
                        reason: blok_blokdocs::Reason::Unknown,
                        source: Some(Box::new(failure)),
                    })
                }
            })?;
            <Pool as blok_blokagent::Invoker>::invoke(&pool, cancel, op, input, timeout).await
        })
    }
}

impl Invoker for SharedRuntime {
    fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Option<Duration>,
    ) -> impl Future<Output = Result<String, InvokeError>> + Send {
        self.0.invoke(op, input, timeout)
    }
}

/// The room manager, built on first use as C# resolves its singletons: a
/// host that never opens a room never touches the directory.
#[derive(Default)]
pub(crate) struct CollabRooms {
    manager: OnceLock<Result<Manager, String>>,
}

impl CollabRooms {
    pub(crate) fn get(&self, inner: &Inner) -> Result<Manager, String> {
        self.manager
            .get_or_init(|| inner.build_room_manager())
            .clone()
    }
}

/// The sync door's view of the rooms: the manager, built on the first join.
pub(crate) struct LazyRooms(pub Arc<Inner>);

impl Rooms for LazyRooms {
    fn join<'a>(
        &'a self,
        doc: &'a str,
        member: Arc<dyn Member>,
    ) -> BoxFuture<'a, Result<JoinResult, blok_collab::Error>> {
        Box::pin(async move {
            let manager = self.0.rooms()?;
            Rooms::join(&manager, doc, member).await
        })
    }
}

fn log_to(logger: Option<Arc<dyn Logger>>) -> Option<blok_collab_room::Log> {
    let logger = logger?;
    Some(Arc::new(move |message: &str| {
        logger.log(Level::Warn, COLLAB_LOG_CATEGORY, message);
    }))
}

impl Inner {
    /// CollabOperationStoreSource answering a store.
    pub(crate) fn has_journal(&self) -> bool {
        let o = &self.options;
        o.collab_enabled
            && (o.collab_operation_store.is_some()
                || o.collab_journal
                || lock(&self.conformance).journal)
    }

    /// The room manager; Err when collaboration is off or it could not be
    /// built.
    pub(crate) fn rooms(&self) -> Result<Manager, String> {
        match &self.collab {
            Some(collab) => collab.get(self),
            None => Err(CollabError::Disabled.to_string()),
        }
    }

    pub(crate) fn corrupt_log(&self, doc: &str) {
        if let Some(logger) = &self.options.logger {
            logger.log(
                Level::Error,
                COLLAB_LOG_CATEGORY,
                &format!("collab: a stored version of \"{doc}\" could not be read"),
            );
        }
    }

    fn build_room_manager(&self) -> Result<Manager, String> {
        let o = &self.options;
        let log = log_to(o.logger.clone());
        let store: Arc<dyn WorkingSetStore> = if !o.collab_s3_prefix.is_empty() {
            let objects = blok_blob::S3::new(crate::server::s3_options(o))
                .map_err(|e| e.to_string())?
                .with_clock(Arc::clone(&self.clock));
            let s3 =
                blok_collab_workingset::S3Store::new(objects, &o.collab_s3_prefix, log.clone())
                    .map_err(|e| e.to_string())?;
            Arc::new(s3)
        } else {
            Arc::new(blok_collab_workingset::LocalStore::new(
                &o.collab_directory,
                log.clone(),
            ))
        };

        let endpoint = blok_dotnet::parse_absolute_uri(&o.doc_endpoint).ok_or_else(|| {
            format!(
                "collab: the doc endpoint {:?} is not an absolute URI",
                o.doc_endpoint
            )
        })?;
        let client = blok_collab_docendpoint::Client::new(blok_collab_docendpoint::Options {
            endpoint,
            authorization: o.doc_endpoint_auth.clone(),
            request_timeout: Some(DOC_ENDPOINT_REQUEST_TIMEOUT),
            max_response_bytes: 0,
        });

        let entries: Vec<RichTextFieldEntry> = o
            .rich_text_fields
            .iter()
            .map(|(kind, fields)| RichTextFieldEntry {
                kind: Str::from(kind.as_str()),
                fields: Some(fields.iter().map(|f| Str::from(f.as_str())).collect()),
            })
            .collect();
        let fields = RichTextFields::new(&entries).map_err(|e| e.to_string())?;
        let clock = Arc::clone(&self.clock);
        let converter = DocConverter {
            now: Box::new(move || clock()),
            html: RuntimeHtmlReader {
                runtime: SharedRuntime(Arc::clone(&self.runtime)),
            },
            fields: Some(fields),
            log: log.clone().map(|log| Box::new(move |m: &str| log(m)) as _),
        };

        let clock = Arc::clone(&self.clock);
        let mut room = RoomOptions {
            announced_max_message_bytes: o.collab_max_message_bytes,
            restore_trashes_pages: o.collab_restore_trashes_pages,
            now: Some(Arc::new(move || clock())),
            timers: o.timers.clone(),
            ..RoomOptions::default()
        };
        let operations: Option<Arc<dyn OperationStore>> =
            if let Some(store) = &o.collab_operation_store {
                // Only the built-in journal states its append limit.
                Some(Arc::clone(store))
            } else if self.has_journal() {
                // The built-in journal on its default limit, as C#
                // constructs it.
                let local = blok_collab_journal::Store::new(
                    &o.collab_directory,
                    blok_collab_journal::StoreOptions {
                        log: log.clone(),
                        ..Default::default()
                    },
                )
                .map_err(|e| e.to_string())?;
                room.max_update_bytes = local.max_update_bytes();
                Some(Arc::new(LocalJournal(local)))
            } else {
                None
            };
        let mut options = ManagerOptions::new(store, Arc::new(client), Arc::new(converter));
        options.room = room;
        options.log = log;
        options.operations = operations;
        options.activity = o.collab_activity_observer.clone();
        options.notes = o.collab_record_notes.clone();
        Ok(Manager::new(options))
    }

    /// The open-routes warning, under the host category: the standalone
    /// host prints only the room category, so it never shows it.
    pub(crate) fn warn_open_sync_routes(&self, prefix: &str) {
        let Some(logger) = &self.options.logger else {
            return;
        };
        let history = [
            format!("GET {prefix}/sync/{{doc}}/history"),
            format!("GET {prefix}/sync/{{doc}}/history/{{lineage}}/{{sequence}}"),
            format!("DELETE {prefix}/sync/{{doc}}/history/{{lineage}}"),
            format!("POST {prefix}/sync/{{doc}}/history/{{lineage}}/{{sequence}}/restore"),
            format!("POST {prefix}/sync/{{doc}}/history/{{lineage}}/{{sequence}}/restore/preview"),
            format!("GET {prefix}/sync/{{doc}}/history/{{lineage}}/{{sequence}}/changes"),
            format!("GET {prefix}/sync/{{doc}}/history/at"),
            format!("GET {prefix}/sync/{{doc}}/history/changes"),
        ];
        let (sync, reset, edit, state) = (
            format!("GET {prefix}/sync/{{doc}}"),
            format!("POST {prefix}/sync/{{doc}}/reset"),
            format!("POST {prefix}/sync/{{doc}}/edit"),
            format!("GET {prefix}/sync/{{doc}}/state"),
        );
        let history = history.join(", ");
        // The fields are C#'s EventId 2 "CollabOpen" and its message fields.
        logger.log_fields(
            Level::Warn,
            HOST_LOG_CATEGORY,
            &format!(
                "collab: no authorization hook is set and Auth is \"none\", so {sync}, {reset}, {edit}, {state} and {history} are open to anyone who can reach this app unless the host puts its own auth in front; set Options.Authorization or set Auth to \"ticket\""
            ),
            &[
                ("EventId", "2"),
                ("EventName", "CollabOpen"),
                ("Sync", &sync),
                ("Reset", &reset),
                ("Edit", &edit),
                ("State", &state),
                ("History", &history),
            ],
        );
    }
}

impl Server {
    fn manager(&self) -> Result<Manager, CollabError> {
        match &self.inner.collab {
            None => Err(CollabError::Disabled),
            Some(collab) => collab.get(&self.inner).map_err(CollabError::Build),
        }
    }

    /// ICollabRoomManager.RecheckAccessAsync: rechecks every member of a
    /// loaded document against the Authorization hook and closes the ones
    /// that fail with 4403. It answers how many were closed.
    pub async fn recheck_access(&self, doc: &str) -> Result<usize, CollabError> {
        let manager = self.manager()?;
        manager.recheck_access(doc).await.map_err(CollabError::Room)
    }

    /// ICollabDocumentPurger.PurgeDocumentAsync: authorize runs first; then
    /// open sockets close 4403 and the working set and journal are deleted.
    pub async fn purge_document<F>(
        &self,
        doc: &str,
        authorize: Option<F>,
    ) -> Result<PurgeOutcome, CollabError>
    where
        F: Future<Output = Result<bool, blok_collab_room::Error>>,
    {
        if self.inner.collab.is_none() {
            return Err(CollabError::Disabled);
        }
        // C# checks the id before the callback.
        if doc.is_empty() {
            return Err(CollabError::Room(blok_collab_room::Error::EmptyDocId));
        }
        let Some(authorize) = authorize else {
            return Err(CollabError::NoAuthorize);
        };
        let manager = self.manager()?;
        manager
            .purge(doc, authorize)
            .await
            .map_err(CollabError::Room)
    }

    /// The server's document converter: one converter over the engine pool
    /// the rooms use, as C# AddBlokServer registers it. Nothing is built
    /// until the first conversion.
    pub fn document_converter(&self) -> blok_blokdocs::Converter {
        self.inner.document_converter()
    }

    /// The server's agent executor: one executor over the server's engine
    /// pool that edits its live rooms when collaboration is on, as C#
    /// AddBlokDocuments registers it. No route calls it; a host embedding
    /// the server does. Nothing is built until the first call, and a room
    /// manager that failed to build fails every later call alike.
    pub fn agent_executor(&self) -> Result<Arc<blok_blokagent::Executor>, CollabError> {
        let inner = &self.inner;
        inner
            .agent
            .get_or_init(|| {
                let rooms = match &inner.collab {
                    Some(collab) => Some(blok_blokagent::Rooms::new(collab.get(inner)?)),
                    None => None,
                };
                Ok(Arc::new(blok_blokagent::Executor::new_on_runtime(
                    SharedRuntime(Arc::clone(&inner.runtime)),
                    rooms,
                )))
            })
            .clone()
            .map_err(CollabError::Build)
    }

    /// Makes the sync door refuse upgrades past max, as Kestrel's
    /// MaxConcurrentUpgradedConnections does. Call it before `handler`.
    pub fn limit_upgrades(&self, max: i64) {
        *lock(&self.inner.upgrades) = Some(Arc::new(blok_collab_synchttp::UpgradeLimit::new(max)));
    }
}

impl Inner {
    pub(crate) fn document_converter(&self) -> blok_blokdocs::Converter {
        self.documents
            .get_or_init(|| blok_blokdocs::new_on_runtime(SharedRuntime(Arc::clone(&self.runtime))))
            .clone()
    }
}

/// Options read by `Server::new` for the shared pool.
pub(crate) fn runtime_options(o: &Options) -> blok_jsruntime::Options {
    blok_jsruntime::Options {
        pool_size: o.documents.pool_size,
        timeout: o.documents.timeout,
        memory_budget: o.documents.memory_budget,
    }
}
