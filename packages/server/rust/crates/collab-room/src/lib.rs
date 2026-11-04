//! The live collaboration room and its manager (C# CollabRoom.cs and
//! CollabRoomManager.cs), ported from Go `internal/collab/room`. A room is a
//! single lane around one yjs Doc; every doc access runs inside it.
//! Functions suffixed `_locked` assume the lane is held and never re-enter
//! it.

#[allow(dead_code, reason = "the room modules use it; remove once they land")]
mod cancel;
mod changes;
#[allow(dead_code, reason = "the room modules use it; remove once they land")]
mod error;
#[allow(dead_code, reason = "the room modules use it; remove once they land")]
mod lane;
#[allow(dead_code, reason = "the room modules use it; remove once they land")]
mod options;
#[allow(dead_code, reason = "the room modules use it; remove once they land")]
mod ordered;
mod restore;
mod seams;
mod timeline;

pub use cancel::Token;
pub use changes::{
    BlockChange, BlockChangeKind, RecordChanges, diff_blocks, diff_page, page_fields,
    replay_changes,
};
pub use error::{Error, is_cancellation, is_transient};
pub use options::{Clock, Options};
pub use restore::{normalize_target, plan_restore};
pub use seams::*;
pub use timeline::{LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions};

/// MaxChangeRecords and MaxChangeBytes bound one changes answer; the newest
/// records are kept.
pub const MAX_CHANGE_RECORDS: usize = 200;
pub const MAX_CHANGE_BYTES: i64 = 4 * 1024 * 1024;

#[cfg(test)]
mod changes_test;
#[cfg(test)]
mod constants_test;
#[cfg(test)]
mod history_fixture_test;
#[cfg(test)]
mod lane_test;
#[cfg(test)]
mod ordered_test;
