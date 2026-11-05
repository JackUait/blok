use std::sync::{Arc, Mutex, PoisonError};

use blok_collab::{BoxFuture, CloseReason, OperationSource};
use blok_collab_convert::{EditError, EditOp, is_too_large};
use blok_collab_journal::OpenOutcome;
use blok_collab_operation::{Checkpoint, LookupOutcome};
use blok_collab_wire::Message;
use blok_collab_workingset::{CURRENT_FORMAT, Tag, new_lineage};
use blok_jsjson::Value;
use blok_yjs::Doc;

use crate::cancel::Token;
use crate::error::{error_text, is_transient};
use crate::options::CHECKPOINT_FAILURE_LIMIT;
use crate::room::{Phase, Room, State};
use crate::{Converter, Error};

/// CollabEditStatus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditStatus {
    Applied,
    Conflict,
    Draining,
    Invalid,
    Overloaded,
    TooLarge,
    Purged,
    SeedFailed,
    Unavailable,
    PreconditionFailed,
    PreconditionRequired,
}

/// The C# CollabEditStatus name, which agent answers print.
impl std::fmt::Display for EditStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

/// The journal head an edit expects (If-Match).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Precondition {
    pub lineage: String,
    pub sequence: u64,
}

/// CollabEditReceipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Receipt {
    pub tag: Tag,
    pub server_sequence: u64,
}

/// CollabEditResult.
#[derive(Debug)]
pub struct EditResult {
    pub status: EditStatus,
    pub err: Option<Error>,
    pub receipt: Option<Receipt>,
}

impl EditResult {
    pub(crate) fn status(status: EditStatus) -> EditResult {
        EditResult {
            status,
            err: None,
            receipt: None,
        }
    }
}

/// Plans an edit against the live doc, inside the lane.
pub type PlanOps = Arc<dyn Fn(Doc) -> BoxFuture<'static, Result<Vec<EditOp>, Error>> + Send + Sync>;

/// Runs in the lane after an edit lands. The receipt is the answer the edit
/// gets, None in a room without a journal.
pub type Applied =
    Arc<dyn Fn(Doc, Option<Receipt>) -> BoxFuture<'static, Result<(), Error>> + Send + Sync>;

/// The edit refusal inside err, or err back.
fn refusal(err: Error) -> Result<EditError, Error> {
    match err {
        Error::Convert(blok_collab_convert::Error::Edit(refusal)) => Ok(refusal),
        other => Err(other),
    }
}

fn refusal_result(refusal: EditError) -> EditResult {
    let status = match refusal.err.as_deref() {
        Some(cause) if is_too_large(cause) => EditStatus::TooLarge,
        _ => EditStatus::Invalid,
    };
    EditResult {
        status,
        err: Some(Error::Convert(blok_collab_convert::Error::Edit(refusal))),
        receipt: None,
    }
}

/// A refused or overloaded plan or apply; Err for anything else.
fn classify(err: Error) -> Result<EditResult, Error> {
    match refusal(err) {
        Ok(refused) => Ok(refusal_result(refused)),
        Err(err) if is_transient(&err) => Ok(EditResult {
            status: EditStatus::Overloaded,
            err: Some(err),
            receipt: None,
        }),
        Err(err) => Err(err),
    }
}

/// CollabStateStatus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateStatus {
    Ready,
    Purged,
    Draining,
    SeedFailed,
    Unavailable,
    ExportFailed,
    Overloaded,
}

/// CollabStateResult.
#[derive(Debug)]
pub struct StateResult {
    pub status: StateStatus,
    pub json: Vec<u8>,
    pub head: Option<Receipt>,
    pub err: Option<Error>,
}

impl StateResult {
    pub(crate) fn status(status: StateStatus) -> StateResult {
        StateResult {
            status,
            json: Vec::new(),
            head: None,
            err: None,
        }
    }
}

/// CollabResetStatus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResetStatus {
    Done,
    SeedFailed,
    Unavailable,
    Purged,
}

/// CollabResetResult.
#[derive(Debug)]
pub struct ResetResult {
    pub status: ResetStatus,
    pub tag: Option<Tag>,
    pub err: Option<Error>,
}

impl ResetResult {
    pub(crate) fn status(status: ResetStatus) -> ResetResult {
        ResetResult {
            status,
            tag: None,
            err: None,
        }
    }
}

