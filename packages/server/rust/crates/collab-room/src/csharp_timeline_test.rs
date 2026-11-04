use std::time::{Duration, SystemTime};

use blok_collab_journal::{LineageInfo, RecordHeader};

use crate::{LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions};

// Twins of C# CollabVersionTimelineTests.

/// 2026-10-07T12:00:00Z.
fn t0() -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(1_791_374_400)
}

const TICK: Duration = Duration::from_nanos(100);

fn minutes(n: u64) -> Duration {
    Duration::from_secs(60 * n)
}

fn lineage(id: &str, created_at: Option<SystemTime>, current: bool) -> LineageInfo {
    LineageInfo {
        lineage: id.to_owned(),
        epoch: 1,
        format: 2,
        created_at,
        current,
    }
}

fn record(sequence: u64, at: SystemTime, actor: Option<&str>) -> RecordHeader {
    RecordHeader {
        sequence,
        committed_at: at,
        actor_id: actor.map(str::to_owned),
    }
}

fn entry(lineage: LineageInfo, headers: Vec<RecordHeader>) -> LineageHeaders {
    LineageHeaders { lineage, headers }
}

fn group(lineages: &[LineageHeaders]) -> Vec<Version> {
    group_versions(lineages, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN)
}

fn sequences(versions: &[Version]) -> Vec<u64> {
    versions.iter().map(|v| v.sequence).collect()
}

#[test]
fn a_lineage_with_no_records_yields_only_its_baseline() {
    let versions = group(&[entry(lineage("L1", Some(t0()), false), vec![])]);

    assert_eq!(versions.len(), 1);
    let baseline = &versions[0];
    assert_eq!(baseline.lineage, "L1");
    assert_eq!(baseline.sequence, 0);
    assert_eq!(baseline.started_at, Some(t0()));
    assert_eq!(baseline.saved_at, Some(t0()));
    assert!(baseline.actors.is_empty());
}

#[test]
fn a_baseline_without_a_created_at_has_no_times() {
    let versions = group(&[entry(lineage("L1", None, false), vec![])]);

    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].started_at, None);
    assert_eq!(versions[0].saved_at, None);
}

#[test]
fn a_gap_of_exactly_the_idle_gap_stays_in_the_same_group() {
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![
            record(1, t0(), None),
            record(2, t0() + TIMELINE_IDLE_GAP, None),
        ],
    )]);

    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].sequence, 2);
    assert_eq!(versions[0].started_at, Some(t0()));
    assert_eq!(versions[0].saved_at, Some(t0() + minutes(2)));
    assert_eq!(versions[1].sequence, 0);
}

#[test]
fn a_gap_one_tick_over_the_idle_gap_starts_a_new_group() {
    let later = t0() + minutes(2) + TICK;
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![record(1, t0(), None), record(2, later, None)],
    )]);

    assert_eq!(sequences(&versions), [2, 1, 0]);
    assert_eq!(versions[0].started_at, Some(later));
    assert_eq!(versions[0].saved_at, Some(later));
    assert_eq!(versions[1].started_at, Some(t0()));
    assert_eq!(versions[1].saved_at, Some(t0()));
}

#[test]
fn a_span_of_exactly_the_max_span_starts_a_new_group_at_that_record() {
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![
            record(1, t0(), None),
            record(2, t0() + minutes(2), None),
            record(3, t0() + minutes(4), None),
            record(4, t0() + minutes(6), None),
            record(5, t0() + minutes(8), None),
            record(6, t0() + minutes(10), None),
            record(7, t0() + minutes(11), None),
        ],
    )]);

    assert_eq!(sequences(&versions), [7, 5, 0]);
    assert_eq!(versions[0].started_at, Some(t0() + minutes(10)));
    assert_eq!(versions[0].saved_at, Some(t0() + minutes(11)));
    assert_eq!(versions[1].started_at, Some(t0()));
    assert_eq!(versions[1].saved_at, Some(t0() + minutes(8)));
}

