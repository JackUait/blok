use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

use blok_collab::BoxFuture;
use blok_collab_convert::{DocConverter, RuntimeHtmlReader};
use blok_collab_docendpoint::{Loaded, Projection};
use blok_collab_journal::{Store, StoreOptions};
use blok_collab_room::{
    Converter, Endpoint, Error as RoomError, LocalJournal, Manager, ManagerOptions, OperationStore,
    StateStatus, WorkingSetStore,
};
use blok_collab_workingset::{Set, Tag};
use blok_jsjson::{Node, Options as JsonOptions, Value, parse_node};
use blok_jsruntime::Pool;

use crate::room::receipt_head;
use crate::test_support::{SharedPool, must_parse, shared_reader};
use crate::{Executor, Invoker, Rooms};

// A room on the real converter and the real journal over a temp dir, with a
// working set and a doc endpoint in memory: the Rust side of C#
// AgentRoomForTests.

pub(crate) type RealConverter = DocConverter<&'static RuntimeHtmlReader<Pool>>;

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Default)]
pub(crate) struct MemorySets {
    sets: Mutex<HashMap<String, Set>>,
    writes: AtomicUsize,
}

impl MemorySets {
    pub(crate) fn write_count(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }
}

impl WorkingSetStore for MemorySets {
    fn read<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Option<Set>, RoomError>> {
        let set = lock(&self.sets).get(doc_id).cloned();
        Box::pin(async move { Ok(set) })
    }
    fn write<'a>(
        &'a self,
        doc_id: &'a str,
        updates: &'a [u8],
        tag: &'a Tag,
    ) -> BoxFuture<'a, Result<(), RoomError>> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        lock(&self.sets).insert(
            doc_id.to_owned(),
            Set {
                updates: updates.to_vec(),
                tag: tag.clone(),
            },
        );
        Box::pin(async { Ok(()) })
    }
    fn reset<'a>(&'a self, doc_id: &'a str, tag: &'a Tag) -> BoxFuture<'a, Result<(), RoomError>> {
        self.write(doc_id, &[], tag)
    }
    fn retire<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), RoomError>> {
        lock(&self.sets).remove(doc_id);
        Box::pin(async { Ok(()) })
    }
    fn delete<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<(), RoomError>> {
        self.retire(doc_id)
    }
}

/// Answers each held document on every load, whatever was saved.
#[derive(Default)]
pub(crate) struct HeldDocs {
    docs: Mutex<HashMap<String, String>>,
}

impl HeldDocs {
    pub(crate) fn hold(&self, doc: &str, json: &str) {
        lock(&self.docs).insert(doc.to_owned(), json.to_owned());
    }
}

impl Endpoint for HeldDocs {
    fn load<'a>(&'a self, doc_id: &'a str) -> BoxFuture<'a, Result<Loaded, RoomError>> {
        let text = lock(&self.docs).get(doc_id).cloned();
        Box::pin(async move {
            let Some(text) = text else {
                return Ok(Loaded::default());
            };
            let data = parse_node(text.as_bytes(), JsonOptions::default())
                .map_err(|err| RoomError::Other(Box::new(err)))?;
            Ok(Loaded {
                data: Some(data),
                version: None,
            })
        })
    }
    fn save<'a>(
        &'a self,
        _: &'a str,
        _: &'a Value,
        _: Option<&'a str>,
        _: Option<&'a Projection>,
    ) -> BoxFuture<'a, Result<Option<String>, RoomError>> {
        Box::pin(async { Ok(None) })
    }
}

/// A temp dir removed on drop.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new() -> TempDir {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "blok-blokagent-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).expect("a temp dir");
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn new_local_journal() -> (LocalJournal, TempDir) {
    let dir = TempDir::new();
    let store = Store::new(dir.0.clone(), StoreOptions::default()).expect("a journal");
    (LocalJournal(store), dir)
}

pub(crate) fn real_converter() -> RealConverter {
    DocConverter {
        now: Box::new(SystemTime::now),
        html: shared_reader(),
        fields: None,
        log: None,
    }
}

pub(crate) type Wrap = Box<dyn FnOnce(Arc<dyn Invoker>) -> Arc<dyn Invoker>>;
pub(crate) type WrapConverter = Box<dyn FnOnce(RealConverter) -> Arc<dyn Converter>>;

pub(crate) struct TestRoom {
    pub executor: Arc<Executor>,
    pub manager: Manager,
    pub sets: Arc<MemorySets>,
    pub docs: Arc<HeldDocs>,
    _dir: Option<TempDir>,
}

/// Rooms over the shared engine, with a journal unless `no_journal`.
/// `wrap` puts a test runtime in front of the real one.
pub(crate) fn new_test_room(no_journal: bool, wrap: Option<Wrap>) -> TestRoom {
    new_test_room_with(no_journal, wrap, None)
}

/// Also lets a test put its own converter in front of the real one.
pub(crate) fn new_test_room_with(
    no_journal: bool,
    wrap: Option<Wrap>,
    wrap_converter: Option<WrapConverter>,
) -> TestRoom {
    if no_journal {
        return new_test_room_on(None, None, wrap, wrap_converter);
    }
    let (journal, dir) = new_local_journal();
    new_test_room_on(Some(Arc::new(journal)), Some(dir), wrap, wrap_converter)
}

/// Rooms over the given journal (None: none).
pub(crate) fn new_test_room_on(
    operations: Option<Arc<dyn OperationStore>>,
    dir: Option<TempDir>,
    wrap: Option<Wrap>,
    wrap_converter: Option<WrapConverter>,
) -> TestRoom {
    new_test_room_on_with(operations, dir, wrap, wrap_converter, Default::default())
}

/// new_test_room_on with the rooms' own options.
pub(crate) fn new_test_room_on_with(
    operations: Option<Arc<dyn OperationStore>>,
    dir: Option<TempDir>,
    wrap: Option<Wrap>,
    wrap_converter: Option<WrapConverter>,
    room: blok_collab_room::Options,
) -> TestRoom {
    let sets = Arc::new(MemorySets::default());
    let docs = Arc::new(HeldDocs::default());
    let converter: Arc<dyn Converter> = match wrap_converter {
        Some(wrap) => wrap(real_converter()),
        None => Arc::new(real_converter()),
    };
    let mut o = ManagerOptions::new(sets.clone(), docs.clone(), converter);
    o.room = room;
    o.operations = operations;
    let manager = Manager::new(o);
    let runtime: Arc<dyn Invoker> = Arc::new(SharedPool);
    let runtime = match wrap {
        Some(wrap) => wrap(runtime),
        None => runtime,
    };
    let executor = Executor::new_on_runtime(runtime, Some(Rooms::new(manager.clone())));
    TestRoom {
        executor: Arc::new(executor),
        manager,
        sets,
        docs,
        _dir: dir,
    }
}

impl TestRoom {
    pub(crate) async fn export(&self, doc: &str) -> Node {
        let state = self.manager.state(doc).await.expect("state");
        assert_eq!(state.status, StateStatus::Ready, "state {:?}", state.err);
        must_parse(&String::from_utf8_lossy(&state.json))
    }

    pub(crate) async fn head(&self, doc: &str) -> String {
        let state = self.manager.state(doc).await.expect("state");
        assert!(state.head.is_some(), "state {:?}", state.status);
        receipt_head(state.head.as_ref())
    }
}
