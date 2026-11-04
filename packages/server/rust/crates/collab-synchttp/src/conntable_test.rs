use std::sync::Arc;

use blok_collab::CloseReason;

use super::*;

#[test]
fn the_process_ceiling_refuses_past_it_and_frees_on_release() {
    let table = Arc::new(ConnectionTable::new(2, 8));
    let (first, second) = (table.try_enter(), table.try_enter());
    assert!(
        first.is_some() && second.is_some(),
        "refused under the ceiling"
    );
    assert!(table.try_enter().is_none(), "allowed past the ceiling");
    let first = first.unwrap();
    first.release();
    first.release();
    let third = table.try_enter();
    assert!(third.is_some(), "a released slot was not freed");
    assert!(
        table.try_enter().is_none(),
        "a double release freed two slots"
    );
}

#[test]
fn a_ceiling_of_zero_is_no_ceiling() {
    let table = Arc::new(ConnectionTable::new(0, 8));
    let mut held = Vec::new();
    for _ in 0..5000 {
        let slot = table.try_enter();
        assert!(slot.is_some(), "a zero ceiling refused");
        held.push(slot);
    }
}

#[test]
fn the_per_user_cap_counts_per_document_and_principal() {
    let table = Arc::new(ConnectionTable::new(0, 2));
    let (a1, a2) = (
        table.try_reserve("doc", "user:a"),
        table.try_reserve("doc", "user:a"),
    );
    assert!(a1.is_some() && a2.is_some(), "refused under the cap");
    assert!(
        table.try_reserve("doc", "user:a").is_none(),
        "allowed a third for one user and doc"
    );
    let (b, other) = (
        table.try_reserve("doc", "user:b"),
        table.try_reserve("other", "user:a"),
    );
    assert!(
        b.is_some() && other.is_some(),
        "the cap leaked across users or documents"
    );
    let a1 = a1.unwrap();
    a1.release();
    a1.release();
    let again = table.try_reserve("doc", "user:a");
    assert!(again.is_some(), "a released lease was not freed");
    assert!(
        table.try_reserve("doc", "user:a").is_none(),
        "a double release freed two leases"
    );
}

#[test]
fn every_room_reason_maps_to_its_close() {
    let cases = [
        (CloseReason::Reset, CloseFrame::new(4409, "document reset")),
        (CloseReason::Forbidden, CloseFrame::new(4403, "forbidden")),
        (
            CloseReason::Draining,
            CloseFrame::new(1001, "server shutting down"),
        ),
        (
            CloseReason::BadAwareness,
            CloseFrame::new(1008, "malformed awareness"),
        ),
        (
            CloseReason::CommitUnavailable,
            CloseFrame::new(4503, "commit unavailable, retry"),
        ),
        (
            CloseReason::RawWriteOnV2,
            CloseFrame::new(1008, "raw write on a v2 session"),
        ),
    ];
    for (reason, want) in cases {
        assert_eq!(close_for(reason), want, "reason {reason:?}");
    }
    assert!(
        CLOSE_COMMIT_UNAVAILABLE.status == CLOSE_SEED_FAILED.status
            && CLOSE_COMMIT_UNAVAILABLE.reason != CLOSE_SEED_FAILED.reason,
        "commit unavailable must share 4503 with seed failed but not its text"
    );
}

#[test]
#[ignore = "CloseReason is a closed Rust enum: the Go rows 99 and -1 and C# AnUnmappedReasonClosesAsAnInternalError cannot be built"]
fn an_unmapped_reason_closes_as_an_internal_error() {}

#[test]
fn the_endpoint_closes_carry_their_exact_text() {
    let cases = [
        (CLOSE_NORMAL, CloseFrame::new(1000, "")),
        (CLOSE_TOO_BIG, CloseFrame::new(1009, "message too big")),
        (
            CLOSE_INBOUND_RATE_EXCEEDED,
            CloseFrame::new(1008, "inbound rate exceeded"),
        ),
        (
            CLOSE_SLOW_CONSUMER,
            CloseFrame::new(1008, "outbound queue overflow"),
        ),
        (
            CLOSE_BAD_DOCUMENT,
            CloseFrame::new(4400, "document ids must be a single path segment"),
        ),
        (CLOSE_MISSING_PASS, CloseFrame::new(4401, "missing pass")),
        (CLOSE_INVALID_PASS, CloseFrame::new(4401, "invalid pass")),
        (
            CLOSE_OTHER_DOCUMENT,
            CloseFrame::new(4401, "pass is for another document"),
        ),
        (
            CLOSE_USERLESS_PASS,
            CloseFrame::new(4401, "pass names no user"),
        ),
        (
            CLOSE_TEXT_FRAME,
            CloseFrame::new(1003, "binary frames only"),
        ),
        (
            CLOSE_SEED_FAILED,
            CloseFrame::new(4503, "document unavailable"),
        ),
    ];
    for (got, want) in cases {
        assert_eq!(got, want);
    }
}
