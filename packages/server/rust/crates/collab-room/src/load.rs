use std::sync::{Arc, PoisonError};

use blok_collab_journal::OpenOutcome;
use blok_collab_operation::Reset;
use blok_collab_wire::Message;
use blok_collab_workingset::{CURRENT_FORMAT, HTML_RICH_TEXT_FORMAT, NO_LINEAGE, Tag, new_lineage};
use blok_yjs::{ApplyResult, DEFAULT_INSPECT_DEPTH, Doc, Outcome, Verdict};

use crate::Error;
use crate::error::is_runtime_limit;
use crate::room::{Job, Phase, Room, State, Task};

/// Why a load produced no Ready room. `open` is Opened when the failure is
/// an error, not an open outcome.
pub(crate) struct LoadFailure {
    pub open: OpenOutcome,
    pub err: Option<Error>,
}

fn head_tag(format: i32, epoch: i64, lineage: &str) -> Tag {
    Tag {
        format,
        epoch,
        lineage: lineage.to_owned(),
    }
}

impl Room {
    /// A random uint32 client id, as a browser draws.
    pub(crate) fn new_doc_locked(&self, st: &mut State) {
        if let Some(subscription) = st.subscription.take() {
            subscription.unsubscribe();
        }
        let doc = Doc::new(blok_yjs::Options::default());
        let captured = self.local_updates.clone();
        st.subscription = Some(doc.on_update(move |event| {
            if event.local {
                captured
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(event.update.clone());
            }
        }));
        st.doc = Some(doc);
    }

    pub(crate) async fn try_open_journal_locked(
        &self,
        st: &mut State,
    ) -> Result<OpenOutcome, Error> {
        let operations = self
            .operations
            .clone()
            .expect("a journal room has an operation store");
        let ctx = self.lifetime.journal().clone();
        let (outcome, session) = self
            .lifetime
            .run(operations.open(&ctx, &self.doc_id))
            .await?;
        if outcome == OpenOutcome::DocumentPurged {
            return Ok(OpenOutcome::DocumentPurged);
        }
        let Some(session) = session else {
            self.logf(&format!(
                "collab: document \"{}\" is open in another process",
                self.doc_id
            ));
            return Ok(OpenOutcome::DocumentOpenElsewhere);
        };
        st.session = Some(session);
        Ok(OpenOutcome::Opened)
    }

    /// Load-or-seed; it returns the failure so the join can report it.
    pub(crate) async fn try_load_locked(&self, st: &mut State) -> Option<LoadFailure> {
        match self.load_locked(st).await {
            Ok(failure) => failure,
            Err(err) => {
                self.logf(&format!(
                    "collab: room \"{}\" could not load: {err}",
                    self.doc_id
                ));
                st.load_held_off = st.migration_failed || is_runtime_limit(&err);
                Some(LoadFailure {
                    open: OpenOutcome::Opened,
                    err: Some(err),
                })
            }
        }
    }

    async fn load_locked(&self, st: &mut State) -> Result<Option<LoadFailure>, Error> {
        self.new_doc_locked(st);
        if self.operations.is_some() {
            let open = self.try_open_journal_locked(st).await?;
            if open != OpenOutcome::Opened {
                return Ok(Some(LoadFailure { open, err: None }));
            }
            self.load_from_journal_locked(st, true).await?;
            st.phase = Phase::Ready;
            return Ok(None);
        }

        let stored = self.lifetime.run(self.store.read(&self.doc_id)).await?;
        if let Some(stored) = stored {
            self.require_readable_format(stored.tag.format)?;
            st.tag = stored.tag;
            self.hydrate_locked(st, &stored.updates)?;
        }

        if st.frame_count == 0 {
            if st.tag.format != CURRENT_FORMAT {
                // Nothing to migrate; the seed writes the current format.
                st.tag = head_tag(CURRENT_FORMAT, st.tag.epoch + 1, &new_lineage());
            }
            self.seed_locked(st).await?;
        } else if st.tag.format != CURRENT_FORMAT {
            self.migrate_working_set_locked(st).await?;
        } else if self.compact_if_oversized_locked(st) {
            match self.persist_locked(st, &self.lifetime).await {
                Err(err) if self.lifetime.is_cancelled() => return Err(err),
                Err(err) => {
                    // The doc and the stored blob are both fine; the
                    // compacted log is retried once the room is Ready.
                    self.logf(&format!(
                        "collab: room \"{}\" could not write its compacted working set, retrying: {err}",
                        self.doc_id
                    ));
                    st.persist_failures += 1;
                    let due = self.options.backoff(st.persist_failures);
                    self.persist_timer
                        .change(&self.arc(), Some(due), || Job::SchedulePersist);
                }
                Ok(()) => {}
            }
        }
        st.phase = Phase::Ready;
        Ok(None)
    }

