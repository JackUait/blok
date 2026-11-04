use std::sync::Arc;

use super::*;

#[test]
fn an_upgrade_slot_is_freed_once_when_its_socket_closes() {
    let limit = Arc::new(UpgradeLimit::new(1));
    let held = limit.try_take().expect("under the limit");
    assert!(limit.try_take().is_none(), "past the limit");
    held.release();
    held.release();
    let again = limit.try_take();
    assert!(again.is_some(), "after close");
    assert!(
        limit.try_take().is_none(),
        "a second close freed a second slot"
    );
}
