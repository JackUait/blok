use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use blok_collab_journal::{Context, RecordHeader};
use blok_dotnet::time_from_ticks;

use crate::changes::RecordChanges;
use crate::error::is_corrupt;
use crate::manager::Manager;
use crate::{Error, HistoryStatus, LineageHeaders};

/// CollabHistoryPoint: a record, or a lineage baseline (sequence 0).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryPoint {
    pub lineage: String,
    pub sequence: u64,
    pub committed_at: Option<SystemTime>,
}

/// CollabRangeSelection. Records are newest first.
#[derive(Debug)]
pub struct RangeSelection {
    pub status: HistoryStatus,
    pub records: Vec<HistoryPoint>,
    pub truncated: bool,
}

/// The changes-by-time route's default range.
pub const DEFAULT_HISTORY_RANGE: Duration = Duration::from_secs(24 * 60 * 60);

const TICKS_PER_SECOND: i64 = 10_000_000;
const TICKS_PER_DAY: i64 = 86_400 * TICKS_PER_SECOND;
const MAX_TICKS: i64 = 3_155_378_975_999_999_999;

/// CollabHistoryTime.TryParse: `YYYY-MM-DDTHH:MM:SS[.f{1,7}](Z|±HH:MM)`,
/// nothing else. The offset is required, and seven fraction digits are
/// .NET's tick.
pub fn parse_history_time(text: &str) -> Option<SystemTime> {
    let s = text.as_bytes();
    if s.len() < 20 {
        return None;
    }
    let digits = |start: usize, count: usize| -> i64 {
        let mut value = 0i64;
        for &c in &s[start..start + count] {
            if !c.is_ascii_digit() {
                return -1;
            }
            value = value * 10 + i64::from(c - b'0');
        }
        value
    };
    if s[4] != b'-' || s[7] != b'-' || s[10] != b'T' || s[13] != b':' || s[16] != b':' {
        return None;
    }
    let (year, month, day) = (digits(0, 4), digits(5, 2), digits(8, 2));
    let (hour, minute, second) = (digits(11, 2), digits(14, 2), digits(17, 2));
    if year < 1
        || !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let mut index = 19;
    let mut fraction = 0i64;
    if s[index] == b'.' {
        index += 1;
        let start = index;
        while index < s.len() && s[index].is_ascii_digit() {
            index += 1;
        }
        let count = index - start;
        if !(1..=7).contains(&count) {
            return None;
        }
        fraction = digits(start, count) * 10i64.pow((7 - count) as u32);
    }
    let offset = if index == s.len() - 1 && s[index] == b'Z' {
        0
    } else if index + 6 == s.len() && (s[index] == b'+' || s[index] == b'-') && s[index + 3] == b':'
    {
        let (hours, minutes) = (digits(index + 1, 2), digits(index + 4, 2));
        if !(0..=14).contains(&hours)
            || !(0..=59).contains(&minutes)
            || (hours == 14 && minutes > 0)
        {
            return None;
        }
        let offset = (hours * 60 + minutes) * 60 * TICKS_PER_SECOND;
        if s[index] == b'-' { -offset } else { offset }
    } else {
        return None;
    };
    let ticks = days_before(year, month, day) * TICKS_PER_DAY
        + ((hour * 60 + minute) * 60 + second) * TICKS_PER_SECOND
        + fraction
        - offset;
    if !(0..=MAX_TICKS).contains(&ticks) {
        return None;
    }
    Some(time_from_ticks(ticks))
}

fn is_leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if is_leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days from 0001-01-01 to the date, as DateTime counts them.
fn days_before(year: i64, month: i64, day: i64) -> i64 {
    let y = year - 1;
    let mut days = y * 365 + y / 4 - y / 100 + y / 400;
    for m in 1..month {
        days += days_in_month(year, m);
    }
    days + day - 1
}

/// CollabHistoryTime.ResolveAt: the newest point at or before `at`. Points
/// are every record and every baseline with a created-at. Equal times: the
/// later lineage wins, then the higher sequence. None when none is that old.
pub fn resolve_at(
    lineages_oldest_first: &[LineageHeaders],
    at: SystemTime,
) -> Option<HistoryPoint> {
    let mut best: Option<(SystemTime, usize, u64)> = None;
    let mut consider = |lineage: usize, sequence: u64, when: SystemTime| {
        if when <= at && best.is_none_or(|b| (when, lineage, sequence) >= b) {
            best = Some((when, lineage, sequence));
        }
    };
    for (i, entry) in lineages_oldest_first.iter().enumerate() {
        if let Some(created_at) = entry.lineage.created_at {
            consider(i, 0, created_at);
        }
        for header in &entry.headers {
            consider(i, header.sequence, header.committed_at);
        }
    }
    best.map(|(when, lineage, sequence)| HistoryPoint {
        lineage: lineages_oldest_first[lineage].lineage.lineage.clone(),
        sequence,
        committed_at: Some(when),
    })
}

