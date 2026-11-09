use std::collections::HashMap;
use std::time::SystemTime;

use blok_dotnet::{ticks, time_from_ticks};

use crate::LineageHeaders;

/// CollabHistoryWindow.Cut: now minus the window in .NET ticks, never before
/// tick 0. A negative window counts as zero.
pub fn history_cut(now: SystemTime, window_ticks: i64) -> SystemTime {
    time_from_ticks((ticks(now) - window_ticks.max(0)).max(0))
}

/// CollabHistoryWindow.Floor: the highest sequence the cut hides, None when
/// it hides none. The baseline is hidden when its lineage was created before
/// the cut or has no created-at; a record when committed before it; and
/// every point below a hidden one.
pub fn history_floor(lineage: &LineageHeaders, cut: SystemTime) -> Option<u64> {
    let cut = ticks(cut);
    let mut floor = match lineage.lineage.created_at {
        Some(created) if ticks(created) >= cut => None,
        _ => Some(0),
    };
    for header in &lineage.headers {
        if ticks(header.committed_at) < cut && floor.is_none_or(|at| header.sequence > at) {
            floor = Some(header.sequence);
        }
    }
    floor
}

/// Each lineage's floor by name; a repeated name keeps the newest.
pub fn history_floors(
    lineages: &[LineageHeaders],
    cut: SystemTime,
) -> HashMap<String, Option<u64>> {
    lineages
        .iter()
        .map(|lineage| (lineage.lineage.lineage.clone(), history_floor(lineage, cut)))
        .collect()
}

fn hides(floor: Option<u64>, sequence: u64) -> bool {
    floor.is_some_and(|at| sequence <= at)
}

/// The window hides the point. A lineage the floors lack hides nothing: it
/// answers not found.
pub fn hides_point(floors: &HashMap<String, Option<u64>>, lineage: &str, sequence: u64) -> bool {
    hides(floors.get(lineage).copied().flatten(), sequence)
}

/// A changes read's since, raised to the floor so no hidden record is listed.
pub fn window_since(floor: Option<u64>, since: u64) -> u64 {
    floor.map_or(since, |at| at.max(since))
}

/// The timeline as the window shows it: hidden records dropped, a hidden
/// baseline without its created-at.
pub fn visible_timeline(lineages: &[LineageHeaders], cut: SystemTime) -> Vec<LineageHeaders> {
    lineages
        .iter()
        .map(|lineage| {
            let floor = history_floor(lineage, cut);
            let mut entry = LineageHeaders {
                lineage: lineage.lineage.clone(),
                headers: lineage
                    .headers
                    .iter()
                    .filter(|header| !hides(floor, header.sequence))
                    .cloned()
                    .collect(),
            };
            if floor.is_some() {
                entry.lineage.created_at = None;
            }
            entry
        })
        .collect()
}
