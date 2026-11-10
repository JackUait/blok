use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_collab_convert::{
    build_replay, describe_structure, plain_page_maps, read_page_maps, restore_digest_keeping,
};
use blok_collab_journal::{Context, LineageDeleteOutcome, LineageInfo, RecordHeader};
use blok_jsjson::{Object, Str, Value};
use blok_yjs::Doc;

use crate::changes::{
    BlockChange, RecordChanges, diff_blocks, diff_page, page_fields, replay_changes,
};
use crate::error::{is_cancellation, is_corrupt, is_transient};
use crate::manager::Manager;
use crate::ops::{
    EditResult, EditStatus, PlanOps, Precondition, Receipt, apply_to_scratch, frame_limit,
};
use crate::restore::{RestoreTrash, plan_restore_pinned};
use crate::restore_guards::{RestoreGuard, restore_guards};
use crate::restore_scope::{keep_databases, kept_restore_guards};
use crate::timeline::{
    LineageHeaders, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN, Version, group_versions_by,
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
    pub(crate) fn history_store(&self) -> Option<&dyn HistoryStore> {
        self.0.operations.as_ref().and_then(|o| o.as_history())
    }

    /// The journal keeps versions.
    pub fn has_history(&self) -> bool {
        self.history_store().is_some()
    }

    pub(crate) fn is_purged(
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
        self.history_by(doc_id, group, false).await
    }

    /// The record notes of one lineage; None without a store. A store that
    /// fails reads as no notes: they are informational.
    pub async fn read_notes(
        &self,
        doc_id: &str,
        lineage: &str,
    ) -> Option<std::collections::HashMap<u64, crate::RecordNote>> {
        let notes = self.0.notes.clone()?;
        match notes.read(doc_id, lineage).await {
            Ok(read) => Some(read),
            Err(err) => {
                self.0.logf(&format!(
                    "collab: the record notes of \"{doc_id}\" could not be read: {err}"
                ));
                Some(Default::default())
            }
        }
    }

    /// `history` where `by_actor` also starts a version where the actor
    /// changes. With a record notes store, each version carries its actor
    /// kinds.
    pub async fn history_by(
        &self,
        doc_id: &str,
        group: Duration,
        by_actor: bool,
    ) -> Result<HistoryList, Error> {
        self.history_windowed(doc_id, group, by_actor, None).await
    }

    /// history_by over what a window with this cut shows: groups are built
    /// from visible records only, and a lineage whose baseline is hidden has
    /// no created_at. None shows everything.
    pub async fn history_windowed(
        &self,
        doc_id: &str,
        group: Duration,
        by_actor: bool,
        cut: Option<SystemTime>,
    ) -> Result<HistoryList, Error> {
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
        let (mut lineages, mut with_headers) = match read() {
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
        if let Some(cut) = cut {
            with_headers = crate::window::visible_timeline(&with_headers, cut);
            for (lineage, visible) in lineages.iter_mut().zip(&with_headers) {
                lineage.created_at = visible.lineage.created_at;
            }
        }
        let (idle_gap, max_span) = if group > Duration::ZERO {
            (group, group)
        } else {
            (TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN)
        };
        let mut notes = None;
        if self.0.notes.is_some() {
            let mut by_lineage = std::collections::HashMap::new();
            for lineage in &lineages {
                let read = self
                    .read_notes(doc_id, &lineage.lineage)
                    .await
                    .unwrap_or_default();
                by_lineage.insert(lineage.lineage.clone(), read);
            }
            notes = Some(by_lineage);
        }
        let note_of = notes.as_ref().map(|notes| {
            move |lineage: &str, sequence: u64| {
                notes
                    .get(lineage)
                    .and_then(|notes| notes.get(&sequence))
                    .cloned()
            }
        });
        let versions = group_versions_by(
            &with_headers,
            idle_gap,
            max_span,
            by_actor,
            note_of.as_ref(),
        );
        Ok(HistoryList {
            status: HistoryStatus::Ready,
            lineages,
            versions,
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
        self.delete_lineage_by(doc_id, lineage, "").await
    }

    /// delete_lineage by a known actor ("" for none), named in its
    /// history.lineageDeleted event.
    pub async fn delete_lineage_by(
        &self,
        doc_id: &str,
        lineage: &str,
        actor_id: &str,
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
        if outcome == LineageDeleteOutcome::Deleted
            && let Some(hub) = &self.0.signals
        {
            hub.event(
                &self.0,
                crate::AuditEvent {
                    event_type: crate::AUDIT_LINEAGE_DELETED.to_owned(),
                    doc_id: doc_id.to_owned(),
                    at: self.0.options.now(),
                    actor: crate::classify_actor(actor_id, false, "").map(|note| {
                        crate::AuditActor {
                            id: actor_id.to_owned(),
                            kind: Some(note.kind),
                            on_behalf_of: note.on_behalf_of,
                        }
                    }),
                    lineage: Some(lineage.to_owned()),
                },
            );
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
        let (status, edit, _) = self
            .restore_guarded(
                doc_id,
                lineage,
                sequence,
                operation_id,
                actor_id,
                expect,
                None,
            )
            .await?;
        Ok((status, edit))
    }

    /// restore with the guards enforced when `confirmed` is Some: a guard
    /// whose kind it lacks refuses the restore, which changes nothing and
    /// answers the guards with no edit. The check runs in the lane after the
    /// duplicate check, so a refusal consumes no key and a committed retry
    /// still gets its receipt.
    #[allow(
        clippy::too_many_arguments,
        reason = "restore's arguments and the confirmed kinds"
    )]
    pub async fn restore_guarded(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        operation_id: &str,
        actor_id: &str,
        expect: Option<Precondition>,
        confirmed: Option<HashSet<String>>,
    ) -> Result<(HistoryStatus, Option<EditResult>, Vec<RestoreGuard>), Error> {
        let outcome = self
            .restore_with(
                doc_id,
                lineage,
                sequence,
                operation_id,
                actor_id,
                expect,
                confirmed,
                RestoreOptions::default(),
            )
            .await?;
        Ok((outcome.status, outcome.edit, outcome.refused))
    }

    /// restore_guarded with its options. A hidden point is never rebuilt; it
    /// is refused in the lane, after the duplicate check, so a committed
    /// retry still gets its receipt.
    #[allow(
        clippy::too_many_arguments,
        reason = "restore's arguments, the confirmed kinds and the options"
    )]
    pub async fn restore_with(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        operation_id: &str,
        actor_id: &str,
        expect: Option<Precondition>,
        confirmed: Option<HashSet<String>>,
        options: RestoreOptions,
    ) -> Result<RestoreOutcome, Error> {
        let point = if options.hidden {
            Point::status(HistoryStatus::NotFound)
        } else {
            self.read_point(doc_id, lineage, sequence).await?
        };
        // A missing point still goes to the room: a retry whose lineage was
        // deleted since gets its first receipt from the duplicate check.
        if point.status != HistoryStatus::Ready && point.status != HistoryStatus::NotFound {
            return Ok(RestoreOutcome {
                status: point.status,
                ..RestoreOutcome::default()
            });
        }
        let (hidden, keep) = (options.hidden, options.keep_databases);
        let refused: Arc<Mutex<Vec<RestoreGuard>>> = Arc::default();
        let confirmed = Arc::new(confirmed);
        let target = Arc::new(blocks_of(point.output.as_ref()));
        let target_doc = point
            .doc
            .filter(|_| point.status != HistoryStatus::NotFound);
        let converter = self.0.converter.clone();
        let trash = Arc::new(self.restore_trash(actor_id));
        let refusal = refused.clone();
        let plan: PlanOps = Arc::new(move |doc: Doc| {
            let (target, target_doc, converter, confirmed, refusal, trash) = (
                target.clone(),
                target_doc.clone(),
                converter.clone(),
                confirmed.clone(),
                refusal.clone(),
                trash.clone(),
            );
            Box::pin(async move {
                if hidden {
                    return Err(Error::Other(Box::new(RestoreHidden)));
                }
                let Some(target_doc) = target_doc else {
                    return Err(Error::RestorePointMissing);
                };
                let structure = describe_structure(&doc)?;
                let exported = converter.export(&doc).await?;
                let current = blocks_of(Some(&exported));
                let kept = keep.then(|| keep_databases(&current, &target));
                if let Some(kept) = &kept
                    && !kept.orphaned.is_empty()
                {
                    // Never confirmable, and refused whether or not the
                    // server enforces guards.
                    *refusal
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = kept.orphaned.clone();
                    return Err(Error::Other(Box::new(RestoreOrphaned)));
                }
                let aim = kept
                    .as_ref()
                    .map_or(target.as_slice(), |kept| kept.target.as_slice());
                if let Some(confirmed) = confirmed.as_ref() {
                    let guards = match &kept {
                        Some(kept) => kept_restore_guards(&current, kept),
                        None => restore_guards(&current, aim),
                    };
                    if guards.iter().any(|guard| !confirmed.contains(guard.kind)) {
                        *refusal
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner()) = guards;
                        return Err(Error::Other(Box::new(RestoreGuarded)));
                    }
                }
                Ok(plan_restore_pinned(
                    &current,
                    &structure,
                    aim,
                    &read_page_maps(&doc)?,
                    &read_page_maps(&target_doc)?,
                    trash.as_ref().as_ref(),
                    kept.as_ref().map(|kept| &kept.pinned),
                ))
            })
        });
        // The request, never the plan: a retry plans against a doc that
        // moved.
        let digest = restore_digest_keeping(lineage, sequence, keep);
        let request = crate::ops::EditRequest {
            plan,
            gate_frame_size: true,
            operation_id: operation_id.to_owned(),
            digest,
            actor_id: actor_id.to_owned(),
            expect,
            applied: None,
            dry_run: false,
            note: None,
        };
        let edit = match self.edit_in_room(doc_id, request).await {
            Err(Error::RestorePointMissing) => {
                return Ok(RestoreOutcome {
                    status: HistoryStatus::NotFound,
                    ..RestoreOutcome::default()
                });
            }
            Err(Error::Other(err)) if err.is::<RestoreHidden>() => {
                return Ok(RestoreOutcome {
                    status: HistoryStatus::NotFound,
                    hidden: true,
                    ..RestoreOutcome::default()
                });
            }
            Err(Error::Other(err)) if err.is::<RestoreGuarded>() => {
                let guards = std::mem::take(
                    &mut *refused
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()),
                );
                return Ok(RestoreOutcome {
                    status: HistoryStatus::Ready,
                    refused: guards,
                    ..RestoreOutcome::default()
                });
            }
            Err(Error::Other(err)) if err.is::<RestoreOrphaned>() => {
                let guards = std::mem::take(
                    &mut *refused
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()),
                );
                return Ok(RestoreOutcome {
                    status: HistoryStatus::Ready,
                    refused: guards,
                    refused_as: "restore_refused",
                    ..RestoreOutcome::default()
                });
            }
            other => other?,
        };
        if edit.status == EditStatus::Applied {
            self.0.document_replaced(doc_id);
        }
        Ok(RestoreOutcome {
            status: HistoryStatus::Ready,
            edit: Some(edit),
            ..RestoreOutcome::default()
        })
    }
}

