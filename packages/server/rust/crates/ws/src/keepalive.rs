//! KeepAlivePingState: a ping carries a counter, only an 8-byte pong with
//! that counter answers it, and data received pushes the next ping back.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use tokio::time::Instant;

use crate::{Conn, Error, OP_PING, OP_PONG, lock};

pub(crate) struct KeepAlive {
    delay: Duration,
    timeout: Duration,
    payload: i64,
    ping_sent: bool,
    // A pong answers only a ping that was written; one that races ahead of
    // the write is held until the write returns.
    ping_written: bool,
    early_pong: bool,
    ping_deadline: Option<Instant>,
    next_ping: Instant,
    pub(crate) fault: Option<Error>,
}

impl Conn {
    /// The heartbeat runs every max(min(delay, timeout)/4, 1ms); with no
    /// timeout it is .NET's unsolicited-pong strategy, every delay.
    pub(crate) fn start_keep_alive(&self, delay: Duration, timeout: Duration) {
        let mut heartbeat = delay;
        if !timeout.is_zero() {
            *lock(&self.inner.keep_alive) = Some(KeepAlive {
                delay,
                timeout,
                payload: 0,
                ping_sent: false,
                ping_written: false,
                early_pong: false,
                ping_deadline: None,
                next_ping: Instant::now() + delay,
                fault: None,
            });
            heartbeat = (delay.min(timeout) / 4).max(Duration::from_millis(1));
        }
        // Weak: a socket nobody holds any more stops its heartbeat.
        let weak = Arc::downgrade(&self.inner);
        let mut done = self.inner.done.subscribe();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval_at(Instant::now() + heartbeat, heartbeat);
            loop {
                tokio::select! {
                    _ = done.wait_for(|done| *done) => return,
                    _ = ticker.tick() => {}
                }
                let Some(inner) = weak.upgrade() else { return };
                Conn { inner }.heartbeat();
            }
        });
    }

    fn heartbeat(&self) {
        let send = {
            let mut guard = lock(&self.inner.keep_alive);
            let Some(k) = guard.as_mut() else {
                drop(guard);
                // .NET queues one pong per tick behind a stuck send; one
                // waiting pong is enough here, so no task piles up.
                if self
                    .inner
                    .keep_alive_sending
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    let conn = self.clone();
                    tokio::spawn(async move {
                        conn.send_keep_alive_frame(OP_PONG, &[]).await;
                        conn.inner
                            .keep_alive_sending
                            .store(false, Ordering::Release);
                    });
                }
                return;
            };
            if k.fault.is_some() {
                return;
            }
            let now = Instant::now();
            if k.ping_sent {
                if k.ping_deadline.is_some_and(|deadline| now > deadline) {
                    k.fault = Some(Error::KeepAliveTimeout);
                    drop(guard);
                    lock(&self.inner.flags).aborted = true;
                    self.dispose();
                    return;
                }
                None
            } else if now > k.next_ping {
                k.ping_sent = true;
                k.ping_written = false;
                k.early_pong = false;
                k.ping_deadline = Some(now + k.timeout);
                k.payload += 1;
                Some(k.payload)
            } else {
                None
            }
        };
        // Off the heartbeat: a send stuck on a peer that stops reading holds
        // the send lock, and the timeout check above must keep running to
        // abort it. ping_sent stays set until the ping is written, so one
        // ping is in flight.
        if let Some(payload) = send {
            let conn = self.clone();
            tokio::spawn(async move {
                if !conn
                    .send_keep_alive_frame(OP_PING, &payload.to_be_bytes())
                    .await
                {
                    return;
                }
                let mut guard = lock(&conn.inner.keep_alive);
                if let Some(k) = guard.as_mut()
                    && k.ping_sent
                    && k.payload == payload
                {
                    k.ping_written = true;
                    if k.early_pong {
                        k.ping_sent = false;
                        k.ping_deadline = None;
                    }
                }
            });
        }
    }

    /// TrySendKeepAliveFrameAsync: nothing once our close went out. Reports
    /// whether the frame was written.
    async fn send_keep_alive_frame(&self, opcode: u8, payload: &[u8]) -> bool {
        let mut writer = self.inner.send.lock().await;
        if !self.valid_send_state() {
            return false;
        }
        self.write_frame(&mut writer, opcode, payload).await.is_ok()
    }

    pub(crate) fn on_data_received(&self) {
        if let Some(k) = lock(&self.inner.keep_alive).as_mut() {
            k.next_ping = Instant::now() + k.delay;
        }
    }

    pub(crate) fn on_pong(&self, payload: i64) {
        let mut guard = lock(&self.inner.keep_alive);
        let Some(k) = guard.as_mut() else { return };
        if !k.ping_sent || payload != k.payload {
            return;
        }
        if !k.ping_written {
            k.early_pong = true;
            return;
        }
        k.ping_sent = false;
        k.ping_deadline = None;
    }
}
