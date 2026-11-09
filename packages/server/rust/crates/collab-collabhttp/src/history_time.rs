use std::time::SystemTime;

use blok_collab_room::{
    DEFAULT_HISTORY_RANGE, HistoryPoint, HistoryStatus, MAX_CHANGE_BYTES, MAX_CHANGE_RECORDS,
    parse_history_time,
};
use blok_collab_synchttp::refuse;
use blok_collab_workingset::is_lineage;
use blok_dotnet::{parse_uint64_none, query_all, ticks, time_from_ticks};
use blok_http::{Request, ResponseWriter};

use super::{
    CHANGES_ENVELOPE_BYTES, append_millis, blocking, change_row, narrowed, query_block,
    query_detail, quoted, write_history_head, write_json,
};
use crate::{Handlers, failed};

const BAD_TIME: &str = "time must be an ISO 8601 time with an offset\n";
const BAD_RANGE: &str =
    "from and to must be ISO 8601 times with an offset, from no later than to\n";
const BAD_BEFORE: &str = "before must be one <lineage>:<sequence>\n";
const BAD_DETAIL: &str = "detail must be properties\n";
const BAD_BLOCK: &str = "block must be one block id\n";

impl Handlers {
    /// GET /sync/{doc}/history/at?time=: the newest point at or before the
    /// time. A redirect to the point, or the point as JSON when the caller
    /// accepts JSON.
    pub async fn history_at(&self, request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, false).await else {
            return;
        };
        let at = match query_time(&request, "time") {
            Ok(Some(at)) => at,
            _ => {
                refuse(&mut response, 400, BAD_TIME).await;
                return;
            }
        };
        let (rooms, doc) = (a.rooms.clone(), a.doc.clone());
        let result = match blocking(&request, async move { rooms.at(&doc, at).await }).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        if result.status == HistoryStatus::NotFound {
            response
                .headers_mut()
                .set("Content-Type", "application/json");
            blok_route::start_stream(&mut response, 404).await;
            let _ = response.write(br#"{"reason":"not_found"}"#).await;
            return;
        }
        let Some(point) = result
            .point
            .filter(|_| result.status == HistoryStatus::Ready)
        else {
            self.refuse_history(&mut response, &a, result.status).await;
            return;
        };
        // The lineage goes into a Location: anything not shaped like one is a
        // broken store.
        if !is_lineage(&point.lineage) {
            self.refuse_history(&mut response, &a, HistoryStatus::Corrupt)
                .await;
            return;
        }
        write_history_head(&mut response, &point.lineage, point.sequence);
        if !accepts_json(&request) {
            // Relative, so it keeps the mount prefix and the doc as sent. With
            // a trailing slash the base is .../at/, one level deeper.
            let mut location = format!("{}/{}", point.lineage, point.sequence);
            if request.path().ends_with('/') {
                location = format!("../{location}");
            }
            let headers = response.headers_mut();
            headers.set("Location", location);
            headers.set("Content-Length", "0");
            response.set_status(302);
            return;
        }
        let mut body = Vec::new();
        append_point(
            &mut body,
            &point.lineage,
            point.sequence,
            point.committed_at,
        );
        write_json(&mut response, &body).await;
    }

    /// GET /sync/{doc}/history/changes?from=&to=: each record's edits in
    /// [from, to), newest first across lineages. The default range is the
    /// last 24 hours.
    pub async fn history_changes_between(&self, request: Request, mut response: ResponseWriter) {
        let Some(a) = self.admit_history(&request, &mut response, false).await else {
            return;
        };
        let (Ok(from), Ok(to)) = (query_time(&request, "from"), query_time(&request, "to")) else {
            refuse(&mut response, 400, BAD_RANGE).await;
            return;
        };
        let end = to.unwrap_or_else(SystemTime::now);
        let range = DEFAULT_HISTORY_RANGE.as_nanos() as i64 / 100;
        let start = from.unwrap_or_else(|| time_from_ticks((ticks(end) - range).max(0)));
        if start > end {
            refuse(&mut response, 400, BAD_RANGE).await;
            return;
        }
        let Ok(before) = query_point(&request, "before") else {
            refuse(&mut response, 400, BAD_BEFORE).await;
            return;
        };
        let Ok(detail) = query_detail(&request) else {
            refuse(&mut response, 400, BAD_DETAIL).await;
            return;
        };
        let Ok(block) = query_block(&request) else {
            refuse(&mut response, 400, BAD_BLOCK).await;
            return;
        };
        let (rooms, doc) = (a.rooms.clone(), a.doc.clone());
        let changes = async move {
            rooms
                .changes_between(
                    &doc,
                    start,
                    end,
                    before.as_ref(),
                    MAX_CHANGE_RECORDS,
                    MAX_CHANGE_BYTES,
                )
                .await
        };
        let result = match blocking(&request, changes).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        if result.status != HistoryStatus::Ready {
            self.refuse_history(&mut response, &a, result.status).await;
            return;
        }
        let mut rows: Vec<Vec<u8>> = Vec::new();
        let mut shown = Vec::new();
        let mut notes = std::collections::HashMap::new();
        for record in &result.records {
            let Some(changes) = narrowed(&record.changes, block.as_deref()) else {
                continue;
            };
            if !notes.contains_key(&record.lineage) {
                let read = a.rooms.read_notes(&a.doc, &record.lineage).await;
                notes.insert(record.lineage.clone(), read);
            }
            shown.push(record);
            let Ok(row) = change_row(&changes, detail, notes[&record.lineage].as_ref()) else {
                failed(&request, &mut response).await;
                return;
            };
            let mut lineaged = br#"{"lineage":"#.to_vec();
            quoted(&mut lineaged, &record.lineage);
            lineaged.push(b',');
            lineaged.extend_from_slice(&row[1..]);
            rows.push(lineaged);
        }
        // As /changes: cut by the room with every row kept, the answer ends
        // at the oldest record read.
        let row_count = rows.len();
        let older_end_of = |oldest: usize| match result.records.last() {
            Some(last) if oldest + 1 == row_count => last,
            _ => shown[oldest],
        };
        let (kept, truncated) = fit_answer(&rows, result.truncated, |oldest| {
            let record = older_end_of(oldest);
            let mut older_end = Vec::new();
            append_older_end(
                &mut older_end,
                &record.lineage,
                record.changes.sequence,
                record.changes.committed_at,
            );
            older_end.len() as i64
        });
        rows.truncate(kept);
        let mut body = br#"{"changes":["#.to_vec();
        for (i, row) in rows.iter().enumerate() {
            if i > 0 {
                body.push(b',');
            }
            body.extend_from_slice(row);
        }
        body.push(b']');
        if truncated {
            let oldest = older_end_of(kept - 1);
            append_older_end(
                &mut body,
                &oldest.lineage,
                oldest.changes.sequence,
                oldest.changes.committed_at,
            );
        }
        body.push(b'}');
        write_json(&mut response, &body).await;
    }
}