    /// Replays committed data only: the baseline, the checkpoint, then the
    /// tail. A document with no head has never been seeded.
    pub(crate) async fn load_from_journal_locked(
        &self,
        st: &mut State,
        migrate: bool,
    ) -> Result<(), Error> {
        let session = st.session.clone().expect("an open journal");
        let opened = session.open_result();
        let Some(head) = &opened.head else {
            return self.seed_journal_locked(st).await;
        };
        self.require_readable_format(head.format)?;
        st.tag = head_tag(head.format, head.epoch, &head.lineage);
        st.committed_through = head.durable_through;
        st.checkpointed_through = opened.checkpoint.as_ref().map_or(0, |c| c.through);
        // The uncovered tail counts toward the next checkpoint. Wraps like
        // C#'s ulong-to-long cast when a store answers a checkpoint ahead of
        // durable.
        st.operations_since_checkpoint =
            st.committed_through.wrapping_sub(st.checkpointed_through) as i64;
        self.start_version_read_locked(st);
        self.hydrate_committed_locked(st, &opened.baseline)?;
        if let Some(checkpoint) = &opened.checkpoint {
            self.hydrate_committed_locked(st, std::slice::from_ref(&checkpoint.state))?;
        }
        let tail: Vec<Vec<u8>> = opened.tail.iter().map(|r| r.update.clone()).collect();
        self.hydrate_committed_locked(st, &tail)?;
        if migrate && st.tag.format != CURRENT_FORMAT {
            self.migrate_journal_locked(st).await?;
        }
        // The journal is the record now; a working set beside it is stale.
        self.drop_working_set_locked().await;
        // The previous room may have died with a projection owed.
        self.mark_dirty_locked(st);
        Ok(())
    }

    /// Reads the consumer's version handle beside the room, best effort.
    pub(crate) fn start_version_read_locked(&self, st: &mut State) {
        let room = self.arc();
        let weak = Arc::downgrade(&room);
        let reading = Task::start(
            async move {
                match room.lifetime.run(room.endpoint.load(&room.doc_id)).await {
                    Ok(loaded) => Ok(loaded.version),
                    Err(err) => {
                        if !room.lifetime.is_cancelled() {
                            room.logf(&format!(
                                "collab: room \"{}\" could not read the document version, so its write-back will carry none: {err}",
                                room.doc_id
                            ));
                        }
                        Ok(None)
                    }
                }
            },
            move |id| {
                if let Some(room) = weak.upgrade() {
                    room.post(Job::VersionAnswered(id));
                }
            },
        );
        st.pending_version = Some(reading);
    }

    /// May only fill the handle, never replace one.
    pub(crate) fn apply_version_locked(&self, st: &mut State, id: u64, answered: Option<String>) {
        if st
            .pending_version
            .as_ref()
            .is_none_or(|reading| reading.id != id)
        {
            return;
        }
        st.pending_version = None;
        if answered.is_some() && st.version.is_none() {
            st.version = answered;
        }
    }

