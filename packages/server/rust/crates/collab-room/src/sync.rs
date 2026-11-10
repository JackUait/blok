use std::sync::Arc;

use blok_collab::{CloseReason, Member, OperationSource};
use blok_collab_operation::{AppendOutcome, Candidate, LookupOutcome, Source};
use blok_collab_wire::{AwarenessEntry, Identity, MAX_AWARENESS_CLIENT_ID, Message};
use sha2::{Digest, Sha256};

use crate::error::error_text;
use crate::options::MALFORMED_AWARENESS_LIMIT;
use crate::room::{
    AwarenessOwner, Job, Room, State, must_encode, new_operation_id, queue_awareness_frame,
};
use crate::{ActivityKind, Error};

pub(crate) fn sha256(update: &[u8]) -> Vec<u8> {
    Sha256::digest(update).to_vec()
}

fn append_outcome_name(outcome: AppendOutcome) -> &'static str {
    match outcome {
        AppendOutcome::Committed => "Committed",
        AppendOutcome::Duplicate => "Duplicate",
        AppendOutcome::Conflict => "Conflict",
    }
}

impl Room {
    fn member_of(st: &State, id: u64) -> Option<Arc<dyn Member>> {
        st.members.get(&id).map(|e| e.member.clone())
    }

    pub(crate) async fn receive_locked(&self, st: &mut State, id: u64, frame: &[u8]) {
        let message = match blok_collab_wire::decode(frame) {
            Ok(message) => message,
            Err(err) => {
                self.logf(&format!(
                    "collab: room \"{}\" dropped a frame: {}",
                    self.doc_id, err.reason
                ));
                return;
            }
        };
        let Some(member) = Self::member_of(st, id) else {
            return;
        };
        // Protocol §7: a v2 client writes only through operation frames.
        if matches!(
            message,
            Message::SyncStep2 { .. } | Message::SyncUpdate { .. }
        ) && member.protocol_source() == OperationSource::ClientV2
        {
            self.logf(&format!(
                "collab: room \"{}\" closed a v2 member that sent a raw write",
                self.doc_id
            ));
            self.expel_locked(st, id, CloseReason::RawWriteOnV2);
            return;
        }
        match message {
            Message::SyncStep1 { state_vector } => {
                self.answer_sync_step1_locked(st, id, &state_vector)
            }
            Message::SyncStep2 { update } | Message::SyncUpdate { update } => {
                self.apply_from_member_locked(st, id, &update).await;
            }
            Message::Operation {
                lineage,
                operation_id,
                update,
            } => {
                self.commit_from_member_locked(st, id, &lineage, &operation_id, &update)
                    .await;
            }
            Message::Awareness { update } => self.relay_awareness_locked(st, id, &update),
            Message::QueryAwareness => {
                self.broadcast_locked(st, &queue_awareness_frame(), Some(id))
            }
            // Payload-free: identity comes from the handshake, time from here.
            Message::Activity => {
                self.record_activity_locked(st, &member.actor_id(), ActivityKind::Active);
            }
            _ => {}
        }
    }

    /// Relays presence verbatim after walking it. Over the cap the frame is
    /// dropped; the third malformed frame closes the sender.
    fn relay_awareness_locked(&self, st: &mut State, id: u64, update: &[u8]) {
        let max = self.options.max_awareness_clients;
        let mut cache = std::mem::take(&mut st.awareness_cache);
        let (clients, valid) =
            blok_collab_wire::validate_awareness_update(update, max, Some(&mut cache));
        if valid {
            self.record_awareness_owners_locked(st, id, &cache);
            st.awareness_cache = cache;
            self.broadcast_locked(
                st,
                &must_encode(&Message::Awareness {
                    update: update.to_vec(),
                }),
                Some(id),
            );
            return;
        }
        st.awareness_cache = cache;
        if clients > max {
            self.logf(&format!(
                "collab: room \"{}\" dropped an awareness frame claiming {clients} clients (the cap is {max})",
                self.doc_id
            ));
            return;
        }
        let Some(entry) = st.members.get_mut(&id) else {
            return;
        };
        entry.malformed_awareness += 1;
        let malformed = entry.malformed_awareness;
        self.logf(&format!(
            "collab: room \"{}\" dropped a malformed awareness frame ({malformed} of {MALFORMED_AWARENESS_LIMIT} from this member)",
            self.doc_id
        ));
        if malformed >= MALFORMED_AWARENESS_LIMIT {
            self.expel_locked(st, id, CloseReason::BadAwareness);
        }
    }