/// What applying ops to live would broadcast, measured on a scratch copy
/// with the same client id.
pub async fn planned_frame_bytes(
    live: &Doc,
    converter: &dyn Converter,
    ops: &[EditOp],
) -> Result<i64, Error> {
    let scratch = Doc::new(blok_yjs::Options::default());
    let whole = live.encode_state_as_update(&[])?;
    scratch.apply_update(&whole)?;
    scratch.adopt_client_id(live.client_id());
    let frame_bytes = Arc::new(Mutex::new(0i64));
    let counted = frame_bytes.clone();
    let subscription = scratch.on_update(move |event| {
        if event.local
            && let Ok(frame) = blok_collab_wire::encode(&Message::SyncUpdate {
                update: event.update.clone(),
            })
        {
            *counted.lock().unwrap_or_else(PoisonError::into_inner) += frame.len() as i64;
        }
    });
    let applied = converter.apply_ops(&scratch, ops).await;
    subscription.unsubscribe();
    applied?;
    Ok(*frame_bytes.lock().unwrap_or_else(PoisonError::into_inner))
}

#[derive(Clone)]
pub(crate) struct EditRequest {
    pub plan: PlanOps,
    pub gate_frame_size: bool,
    pub operation_id: String,
    pub digest: Vec<u8>,
    pub actor_id: String,
    pub expect: Option<Precondition>,
    pub applied: Option<Applied>,
}

impl Room {
    pub(crate) async fn edit(
        &self,
        caller: &Token,
        request: EditRequest,
    ) -> Result<Option<EditResult>, Error> {
        let _held = self.enter(caller).await?;
        let mut st = self.state.lock().await;
        self.edit_locked(&mut st, request).await
    }

