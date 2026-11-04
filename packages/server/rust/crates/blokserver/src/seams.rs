//! Where crates other lanes build plug in.

use std::sync::Arc;
use std::time::SystemTime;

/// What a verified pass grants.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TicketClaims {
    pub user: String,
    /// The one document the pass names, "" when it names none.
    pub doc: String,
    pub write: bool,
}

/// ticket.Verify: (secret, pass, now) to the claims of a valid pass. The
/// blok-ticket crate's `verify` fits once its Claims map onto these.
pub type TicketVerifier = Arc<dyn Fn(&str, &str, SystemTime) -> Option<TicketClaims> + Send + Sync>;