    /// Replies Step2(diff) then Step1(sv), and only then marks the member
    /// synced. The server never sends its own SyncStep1 first.
    fn answer_sync_step1_locked(&self, st: &mut State, id: u64, peer_state_vector: &[u8]) {
        let doc = st.doc();
        let diff = match doc.encode_state_as_update(peer_state_vector) {
            Ok(diff) => diff,
            Err(err) => {
                self.logf(&format!(
                    "collab: room \"{}\" dropped a SyncStep1 it could not answer: {err}",
                    self.doc_id
                ));
                return;
            }
        };
        let state_vector = doc.encode_state_vector();
        if diff.is_empty() || state_vector.is_empty() {
            self.logf(&format!(
                "collab: room \"{}\" dropped a SyncStep1 with an unusable state vector",
                self.doc_id
            ));
            return;
        }
        let Some(entry) = st.members.get_mut(&id) else {
            return;
        };
        let member = entry.member.clone();
        self.send_encoded(member.as_ref(), &Message::SyncStep2 { update: diff });
        self.send_encoded(member.as_ref(), &Message::SyncStep1 { state_vector });
        entry.synced = true;
    }

    /// A v2 operation: settle the id, apply, journal it, and only then let
    /// anyone see it.
    async fn commit_from_member_locked(
        &self,
        st: &mut State,
        id: u64,
        lineage: &str,
        operation_id: &str,
        update: &[u8],
    ) {
        let Some(session) = st.session.clone() else {
            self.logf(&format!(
                "collab: room \"{}\" dropped an operation frame; it has no operation store",
                self.doc_id
            ));
            return;
        };
        let Some(entry) = st.members.get(&id) else {
            return;
        };
        let (member, synced) = (entry.member.clone(), entry.synced);
        if member.protocol_source() != OperationSource::ClientV2 {
            self.logf(&format!(
                "collab: room \"{}\" dropped an operation frame from a member that did not negotiate v2",
                self.doc_id
            ));
            return;
        }
        let reject = |code: &str| self.reject_locked(member.as_ref(), lineage, operation_id, code);
        if !member.can_write() {
            return reject("read-only");
        }
        if !synced {
            return reject("not-synced");
        }
        // Ahead of the lookup, which answers for the current lineage only.
        if lineage != st.tag.lineage {
            return reject("lineage-mismatch");
        }
        let digest = sha256(update);
        let ctx = self.lifetime.journal().clone();
        let committed = self
            .lifetime
            .run_for(
                self.options.sleep(self.options.commit_timeout),
                session.find_committed(&ctx, operation_id, &digest),
            )
            .await;
        let committed = match committed {
            Ok(committed) => committed,
            Err(err) => {
                self.fail_commit_locked(st, "look up an operation id", &err)
                    .await;
                return;
            }
        };
        match committed.outcome {
            LookupOutcome::Duplicate => {
                self.acknowledge_locked(st, member.as_ref(), operation_id, committed.sequence);
                return;
            }
            LookupOutcome::Conflict => return reject("operation-id-conflict"),
            LookupOutcome::NotCommitted => {}
        }
        let Some(applied) = self.apply_remote_locked(st, update) else {
            return reject("invalid-update");
        };
        // A reload's residual round resends the whole delete set (see the v1
        // path). Ack it at the head and journal nothing. With no head yet an
        // ack has no sequence to name (it must be at least 1), so that one is
        // still journalled.
        if !applied.changed && st.committed_through > 0 {
            self.acknowledge_locked(st, member.as_ref(), operation_id, st.committed_through);
            return;
        }
        let Some(sequence) = self
            .append_committed_locked(
                st,
                operation_id,
                &member.actor_id(),
                member.protocol_source(),
                update,
                &digest,
                None,
            )
            .await
        else {
            return;
        };
        self.append_locked(st, update);
        // The submitter included: on v2 the relay is how a writer sees what
        // was accepted, and the acknowledgement follows it.
        self.broadcast_locked(
            st,
            &must_encode(&Message::SyncUpdate {
                update: update.to_vec(),
            }),
            None,
        );
        self.acknowledge_locked(st, member.as_ref(), operation_id, sequence);
        self.compact_if_oversized_locked(st);
        self.schedule_persist_locked(st);
        self.mark_dirty_locked(st);
    }