    /// Waits out the load-time version read where a PUT is built, bounded
    /// because the lane is held.
    pub(crate) async fn settle_version_locked(&self, st: &mut State) {
        let Some(reading) = st.pending_version.clone() else {
            return;
        };
        match tokio::time::timeout(self.options.commit_timeout, reading.wait()).await {
            Ok(answered) => self.apply_version_locked(st, reading.id, answered.ok().flatten()),
            Err(_) => self.logf(&format!(
                "collab: room \"{}\" is projecting before its version read finished: it did not answer within the commit timeout",
                self.doc_id
            )),
        }
    }

    fn hydrate_committed_locked(&self, st: &mut State, updates: &[Vec<u8>]) -> Result<(), Error> {
        for update in updates {
            if self.apply_remote_locked(st, update).is_none() {
                return Err(Error::message(format!(
                    "collab: committed data for \"{}\" could not be applied.",
                    self.doc_id
                )));
            }
            self.append_locked(st, update);
        }
        Ok(())
    }

    /// The endpoint's JSON becomes the sequence-zero baseline under a fresh
    /// lineage, and the reset is awaited.
    async fn seed_journal_locked(&self, st: &mut State) -> Result<(), Error> {
        if self.try_adopt_working_set_locked(st).await? {
            return Ok(());
        }
        let loaded = self.lifetime.run(self.endpoint.load(&self.doc_id)).await?;
        st.version = loaded.version;
        self.take_local_updates();
        if let Some(data) = &loaded.data {
            let doc = st.doc();
            self.lifetime.run(self.converter.seed(&doc, data)).await?;
        }
        let baseline = self.take_local_updates();
        for update in &baseline {
            self.append_locked(st, update);
        }
        let head = self
            .session_reset(
                st,
                Reset {
                    format: CURRENT_FORMAT,
                    epoch: 0,
                    lineage: new_lineage(),
                    baseline,
                },
            )
            .await?;
        st.tag = head_tag(head.format, head.epoch, &head.lineage);
        Ok(())
    }

    async fn session_reset(
        &self,
        st: &State,
        reset: Reset,
    ) -> Result<blok_collab_operation::Head, Error> {
        let session = st.session.clone().expect("an open journal");
        let ctx = self.lifetime.journal().clone();
        self.lifetime.run(session.reset(&ctx, reset)).await
    }

    /// Makes a working set left by a journal-less room the journal's
    /// baseline. False when there is nothing to adopt.
    pub(crate) async fn try_adopt_working_set_locked(&self, st: &mut State) -> Result<bool, Error> {
        let Some(stored) = self.lifetime.run(self.store.read(&self.doc_id)).await? else {
            return Ok(false);
        };
        self.require_readable_format(stored.tag.format)?;
        let Some(frames) = blok_collab_workingset::decode_frames(&stored.updates) else {
            return Err(Error::message(format!(
                "collab: the stored working set for \"{}\" is not a valid update log.",
                self.doc_id
            )));
        };
        if frames.is_empty() {
            return Ok(false);
        }
        for frame in &frames {
            if self.apply_remote_locked(st, frame).is_none() {
                return Err(Error::message(format!(
                    "collab: a stored update for \"{}\" could not be applied.",
                    self.doc_id
                )));
            }
        }
        let mut adopted = stored.tag.clone();
        if !adopted.is_announceable() {
            adopted = head_tag(CURRENT_FORMAT, 0, &new_lineage());
        }
        let mut baseline = frames;
        // The STORED format: the fallback above stamps the current one on a
        // copy that is still format 1.
        if stored.tag.format != CURRENT_FORMAT {
            self.migrate_rich_text_locked(st).await?;
            baseline = vec![st.doc().encode_state_as_update(&[])?];
            adopted = head_tag(CURRENT_FORMAT, adopted.epoch + 1, &new_lineage());
        }
        let head = self
            .session_reset(
                st,
                Reset {
                    format: adopted.format,
                    epoch: adopted.epoch,
                    lineage: adopted.lineage,
                    baseline,
                },
            )
            .await?;
        st.tag = head_tag(head.format, head.epoch, &head.lineage);
        self.start_version_read_locked(st);
        self.mark_dirty_locked(st);
        // Only after the reset is durable: before it, the working set is the
        // only copy.
        self.drop_working_set_locked().await;
        Ok(true)
    }