    async fn edit_locked(
        &self,
        st: &mut State,
        request: EditRequest,
    ) -> Result<Option<EditResult>, Error> {
        if self.purging() {
            return Ok(Some(EditResult::status(EditStatus::Purged)));
        }
        if st.phase == Phase::Closed {
            return Ok(None);
        }
        if st.phase == Phase::New
            && let Some(failure) = self.try_load_locked(st).await
        {
            self.close_room_locked(st, None).await;
            let status = match failure.open {
                OpenOutcome::DocumentPurged => EditStatus::Purged,
                OpenOutcome::DocumentOpenElsewhere => EditStatus::Unavailable,
                OpenOutcome::Opened => EditStatus::SeedFailed,
            };
            return Ok(Some(EditResult {
                status,
                err: failure.err,
                receipt: None,
            }));
        }
        if self.purging() {
            return Ok(Some(EditResult::status(EditStatus::Purged)));
        }

        if let Some(session) = st.session.clone() {
            let ctx = self.lifetime.journal().clone();
            let committed = self
                .lifetime
                .run_for(
                    self.options.sleep(self.options.commit_timeout),
                    session.find_committed(&ctx, &request.operation_id, &request.digest),
                )
                .await;
            let committed = match committed {
                Ok(committed) => committed,
                Err(err) => {
                    self.fail_commit_locked(st, "look up an operation id", &err)
                        .await;
                    return Ok(Some(EditResult::status(EditStatus::Unavailable)));
                }
            };
            // A room this request loaded has no member to arm its eviction.
            match committed.outcome {
                LookupOutcome::Duplicate => {
                    self.update_eviction_locked(st, None);
                    return Ok(Some(EditResult {
                        status: EditStatus::Applied,
                        err: None,
                        receipt: Some(Receipt {
                            tag: st.tag.clone(),
                            server_sequence: committed.sequence,
                        }),
                    }));
                }
                LookupOutcome::Conflict => {
                    self.update_eviction_locked(st, None);
                    return Ok(Some(EditResult::status(EditStatus::Conflict)));
                }
                LookupOutcome::NotCommitted => {}
            }
            if let Some(expect) = &request.expect
                && (expect.lineage != st.tag.lineage || expect.sequence != st.committed_through)
            {
                self.update_eviction_locked(st, None);
                return Ok(Some(EditResult {
                    status: EditStatus::PreconditionFailed,
                    err: None,
                    receipt: Some(Receipt {
                        tag: st.tag.clone(),
                        server_sequence: st.committed_through,
                    }),
                }));
            }
        }

        let doc = st.doc();
        let mut planned = self.lifetime.run((request.plan)(doc.clone())).await;
        if let Ok(ops) = &planned
            && request.gate_frame_size
            && !ops.is_empty()
        {
            match self.fits_one_frame_locked(&doc, ops).await {
                Ok(true) => {}
                Ok(false) => {
                    self.update_eviction_locked(st, None);
                    return Ok(Some(EditResult {
                        status: EditStatus::TooLarge,
                        err: Some(Error::Convert(blok_collab_convert::Error::Edit(
                            EditError::new("collab: the restore is larger than one update may be."),
                        ))),
                        receipt: None,
                    }));
                }
                Err(err) => planned = Err(err),
            }
        }
        let ops = match planned {
            Ok(ops) => ops,
            Err(err) => {
                // Planning only reads the live doc, so the room stays open.
                self.update_eviction_locked(st, None);
                return classify(err).map(Some);
            }
        };

        self.take_local_updates();
        if st.session.is_none() {
            let applied = self
                .lifetime
                .run(self.converter.apply_ops(&doc, &ops))
                .await;
            self.publish_local_updates_locked(st);
            self.update_eviction_locked(st, None);
            if let Err(err) = applied {
                return classify(err).map(Some);
            }
            self.compact_if_oversized_locked(st);
            self.settle_in_flight_persist_locked(st).await;
            if let Err(err) = self.persist_locked(st, &self.lifetime.clone()).await {
                if self.lifetime.is_cancelled() {
                    return Err(err);
                }
                self.logf(&format!(
                    "collab: room \"{}\" could not persist an edit, retrying: {err}",
                    self.doc_id
                ));
                self.schedule_persist_locked(st);
            }
            self.mark_dirty_locked(st);
            if let Some(applied) = request.applied {
                self.lifetime.run(applied(doc, None)).await?;
            }
            return Ok(Some(EditResult::status(EditStatus::Applied)));
        }

        let state_before = doc.encode_state_vector();
        if let Err(err) = self
            .lifetime
            .run(self.converter.apply_ops(&doc, &ops))
            .await
        {
            self.take_local_updates();
            return match refusal(err) {
                Ok(refused) => {
                    self.update_eviction_locked(st, None);
                    Ok(Some(refusal_result(refused)))
                }
                Err(err) if is_transient(&err) => {
                    // Thrown before the first write: the room stays open.
                    self.update_eviction_locked(st, None);
                    Ok(Some(EditResult {
                        status: EditStatus::Overloaded,
                        err: Some(err),
                        receipt: None,
                    }))
                }
                Err(err) => {
                    // The converter may have written part of the edit: the
                    // room holds state no append can journal, so it goes.
                    self.fail_commit_locked(st, "apply an edit", &err).await;
                    Ok(Some(EditResult::status(EditStatus::Unavailable)))
                }
            };
        }
        // An edit that changed nothing wrote no bytes: applied, nothing to
        // append.
        if self.local_update_count() == 0 && doc.encode_state_vector() == state_before {
            self.update_eviction_locked(st, None);
            let receipt = Receipt {
                tag: st.tag.clone(),
                server_sequence: st.committed_through,
            };
            if let Some(applied) = request.applied {
                self.lifetime
                    .run(applied(doc, Some(receipt.clone())))
                    .await?;
            }
            return Ok(Some(EditResult {
                status: EditStatus::Applied,
                err: None,
                receipt: Some(receipt),
            }));
        }
        // One update is what the append journals; anything else is bytes the
        // journal would never see.
        let count = self.local_update_count();
        if count != 1 {
            self.take_local_updates();
            let err = Error::message(format!(
                "collab: applying an edit emitted {count} local updates."
            ));
            self.fail_commit_locked(st, "apply an edit", &err).await;
            return Ok(Some(EditResult::status(EditStatus::Unavailable)));
        }
        let update = self
            .local_updates
            .lock()
            .unwrap_or_else(PoisonError::into_inner)[0]
            .clone();
        let Some(sequence) = self
            .append_committed_locked(
                st,
                &request.operation_id,
                &request.actor_id,
                OperationSource::HttpEdit,
                &update,
                &request.digest,
            )
            .await
        else {
            return Ok(Some(EditResult::status(EditStatus::Unavailable)));
        };
        self.publish_local_updates_locked(st);
        self.compact_if_oversized_locked(st);
        self.schedule_persist_locked(st);
        self.mark_dirty_locked(st);
        self.update_eviction_locked(st, None);
        let receipt = Receipt {
            tag: st.tag.clone(),
            server_sequence: sequence,
        };
        if let Some(applied) = request.applied {
            self.lifetime
                .run(applied(doc, Some(receipt.clone())))
                .await?;
        }
        Ok(Some(EditResult {
            status: EditStatus::Applied,
            err: None,
            receipt: Some(receipt),
        }))
    }