    /// The durable step every journal write shares. It answers the
    /// sequence, or closes the room before anything is published.
    #[allow(clippy::too_many_arguments, reason = "the Go and C# signatures")]
    pub(crate) async fn append_committed_locked(
        &self,
        st: &mut State,
        operation_id: &str,
        actor_id: &str,
        source: OperationSource,
        update: &[u8],
        digest: &[u8],
        note: Option<crate::RecordNote>,
    ) -> Option<u64> {
        let session = st.session.clone()?;
        let actor = (!actor_id.is_empty()).then(|| actor_id.to_owned());
        let ctx = self.lifetime.journal().clone();
        let candidate = Candidate {
            operation_id: operation_id.to_owned(),
            actor_id: actor,
            source: Source(source as u8),
            update: update.to_vec(),
            digest: digest.to_vec(),
        };
        let appended = self
            .lifetime
            .run_for(
                self.options.sleep(self.options.commit_timeout),
                session.append(&ctx, candidate),
            )
            .await;
        let appended = match appended {
            Ok(appended) => appended,
            Err(err) => {
                // A timeout too: the write may still land, so the outcome is
                // unknown.
                self.fail_commit_locked(st, "journal an operation", &err)
                    .await;
                return None;
            }
        };
        if appended.outcome != AppendOutcome::Committed {
            let err = Error::message(format!(
                "collab: the store returned {} for new operation \"{operation_id}\".",
                append_outcome_name(appended.outcome)
            ));
            self.fail_commit_locked(st, "journal an operation", &err)
                .await;
            return None;
        }
        st.committed_through = appended.sequence;
        let note = note.or_else(|| crate::classify_actor(actor_id, false, ""));
        self.write_note_locked(st, appended.sequence, note.clone())
            .await;
        if let Some(manager) = self.manager.upgrade()
            && let Some(hub) = &manager.signals
        {
            hub.committed(
                &self.manager,
                &self.doc_id,
                &st.tag.lineage,
                appended.sequence,
                actor_id,
                note.clone(),
            );
        }
        // After the append: an edit is reported once it is durable.
        self.record_activity_locked(st, actor_id, ActivityKind::Edited);
        st.operations_since_checkpoint += 1;
        st.bytes_since_checkpoint += update.len() as i64;
        if st.operations_since_checkpoint >= self.options.checkpoint_operation_threshold
            || st.bytes_since_checkpoint >= self.options.checkpoint_byte_threshold
        {
            // Posted: this operation still owes its broadcast and receipt.
            self.post(Job::Checkpoint);
        }
        Some(appended.sequence)
    }

    /// Stores who wrote the record just journalled. Not atomic with the
    /// journal: a crash, a timeout or an error here loses only this note,
    /// and never fails the edit or closes the room.
    async fn write_note_locked(&self, st: &State, sequence: u64, note: Option<crate::RecordNote>) {
        let (Some(notes), Some(note)) = (self.notes.clone(), note) else {
            return;
        };
        let written = self
            .lifetime
            .run_for(
                self.options.sleep(self.options.commit_timeout),
                notes.write(&self.doc_id, &st.tag.lineage, sequence, note),
            )
            .await;
        if let Err(err) = written {
            self.logf(&format!(
                "collab: the record note of {sequence} in \"{}\" was not written: {err}",
                self.doc_id
            ));
        }
    }

    fn acknowledge_locked(
        &self,
        st: &State,
        member: &dyn Member,
        operation_id: &str,
        sequence: u64,
    ) {
        self.send_encoded(
            member,
            &Message::Acknowledgement {
                lineage: st.tag.lineage.clone(),
                operation_id: operation_id.to_owned(),
                server_sequence: sequence,
            },
        );
    }

    /// Carries the lineage the client named, not the room's.
    fn reject_locked(&self, member: &dyn Member, lineage: &str, operation_id: &str, code: &str) {
        self.logf(&format!(
            "collab: room \"{}\" refused operation \"{operation_id}\": {code}",
            self.doc_id
        ));
        self.send_encoded(
            member,
            &Message::Rejection {
                lineage: lineage.to_owned(),
                operation_id: operation_id.to_owned(),
                code: code.to_owned(),
            },
        );
    }

    /// The doc may hold bytes the journal does not, so the room closes
    /// every member with the retryable close and discards itself.
    pub(crate) async fn fail_commit_locked(&self, st: &mut State, what: &str, err: &Error) {
        // Every commit step runs on a fresh commit timeout, so a cancel here
        // came during the call.
        self.logf(&format!(
            "collab: room \"{}\" could not {what}, closing: {}",
            self.doc_id,
            error_text(err, None, false)
        ));
        st.commit_unavailable = true;
        self.close_room_locked(st, Some(CloseReason::CommitUnavailable))
            .await;
    }

