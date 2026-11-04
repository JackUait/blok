//! The live collaboration room and its manager (C# CollabRoom.cs and
//! CollabRoomManager.cs), ported from Go `internal/collab/room`. A room is a
//! single lane around one yjs Doc; every doc access runs inside it.
//! Functions suffixed `_locked` assume the lane is held and never re-enter
//! it.

#[cfg(feature = "core-wip")]
mod activity;
#[cfg_attr(not(feature = "core-wip"), allow(dead_code))]
mod cancel;
mod changes;
#[cfg_attr(not(feature = "core-wip"), allow(dead_code))]
mod error;
#[cfg_attr(not(feature = "core-wip"), allow(dead_code))]
mod lane;
#[cfg(feature = "core-wip")]
mod load;
#[cfg(feature = "core-wip")]
mod manager;
#[cfg(feature = "core-wip")]
mod ops;
#[cfg_attr(not(feature = "core-wip"), allow(dead_code))]
mod options;
#[cfg_attr(not(feature = "core-wip"), allow(dead_code))]
mod ordered;
#[cfg(feature = "core-wip")]
mod persist;
#[cfg(feature = "core-wip")]
mod room;
mod restore;
mod seams;
#[cfg(feature = "core-wip")]
mod sync;
mod timeline;

pub use cancel::Token;
pub use changes::{
    BlockChange, BlockChangeKind, RecordChanges, diff_blocks, diff_page, page_fields,
    replay_changes,
};
pub use error::{Error, PURGE_UNSUPPORTED, is_cancellation, is_transient};
#[cfg(feature = "core-wip")]
pub use manager::{Manager, ManagerOptions};
#[cfg(feature = "core-wip")]
pub use ops::{
    Applied, EditResult, EditStatus, PlanOps, Precondition, Receipt, ResetResult, ResetStatus,
    StateResult, StateStatus, planned_frame_bytes,
};
pub use options::{Clock, Options};
#[cfg(feature = "core-wip")]
pub use room::{Log, Membership};
pub use restore::{normalize_target, plan_restore};
pub use seams::*;
pub use timeline::{LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions};

/// MaxChangeRecords and MaxChangeBytes bound one changes answer; the newest
/// records are kept.
pub const MAX_CHANGE_RECORDS: usize = 200;
pub const MAX_CHANGE_BYTES: i64 = 4 * 1024 * 1024;

#[cfg(test)]
mod bigint_probe_test;
#[cfg(test)]
mod changes_test;
#[cfg(test)]
mod constants_test;
#[cfg(test)]
mod csharp_changes_test;
#[cfg(test)]
mod csharp_restore_planner_test;
#[cfg(test)]
mod csharp_timeline_test;
#[cfg(test)]
mod history_fixture_test;
#[cfg(test)]
mod lane_test;
#[cfg(test)]
mod ordered_test;
#[cfg(all(test, feature = "core-wip"))]
mod activity_test;
#[cfg(all(test, feature = "core-wip"))]
mod awareness_test;
#[cfg(all(test, feature = "core-wip"))]
mod checkpoint_test;
#[cfg(all(test, feature = "core-wip"))]
mod compaction_test;
#[cfg(all(test, feature = "core-wip"))]
mod export_test;
#[cfg(all(test, feature = "core-wip"))]
mod flush_test;
#[cfg(all(test, feature = "core-wip"))]
mod headless_test;
#[cfg(all(test, feature = "core-wip"))]
mod join_test;
#[cfg(all(test, feature = "core-wip"))]
mod migration_test;
#[cfg(all(test, feature = "core-wip"))]
mod purge_test;
#[cfg(all(test, feature = "core-wip"))]
mod retry_test;
#[cfg(all(test, feature = "core-wip"))]
mod room_test;
#[cfg(all(test, feature = "core-wip"))]
#[allow(dead_code, reason = "a harness: not every test uses every fake")]
mod test_support;
#[cfg(all(test, feature = "core-wip"))]
mod version_test;