/// CollabRestoreOptions. `hidden`: the host's history window hides the
/// point.
#[derive(Clone, Copy, Debug, Default)]
pub struct RestoreOptions {
    pub hidden: bool,
    /// databases=keep: every database stays as it is now.
    pub keep_databases: bool,
}

/// CollabRestoreResult: `edit` when Ready and run, `refused` when a guard
/// refused it, `hidden` when the window hid the point.
#[derive(Debug)]
pub struct RestoreOutcome {
    pub status: HistoryStatus,
    pub edit: Option<EditResult>,
    pub refused: Vec<RestoreGuard>,
    pub hidden: bool,
    /// The refusal's error: confirmation_required, or restore_refused for a
    /// guard no confirm can pass.
    pub refused_as: &'static str,
}

impl Default for RestoreOutcome {
    fn default() -> Self {
        Self {
            status: HistoryStatus::Ready,
            edit: None,
            refused: Vec::new(),
            hidden: false,
            refused_as: "confirmation_required",
        }
    }
}

/// A keep restore's planner refused: it would orphan a kept database.
#[derive(Debug)]
struct RestoreOrphaned;

impl std::fmt::Display for RestoreOrphaned {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("collab: the restore would orphan a kept database")
    }
}

impl std::error::Error for RestoreOrphaned {}

