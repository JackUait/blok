//! Every close the sync endpoint sends: SyncClose.cs.

use blok_collab::CloseReason;

/// A close status and its exact reason text: SyncCloseFrame. Compared as a
/// whole value, so code AND reason must match.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CloseFrame {
    pub status: u16,
    pub reason: &'static str,
}

impl CloseFrame {
    pub const fn new(status: u16, reason: &'static str) -> Self {
        Self { status, reason }
    }
}

pub const CLOSE_NORMAL: CloseFrame = CloseFrame::new(1000, "");
pub const CLOSE_DRAINING: CloseFrame = CloseFrame::new(1001, "server shutting down");
pub const CLOSE_TOO_BIG: CloseFrame = CloseFrame::new(1009, "message too big");
pub const CLOSE_INBOUND_RATE_EXCEEDED: CloseFrame = CloseFrame::new(1008, "inbound rate exceeded");
pub const CLOSE_SLOW_CONSUMER: CloseFrame = CloseFrame::new(1008, "outbound queue overflow");
pub const CLOSE_BAD_DOCUMENT: CloseFrame =
    CloseFrame::new(4400, "document ids must be a single path segment");
pub const CLOSE_MISSING_PASS: CloseFrame = CloseFrame::new(4401, "missing pass");
pub const CLOSE_INVALID_PASS: CloseFrame = CloseFrame::new(4401, "invalid pass");
pub const CLOSE_OTHER_DOCUMENT: CloseFrame = CloseFrame::new(4401, "pass is for another document");
pub const CLOSE_TEXT_FRAME: CloseFrame = CloseFrame::new(1003, "binary frames only");
pub const CLOSE_USERLESS_PASS: CloseFrame = CloseFrame::new(4401, "pass names no user");
pub const CLOSE_FORBIDDEN: CloseFrame = CloseFrame::new(4403, "forbidden");
pub const CLOSE_RESET: CloseFrame = CloseFrame::new(4409, "document reset");
pub const CLOSE_SEED_FAILED: CloseFrame = CloseFrame::new(4503, "document unavailable");
pub const CLOSE_COMMIT_UNAVAILABLE: CloseFrame = CloseFrame::new(4503, "commit unavailable, retry");
pub const CLOSE_BAD_AWARENESS: CloseFrame = CloseFrame::new(1008, "malformed awareness");
pub const CLOSE_RAW_WRITE_ON_V2: CloseFrame = CloseFrame::new(1008, "raw write on a v2 session");
pub const CLOSE_INTERNAL: CloseFrame = CloseFrame::new(1011, "internal error");

/// SyncClose.For. C# maps a value outside the enum to 1011; CloseReason is
/// closed here, so every reason has its own frame.
pub(crate) fn close_for(reason: CloseReason) -> CloseFrame {
    match reason {
        CloseReason::Reset => CLOSE_RESET,
        CloseReason::Forbidden => CLOSE_FORBIDDEN,
        CloseReason::Draining => CLOSE_DRAINING,
        CloseReason::BadAwareness => CLOSE_BAD_AWARENESS,
        CloseReason::CommitUnavailable => CLOSE_COMMIT_UNAVAILABLE,
        CloseReason::RawWriteOnV2 => CLOSE_RAW_WRITE_ON_V2,
    }
}