/// How many rows, newest first, one answer keeps under the byte cap, and
/// whether it was cut. Rows count against the plain envelope; only a cut
/// answer also pays for its olderEnd, and drops rows until that fits. The
/// newest row always goes out.
pub(super) fn fit_answer(
    rows: &[Vec<u8>],
    cut: bool,
    older_end: impl Fn(usize) -> i64,
) -> (usize, bool) {
    let mut size = CHANGES_ENVELOPE_BYTES;
    let mut kept = 0;
    while kept < rows.len() && (kept == 0 || size + (rows[kept].len() as i64) < MAX_CHANGE_BYTES) {
        size += rows[kept].len() as i64 + 1;
        kept += 1;
    }
    if kept == rows.len() && !cut {
        return (kept, false);
    }
    while kept > 1 && size + older_end(kept - 1) > MAX_CHANGE_BYTES {
        kept -= 1;
        size -= rows[kept].len() as i64 + 1;
    }
    (kept, true)
}

/// Writes ,"truncated":true,"olderEnd":{...}: the oldest record in the
/// answer, so a caller can ask for what is older.
pub(super) fn append_older_end(body: &mut Vec<u8>, lineage: &str, sequence: u64, at: SystemTime) {
    body.extend_from_slice(br#","truncated":true,"olderEnd":"#);
    append_point(body, lineage, sequence, Some(at));
}

fn append_point(body: &mut Vec<u8>, lineage: &str, sequence: u64, at: Option<SystemTime>) {
    body.extend_from_slice(br#"{"lineage":"#);
    quoted(body, lineage);
    body.extend_from_slice(format!(r#","sequence":{sequence},"committedAt":"#).as_bytes());
    append_millis(body, at);
    body.push(b'}');
}

/// Absent is Ok(None); a repeated value or one the time format refuses is
/// Err.
fn query_time(request: &Request, name: &str) -> Result<Option<SystemTime>, ()> {
    let raw = request.query();
    match query_all(raw.strip_prefix('?').unwrap_or(raw), name).as_slice() {
        [] => Ok(None),
        [value] => parse_history_time(value).map(Some).ok_or(()),
        _ => Err(()),
    }
}

/// Reads <lineage>:<sequence>; absent is Ok(None).
fn query_point(request: &Request, name: &str) -> Result<Option<HistoryPoint>, ()> {
    let raw = request.query();
    match query_all(raw.strip_prefix('?').unwrap_or(raw), name).as_slice() {
        [] => Ok(None),
        [value] => {
            let (lineage, digits) = value.split_once(':').ok_or(())?;
            if !is_lineage(lineage) {
                return Err(());
            }
            let sequence = parse_uint64_none(digits).ok_or(())?;
            Ok(Some(HistoryPoint {
                lineage: lineage.to_owned(),
                sequence,
                committed_at: None,
            }))
        }
        _ => Err(()),
    }
}

/// Some Accept entry is application/json, ignoring case and parameters.
/// */* is a redirect: a browser follows it to the version.
fn accepts_json(request: &Request) -> bool {
    request.headers().get_all("Accept").any(|value| {
        value.split(',').any(|entry| {
            let media_type = entry.split(';').next().unwrap_or("");
            media_type.trim().eq_ignore_ascii_case("application/json")
        })
    })
}