/// A restore's planner refused: the host's window hides its point.
#[derive(Debug)]
struct RestoreHidden;

impl std::fmt::Display for RestoreHidden {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("collab: the history window hides the restore point")
    }
}

impl std::error::Error for RestoreHidden {}

/// A restore planned and measured against the live doc, with nothing
/// applied: the blocks and page keys it would change, its guards, and its
/// frame size against the one-update limit.
#[derive(Debug, Default)]
pub struct RestorePreview {
    pub blocks: Vec<BlockChange>,
    pub page: Vec<String>,
    pub guards: Vec<RestoreGuard>,
    pub frame_bytes: i64,
    pub limit_bytes: i64,
    /// The revision it planned against, for the real call's If-Match.
    pub head: Option<Receipt>,
}

impl Manager {
    /// The trash input a restore plans with: None unless the rooms'
    /// restore_trashes_pages is on.
    fn restore_trash(&self, actor_id: &str) -> Option<RestoreTrash> {
        if !self.0.options.restore_trashes_pages {
            return None;
        }
        let at = self
            .0
            .options
            .now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as i64);
        Some(RestoreTrash {
            by: (!actor_id.is_empty()).then(|| actor_id.to_owned()),
            at,
        })
    }

    /// A restore's dry run. A refusal before the plan (a stale If-Match, a
    /// purge, a room that cannot load) comes back as the edit.
    pub async fn preview_restore(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        expect: Option<Precondition>,
        actor_id: &str,
    ) -> Result<(HistoryStatus, Option<RestorePreview>, Option<EditResult>), Error> {
        self.preview_restore_with(
            doc_id,
            lineage,
            sequence,
            expect,
            actor_id,
            RestoreOptions::default(),
        )
        .await
    }

    /// preview_restore with its options. A kept database's orphaning shows
    /// as a guard.
    pub async fn preview_restore_with(
        &self,
        doc_id: &str,
        lineage: &str,
        sequence: u64,
        expect: Option<Precondition>,
        actor_id: &str,
        options: RestoreOptions,
    ) -> Result<(HistoryStatus, Option<RestorePreview>, Option<EditResult>), Error> {
        let keep = options.keep_databases;
        let point = self.read_point(doc_id, lineage, sequence).await?;
        let (HistoryStatus::Ready, Some(target_doc)) = (point.status, point.doc.clone()) else {
            let status = match point.status {
                HistoryStatus::Ready => HistoryStatus::NotFound,
                other => other,
            };
            return Ok((status, None, None));
        };
        let target = Arc::new(blocks_of(point.output.as_ref()));
        let target_maps = Arc::new(read_page_maps(&target_doc)?);
        let converter = self.0.converter.clone();
        let preview: Arc<Mutex<RestorePreview>> = Arc::default();
        let filled = preview.clone();
        // The restorer's id is part of the frame the real restore sends.
        let trash = Arc::new(self.restore_trash(actor_id));
        let plan: PlanOps = Arc::new(move |doc: Doc| {
            let (target, target_maps, converter, filled, trash) = (
                target.clone(),
                target_maps.clone(),
                converter.clone(),
                filled.clone(),
                trash.clone(),
            );
            Box::pin(async move {
                let current = blocks_of(Some(&converter.export(&doc).await?));
                let kept = keep.then(|| keep_databases(&current, &target));
                let aim = kept
                    .as_ref()
                    .map_or(target.as_slice(), |kept| kept.target.as_slice());
                let ops = plan_restore_pinned(
                    &current,
                    &describe_structure(&doc)?,
                    aim,
                    &read_page_maps(&doc)?,
                    &target_maps,
                    trash.as_ref().as_ref(),
                    kept.as_ref().map(|kept| &kept.pinned),
                );
                let (scratch, frame_bytes) =
                    apply_to_scratch(&doc, converter.as_ref(), &ops).await?;
                let after = blocks_of(Some(&converter.export(&scratch).await?));
                let mut preview = filled
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                preview.blocks = diff_blocks(&current, &after);
                preview.page = diff_page(&page_fields(&doc)?, &page_fields(&scratch)?);
                preview.guards = match &kept {
                    Some(kept) => kept_restore_guards(&current, kept),
                    None => restore_guards(&current, aim),
                };
                preview.frame_bytes = frame_bytes;
                Ok(ops)
            })
        });
        let request = crate::ops::EditRequest {
            plan,
            gate_frame_size: false,
            operation_id: String::new(),
            digest: Vec::new(),
            actor_id: String::new(),
            expect,
            applied: None,
            dry_run: true,
            note: None,
        };
        let edit = self.edit_in_room(doc_id, request).await?;
        // A plan that ran answers Applied with the head it planned against.
        if edit.status != EditStatus::Applied {
            return Ok((HistoryStatus::Ready, None, Some(edit)));
        }
        let mut preview = std::mem::take(
            &mut *preview
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        preview.limit_bytes = frame_limit(&self.0.options);
        preview.head = edit.receipt;
        Ok((HistoryStatus::Ready, Some(preview), None))
    }
}

/// A restore's planner refused: a guard is present the request did not
/// confirm. Carried in Error::Other so Error keeps its variants.
#[derive(Debug)]
struct RestoreGuarded;

impl std::fmt::Display for RestoreGuarded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("collab: the restore needs confirmation")
    }
}

impl std::error::Error for RestoreGuarded {}

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
