use std::time::SystemTime;

use blok_collab_docendpoint::Projection;
use blok_jsjson::Value;

use crate::Error;
use crate::cancel::Token;
use crate::error::{is_cancellation, is_runtime_limit, is_transient};
use crate::options::TRANSIENT_EXPORT_FAILURE_LIMIT;
use crate::room::{Job, Phase, Room, State, Task};

/// A CollabTransientException or a cancellation.
fn is_transient_export_failure(err: &Error) -> bool {
    is_transient(err) || is_cancellation(err)
}

fn later(at: SystemTime, by: std::time::Duration) -> SystemTime {
    at.checked_add(by).unwrap_or(at)
}

impl Room {
    /// Writes the blob INSIDE the lane; only the seed, edits and the flush
    /// pay that.
    pub(crate) async fn persist_locked(&self, st: &mut State, ctx: &Token) -> Result<(), Error> {
        let pending = st.blob_version;
        let frames = st.frame_section.clone();
        ctx.run(self.store.write(&self.doc_id, &frames, &st.tag))
            .await?;
        st.persisted_version = pending;
        st.persist_failures = 0;
        Ok(())
    }

    /// Starts the blob write beside the lane, single flight; edits made
    /// meanwhile are coalesced into the next one.
    pub(crate) fn schedule_persist_locked(&self, st: &mut State) {
        if self.purging()
            || st.phase != Phase::Ready
            || st.in_flight_persist.is_some()
            || st.blob_version == st.persisted_version
        {
            return;
        }
        st.persisting_version = st.blob_version;
        let (frames, tag, room) = (st.frame_section.clone(), st.tag.clone(), self.arc());
        let weak = self.this.clone();
        let write = Task::start(
            async move {
                room.lifetime
                    .run(room.store.write(&room.doc_id, &frames, &tag))
                    .await
            },
            move |id| {
                if let Some(room) = weak.upgrade() {
                    room.post(Job::PersistFinished(id));
                }
            },
        );
        st.in_flight_persist = Some(write);
    }

    /// Waits out the off-lane write so nothing written after it can be
    /// overtaken.
    pub(crate) async fn settle_in_flight_persist_locked(&self, st: &mut State) {
        let Some(write) = st.in_flight_persist.take() else {
            return;
        };
        if let Err(err) = write.wait().await {
            if !self.lifetime.is_cancelled() {
                self.logf(&format!(
                    "collab: room \"{}\" could not persist the working set: {err}",
                    self.doc_id
                ));
            }
            return;
        }
        st.persisted_version = st.persisting_version;
        st.persist_failures = 0;
    }

    pub(crate) fn on_persist_finished_locked(&self, st: &mut State, id: u64) {
        let Some(write) = st.in_flight_persist.clone() else {
            return;
        };
        if write.id != id {
            return;
        }
        st.in_flight_persist = None;
        match write.try_get() {
            Some(Ok(())) => {
                st.persisted_version = st.persisting_version;
                st.persist_failures = 0;
                self.schedule_persist_locked(st);
            }
            Some(Err(failure)) => {
                if self.lifetime.is_cancelled() {
                    return;
                }
                self.logf(&format!(
                    "collab: room \"{}\" could not persist the working set: {failure}",
                    self.doc_id
                ));
                st.persist_failures += 1;
                let due = self.options.backoff(st.persist_failures);
                self.persist_timer
                    .change(&self.arc(), Some(due), || Job::SchedulePersist);
            }
            None => {}
        }
    }

    /// True when the log was replaced by one full-state frame.
    pub(crate) fn compact_if_oversized_locked(&self, st: &mut State) -> bool {
        if st.frame_count < 2
            || (st.frame_count < self.options.compaction_frame_threshold
                && (st.frame_section.len() as i64) - st.base_frame_length
                    < self.options.compaction_byte_threshold)
        {
            return false;
        }
        if let Err(err) = self.compact_locked(st) {
            self.logf(&format!(
                "collab: room \"{}\" background work failed: {err}",
                self.doc_id
            ));
            return false;
        }
        true
    }

    /// Replaces the log with the doc's whole state, pending structs
    /// included.
    pub(crate) fn compact_locked(&self, st: &mut State) -> Result<(), Error> {
        let whole = st.doc().encode_state_as_update(&[])?;
        self.replace_log_locked(st, &whole);
        Ok(())
    }

    pub(crate) fn replace_log_locked(&self, st: &mut State, whole: &[u8]) {
        st.frame_section.clear();
        st.frame_count = 0;
        self.append_locked(st, whole);
        st.base_frame_length = st.frame_section.len() as i64;
    }

