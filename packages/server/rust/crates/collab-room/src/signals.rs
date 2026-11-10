use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, SystemTime};

use blok_collab::BoxFuture;
use blok_jsjson::{Object, Str, Value};
use tokio::sync::Notify;

use crate::changes::{BlockChangeKind, RecordChanges};
use crate::database_changes::describe_database_change;
use crate::error::Error;
use crate::manager::{Manager, Shared};
use crate::notes::RecordNote;
use crate::{ActivityObserver, HistoryStatus, MAX_CHANGE_BYTES};

/// CollabSignalBlock: one block, added, removed, changed or moved over the
/// window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalBlock {
    pub id: String,
    pub kind: String,
}

/// CollabSignalProperties: the property ids that changed on one database row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalProperties {
    pub row_id: String,
    pub ids: Vec<String>,
}

/// CollabSignalSchema: one schema entry of one database, created, updated
/// or deleted over the window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalSchema {
    pub database_id: String,
    pub id: String,
    pub name: Option<String>,
    pub action: String,
}

/// CollabSignalAuthor. `kind` is None when no note was written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalAuthor {
    pub id: String,
    pub kind: Option<String>,
}

/// CollabChangeSignal: what changed in one document during one window, by
/// id only. Signals can be lost; a host that must not miss a change
/// reconciles through /history/changes and olderEnd.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangeSignal {
    pub doc_id: String,
    pub lineage: String,
    pub from_sequence: u64,
    pub to_sequence: u64,
    pub window_start: SystemTime,
    pub window_end: SystemTime,
    pub blocks: Vec<SignalBlock>,
    pub page: Vec<String>,
    pub properties: Vec<SignalProperties>,
    pub schema: Vec<SignalSchema>,
    pub authors: Vec<SignalAuthor>,
}

/// One journal record as the change signals read it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalRecord {
    pub lineage: String,
    pub sequence: u64,
    pub committed_at: SystemTime,
    pub actor: Option<String>,
    pub note: Option<RecordNote>,
    pub blocks: Vec<SignalBlock>,
    pub page: Vec<String>,
    pub properties: Vec<SignalProperties>,
    pub schema: Vec<SignalSchema>,
}

/// CollabAuditEventTypes.
pub const AUDIT_CONTENT_EDITED: &str = "content.edited";
pub const AUDIT_LINEAGE_DELETED: &str = "history.lineageDeleted";
pub const AUDIT_DOCUMENT_PURGED: &str = "document.purged";

/// CollabAuditActor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuditActor {
    pub id: String,
    pub kind: Option<String>,
    pub on_behalf_of: Option<String>,
}

/// CollabAuditEvent. `actor` is None when the server does not know;
/// `lineage` is set for history.lineageDeleted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuditEvent {
    pub event_type: String,
    pub doc_id: String,
    pub at: SystemTime,
    pub actor: Option<AuditActor>,
    pub lineage: Option<String>,
}

/// ICollabActivityObserver.OnChangesAsync. An ActivityObserver hands one
/// out from `changes()` to be told what changed in each window.
pub trait ChangeObserver: Send + Sync {
    fn on_changes<'a>(&'a self, signal: &'a ChangeSignal) -> BoxFuture<'a, Result<(), Error>>;
}

/// ICollabActivityObserver.OnEventAsync. An ActivityObserver hands one out
/// from `audit()` to be told each typed audit event.
pub trait AuditObserver: Send + Sync {
    fn on_event<'a>(&'a self, event: &'a AuditEvent) -> BoxFuture<'a, Result<(), Error>>;
}

const ADDED: &str = "added";
const REMOVED: &str = "removed";
const CHANGED: &str = "changed";
const MOVED: &str = "moved";