/// CollabHistoryTime.SelectRange: the records committed in [from, to),
/// older than `before` when given, newest first by lineage then sequence, at
/// most `max_records`.
pub fn select_range(
    lineages_oldest_first: &[LineageHeaders],
    from: SystemTime,
    to: SystemTime,
    before: Option<&HistoryPoint>,
    max_records: usize,
) -> RangeSelection {
    let count = lineages_oldest_first.len();
    let (before_lineage, before_sequence) = match before {
        None => (count, u64::MAX),
        // Lineage ids are unique; if two ever share one, the newest wins.
        Some(point) => match lineages_oldest_first
            .iter()
            .rposition(|entry| entry.lineage.lineage == point.lineage)
        {
            Some(index) => (index, point.sequence),
            None => {
                return RangeSelection {
                    status: HistoryStatus::NotFound,
                    records: Vec::new(),
                    truncated: false,
                };
            }
        },
    };
    let mut picked = Vec::new();
    for i in (0..count.min(before_lineage + 1)).rev() {
        let entry = &lineages_oldest_first[i];
        for header in entry.headers.iter().rev() {
            if (i == before_lineage && header.sequence >= before_sequence)
                || header.committed_at < from
                || header.committed_at >= to
            {
                continue;
            }
            if picked.len() == max_records {
                return RangeSelection {
                    status: HistoryStatus::Ready,
                    records: picked,
                    truncated: true,
                };
            }
            picked.push(HistoryPoint {
                lineage: entry.lineage.lineage.clone(),
                sequence: header.sequence,
                committed_at: Some(header.committed_at),
            });
        }
    }
    RangeSelection {
        status: HistoryStatus::Ready,
        records: picked,
        truncated: false,
    }
}

/// The point a time reads. `point` is set only when Ready.
#[derive(Debug)]
pub struct HistoryAt {
    pub status: HistoryStatus,
    pub point: Option<HistoryPoint>,
}

/// One record's edits in a changes-by-time answer.
#[derive(Debug)]
pub struct RangeRecord {
    pub lineage: String,
    pub changes: RecordChanges,
}

/// The changes-by-time answer, newest first. `truncated`: older records in
/// the range were left out.
#[derive(Debug)]
pub struct HistoryRange {
    pub status: HistoryStatus,
    pub records: Vec<RangeRecord>,
    pub truncated: bool,
}

impl Manager {
    /// Every lineage, oldest first, with its record headers.
    fn read_timeline(&self, doc_id: &str) -> Result<(HistoryStatus, Vec<LineageHeaders>), Error> {
        let Some(history) = self.history_store() else {
            return Ok((HistoryStatus::None, Vec::new()));
        };
        let ctx = Context::background();
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok((HistoryStatus::Purged, Vec::new()));
        }
        let read = || -> Result<Vec<LineageHeaders>, Error> {
            let mut out = Vec::new();
            for lineage in history.list_lineages(&ctx, doc_id)? {
                let headers = history
                    .read_headers(&ctx, doc_id, &lineage.lineage)
                    .collect::<Result<Vec<RecordHeader>, Error>>()?;
                out.push(LineageHeaders { lineage, headers });
            }
            Ok(out)
        };
        let lineages = match read() {
            Ok(lineages) => lineages,
            Err(err) if is_corrupt(&err) => {
                self.0.logf(&format!(
                    "collab: the history of \"{doc_id}\" could not be read: {err}"
                ));
                return Ok((HistoryStatus::Corrupt, Vec::new()));
            }
            Err(err) => return Err(err),
        };
        // A purge that raced the reads leaves them empty.
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok((HistoryStatus::Purged, Vec::new()));
        }
        Ok((HistoryStatus::Ready, lineages))
    }

    /// The newest point at or before `at`. NotFound when the history starts
    /// later.
    pub async fn at(&self, doc_id: &str, at: SystemTime) -> Result<HistoryAt, Error> {
        let (status, lineages) = self.read_timeline(doc_id)?;
        if status != HistoryStatus::Ready {
            return Ok(HistoryAt {
                status,
                point: None,
            });
        }
        Ok(match resolve_at(&lineages, at) {
            Some(point) => HistoryAt {
                status: HistoryStatus::Ready,
                point: Some(point),
            },
            None => HistoryAt {
                status: HistoryStatus::NotFound,
                point: None,
            },
        })
    }

    /// The edits of each record committed in [from, to), older than
    /// `before` when given, newest first across lineages. Each lineage
    /// replays on its own, under the same caps as `changes`.
    pub async fn changes_between(
        &self,
        doc_id: &str,
        from: SystemTime,
        to: SystemTime,
        before: Option<&HistoryPoint>,
        max_records: usize,
        max_bytes: i64,
    ) -> Result<HistoryRange, Error> {
        let empty = |status| HistoryRange {
            status,
            records: Vec::new(),
            truncated: false,
        };
        let (status, lineages) = self.read_timeline(doc_id)?;
        if status != HistoryStatus::Ready {
            return Ok(empty(status));
        }
        let selection = select_range(&lineages, from, to, before, max_records);
        if selection.status != HistoryStatus::Ready {
            return Ok(empty(selection.status));
        }
        let mut records = Vec::new();
        let mut truncated = selection.truncated;
        let mut start = 0;
        while start < selection.records.len() {
            let lineage = &selection.records[start].lineage;
            let mut end = start;
            let mut picked = HashSet::new();
            while end < selection.records.len() && selection.records[end].lineage == *lineage {
                picked.insert(selection.records[end].sequence);
                end += 1;
            }
            let result = self
                .changes(
                    doc_id,
                    lineage,
                    selection.records[start].sequence,
                    selection.records[end - 1].sequence - 1,
                    max_records,
                    max_bytes,
                )
                .await?;
            if result.status != HistoryStatus::Ready {
                return Ok(empty(result.status));
            }
            for changes in result.changes.into_iter().rev() {
                if picked.contains(&changes.sequence) {
                    records.push(RangeRecord {
                        lineage: lineage.clone(),
                        changes,
                    });
                }
            }
            // Older records were dropped inside this lineage: anything older
            // still is past the cut.
            if result.truncated {
                truncated = true;
                break;
            }
            start = end;
        }
        Ok(HistoryRange {
            status: HistoryStatus::Ready,
            records,
            truncated,
        })
    }
}
