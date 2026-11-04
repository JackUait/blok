use std::time::{Duration, SystemTime};

use blok_collab_journal::{LineageInfo, RecordHeader};

/// CollabVersion: one version in a document's history. Sequence 0 is a
/// lineage baseline; both its times are the lineage's created-at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    pub lineage: String,
    pub sequence: u64,
    pub started_at: Option<SystemTime>,
    pub saved_at: Option<SystemTime>,
    /// Distinct, in first-seen order.
    pub actors: Vec<String>,
}

/// One lineage with its record headers.
#[derive(Clone, Debug)]
pub struct LineageHeaders {
    pub lineage: LineageInfo,
    pub headers: Vec<RecordHeader>,
}

pub const TIMELINE_IDLE_GAP: Duration = Duration::from_secs(2 * 60);
pub const TIMELINE_MAX_SPAN: Duration = Duration::from_secs(10 * 60);

/// CollabVersionTimeline.Group: newest lineage first, each lineage's groups
/// newest first, then its baseline.
pub fn group_versions(
    lineages_oldest_first: &[LineageHeaders],
    idle_gap: Duration,
    max_span: Duration,
) -> Vec<Version> {
    let mut versions = Vec::new();
    for entry in lineages_oldest_first.iter().rev() {
        let (lineage, headers) = (&entry.lineage, &entry.headers);
        let mut groups = Vec::new();
        let mut start = 0;
        for r in 1..=headers.len() {
            if r < headers.len()
                && !starts_group(
                    &headers[r],
                    &headers[r - 1],
                    &headers[start],
                    idle_gap,
                    max_span,
                )
            {
                continue;
            }
            groups.push(to_version(&lineage.lineage, headers, start, r));
            start = r;
        }
        groups.reverse();
        versions.extend(groups);
        versions.push(Version {
            lineage: lineage.lineage.clone(),
            sequence: 0,
            started_at: lineage.created_at,
            saved_at: lineage.created_at,
            actors: Vec::new(),
        });
    }
    versions
}

/// The store clock is wall time, so a negative gap passes no limit.
fn past(to: SystemTime, from: SystemTime, limit: Duration, inclusive: bool) -> bool {
    match to.duration_since(from) {
        Ok(gap) if inclusive => gap >= limit,
        Ok(gap) => gap > limit,
        Err(_) => false,
    }
}

fn starts_group(
    record: &RecordHeader,
    previous: &RecordHeader,
    first: &RecordHeader,
    idle_gap: Duration,
    max_span: Duration,
) -> bool {
    past(record.committed_at, previous.committed_at, idle_gap, false)
        || past(record.committed_at, first.committed_at, max_span, true)
}

fn to_version(lineage: &str, headers: &[RecordHeader], start: usize, end: usize) -> Version {
    let mut actors: Vec<String> = Vec::new();
    for header in &headers[start..end] {
        if let Some(actor) = &header.actor_id
            && !actors.contains(actor)
        {
            actors.push(actor.clone());
        }
    }
    Version {
        lineage: lineage.to_owned(),
        sequence: headers[end - 1].sequence,
        started_at: Some(headers[start].committed_at),
        saved_at: Some(headers[end - 1].committed_at),
        actors,
    }
}
