use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_collab_convert::{
    build_replay, describe_structure, plain_page_maps, read_page_maps, restore_digest,
};
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo, RecordHeader};
use blok_jsjson::{Object, Str, Value};
use blok_yjs::Doc;

use crate::changes::{RecordChanges, replay_changes};
use crate::error::{is_cancellation, is_corrupt, is_transient};
use crate::manager::Manager;
use crate::ops::{EditResult, EditStatus, PlanOps, Precondition};
use crate::restore::plan_restore;
use crate::timeline::{
    LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions,
};
use crate::{Error, HistoryStore};

/// CollabHistoryStatus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HistoryStatus {
    Ready,
    /// No journal, or one without history reads.
    None,
    NotFound,
    Purged,
    /// A converter limit a retry may pass.
    Unavailable,
    ExportFailed,
    Corrupt,
}

/// The C# CollabHistoryStatus name, which agent answers print.
impl std::fmt::Display for HistoryStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            HistoryStatus::Ready => "Ready",
            HistoryStatus::None => "NoHistory",
            HistoryStatus::NotFound => "NotFound",
            HistoryStatus::Purged => "Purged",
            HistoryStatus::Unavailable => "Unavailable",
            HistoryStatus::ExportFailed => "ExportFailed",
            HistoryStatus::Corrupt => "Corrupt",
        })
    }
}

/// CollabHistoryListResult.
#[derive(Debug)]
pub struct HistoryList {
    pub status: HistoryStatus,
    pub lineages: Vec<LineageInfo>,
    pub versions: Vec<Version>,
}

impl HistoryList {
    fn status(status: HistoryStatus) -> HistoryList {
        HistoryList {
            status,
            lineages: Vec::new(),
            versions: Vec::new(),
        }
    }
}

/// CollabHistoryReadResult.
#[derive(Debug)]
pub struct HistoryRead {
    pub status: HistoryStatus,
    pub json: Vec<u8>,
}

/// CollabHistoryChangesResult.
#[derive(Debug)]
pub struct HistoryChanges {
    pub status: HistoryStatus,
    pub changes: Vec<RecordChanges>,
    pub truncated: bool,
}

impl HistoryChanges {
    fn status(status: HistoryStatus) -> HistoryChanges {
        HistoryChanges {
            status,
            changes: Vec::new(),
            truncated: false,
        }
    }
}

struct Point {
    status: HistoryStatus,
    output: Option<Object>,
    time: Option<SystemTime>,
    doc: Option<Doc>,
}

impl Point {
    fn status(status: HistoryStatus) -> Point {
        Point {
            status,
            output: None,
            time: None,
            doc: None,
        }
    }
}

/// Go's Time.UnixMilli: whole milliseconds, rounded down.
fn unix_milli(at: SystemTime) -> i64 {
    match at.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_millis() as i64,
        Err(before) => {
            let before = before.duration();
            let millis = before.as_millis() as i64;
            if before.as_nanos() % 1_000_000 == 0 {
                -millis
            } else {
                -millis - 1
            }
        }
    }
}

fn blocks_of(output: Option<&Object>) -> Vec<Value> {
    match output.and_then(|o| o.get(&Str::from("blocks"))) {
        Some(Value::Array(blocks)) => blocks.clone(),
        _ => Vec::new(),
    }
}

/// History reads take no lane and run on the caller's task; the store's
/// reads block, as Go's do.
impl Manager {
    fn history_store(&self) -> Option<&dyn HistoryStore> {
        self.0.operations.as_ref().and_then(|o| o.as_history())
    }

    /// The journal keeps versions.
    pub fn has_history(&self) -> bool {
        self.history_store().is_some()
    }

    fn is_purged(
        &self,
        ctx: &Context,
        history: &dyn HistoryStore,
        doc_id: &str,
    ) -> Result<bool, Error> {
        if self.is_purging(doc_id) {
            return Ok(true);
        }
        history.is_purged(ctx, doc_id)
    }