    /// The limit is the announced cap (1 MiB when none), lowered to the
    /// store's append limit when known.
    async fn fits_one_frame_locked(&self, doc: &Doc, ops: &[EditOp]) -> Result<bool, Error> {
        let mut limit: i64 = 1 << 20;
        if self.options.announced_max_message_bytes > 0 {
            limit = self.options.announced_max_message_bytes;
        }
        if self.options.max_update_bytes > 0 && self.options.max_update_bytes < limit {
            limit = self.options.max_update_bytes;
        }
        let planned = self
            .lifetime
            .run(planned_frame_bytes(doc, self.converter.as_ref(), ops))
            .await?;
        Ok(planned <= limit)
    }

    pub(crate) async fn read_state(&self, caller: &Token) -> Result<Option<StateResult>, Error> {
        let _held = self.enter(caller).await?;
        let mut guard = self.state.lock().await;
        let st = &mut *guard;
        if self.purging() {
            return Ok(Some(StateResult::status(StateStatus::Purged)));
        }
        if st.phase == Phase::Closed {
            return Ok(None);
        }
        if st.phase == Phase::New
            && let Some(failure) = self.try_load_locked(st).await
        {
            self.close_room_locked(st, None).await;
            let status = match failure.open {
                OpenOutcome::DocumentPurged => StateStatus::Purged,
                OpenOutcome::DocumentOpenElsewhere => StateStatus::Unavailable,
                OpenOutcome::Opened => StateStatus::SeedFailed,
            };
            let mut result = StateResult::status(status);
            result.err = failure.err;
            return Ok(Some(result));
        }
        if self.purging() {
            return Ok(Some(StateResult::status(StateStatus::Purged)));
        }
        self.update_eviction_locked(st, None);
        let doc = st.doc();
        let before = caller.is_cancelled();
        let exported = caller
            .run(self.converter.export(&doc))
            .await
            .and_then(|exported| {
                Ok(blok_collab_docendpoint::serialize(&Value::Object(
                    exported,
                ))?)
            });
        let json = match exported {
            Ok(json) => json,
            Err(err) => {
                self.logf(&format!(
                    "collab: room \"{}\" could not export its state: {}",
                    self.doc_id,
                    error_text(&err, Some(caller), before)
                ));
                let status = if is_transient(&err) {
                    StateStatus::Overloaded
                } else {
                    StateStatus::ExportFailed
                };
                let mut result = StateResult::status(status);
                result.err = Some(err);
                return Ok(Some(result));
            }
        };
        let mut result = StateResult::status(StateStatus::Ready);
        result.json = json;
        if st.session.is_some() {
            result.head = Some(Receipt {
                tag: st.tag.clone(),
                server_sequence: st.committed_through,
            });
        }
        Ok(Some(result))
    }

    pub(crate) async fn checkpoint(&self, caller: &Token) -> Result<bool, Error> {
        let _held = self.enter(caller).await?;
        let mut st = self.state.lock().await;
        self.checkpoint_locked(&mut st).await
    }