/// CollabChangeSignals.Fold: records in commit order, split into windows
/// that start at their first record and hold each next record on the same
/// lineage committed before the window ends, each collapsed.
pub fn fold_signals(doc_id: &str, records: &[SignalRecord], window: Duration) -> Vec<ChangeSignal> {
    let mut signals = Vec::new();
    let mut start = 0;
    for r in 1..=records.len() {
        if r < records.len()
            && records[r].lineage == records[start].lineage
            && records[r].committed_at < records[start].committed_at + window
        {
            continue;
        }
        let at = records[start].committed_at;
        if let Some(signal) = collapse_signal(doc_id, at, at + window, &records[start..r]) {
            signals.push(signal);
        }
        start = r;
    }
    signals
}

/// CollabChangeSignals.Collapse: one window's records, oldest first, as one
/// signal; None when nothing is left. A block added and removed in the
/// window is gone, with its properties and schema entries.
pub fn collapse_signal(
    doc_id: &str,
    window_start: SystemTime,
    window_end: SystemTime,
    records: &[SignalRecord],
) -> Option<ChangeSignal> {
    let (first, last) = (records.first()?, records.last()?);
    let mut block_order: Vec<String> = Vec::new();
    let mut blocks: HashMap<String, Option<String>> = HashMap::new();
    let mut page: Vec<String> = Vec::new();
    let mut row_order: Vec<String> = Vec::new();
    let mut rows: HashMap<String, Vec<String>> = HashMap::new();
    let mut schema_order: Vec<(String, String)> = Vec::new();
    let mut schema: HashMap<(String, String), Option<SignalSchema>> = HashMap::new();
    let mut author_order: Vec<String> = Vec::new();
    let mut kinds: HashMap<String, Option<String>> = HashMap::new();

    for record in records {
        for block in &record.blocks {
            let next = match blocks.get(&block.id) {
                None => {
                    block_order.push(block.id.clone());
                    Some(block.kind.clone())
                }
                Some(None) => Some(block.kind.clone()),
                Some(Some(seen)) => combine_kind(seen, &block.kind),
            };
            blocks.insert(block.id.clone(), next);
        }
        for key in &record.page {
            if !page.contains(key) {
                page.push(key.clone());
            }
        }
        for row in &record.properties {
            let ids = rows.entry(row.row_id.clone()).or_insert_with(|| {
                row_order.push(row.row_id.clone());
                Vec::new()
            });
            for id in &row.ids {
                if !ids.contains(id) {
                    ids.push(id.clone());
                }
            }
        }
        for entry in &record.schema {
            let key = (entry.database_id.clone(), entry.id.clone());
            let next = match schema.get(&key) {
                None => {
                    schema_order.push(key.clone());
                    Some(entry.clone())
                }
                Some(None) => Some(entry.clone()),
                Some(Some(seen)) => combine_schema(seen, entry),
            };
            schema.insert(key, next);
        }
        let visible = !record.blocks.is_empty()
            || !record.page.is_empty()
            || !record.properties.is_empty()
            || !record.schema.is_empty();
        if visible && let Some(actor) = &record.actor {
            let kind = kinds.entry(actor.clone()).or_insert_with(|| {
                author_order.push(actor.clone());
                None
            });
            // The actor's first note, as the version list reads it.
            if kind.is_none() {
                *kind = record.note.as_ref().map(|note| note.kind.clone());
            }
        }
    }

    let gone = |id: &str| matches!(blocks.get(id), Some(None));
    let signal = ChangeSignal {
        doc_id: doc_id.to_owned(),
        lineage: first.lineage.clone(),
        from_sequence: first.sequence,
        to_sequence: last.sequence,
        window_start,
        window_end,
        blocks: block_order
            .iter()
            .filter_map(|id| {
                blocks[id].as_ref().map(|kind| SignalBlock {
                    id: id.clone(),
                    kind: kind.clone(),
                })
            })
            .collect(),
        page,
        properties: row_order
            .iter()
            .filter(|id| !gone(id) && !rows[*id].is_empty())
            .map(|id| SignalProperties {
                row_id: id.clone(),
                ids: rows[id].clone(),
            })
            .collect(),
        schema: schema_order
            .iter()
            .filter(|key| !gone(&key.0))
            .filter_map(|key| schema[key].clone())
            .collect(),
        authors: author_order
            .iter()
            .map(|id| SignalAuthor {
                id: id.clone(),
                kind: kinds[id].clone(),
            })
            .collect(),
    };
    let empty = signal.blocks.is_empty()
        && signal.page.is_empty()
        && signal.properties.is_empty()
        && signal.schema.is_empty();
    (!empty).then_some(signal)
}