    /// Retires (never deletes) the stale working set, best effort.
    async fn drop_working_set_locked(&self) {
        if let Err(err) = self.lifetime.run(self.store.retire(&self.doc_id)).await
            && !self.lifetime.is_cancelled()
        {
            self.logf(&format!(
                "collab: room \"{}\" could not drop its stale working set: {err}",
                self.doc_id
            ));
        }
    }

    /// Builds a standalone baseline from the endpoint.
    pub(crate) async fn reset_journal_locked(
        &self,
        st: &mut State,
        current: &Tag,
    ) -> Result<Tag, Error> {
        let loaded = self.lifetime.run(self.endpoint.load(&self.doc_id)).await?;
        let reset_doc = Doc::new(blok_yjs::Options::default());
        let baseline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = baseline.clone();
        let subscription = reset_doc.on_update(move |event| {
            if event.local {
                captured
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(event.update.clone());
            }
        });
        let seeded = match &loaded.data {
            Some(data) => {
                self.lifetime
                    .run(self.converter.seed(&reset_doc, data))
                    .await
            }
            None => Ok(()),
        };
        subscription.unsubscribe();
        seeded?;
        let baseline =
            std::mem::take(&mut *baseline.lock().unwrap_or_else(PoisonError::into_inner));
        let head = self
            .session_reset(
                st,
                Reset {
                    format: CURRENT_FORMAT,
                    epoch: current.epoch + 1,
                    lineage: new_lineage(),
                    baseline,
                },
            )
            .await?;
        st.tag = head_tag(head.format, head.epoch, &head.lineage);
        Ok(st.tag.clone())
    }

    /// Format 1 is read only to be migrated; anything newer was written by
    /// a newer server.
    fn require_readable_format(&self, format: i32) -> Result<(), Error> {
        if format == HTML_RICH_TEXT_FORMAT || format == CURRENT_FORMAT {
            return Ok(());
        }
        Err(Error::message(format!(
            "collab: the stored document \"{}\" has format {format}; this server reads format 2 and migrates format 1.",
            self.doc_id
        )))
    }

    /// The doc half of a migration; its update is never published.
    async fn migrate_rich_text_locked(&self, st: &mut State) -> Result<(), Error> {
        let doc = st.doc();
        match self
            .lifetime
            .run(self.converter.migrate_rich_text(&doc))
            .await
        {
            Err(err) if !self.lifetime.is_cancelled() => {
                st.migration_failed = true;
                return Err(Error::Wrapped {
                    message: format!(
                        "collab: room \"{}\" could not migrate its format-1 rich text, so the store keeps format 1 and the next open tries again (for a very large field, raise the runtime's timeout): {err}",
                        self.doc_id
                    ),
                    err: Box::new(err),
                });
            }
            Err(err) => return Err(err),
            Ok(_) => {}
        }
        self.take_local_updates();
        Ok(())
    }

    /// The migrated state becomes the baseline of a NEW lineage. The reset
    /// is the commit point.
    async fn migrate_journal_locked(&self, st: &mut State) -> Result<(), Error> {
        self.migrate_rich_text_locked(st).await?;
        let whole = st.doc().encode_state_as_update(&[])?;
        let head = self
            .session_reset(
                st,
                Reset {
                    format: CURRENT_FORMAT,
                    epoch: st.tag.epoch + 1,
                    lineage: new_lineage(),
                    baseline: vec![whole.clone()],
                },
            )
            .await?;
        st.tag = head_tag(head.format, head.epoch, &head.lineage);
        st.committed_through = head.durable_through;
        st.checkpointed_through = 0;
        st.operations_since_checkpoint = 0;
        st.bytes_since_checkpoint = 0;
        self.replace_log_locked(st, &whole);
        Ok(())
    }

