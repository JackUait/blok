//! GET /sync/{doc}: the handshake, the connection caps, the inbound budget
//! and the socket member a room talks to. Port of Go
//! `internal/collab/synchttp` (Blok.Server.AspNetCore/Collab/Sync*.cs). The
//! room itself is behind blok_collab::Rooms.

mod budget;
mod close;
mod conntable;
mod endpoint;
mod handshake;
mod member;
mod upgradelimit;

pub use budget::{BudgetOptions, Clock, InboundBudget};
pub use close::*;
pub use conntable::{ConnectionTable, Lease, Slot};
pub use endpoint::{Config, Endpoint, refuse};
pub use handshake::{PROTOCOL_V1, PROTOCOL_V2, derive_actor, is_single_segment};
pub use member::{MemberOptions, Receipt, Recheck, Socket, SocketMember, SocketResult};
pub use upgradelimit::{UpgradeLimit, UpgradeSlot};

#[cfg(test)]
mod budget_test;
#[cfg(test)]
mod conntable_test;
#[cfg(test)]
mod csharp_test;
#[cfg(test)]
mod endpoint_test;
#[cfg(test)]
mod member_test;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod upgradelimit_test;