/// A block over two changes; None when added then removed.
fn combine_kind(older: &str, newer: &str) -> Option<String> {
    let kind = if older == ADDED {
        if newer == REMOVED {
            return None;
        }
        ADDED
    } else if newer == REMOVED {
        REMOVED
    } else if older == MOVED && newer == MOVED {
        MOVED
    } else {
        CHANGED
    };
    Some(kind.to_owned())
}

fn combine_schema(older: &SignalSchema, newer: &SignalSchema) -> Option<SignalSchema> {
    let action = if older.action == "created" {
        if newer.action == "deleted" {
            return None;
        }
        "created"
    } else if newer.action == "deleted" {
        "deleted"
    } else {
        "updated"
    };
    Some(SignalSchema {
        name: newer.name.clone().or_else(|| older.name.clone()),
        action: action.to_owned(),
        ..newer.clone()
    })
}

fn text_of(object: &Object, key: &str) -> Option<String> {
    match object.get(&Str::from(key)) {
        Some(Value::String(text)) => Some(text.to_string()),
        _ => None,
    }
}

fn entries_of(fields: &Object, key: &str) -> Vec<Object> {
    match fields.get(&Str::from(key)) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::Object(entry) => Some(entry.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// CollabChangeSignals.FromChanges: one record of a changes read, ids only.
pub(crate) fn signal_record_of(
    lineage: &str,
    record: &RecordChanges,
    note: Option<RecordNote>,
) -> SignalRecord {
    let mut out = SignalRecord {
        lineage: lineage.to_owned(),
        sequence: record.sequence,
        committed_at: record.committed_at,
        actor: record.actor_id.clone(),
        note,
        blocks: Vec::new(),
        page: record.page.clone(),
        properties: Vec::new(),
        schema: Vec::new(),
    };
    for block in &record.blocks {
        let id = block.id.to_string();
        let kind = match block.kind {
            BlockChangeKind::Added => ADDED,
            BlockChangeKind::Removed => REMOVED,
            BlockChangeKind::Moved => MOVED,
            BlockChangeKind::Changed => CHANGED,
        };
        out.blocks.push(SignalBlock {
            id: id.clone(),
            kind: kind.to_owned(),
        });
        if block.kind != BlockChangeKind::Changed {
            continue;
        }
        let fields = describe_database_change(
            block.kind_type.as_ref(),
            block.before.as_ref(),
            block.after.as_ref(),
        );
        let properties = entries_of(&fields, "properties");
        if !properties.is_empty() {
            out.properties.push(SignalProperties {
                row_id: id.clone(),
                ids: properties.iter().filter_map(|entry| text_of(entry, "id")).collect(),
            });
        }
        for entry in entries_of(&fields, "schema") {
            out.schema.push(SignalSchema {
                database_id: id.clone(),
                id: text_of(&entry, "id").unwrap_or_default(),
                name: text_of(&entry, "name"),
                action: text_of(&entry, "action").unwrap_or_default(),
            });
        }
    }
    out
}

/// Jobs waiting for the pump. Past it the oldest is dropped.
const QUEUE_LIMIT: usize = 1024;

struct Window {
    lineage: String,
    from: u64,
    to: u64,
    start: SystemTime,
    closed: bool,
    notes: HashMap<u64, RecordNote>,
}

type Job = Box<dyn FnOnce(Manager) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send>;

#[derive(Default)]
struct Queue {
    jobs: VecDeque<Job>,
    pumping: bool,
}

/// CollabChangeSignalHub: each document's open window, and one pump that
/// reads, folds and calls the observer off every room's lane.
pub(crate) struct SignalHub {
    observer: Arc<dyn ActivityObserver>,
    changes: bool,
    audit: bool,
    open: Mutex<HashMap<String, Arc<Mutex<Window>>>>,
    queue: Mutex<Queue>,
    idle: Notify,
    closed: AtomicUsize,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl SignalHub {
    /// None unless the observer hands out a change or audit observer, so a
    /// host that does not pays nothing.
    pub(crate) fn for_observer(observer: Option<&Arc<dyn ActivityObserver>>) -> Option<SignalHub> {
        let observer = observer?;
        let changes = observer.changes().is_some();
        let audit = observer.audit().is_some();
        (changes || audit).then(|| SignalHub {
            observer: observer.clone(),
            changes,
            audit,
            open: Mutex::new(HashMap::new()),
            queue: Mutex::new(Queue::default()),
            idle: Notify::new(),
            closed: AtomicUsize::new(0),
        })
    }

    /// A record was journalled. Called on the room's lane.
    pub(crate) fn committed(
        &self,
        shared: &Weak<Shared>,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        note: Option<RecordNote>,
    ) {
        if !self.changes {
            return;
        }
        let Some(manager) = shared.upgrade() else {
            return;
        };
        let mut closed = None;
        let mut opened = None;
        {
            let mut open = locked(&self.open);
            let mut window = open.get(doc_id).cloned();
            if let Some(current) = &window
                && locked(current).lineage != lineage
            {
                open.remove(doc_id);
                locked(current).closed = true;
                closed = window.take();
            }
            let window = match window {
                Some(window) => window,
                None => {
                    let window = Arc::new(Mutex::new(Window {
                        lineage: lineage.to_owned(),
                        from: sequence,
                        to: sequence,
                        start: manager.options.now(),
                        closed: false,
                        notes: HashMap::new(),
                    }));
                    open.insert(doc_id.to_owned(), window.clone());
                    opened = Some(window.clone());
                    window
                }
            };
            let mut window = locked(&window);
            window.to = sequence;
            if let Some(note) = note {
                window.notes.insert(sequence, note);
            }
        }
        if let Some(window) = closed {
            self.deliver(&manager, doc_id, window);
        }
        if let Some(window) = opened {
            let sleep = manager.options.sleep(manager.options.change_signal_window);
            let weak = Arc::downgrade(&manager);
            let doc_id = doc_id.to_owned();
            tokio::spawn(async move {
                sleep.await;
                if let Some(manager) = weak.upgrade()
                    && let Some(hub) = &manager.signals
                {
                    hub.close(&manager, &doc_id, &window);
                }
            });
        }
    }

    /// A purged document's open window is dropped: its records are gone.
    pub(crate) fn forget(&self, doc_id: &str) {
        if let Some(window) = locked(&self.open).remove(doc_id) {
            locked(&window).closed = true;
        }
    }

    pub(crate) fn event(&self, manager: &Arc<Shared>, event: AuditEvent) {
        if !self.audit {
            return;
        }
        let observer = self.observer.clone();
        self.enqueue(
            manager,
            Box::new(move |manager: Manager| {
                Box::pin(async move {
                    let Some(audit) = observer.audit() else {
                        return;
                    };
                    if let Err(err) = audit.on_event(&event).await {
                        manager.0.logf(&format!(
                            "collab: the activity observer failed on an audit event: {err}"
                        ));
                    }
                })
            }),
        );
    }

    /// Windows closed so far: a test waits for its timers through it.
    #[cfg(test)]
    pub(crate) fn closed_windows(&self) -> usize {
        self.closed.load(Ordering::SeqCst)
    }

    fn close(&self, manager: &Arc<Shared>, doc_id: &str, window: &Arc<Mutex<Window>>) {
        {
            let mut open = locked(&self.open);
            let mut state = locked(window);
            if state.closed {
                return;
            }
            state.closed = true;
            if open.get(doc_id).is_some_and(|current| Arc::ptr_eq(current, window)) {
                open.remove(doc_id);
            }
        }
        self.deliver(manager, doc_id, window.clone());
    }

    fn deliver(&self, manager: &Arc<Shared>, doc_id: &str, window: Arc<Mutex<Window>>) {
        let observer = self.observer.clone();
        let doc_id = doc_id.to_owned();
        self.enqueue(
            manager,
            Box::new(move |manager: Manager| {
                Box::pin(async move { signal(manager, observer, doc_id, window).await })
            }),
        );
        self.closed.fetch_add(1, Ordering::SeqCst);
    }

    fn enqueue(&self, manager: &Arc<Shared>, job: Job) {
        let (start, dropped) = {
            let mut queue = locked(&self.queue);
            let dropped = if queue.jobs.len() == QUEUE_LIMIT {
                queue.jobs.pop_front().is_some()
            } else {
                false
            };
            queue.jobs.push_back(job);
            let start = !queue.pumping;
            queue.pumping = true;
            (start, dropped)
        };
        if dropped {
            manager.logf("collab: a change signal or audit event was dropped; the observer is behind");
        }
        if start {
            let manager = Manager(manager.clone());
            tokio::spawn(async move { pump(manager).await });
        }
    }

    /// Waits for every queued job. A test hook.
    pub(crate) async fn settle(&self) {
        loop {
            let notified = self.idle.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if !locked(&self.queue).pumping {
                return;
            }
            notified.await;
        }
    }
}

async fn pump(manager: Manager) {
    let Some(hub) = manager.0.signals.as_ref() else {
        return;
    };
    loop {
        let next = {
            let mut queue = locked(&hub.queue);
            match queue.jobs.pop_front() {
                Some(job) => job,
                None => {
                    queue.pumping = false;
                    hub.idle.notify_waiters();
                    return;
                }
            }
        };
        // Its own task: a panicking observer loses only its own call.
        let run = tokio::spawn(next(manager.clone()));
        if run.await.is_err() {
            manager
                .0
                .logf("collab: the activity observer failed on a change signal or audit event");
        }
    }
}

async fn signal(
    manager: Manager,
    observer: Arc<dyn ActivityObserver>,
    doc_id: String,
    window: Arc<Mutex<Window>>,
) {
    let (lineage, from, to, start, notes) = {
        let window = locked(&window);
        (
            window.lineage.clone(),
            window.from,
            window.to,
            window.start,
            window.notes.clone(),
        )
    };
    let count = usize::try_from(to - from + 1).unwrap_or(usize::MAX);
    let result = manager
        .changes(&doc_id, &lineage, to, from - 1, count, MAX_CHANGE_BYTES)
        .await;
    let result = match result {
        Ok(result) if result.status == HistoryStatus::Ready => result,
        Ok(result) => {
            manager.0.logf(&format!(
                "collab: the change signal for {from}..{to} of \"{doc_id}\" was dropped: the history is {}",
                result.status
            ));
            return;
        }
        Err(err) => {
            manager.0.logf(&format!(
                "collab: the change signal for {from}..{to} of \"{doc_id}\" was dropped: {err}"
            ));
            return;
        }
    };
    if result.truncated {
        manager.0.logf(&format!(
            "collab: the change signal for {from}..{to} of \"{doc_id}\" lists only the newest records that fit one read"
        ));
    }
    let records: Vec<SignalRecord> = result
        .changes
        .iter()
        .map(|record| signal_record_of(&lineage, record, notes.get(&record.sequence).cloned()))
        .collect();
    let length = manager.0.options.change_signal_window;
    let Some(mut signal) = collapse_signal(&doc_id, start, start + length, &records) else {
        return;
    };
    signal.from_sequence = from;
    let Some(changes) = observer.changes() else {
        return;
    };
    if let Err(err) = changes.on_changes(&signal).await {
        manager.0.logf(&format!(
            "collab: the activity observer failed on a change signal: {err}"
        ));
    }
}