#[test]
fn a_span_just_under_the_max_span_stays_in_the_same_group() {
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![
            record(1, t0(), None),
            record(2, t0() + minutes(2), None),
            record(3, t0() + minutes(4), None),
            record(4, t0() + minutes(6), None),
            record(5, t0() + minutes(8), None),
            record(6, t0() + minutes(10) - TICK, None),
        ],
    )]);

    assert_eq!(sequences(&versions), [6, 0]);
}

#[test]
fn a_negative_gap_counts_as_no_gap() {
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![record(1, t0() + minutes(5), None), record(2, t0(), None)],
    )]);

    assert_eq!(sequences(&versions), [2, 0]);
    assert_eq!(versions[0].started_at, Some(t0() + minutes(5)));
    assert_eq!(versions[0].saved_at, Some(t0()));
}

#[test]
fn actors_are_distinct_in_first_seen_order_and_skip_nulls() {
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![
            record(1, t0(), Some("bob")),
            record(2, t0(), None),
            record(3, t0(), Some("alice")),
            record(4, t0(), Some("bob")),
            record(5, t0(), Some("carol")),
        ],
    )]);

    assert_eq!(versions[0].actors, ["bob", "alice", "carol"]);
}

#[test]
fn actors_belong_only_to_their_own_group() {
    let versions = group(&[entry(
        lineage("L1", Some(t0()), false),
        vec![
            record(1, t0(), Some("bob")),
            record(2, t0() + minutes(5), Some("alice")),
        ],
    )]);

    assert_eq!(versions[0].actors, ["alice"]);
    assert_eq!(versions[1].actors, ["bob"]);
}

#[test]
fn output_is_newest_first_across_lineages() {
    let later = t0() + minutes(60);
    let versions = group(&[
        entry(
            lineage("old", Some(t0()), false),
            vec![record(1, t0(), None), record(2, t0() + minutes(5), None)],
        ),
        entry(
            lineage("new", Some(later), true),
            vec![record(1, later, None)],
        ),
    ]);

    let got: Vec<(&str, u64)> = versions
        .iter()
        .map(|v| (v.lineage.as_str(), v.sequence))
        .collect();
    assert_eq!(
        got,
        [("new", 1), ("new", 0), ("old", 2), ("old", 1), ("old", 0)]
    );
}

#[test]
fn each_lineage_starts_its_own_grouping() {
    let versions = group(&[
        entry(
            lineage("old", Some(t0()), false),
            vec![record(1, t0(), None)],
        ),
        entry(
            lineage("new", Some(t0()), false),
            vec![record(1, t0() + minutes(1), None)],
        ),
    ]);

    let got: Vec<(&str, u64)> = versions
        .iter()
        .map(|v| (v.lineage.as_str(), v.sequence))
        .collect();
    assert_eq!(got, [("new", 1), ("new", 0), ("old", 1), ("old", 0)]);
}

#[test]
fn a_window_groups_by_that_window_for_both_the_gap_and_the_span() {
    let window = minutes(15);
    let versions = group_versions(
        &[entry(
            lineage("L1", Some(t0()), false),
            vec![
                record(1, t0(), None),
                record(2, t0() + minutes(14), None),
                record(3, t0() + minutes(15), None),
                record(4, t0() + minutes(30), None),
                record(5, t0() + minutes(45) + TICK, None),
            ],
        )],
        window,
        window,
    );

    // 3 and 4 each reach the span; 5 is one tick past the gap.
    assert_eq!(sequences(&versions), [5, 4, 3, 2, 0]);
}

#[test]
fn a_one_minute_window_splits_what_the_default_keeps_together() {
    let headers = vec![
        record(1, t0(), None),
        record(2, t0() + Duration::from_secs(90), None),
    ];
    let window = minutes(1);
    let lineages = [entry(lineage("L1", Some(t0()), false), headers)];

    assert_eq!(sequences(&group(&lineages)), [2, 0]);
    assert_eq!(
        sequences(&group_versions(&lineages, window, window)),
        [2, 1, 0]
    );
}