    /// The consumer's JSON is behind the document. A journal room's
    /// projection is scheduled by checkpoints and eviction/drain only.
    pub(crate) fn mark_dirty_locked(&self, st: &mut State) {
        st.export_dirty = true;
        if st.dirty_since.is_none() {
            st.dirty_since = Some(self.options.now());
        }
        if st.session.is_none() {
            self.schedule_export_locked(st);
        }
    }

    fn refuse_projection_locked(&self, st: &mut State, err: &Error, why: Option<String>) {
        if st.projection_refused {
            return;
        }
        st.projection_refused = true;
        let why = why.unwrap_or_else(|| {
            format!(
                "collab: room \"{}\" cannot export its document, so the consumer's record stays behind and no retry will change that",
                self.doc_id
            )
        });
        self.logf(&format!("{why}: {err}"));
    }

    /// None on a working-set-only room: it has no sequence.
    pub(crate) fn projection_locked(&self, st: &State) -> Option<Projection> {
        st.session.as_ref()?;
        Some(Projection {
            lineage: st.tag.lineage.clone(),
            server_sequence: st.committed_through,
        })
    }

    pub(crate) fn schedule_export_locked(&self, st: &mut State) {
        let Some(dirty_since) = st.dirty_since else {
            return;
        };
        if st.in_flight_save.is_some() {
            return;
        }
        let now = self.options.now();
        let mut due = later(now, self.options.export_debounce);
        let latest = later(dirty_since, self.options.export_max_delay);
        if latest < due {
            due = latest;
        }
        if let Some(retry) = st.export_retry_at
            && retry > due
        {
            due = retry;
        }
        let delay = due.duration_since(now).unwrap_or_default();
        self.export_timer
            .change(&self.arc(), Some(delay), || Job::TryExport);
    }

    pub(crate) async fn try_export_locked(&self, st: &mut State) -> Result<(), Error> {
        if self.purging()
            || st.phase != Phase::Ready
            || !st.export_dirty
            || st.in_flight_save.is_some()
        {
            return Ok(());
        }
        self.settle_version_locked(st).await;
        let doc = st.doc();
        let snapshot = match self.lifetime.run(self.converter.export(&doc)).await {
            Ok(snapshot) => snapshot,
            Err(err) => {
                if st.session.is_some() && !is_transient_export_failure(&err) {
                    self.refuse_projection_locked(st, &err, None);
                    return Ok(());
                }
                if self.lifetime.is_cancelled() {
                    return Ok(());
                }
                if is_runtime_limit(&err) {
                    st.transient_export_failures += 1;
                    if st.transient_export_failures >= TRANSIENT_EXPORT_FAILURE_LIMIT {
                        let next = if st.session.is_none() {
                            "next edit"
                        } else {
                            "next checkpoint"
                        };
                        let why = format!(
                            "collab: room \"{}\" gave up exporting after {} attempts that ran past the runtime's limits, so the consumer's record stays behind until the {next} retries it (raise the runtime's timeout for documents this large)",
                            self.doc_id, st.transient_export_failures
                        );
                        self.refuse_projection_locked(st, &err, Some(why));
                        return Ok(());
                    }
                }
                self.logf(&format!(
                    "collab: room \"{}\" could not export, retrying: {err}",
                    self.doc_id
                ));
                st.export_failures += 1;
                st.export_retry_at = Some(later(
                    self.options.now(),
                    self.options.backoff(st.export_failures),
                ));
                self.schedule_export_locked(st);
                return Ok(());
            }
        };
        st.transient_export_failures = 0;
        // Cleared at the snapshot: this is what the checkpoint owed.
        st.projection_owed = false;
        let (version, projection, room) =
            (st.version.clone(), self.projection_locked(st), self.arc());
        let weak = self.this.clone();
        let save = Task::start(
            async move {
                let snapshot = Value::Object(snapshot);
                room.lifetime
                    .run(room.endpoint.save(
                        &room.doc_id,
                        &snapshot,
                        version.as_deref(),
                        projection.as_ref(),
                    ))
                    .await
            },
            move |id| {
                if let Some(room) = weak.upgrade() {
                    room.post(Job::SaveFinished(id));
                }
            },
        );
        st.export_dirty = false;
        st.dirty_since = None;
        st.in_flight_save = Some(save);
        Ok(())
    }

    pub(crate) fn on_save_finished_locked(&self, st: &mut State, id: u64) {
        let Some(save) = st.in_flight_save.clone() else {
            return;
        };
        if save.id != id {
            return;
        }
        st.in_flight_save = None;
        if st.phase != Phase::Ready {
            return;
        }
        let answer = save.try_get().unwrap_or(Ok(None));
        let failed = answer.is_err();
        match answer {
            Err(failure) => {
                self.logf(&format!(
                    "collab: room \"{}\" export failed, retrying: {failure}",
                    self.doc_id
                ));
                st.export_dirty = true;
                if st.dirty_since.is_none() {
                    st.dirty_since = Some(self.options.now());
                }
                st.export_failures += 1;
                st.export_retry_at = Some(later(
                    self.options.now(),
                    self.options.backoff(st.export_failures),
                ));
            }
            Ok(answered) => {
                st.export_failures = 0;
                st.export_retry_at = None;
                st.projection_refused = false;
                if answered.is_some() {
                    st.version = answered;
                }
            }
        }
        if st.export_dirty && (failed || st.projection_owed || st.session.is_none()) {
            self.schedule_export_locked(st);
        }
    }