    /// Every lineage and its versions newest first. A group above zero
    /// replaces both default grouping limits.
    pub async fn history(&self, doc_id: &str, group: Duration) -> Result<HistoryList, Error> {
        let Some(history) = self.history_store() else {
            return Ok(HistoryList::status(HistoryStatus::None));
        };
        let ctx = Context::background();
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok(HistoryList::status(HistoryStatus::Purged));
        }
        let read = || -> Result<(Vec<LineageInfo>, Vec<LineageHeaders>), Error> {
            let lineages = history.list_lineages(&ctx, doc_id)?;
            let mut with_headers = Vec::new();
            for lineage in &lineages {
                let headers = history
                    .read_headers(&ctx, doc_id, &lineage.lineage)
                    .collect::<Result<Vec<RecordHeader>, Error>>()?;
                with_headers.push(LineageHeaders {
                    lineage: lineage.clone(),
                    headers,
                });
            }
            Ok((lineages, with_headers))
        };
        let (lineages, with_headers) = match read() {
            Ok(read) => read,
            Err(err) if is_corrupt(&err) => {
                self.0.logf(&format!(
                    "collab: the history of \"{doc_id}\" could not be read: {err}"
                ));
                return Ok(HistoryList::status(HistoryStatus::Corrupt));
            }
            Err(err) => return Err(err),
        };
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok(HistoryList::status(HistoryStatus::Purged));
        }
        let (idle_gap, max_span) = if group > Duration::ZERO {
            (group, group)
        } else {
            (TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN)
        };
        Ok(HistoryList {
            status: HistoryStatus::Ready,
            lineages,
            versions: group_versions(&with_headers, idle_gap, max_span),
        })
    }

    /// Rebuilds and exports one point. Its bounds come from the headers: a
    /// record read stops early without saying so.
    async fn read_point(&self, doc_id: &str, lineage: &str, sequence: u64) -> Result<Point, Error> {
        let Some(history) = self.history_store() else {
            return Ok(Point::status(HistoryStatus::None));
        };
        let ctx = Context::background();
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok(Point::status(HistoryStatus::Purged));
        }
        let replayed = match replay_point(&ctx, history, doc_id, lineage, sequence) {
            Ok(replayed) => replayed,
            Err(err) if is_corrupt(&err) => {
                self.0.logf(&format!(
                    "collab: version {sequence} of lineage {lineage} of \"{doc_id}\" could not be rebuilt: {err}"
                ));
                return Ok(Point::status(HistoryStatus::Corrupt));
            }
            Err(err) => return Err(err),
        };
        let Some((doc, at)) = replayed else {
            if self.is_purged(&ctx, history, doc_id)? {
                return Ok(Point::status(HistoryStatus::Purged));
            }
            return Ok(Point::status(HistoryStatus::NotFound));
        };
        match self.0.converter.export(&doc).await {
            Ok(output) => Ok(Point {
                status: HistoryStatus::Ready,
                output: Some(output),
                time: at,
                doc: Some(doc),
            }),
            Err(err) if is_transient(&err) => Ok(Point::status(HistoryStatus::Unavailable)),
            Err(err) if is_cancellation(&err) => Err(err),
            Err(err) => {
                self.0.logf(&format!(
                    "collab: version {sequence} of lineage {lineage} of \"{doc_id}\" could not be exported: {err}"
                ));
                Ok(Point::status(HistoryStatus::ExportFailed))
            }
        }
    }

    /// One point as OutputData JSON, read without the room. It carries the
    /// point's own time, and the page maps beside the title and icon. A page
    /// map value with no JSON form is C#'s InvalidDataException: an error.
    pub async fn read_version(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
    ) -> Result<HistoryRead, Error> {
        let point = self.read_point(doc_id, lineage, sequence).await?;
        let (Some(mut output), Some(doc), HistoryStatus::Ready) =
            (point.output, point.doc, point.status)
        else {
            return Ok(HistoryRead {
                status: point.status,
                json: Vec::new(),
            });
        };
        // JsonObject's indexer sets in place when present, else at the end;
        // Remove drops the key.
        let time = Str::from("time");
        match point.time {
            Some(at) => output.set(time, Value::BigInt(unix_milli(at))),
            None if output.get(&time).is_some() => {
                let mut kept = Object::new();
                for member in output.into_members() {
                    if member.key != time {
                        kept.set(member.key, member.value);
                    }
                }
                output = kept;
            }
            None => {}
        }
        for plain in plain_page_maps(&doc, &["title", "icon"])? {
            output.set(Str::from(plain.name), Value::Object(plain.map));
        }
        let json = blok_collab_docendpoint::serialize(&Value::Object(output))?;
        Ok(HistoryRead {
            status: HistoryStatus::Ready,
            json,
        })
    }

    /// The edits of each record in (since, sequence] of one lineage, read
    /// without the room. The replay always starts at the baseline.
    #[allow(clippy::too_many_arguments, reason = "the Go and C# signatures")]
    pub async fn changes(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        since: u64,
        max_records: usize,
        max_bytes: i64,
    ) -> Result<HistoryChanges, Error> {
        let Some(history) = self.history_store() else {
            return Ok(HistoryChanges::status(HistoryStatus::None));
        };
        let ctx = Context::background();
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok(HistoryChanges::status(HistoryStatus::Purged));
        }
        let collected = self
            .collect_changes(
                &ctx,
                history,
                doc_id,
                lineage,
                sequence,
                since,
                max_records,
                max_bytes,
            )
            .await;
        let (changes, truncated) = match collected {
            Ok(Some(found)) => found,
            Ok(None) => {
                if self.is_purged(&ctx, history, doc_id)? {
                    return Ok(HistoryChanges::status(HistoryStatus::Purged));
                }
                return Ok(HistoryChanges::status(HistoryStatus::NotFound));
            }
            Err(err) if is_corrupt(&err) => {
                self.0.logf(&format!(
                    "collab: the changes through {sequence} of lineage {lineage} of \"{doc_id}\" could not be rebuilt: {err}"
                ));
                return Ok(HistoryChanges::status(HistoryStatus::Corrupt));
            }
            Err(err) if is_transient(&err) => {
                return Ok(HistoryChanges::status(HistoryStatus::Unavailable));
            }
            Err(err @ Error::ChangesExport(_)) => {
                self.0.logf(&format!(
                    "collab: the changes through {sequence} of lineage {lineage} of \"{doc_id}\" could not be exported: {err}"
                ));
                return Ok(HistoryChanges::status(HistoryStatus::ExportFailed));
            }
            Err(err) => return Err(err),
        };
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok(HistoryChanges::status(HistoryStatus::Purged));
        }
        Ok(HistoryChanges {
            status: HistoryStatus::Ready,
            changes,
            truncated,
        })
    }

    #[allow(clippy::too_many_arguments, reason = "the Go signature")]
    async fn collect_changes(
        &self,
        ctx: &Context,
        history: &dyn HistoryStore,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        since: u64,
        max_records: usize,
        max_bytes: i64,
    ) -> Result<Option<(Vec<RecordChanges>, bool)>, Error> {
        let lineages = history.list_lineages(ctx, doc_id)?;
        let known = lineages.iter().any(|entry| entry.lineage == lineage);
        let mut found = known && sequence == 0;
        let mut first_before = 0;
        let mut window: Vec<u64> = Vec::new();
        if known && sequence > 0 {
            for header in history.read_headers(ctx, doc_id, lineage) {
                let header = header?;
                if header.sequence > sequence {
                    break;
                }
                if header.sequence <= since {
                    first_before = header.sequence;
                } else {
                    window.push(header.sequence);
                }
                if header.sequence == sequence {
                    found = true;
                    break;
                }
            }
        }
        if !found {
            return Ok(None);
        }
        let mut truncated = false;
        if window.len() > max_records {
            first_before = window[window.len() - max_records - 1];
            window.drain(..window.len() - max_records);
            truncated = true;
        }
        let mut changes = Vec::new();
        if !window.is_empty() {
            let Some(baseline) = history.read_baseline(ctx, doc_id, lineage)? else {
                return Ok(None);
            };
            let Some(converter) = self.0.converter.history() else {
                return Err(Error::message(
                    "collab: the converter cannot replay changes",
                ));
            };
            changes = replay_changes(
                &baseline,
                history.read_records(ctx, doc_id, lineage, sequence),
                first_before,
                converter,
                max_bytes,
            )
            .await?;
            // The replay drops the oldest records past the byte budget;
            // what is left is the window's tail.
            let tail = &window[window.len() - changes.len().min(window.len())..];
            if changes.is_empty()
                || changes.len() > window.len()
                || !changes.iter().map(|c| c.sequence).eq(tail.iter().copied())
            {
                return Err(Error::Corrupt(Box::new(Error::message(
                    "collab: the records do not match their headers.",
                ))));
            }
            truncated = truncated || changes.len() < window.len();
        }
        Ok(Some((changes, truncated)))
    }

    /// Removes one superseded lineage. The outcome is None with no history.
    pub async fn delete_lineage(
        &self,
        doc_id: &str,
        lineage: &str,
    ) -> Result<(HistoryStatus, Option<LineageDeleteOutcome>), Error> {
        let Some(history) = self.history_store() else {
            return Ok((HistoryStatus::None, None));
        };
        let ctx = Context::background();
        if self.is_purged(&ctx, history, doc_id)? {
            return Ok((HistoryStatus::Purged, Some(LineageDeleteOutcome::Purged)));
        }
        let outcome = history.delete_lineage(&ctx, doc_id, lineage)?;
        if outcome == LineageDeleteOutcome::Purged || self.is_purging(doc_id) {
            return Ok((HistoryStatus::Purged, Some(LineageDeleteOutcome::Purged)));
        }
        Ok((HistoryStatus::Ready, Some(outcome)))
    }

    /// Makes the live doc equal one point, as one journalled edit planned
    /// inside the lane after the duplicate and precondition checks.
    pub async fn restore(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        operation_id: &str,
        actor_id: &str,
        expect: Option<Precondition>,
    ) -> Result<(HistoryStatus, Option<EditResult>), Error> {
        let point = self.read_point(doc_id, lineage, sequence).await?;
        // A missing point still goes to the room: a retry whose lineage was
        // deleted since gets its first receipt from the duplicate check.
        if point.status != HistoryStatus::Ready && point.status != HistoryStatus::NotFound {
            return Ok((point.status, None));
        }
        let target = Arc::new(blocks_of(point.output.as_ref()));
        let target_doc = point
            .doc
            .filter(|_| point.status != HistoryStatus::NotFound);
        let converter = self.0.converter.clone();
        let plan: PlanOps = Arc::new(move |doc: Doc| {
            let (target, target_doc, converter) =
                (target.clone(), target_doc.clone(), converter.clone());
            Box::pin(async move {
                let Some(target_doc) = target_doc else {
                    return Err(Error::RestorePointMissing);
                };
                let structure = describe_structure(&doc)?;
                let exported = converter.export(&doc).await?;
                let current = blocks_of(Some(&exported));
                Ok(plan_restore(
                    &current,
                    &structure,
                    &target,
                    &read_page_maps(&doc)?,
                    &read_page_maps(&target_doc)?,
                ))
            })
        });
        // The request, never the plan: a retry plans against a doc that
        // moved.
        let digest = restore_digest(lineage, sequence);
        let request = crate::ops::EditRequest {
            plan,
            gate_frame_size: true,
            operation_id: operation_id.to_owned(),
            digest,
            actor_id: actor_id.to_owned(),
            expect,
            applied: None,
        };
        let edit = match self.edit_in_room(doc_id, request).await {
            Err(Error::RestorePointMissing) => return Ok((HistoryStatus::NotFound, None)),
            other => other?,
        };
        if edit.status == EditStatus::Applied {
            self.0.document_replaced(doc_id);
        }
        Ok((HistoryStatus::Ready, Some(edit)))
    }
}

fn replay_point(
    ctx: &Context,
    history: &dyn HistoryStore,
    doc_id: &str,
    lineage: &str,
    sequence: u64,
) -> Result<Option<(Doc, Option<SystemTime>)>, Error> {
    let lineages = history.list_lineages(ctx, doc_id)?;
    let Some(info) = lineages.iter().find(|l| l.lineage == lineage) else {
        return Ok(None);
    };
    let mut at = info.created_at;
    let mut found = sequence == 0;
    if sequence > 0 {
        for header in history.read_headers(ctx, doc_id, lineage) {
            let header = header?;
            if header.sequence >= sequence {
                found = header.sequence == sequence;
                at = Some(header.committed_at);
                break;
            }
        }
    }
    if !found {
        return Ok(None);
    }
    let Some(baseline) = history.read_baseline(ctx, doc_id, lineage)? else {
        return Ok(None);
    };
    let replayed = build_replay(
        || Ok(()),
        &baseline,
        history.read_records(ctx, doc_id, lineage, sequence),
    )?;
    Ok(Some((replayed, at)))
}