    /// A write, never a store reset, awaited so a failed write leaves format
    /// 1 for the next open.
    async fn migrate_working_set_locked(&self, st: &mut State) -> Result<(), Error> {
        self.migrate_rich_text_locked(st).await?;
        self.compact_locked(st)?;
        st.tag = head_tag(CURRENT_FORMAT, st.tag.epoch + 1, &new_lineage());
        self.persist_locked(st, &self.lifetime).await?;
        // The host record still holds HTML.
        self.mark_dirty_locked(st);
        Ok(())
    }

    fn hydrate_locked(&self, st: &mut State, stored_frames: &[u8]) -> Result<(), Error> {
        let Some(frames) = blok_collab_workingset::decode_frames(stored_frames) else {
            return Err(Error::message(format!(
                "collab: the stored working set for \"{}\" is not a valid update log.",
                self.doc_id
            )));
        };
        for frame in &frames {
            if self.apply_remote_locked(st, frame).is_none() {
                return Err(Error::message(format!(
                    "collab: a stored update for \"{}\" could not be applied.",
                    self.doc_id
                )));
            }
        }
        st.frame_section.extend_from_slice(stored_frames);
        st.frame_count = frames.len();
        Ok(())
    }

    async fn seed_locked(&self, st: &mut State) -> Result<(), Error> {
        let loaded = self.lifetime.run(self.endpoint.load(&self.doc_id)).await?;
        st.version = loaded.version;
        // A seed is a new CRDT history, so a new lineage; a null document
        // under a lineage the store still holds creates none.
        if loaded.data.is_some() || st.tag.lineage == NO_LINEAGE {
            st.tag.lineage = new_lineage();
        }
        self.take_local_updates();
        if let Some(data) = &loaded.data {
            let doc = st.doc();
            self.lifetime.run(self.converter.seed(&doc, data)).await?;
        }
        self.publish_local_updates_locked(st);
        // Awaited: a seed that cannot be written fails the join closed.
        self.persist_locked(st, &self.lifetime).await
    }

    /// Appends and relays what the last local transaction emitted.
    pub(crate) fn publish_local_updates_locked(&self, st: &mut State) {
        for update in self.take_local_updates() {
            self.append_locked(st, &update);
            if let Ok(frame) = blok_collab_wire::encode(&Message::SyncUpdate { update }) {
                self.broadcast_locked(st, &frame, None);
            }
        }
    }

    /// Screens and applies an update; None when it was not applied. Only
    /// Malformed and TooDeep are refused, with a log and a drop.
    pub(crate) fn apply_remote_locked(&self, st: &State, update: &[u8]) -> Option<ApplyResult> {
        let inspection = blok_yjs::inspect(update, DEFAULT_INSPECT_DEPTH);
        let decoded = match (inspection.verdict, &inspection.decoded) {
            (Verdict::Ok, Some(decoded)) => decoded,
            _ => {
                self.logf(&format!(
                    "collab: room \"{}\" dropped an update it could not read: {}",
                    self.doc_id, inspection.reason
                ));
                return None;
            }
        };
        match st.doc().apply_decoded(decoded) {
            Ok(applied) if applied.outcome == Outcome::Applied => Some(applied),
            Ok(_) => None,
            Err(err) => {
                self.logf(&format!(
                    "collab: room \"{}\" dropped an update it could not apply: {err}",
                    self.doc_id
                ));
                None
            }
        }
    }

    /// The working-set log. A journal room keeps none, which is what skips
    /// every blob path.
    pub(crate) fn append_locked(&self, st: &mut State, update: &[u8]) {
        if st.session.is_some() {
            return;
        }
        blok_collab_workingset::append_frame(&mut st.frame_section, update);
        st.frame_count += 1;
        st.blob_version += 1;
    }
}
