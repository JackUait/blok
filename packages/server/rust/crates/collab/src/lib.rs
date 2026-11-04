//! The seam between the sync endpoint and the rooms: the member a room talks
//! to, and the membership the endpoint feeds. The room lane implements
//! `Rooms`; the endpoint (synchttp) implements `Member`.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// A boxed future: rooms keep members and memberships as trait objects.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Why a room closes a member: CollabCloseReason. The endpoint maps it to a
/// close code and reason.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CloseReason {
    /// The doc was reset; 4409.
    Reset,
    /// Access was revoked; 4403. It overtakes any other close.
    Forbidden,
    /// The server is shutting down; 1001.
    Draining,
    /// Presence a stock client cannot parse; 1008.
    BadAwareness,
    /// A journal commit was not confirmed; 4503.
    CommitUnavailable,
    /// A v2 member sent SyncStep2 or Update; 1008.
    RawWriteOnV2,
}

/// CollabOperationSource. The numbers are stored on disk.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum OperationSource {
    ClientV2 = 0,
    ClientV1 = 1,
    HttpEdit = 2,
}

/// One connection as a room sees it: ICollabMember. The room calls `send`
/// and `close` inside its lane, so both must enqueue and return; they never
/// block on the socket.
pub trait Member: Send + Sync {
    /// False drops the member's SyncStep2 and Update frames.
    fn can_write(&self) -> bool;
    /// True when a blok-sync subprotocol was negotiated: the room sends the
    /// control frame first.
    fn accepts_control_frames(&self) -> bool;
    /// Who a journalled write is attributed to; "" when the connection
    /// carries no verified identity.
    fn actor_id(&self) -> String;
    fn protocol_source(&self) -> OperationSource;
    /// Checks the admitted read (and write) rights again.
    fn recheck_access(&self) -> BoxFuture<'_, Result<bool, Error>>;
    /// Queues one encoded wire frame.
    fn send(&self, frame: Vec<u8>);
    fn close(&self, reason: CloseReason);
}

/// CollabJoinStatus.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum JoinStatus {
    Joined,
    /// Access changed after the handshake; HTTP 403.
    Forbidden,
    /// The document was purged; HTTP 403.
    Purged,
    /// The doc endpoint could not seed; upgrade, then 4503.
    SeedFailed,
    /// The server is shutting down; HTTP 503.
    Draining,
    /// Held elsewhere or in a retry cooldown; upgrade, then 4503.
    Unavailable,
}

/// A member's handle onto its room: CollabMembership.
pub trait Membership: Send + Sync {
    /// Hands the room one whole inbound frame.
    fn receive(&self, frame: Vec<u8>) -> BoxFuture<'_, Result<(), Error>>;
    /// Called once, when the connection ends.
    fn leave(&self);
}

/// CollabJoinResult. `membership` is set only when `status` is `Joined`.
pub struct JoinResult {
    pub status: JoinStatus,
    pub membership: Option<Box<dyn Membership>>,
    pub err: Option<Error>,
}

/// The part of the room manager the sync endpoint uses.
pub trait Rooms: Send + Sync {
    /// Adds member to doc's room. A request abort drops the future, and
    /// nothing is answered.
    fn join<'a>(
        &'a self,
        doc: &'a str,
        member: Arc<dyn Member>,
    ) -> BoxFuture<'a, Result<JoinResult, Error>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_sources_are_the_numbers_stored_on_disk() {
        assert_eq!(OperationSource::ClientV2 as i32, 0);
        assert_eq!(OperationSource::ClientV1 as i32, 1);
        assert_eq!(OperationSource::HttpEdit as i32, 2);
    }

    struct Quiet;

    impl Member for Quiet {
        fn can_write(&self) -> bool {
            false
        }
        fn accepts_control_frames(&self) -> bool {
            false
        }
        fn actor_id(&self) -> String {
            String::new()
        }
        fn protocol_source(&self) -> OperationSource {
            OperationSource::ClientV1
        }
        fn recheck_access(&self) -> BoxFuture<'_, Result<bool, Error>> {
            Box::pin(async { Ok(true) })
        }
        fn send(&self, _frame: Vec<u8>) {}
        fn close(&self, _reason: CloseReason) {}
    }

    #[test]
    fn a_member_is_usable_as_a_shared_trait_object() {
        let member: std::sync::Arc<dyn Member> = std::sync::Arc::new(Quiet);
        assert!(!member.can_write());
        assert_eq!(member.protocol_source(), OperationSource::ClientV1);
    }
}