    /// Refused while the engine holds pending state: a checkpoint replaces
    /// the operations it covers on replay.
    pub(crate) async fn checkpoint_locked(&self, st: &mut State) -> Result<bool, Error> {
        let Some(session) = st.session.clone() else {
            return Ok(false);
        };
        if self.purging()
            || st.phase != Phase::Ready
            || st.committed_through == st.checkpointed_through
            || st.doc().has_pending()
        {
            return Ok(false);
        }
        st.operations_since_checkpoint = 0;
        st.bytes_since_checkpoint = 0;
        let written = match st.doc().encode_state_as_update(&[]) {
            Ok(state) => {
                let ctx = self.lifetime.journal().clone();
                let checkpoint = Checkpoint {
                    through: st.committed_through,
                    state,
                };
                self.lifetime
                    .run_for(
                        self.options.sleep(self.options.commit_timeout),
                        session.write_checkpoint(&ctx, checkpoint),
                    )
                    .await
            }
            Err(err) => Err(err.into()),
        };
        if let Err(err) = written {
            // A lost fence, a refused sequence and an unreadable journal
            // never heal by retrying.
            use blok_collab_journal::Error as J;
            if matches!(
                err,
                Error::Journal(
                    J::FenceLost
                        | J::Argument {
                            out_of_range: true,
                            ..
                        }
                        | J::InvalidData { .. }
                )
            ) {
                self.fail_commit_locked(st, "publish a checkpoint", &err)
                    .await;
                return Ok(false);
            }
            st.checkpoint_failures += 1;
            if st.checkpoint_failures >= CHECKPOINT_FAILURE_LIMIT {
                self.fail_commit_locked(st, "publish a checkpoint", &err)
                    .await;
                return Ok(false);
            }
            self.logf(&format!(
                "collab: room \"{}\" could not publish a checkpoint ({} of {CHECKPOINT_FAILURE_LIMIT}), retrying later: {}",
                self.doc_id,
                st.checkpoint_failures,
                error_text(&err, None, false)
            ));
            return Ok(false);
        }
        st.checkpoint_failures = 0;
        st.checkpointed_through = st.committed_through;
        // MarkDirty arms no timer on a journal room, so the projection a
        // checkpoint earns is armed here, and marked owed.
        st.projection_owed = true;
        self.mark_dirty_locked(st);
        self.schedule_export_locked(st);
        Ok(true)
    }

    pub(crate) async fn reset(&self, caller: &Token) -> Result<Option<ResetResult>, Error> {
        let _held = self.enter(caller).await?;
        let mut st = self.state.lock().await;
        self.reset_locked(&mut st, caller).await
    }

    async fn reset_locked(
        &self,
        st: &mut State,
        caller: &Token,
    ) -> Result<Option<ResetResult>, Error> {
        if self.purging() {
            return Ok(Some(ResetResult::status(ResetStatus::Purged)));
        }
        if st.phase == Phase::Closed {
            return Ok(None);
        }
        if self.operations.is_some() {
            if st.phase == Phase::New
                && let Some(result) = self.open_for_reset_locked(st).await
            {
                return Ok(Some(result));
            }
            if self.purging() {
                return Ok(Some(ResetResult::status(ResetStatus::Purged)));
            }
            if st.phase == Phase::Ready {
                // Not under the caller's context: a client that disconnects
                // mid-flush would leave the record stale.
                self.flush_locked(st, &Token::new()).await;
            }
            // Strict, unlike the load path: a copy left beside the new
            // lineage holds what this reset threw away.
            if let Err(err) = self.lifetime.run(self.store.retire(&self.doc_id)).await {
                if self.lifetime.is_cancelled() {
                    return Err(err);
                }
                self.logf(&format!(
                    "collab: room \"{}\" could not retire its working set, so the reset is refused: {err}",
                    self.doc_id
                ));
                if st.phase == Phase::Ready && st.tag.format == CURRENT_FORMAT {
                    self.update_eviction_locked(st, None);
                } else {
                    self.close_room_locked(st, None).await;
                }
                return Ok(Some(ResetResult {
                    status: ResetStatus::Unavailable,
                    tag: None,
                    err: Some(err),
                }));
            }
            let mut current = st.tag.clone();
            if let Some(head) = st
                .session
                .as_ref()
                .and_then(|s| s.open_result().head.clone())
            {
                current = Tag {
                    format: head.format,
                    epoch: head.epoch,
                    lineage: head.lineage,
                };
            }
            let next = match self.reset_journal_locked(st, &current).await {
                Ok(next) => next,
                Err(err) => {
                    self.fail_commit_locked(st, "reset the document", &err)
                        .await;
                    return Ok(Some(ResetResult {
                        status: ResetStatus::Unavailable,
                        tag: None,
                        err: Some(err),
                    }));
                }
            };
            self.close_room_locked(st, Some(CloseReason::Reset)).await;
            return Ok(Some(ResetResult {
                status: ResetStatus::Done,
                tag: Some(next),
                err: None,
            }));
        }

        let mut current = st.tag.clone();
        if st.phase == Phase::New
            && let Some(stored) = caller.run(self.store.read(&self.doc_id)).await?
        {
            current = stored.tag;
        }
        self.settle_in_flight_persist_locked(st).await;
        if self.purging() {
            return Ok(Some(ResetResult::status(ResetStatus::Purged)));
        }
        let next = Tag {
            format: CURRENT_FORMAT,
            epoch: current.epoch + 1,
            lineage: new_lineage(),
        };
        caller.err()?;
        self.lifetime
            .run(self.store.reset(&self.doc_id, &next))
            .await?;
        self.close_room_locked(st, Some(CloseReason::Reset)).await;
        Ok(Some(ResetResult {
            status: ResetStatus::Done,
            tag: Some(next),
            err: None,
        }))
    }

