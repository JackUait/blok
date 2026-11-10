//! The live collaboration room and its manager (C# CollabRoom.cs and
//! CollabRoomManager.cs), ported from Go `internal/collab/room`. A room is a
//! single lane around one yjs Doc; every doc access runs inside it.
//! Functions suffixed `_locked` assume the lane is held and never re-enter
//! it.

mod activity;
mod cancel;
mod changes;
mod database_changes;
mod error;
mod history;
mod historytime;
mod lane;
mod load;
mod manager;
mod notes;
mod ops;
mod options;
mod ordered;
mod persist;
mod restore;
mod restore_guards;
mod restore_scope;
mod room;
mod seams;
mod signals;
mod sync;
mod timeline;
mod window;

pub use cancel::Token;
pub use changes::{
    BlockChange, BlockChangeKind, RecordChanges, diff_blocks, diff_page, page_fields,
    replay_changes,
};
pub use database_changes::describe_database_change;
pub use error::{Error, PURGE_UNSUPPORTED, is_cancellation, is_transient};
pub use history::{
    HistoryChanges, HistoryList, HistoryRead, HistoryStatus, RestoreOptions, RestoreOutcome,
    RestorePreview,
};
pub use historytime::{
    DEFAULT_HISTORY_RANGE, HistoryAt, HistoryPoint, HistoryRange, MAX_RANGE_LINEAGES, RangeRecord,
    RangeSelection, fit_rows, fits, parse_history_time, record_bytes, resolve_at, select_range,
};
pub use manager::{Manager, ManagerOptions};
pub use notes::{
    KIND_AGENT, KIND_PERSON, MemoryRecordNotes, RecordNote, RecordNotesStore, attribution,
    classify_actor, stamp_authority,
};
pub use ops::{
    Applied, EditResult, EditStatus, PlanOps, Precondition, Receipt, ResetResult, ResetStatus,
    StateResult, StateStatus, planned_frame_bytes,
};
pub use options::{Clock, Options, Timers};
pub use restore::{
    RestoreTrash, normalize_target, plan_restore, plan_restore_pinned, plan_restore_trashing,
};
pub use restore_guards::{
    CONFIRMABLE_GUARDS, GUARD_LOCKED_RESHAPE, GUARD_SHARE, GUARD_UNLOCK, RestoreGuard,
    restore_guards,
};
pub use restore_scope::{
    GUARD_ORPHANED_DATABASE, KeptDatabases, keep_databases, kept_restore_guards,
};
pub use room::{Log, Membership};
pub use seams::*;
pub use signals::{
    AUDIT_CONTENT_EDITED, AUDIT_DOCUMENT_PURGED, AUDIT_LINEAGE_DELETED, AuditActor, AuditEvent,
    AuditObserver, ChangeObserver, ChangeSignal, SignalAuthor, SignalBlock, SignalProperties,
    SignalRecord, SignalSchema, collapse_signal, fold_signals,
};
pub use timeline::{
    ActorKind, LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions,
    group_versions_by,
};
pub use window::{
    hides_point, history_cut, history_floor, history_floors, visible_timeline, window_since,
};

/// MaxChangeRecords and MaxChangeBytes bound one changes answer; the newest
/// records are kept.
pub const MAX_CHANGE_RECORDS: usize = 200;
pub const MAX_CHANGE_BYTES: i64 = 4 * 1024 * 1024;

#[cfg(test)]
mod activity_test;
#[cfg(test)]
mod awareness_test;
#[cfg(test)]
mod bigint_data_test;
#[cfg(test)]
mod changes_test;
#[cfg(test)]
mod checkpoint_test;
#[cfg(test)]
mod compaction_test;
#[cfg(test)]
mod constants_test;
#[cfg(test)]
mod csharp_changes_test;
#[cfg(test)]
mod csharp_fake_store_test;
#[cfg(test)]
mod csharp_history_manager_test;
#[cfg(test)]
mod csharp_manager_test;
#[cfg(test)]
mod csharp_restore_planner_test;
#[cfg(test)]
mod csharp_room_a_test;
#[cfg(test)]
mod csharp_room_b_test;
#[cfg(test)]
mod csharp_timeline_test;
#[cfg(test)]
mod database_changes_test;
#[cfg(test)]
mod export_test;
#[cfg(test)]
mod flush_test;
#[cfg(test)]
mod headless_test;
#[cfg(test)]
mod history_fixture_test;
#[cfg(test)]
mod history_test;
#[cfg(test)]
mod historytime_fixture_test;
#[cfg(test)]
mod join_test;
#[cfg(test)]
mod lane_test;
#[cfg(test)]
mod migration_test;
#[cfg(test)]
mod ordered_test;
#[cfg(test)]
mod purge_test;
#[cfg(test)]
mod replaced_test;
#[cfg(test)]
mod restore_guards_fixture_test;
#[cfg(test)]
mod restore_scope_fixture_test;
#[cfg(test)]
mod retry_test;
#[cfg(test)]
mod room_test;
#[cfg(test)]
#[allow(dead_code, reason = "a harness: not every test uses every fake")]
mod test_support;
#[cfg(test)]
mod signals_fixture_test;
#[cfg(test)]
mod timers_test;
#[cfg(test)]
mod version_test;
#[cfg(test)]
mod window_fixture_test;
