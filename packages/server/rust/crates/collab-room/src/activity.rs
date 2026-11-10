use std::collections::VecDeque;
use std::sync::{Arc, MutexGuard, PoisonError};
use std::time::SystemTime;

use tokio::sync::Notify;

use crate::ActivityKind;
use crate::options::{ACTIVITY_QUEUE_LIMIT, ACTIVITY_STAMP_LIMIT, ACTIVITY_WINDOW};
use crate::room::{Room, State};

struct Pending {
    actor: String,
    at: SystemTime,
    kind: ActivityKind,
}

/// Set once one pump has drained the queue.
#[derive(Default)]
pub(crate) struct Dispatch {
    done: std::sync::atomic::AtomicBool,
    notify: Notify,
}

impl Dispatch {
    fn finish(&self) {
        self.done.store(true, std::sync::atomic::Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    async fn wait(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.done.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Default)]
pub(crate) struct ActivityQueue {
    queue: VecDeque<Pending>,
    pumping: bool,
    dispatch: Option<Arc<Dispatch>>,
}

fn within_window(at: SystemTime, reported: SystemTime) -> bool {
    at.duration_since(reported)
        .map_or(true, |gap| gap < ACTIVITY_WINDOW)
}

impl Room {
    fn activity_lock(&self) -> MutexGuard<'_, ActivityQueue> {
        self.activity_queue
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Hands one moment of a member's presence to the host's observer. The
    /// decision needs the lane; the call runs off it, so a slow observer
    /// never stalls the document.
    pub(crate) fn record_activity_locked(
        &self,
        st: &mut State,
        actor_id: &str,
        kind: ActivityKind,
    ) {
        self.record_activity_noted_locked(st, actor_id, kind, None);
    }

    /// Edited, and the content.edited event at the same moment, with the
    /// record's note.
    pub(crate) fn record_edited_locked(
        &self,
        st: &mut State,
        actor_id: &str,
        note: Option<crate::RecordNote>,
    ) {
        self.record_activity_noted_locked(st, actor_id, ActivityKind::Edited, note);
    }

    fn record_activity_noted_locked(
        &self,
        st: &mut State,
        actor_id: &str,
        kind: ActivityKind,
        note: Option<crate::RecordNote>,
    ) {
        // No verified identity, no call of any kind.
        if actor_id.is_empty() || self.activity.is_none() {
            return;
        }
        let at = self.options.now();
        if st.activity_stamps.len() > ACTIVITY_STAMP_LIMIT {
            // Drops only stamps the window no longer covers.
            st.activity_stamps
                .retain(|_, reported| within_window(at, *reported));
        }
        if matches!(kind, ActivityKind::Active | ActivityKind::Edited) {
            if let Some(reported) = st.activity_stamps.get(actor_id)
                && within_window(at, *reported)
            {
                return;
            }
            // Stamped only where a call is made, or a busy actor stays
            // silenced.
            st.activity_stamps.insert(actor_id.to_owned(), at);
        }
        if kind == ActivityKind::Edited
            && let Some(manager) = self.manager.upgrade()
            && let Some(hub) = &manager.signals
        {
            hub.event(
                &manager,
                crate::AuditEvent {
                    event_type: crate::AUDIT_CONTENT_EDITED.to_owned(),
                    doc_id: self.doc_id.clone(),
                    at,
                    actor: Some(crate::AuditActor {
                        id: actor_id.to_owned(),
                        kind: note.as_ref().map(|note| note.kind.clone()),
                        on_behalf_of: note.and_then(|note| note.on_behalf_of),
                    }),
                    lineage: None,
                },
            );
        }

        let mut dropped = None;
        let start = {
            let mut q = self.activity_lock();
            if q.queue.len() == ACTIVITY_QUEUE_LIMIT {
                // Heartbeats go first, oldest of them; a session boundary
                // only when no heartbeat is left.
                let victim = q
                    .queue
                    .iter()
                    .position(|p| matches!(p.kind, ActivityKind::Active | ActivityKind::Edited))
                    .unwrap_or(0);
                dropped = q.queue.remove(victim);
            }
            q.queue.push_back(Pending {
                actor: actor_id.to_owned(),
                at,
                kind,
            });
            if q.pumping {
                None
            } else {
                q.pumping = true;
                let dispatch = Arc::new(Dispatch::default());
                q.dispatch = Some(dispatch.clone());
                Some(dispatch)
            }
        };
        if let Some(dispatch) = start {
            let room = self.arc();
            tokio::spawn(async move { room.pump_activity(dispatch).await });
        }
        if let Some(lost) = dropped {
            self.logf_surviving(&format!(
                "collab: room \"{}\" dropped an activity record ({}) for \"{}\"; the activity observer is behind",
                self.doc_id, lost.kind, lost.actor
            ));
        }
    }

    /// Drains the queue one call at a time. It never takes the lane. Only
    /// the host logger can panic in it; left set, the pumping flag would make
    /// this room's activity dead for good, so the pump goes round again. A
    /// settle holding `dispatch` waits for the records after a restart too.
    async fn pump_activity(self: Arc<Self>, dispatch: Arc<Dispatch>) {
        loop {
            let failed = tokio::spawn(self.clone().drain_activity()).await.is_err();
            if failed {
                let mut q = self.activity_lock();
                if !q.queue.is_empty() {
                    continue;
                }
                q.pumping = false;
            }
            dispatch.finish();
            return;
        }
    }

    async fn drain_activity(self: Arc<Self>) {
        loop {
            let next = {
                let mut q = self.activity_lock();
                match q.queue.pop_front() {
                    Some(next) => next,
                    None => {
                        // Cleared under the lock that would start the next
                        // pump.
                        q.pumping = false;
                        break;
                    }
                }
            };
            self.record_one(next).await;
        }
    }

    async fn record_one(&self, next: Pending) {
        let Some(observer) = self.activity.clone() else {
            return;
        };
        let doc_id = self.doc_id.clone();
        let call = tokio::spawn(async move {
            observer
                .record(&doc_id, &next.actor, next.at, next.kind)
                .await
        });
        match call.await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => self.logf(&format!(
                "collab: room \"{}\" activity observer failed: {err}",
                self.doc_id
            )),
            Err(_) => self.logf(&format!(
                "collab: room \"{}\" activity observer failed",
                self.doc_id
            )),
        }
    }

    /// Completes once every lane operation queued before it has run and the
    /// activity they produced has been delivered. Unbounded: callers bound
    /// it.
    pub(crate) async fn settle(&self) {
        drop(self.lane.reserve().hold().await);
        let pending = self.activity_lock().dispatch.clone();
        if let Some(pending) = pending {
            pending.wait().await;
        }
    }
}