    /// Opens the journal for a reset on an unloaded room and hydrates it,
    /// so the flush can project first. Some ends the reset.
    async fn open_for_reset_locked(&self, st: &mut State) -> Option<ResetResult> {
        let open = match self.try_open_journal_locked(st).await {
            Ok(open) => open,
            Err(err) => {
                self.close_room_locked(st, None).await;
                return Some(ResetResult {
                    status: ResetStatus::SeedFailed,
                    tag: None,
                    err: Some(err),
                });
            }
        };
        if self.purging() {
            return Some(ResetResult::status(ResetStatus::Purged));
        }
        if open != OpenOutcome::Opened {
            self.close_room_locked(st, None).await;
            if open == OpenOutcome::DocumentPurged {
                return Some(ResetResult::status(ResetStatus::Purged));
            }
            return Some(ResetResult::status(ResetStatus::Unavailable));
        }
        self.new_doc_locked(st);
        let has_head = st
            .session
            .as_ref()
            .is_some_and(|s| s.open_result().head.is_some());
        if has_head {
            match self.load_from_journal_locked(st, false).await {
                // A journal this engine cannot replay: nobody could have been
                // served it, and the reset throws it away regardless.
                Err(err) => self.logf(&format!(
                    "collab: room \"{}\" could not replay its journal before a reset, so the reset drops it: {err}",
                    self.doc_id
                )),
                Ok(()) => st.phase = Phase::Ready,
            }
            return None;
        }
        // A store that does not import working sets never seeded this
        // document: adopt the working copy so the flush sends its edits.
        match self.try_adopt_working_set_locked(st).await {
            Err(err) => {
                self.close_room_locked(st, None).await;
                Some(ResetResult {
                    status: ResetStatus::SeedFailed,
                    tag: None,
                    err: Some(err),
                })
            }
            Ok(adopted) => {
                if adopted {
                    st.phase = Phase::Ready;
                }
                None
            }
        }
    }

    pub(crate) async fn purge(&self, caller: &Token) -> Result<(), Error> {
        self.request_purge();
        let _held = self.enter(caller).await?;
        let mut guard = self.state.lock().await;
        let st = &mut *guard;
        if st.phase == Phase::Closed {
            return Ok(());
        }
        if let Some(save) = st.in_flight_save.take() {
            // A failed export does not block deletion.
            let _ = save.wait().await;
        }
        self.settle_in_flight_persist_locked(st).await;
        self.close_room_locked(st, Some(CloseReason::Forbidden))
            .await;
        Ok(())
    }

    /// Flushes (bounded by the caller), closes 1001 whatever happens, then
    /// waits for the activity pump, bounded by CommitTimeout and the caller.
    pub(crate) async fn drain(&self, caller: &Token) {
        {
            let _held = self.lane.reserve().hold().await;
            let mut guard = self.state.lock().await;
            let st = &mut *guard;
            if st.phase == Phase::Ready {
                self.flush_locked(st, caller).await;
            }
            if st.phase != Phase::Closed {
                self.close_room_locked(st, Some(CloseReason::Draining))
                    .await;
            }
        }
        // Biased: like C#'s WaitAsync, a settle that is already done wins
        // over a cancelled caller, so an idle pump logs nothing.
        tokio::select! {
            biased;
            () = self.settle() => {}
            () = self.options.sleep(self.options.commit_timeout) => self.logf(&format!(
                "collab: room \"{}\" abandoned its activity dispatch while draining: the observer is past its bound",
                self.doc_id
            )),
            () = caller.cancelled() => self.logf(&format!(
                "collab: room \"{}\" abandoned its activity dispatch while draining: the drain was cancelled",
                self.doc_id
            )),
        }
    }
}