    pub(crate) async fn evict_locked(&self, st: &mut State) -> Result<(), Error> {
        if st.phase != Phase::Ready || st.members.len() > 0 {
            return Ok(());
        }
        self.flush_locked(st, &Token::new()).await;
        if st.blob_version != st.persisted_version {
            // A blob with any frame in it is authoritative on the next open,
            // so the room stays the authority until the write lands.
            st.persist_failures += 1;
            self.logf(&format!(
                "collab: room \"{}\" is staying loaded until its working set is written",
                self.doc_id
            ));
            self.update_eviction_locked(st, Some(self.options.backoff(st.persist_failures)));
            return Ok(());
        }
        if st.export_dirty && !st.projection_refused {
            st.export_failures += 1;
            self.logf(&format!(
                "collab: room \"{}\" is staying loaded until its export lands",
                self.doc_id
            ));
            self.update_eviction_locked(st, Some(self.options.backoff(st.export_failures)));
            return Ok(());
        }
        self.close_room_locked(st, None).await;
        Ok(())
    }

    /// Compact + persist + export, all awaited; failures are logged, not
    /// returned. The work stops when the room's lifetime or the caller ends.
    pub(crate) async fn flush_locked(&self, st: &mut State, caller: &Token) {
        let ctx = Token::new();
        let (lifetime, caller_gone, linked) = (self.lifetime.clone(), caller.clone(), ctx.clone());
        let link = tokio::spawn(async move {
            tokio::select! {
                () = lifetime.cancelled() => {}
                () = caller_gone.cancelled() => {}
            }
            linked.cancel();
        });
        self.flush_with_locked(st, &ctx).await;
        link.abort();
    }

    async fn flush_with_locked(&self, st: &mut State, ctx: &Token) {
        if let Some(save) = st.in_flight_save.take() {
            match save.wait().await {
                Err(err) => {
                    self.logf(&format!(
                        "collab: room \"{}\" export failed during flush: {err}",
                        self.doc_id
                    ));
                    st.export_dirty = true;
                }
                Ok(Some(answered)) => st.version = Some(answered),
                Ok(None) => {}
            }
        }
        // The in-flight write carries an older snapshot: it lands first.
        self.settle_in_flight_persist_locked(st).await;
        if st.frame_count > 1
            && let Err(err) = self.compact_locked(st)
        {
            self.logf(&format!(
                "collab: room \"{}\" could not flush the working set: {err}",
                self.doc_id
            ));
        }
        if st.blob_version != st.persisted_version
            && let Err(err) = self.persist_locked(st, ctx).await
            && !self.lifetime.is_cancelled()
        {
            self.logf(&format!(
                "collab: room \"{}\" could not flush the working set: {err}",
                self.doc_id
            ));
        }
        if !st.export_dirty {
            return;
        }
        self.settle_version_locked(st).await;
        let doc = st.doc();
        let snapshot = match ctx.run(self.converter.export(&doc)).await {
            Ok(snapshot) => snapshot,
            Err(err) => {
                if self.lifetime.is_cancelled() {
                    return;
                }
                if st.session.is_some() && !is_transient_export_failure(&err) {
                    self.refuse_projection_locked(st, &err, None);
                } else {
                    self.logf(&format!(
                        "collab: room \"{}\" could not export during flush: {err}",
                        self.doc_id
                    ));
                }
                return;
            }
        };
        st.projection_owed = false;
        let snapshot = Value::Object(snapshot);
        let projection = self.projection_locked(st);
        let saved = ctx
            .run(self.endpoint.save(
                &self.doc_id,
                &snapshot,
                st.version.as_deref(),
                projection.as_ref(),
            ))
            .await;
        let answered = match saved {
            Ok(answered) => answered,
            Err(err) => {
                if !self.lifetime.is_cancelled() {
                    self.logf(&format!(
                        "collab: room \"{}\" could not export during flush: {err}",
                        self.doc_id
                    ));
                }
                return;
            }
        };
        if answered.is_some() {
            st.version = answered;
        }
        st.export_dirty = false;
        st.dirty_since = None;
        st.export_failures = 0;
        st.export_retry_at = None;
        st.projection_refused = false;
    }
}