    /// A SyncStep2 or Update from a v1 or stock member. A journal room
    /// journals it under a minted id and sends no receipt.
    async fn apply_from_member_locked(&self, st: &mut State, id: u64, update: &[u8]) {
        let Some(member) = Self::member_of(st, id) else {
            return;
        };
        if !member.can_write() {
            return;
        }
        if st.session.is_none() {
            if self.apply_remote_locked(st, update).is_some() {
                self.publish_from_member_locked(st, id, update);
            }
            return;
        }
        let Some(result) = self.apply_remote_locked(st, update) else {
            return;
        };
        // The ENGINE decides whether anything changed, never the bytes.
        if !result.changed {
            return;
        }
        let digest = sha256(update);
        if self
            .append_committed_locked(
                st,
                &new_operation_id(),
                &member.actor_id(),
                member.protocol_source(),
                update,
                &digest,
                None,
            )
            .await
            .is_none()
        {
            return;
        }
        self.publish_from_member_locked(st, id, update);
    }

    /// Relays a v1 write to the OTHERS only.
    fn publish_from_member_locked(&self, st: &mut State, id: u64, update: &[u8]) {
        self.append_locked(st, update);
        self.broadcast_locked(
            st,
            &must_encode(&Message::SyncUpdate {
                update: update.to_vec(),
            }),
            Some(id),
        );
        self.compact_if_oversized_locked(st);
        self.schedule_persist_locked(st);
        self.mark_dirty_locked(st);
    }

    /// Ownership follows the clock, never the sender; an unknown id is
    /// claimed only from a one-entry frame.
    fn record_awareness_owners_locked(&self, st: &mut State, id: u64, entries: &[AwarenessEntry]) {
        let Some(member) = Self::member_of(st, id) else {
            return;
        };
        let own_publish = entries.len() == 1;
        let mut changed = false;
        let mut skipped = 0;
        for entry in entries {
            if entry.client_id > MAX_AWARENESS_CLIENT_ID {
                skipped += 1;
                continue;
            }
            let known = st
                .awareness_owners
                .get(&entry.client_id)
                .map(|o| (o.clock, o.member.actor_id()));
            if entry.removed {
                if let Some((clock, _)) = known
                    && entry.clock >= clock
                {
                    st.awareness_owners.remove(&entry.client_id);
                }
                continue;
            }
            if let Some((clock, previous)) = known {
                if entry.clock > clock {
                    st.awareness_owners.set(
                        entry.client_id,
                        AwarenessOwner {
                            membership: id,
                            member: member.clone(),
                            clock: entry.clock,
                        },
                    );
                    if member.actor_id() != previous {
                        changed = true;
                    }
                }
                continue;
            }
            if own_publish && st.awareness_owners.len() < self.options.max_awareness_clients {
                st.awareness_owners.set(
                    entry.client_id,
                    AwarenessOwner {
                        membership: id,
                        member: member.clone(),
                        clock: entry.clock,
                    },
                );
                if !member.actor_id().is_empty() {
                    changed = true;
                }
            }
        }
        if skipped > 0 {
            self.logf(&format!(
                "collab: room \"{}\" ignored {skipped} awareness client id(s) past the safe-integer ceiling in one frame",
                self.doc_id
            ));
        }
        if changed {
            self.broadcast_locked(st, &must_encode(&self.identities_frame_locked(st)), None);
        }
    }

    /// Tells the room a departing member's clients are gone; a crashed tab
    /// never says so itself.
    pub(crate) fn withdraw_awareness_locked(&self, st: &mut State, id: u64, member: &dyn Member) {
        let gone: Vec<AwarenessEntry> = st
            .awareness_owners
            .iter()
            .filter(|(_, owner)| owner.membership == id)
            .map(|(client_id, owner)| AwarenessEntry {
                client_id: *client_id,
                clock: owner.clock,
                removed: true,
            })
            .collect();
        if gone.is_empty() {
            return;
        }
        for entry in &gone {
            st.awareness_owners.remove(&entry.client_id);
        }
        self.broadcast_locked(
            st,
            &must_encode(&Message::Awareness {
                update: blok_collab_wire::encode_awareness_removal(&gone),
            }),
            Some(id),
        );
        if !member.actor_id().is_empty() {
            self.broadcast_locked(st, &must_encode(&self.identities_frame_locked(st)), None);
        }
    }

    /// The whole verified map, every time.
    pub(crate) fn identities_frame_locked(&self, st: &State) -> Message {
        let identities = st
            .awareness_owners
            .iter()
            .filter_map(|(client_id, owner)| {
                let actor_id = owner.member.actor_id();
                (!actor_id.is_empty()).then_some(Identity {
                    client_id: *client_id,
                    actor_id,
                })
            })
            .collect();
        Message::Identities { identities }
    }
}
