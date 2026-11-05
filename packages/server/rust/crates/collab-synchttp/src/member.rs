//! SyncSocketMember: one WebSocket as the room sees it. send and close only
//! enqueue; one pump owns every write, and the receive loop never sends.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use blok_collab::{BoxFuture, CloseReason, Error, Member, Membership, OperationSource};
use blok_ws::MessageType;
use tokio::sync::{Notify, watch};
use tokio::time::{Instant, sleep, sleep_until};

use crate::budget::InboundBudget;
use crate::close::*;
use crate::conntable::Lease;

const RECEIVE_BUFFER_SIZE: usize = 16 * 1024;
// RECEIVE_SLACK plus one receive per MIN_BYTES_PER_RECEIVE bytes is what one
// message may take; an empty-fragment flood closes at the 17th receive.
const RECEIVE_SLACK: usize = 16;
const MIN_BYTES_PER_RECEIVE: usize = 64;
const DEFAULT_CLOSE_GRACE: Duration = Duration::from_secs(5);

pub type SocketResult<T> = Result<T, blok_ws::Error>;

/// (bytes, message type, end of message), as ReceiveAsync answers.
pub type Receipt = (usize, MessageType, bool);

/// The part of blok_ws::Conn the member drives. Every error means the
/// socket is gone.
pub trait Socket: Send + Sync {
    fn receive<'a>(&'a self, buf: &'a mut [u8]) -> BoxFuture<'a, SocketResult<Receipt>>;
    fn send_binary<'a>(&'a self, payload: &'a [u8]) -> BoxFuture<'a, SocketResult<()>>;
    fn close_output<'a>(&'a self, status: u16, reason: &'a str) -> BoxFuture<'a, SocketResult<()>>;
    fn abort(&self);
    /// Resolves once the peer ended the connection while nobody receives
    /// (Kestrel's RequestAborted). Never, by default.
    fn peer_gone(&self) -> BoxFuture<'_, ()> {
        Box::pin(std::future::pending())
    }
}

impl Socket for blok_ws::Conn {
    fn receive<'a>(&'a self, buf: &'a mut [u8]) -> BoxFuture<'a, SocketResult<Receipt>> {
        Box::pin(blok_ws::Conn::receive(self, buf))
    }

    fn send_binary<'a>(&'a self, payload: &'a [u8]) -> BoxFuture<'a, SocketResult<()>> {
        Box::pin(blok_ws::Conn::send_binary(self, payload))
    }

    fn close_output<'a>(&'a self, status: u16, reason: &'a str) -> BoxFuture<'a, SocketResult<()>> {
        Box::pin(blok_ws::Conn::close_output(self, status, reason))
    }

    fn abort(&self) {
        blok_ws::Conn::abort(self);
    }

    fn peer_gone(&self) -> BoxFuture<'_, ()> {
        Box::pin(blok_ws::Conn::peer_gone(self))
    }
}

/// Checks the admitted rights again; see Member::recheck_access.
pub type Recheck = Arc<dyn Fn() -> BoxFuture<'static, Result<bool, Error>> + Send + Sync>;

/// SyncSocketMember's constructor arguments.
pub struct MemberOptions {
    pub can_write: bool,
    pub accepts_control_frames: bool,
    pub max_queued_bytes: i64,
    /// None means no budget (a rejected handshake).
    pub inbound: Option<InboundBudget>,
    /// Zero means 5 s.
    pub close_grace: Duration,
    pub actor_id: String,
    pub protocol_source: OperationSource,
    /// None always allows.
    pub recheck: Option<Recheck>,
}

impl Default for MemberOptions {
    /// protocol_source is ClientV1, C#'s default argument.
    fn default() -> Self {
        Self {
            can_write: false,
            accepts_control_frames: false,
            max_queued_bytes: 0,
            inbound: None,
            close_grace: Duration::ZERO,
            actor_id: String::new(),
            protocol_source: OperationSource::ClientV1,
            recheck: None,
        }
    }
}

enum Outbound {
    Frame(Vec<u8>),
    Close(CloseFrame),
}

#[derive(Default)]
struct Queue {
    items: VecDeque<Outbound>,
    completed: bool,
}

pub struct SocketMember {
    can_write: bool,
    accepts_control_frames: bool,
    max_queued_bytes: i64,
    close_grace: Duration,
    actor_id: String,
    protocol_source: OperationSource,
    recheck: Option<Recheck>,
    inbound: Mutex<Option<InboundBudget>>,
    queued_bytes: AtomicI64,
    requested_close: Mutex<Option<CloseFrame>>,
    queue: Mutex<Queue>,
    signal: Notify,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl SocketMember {
    pub fn new(options: MemberOptions) -> Self {
        Self {
            can_write: options.can_write,
            accepts_control_frames: options.accepts_control_frames,
            max_queued_bytes: options.max_queued_bytes,
            close_grace: if options.close_grace.is_zero() {
                DEFAULT_CLOSE_GRACE
            } else {
                options.close_grace
            },
            actor_id: options.actor_id,
            protocol_source: options.protocol_source,
            recheck: options.recheck,
            inbound: Mutex::new(options.inbound),
            queued_bytes: AtomicI64::new(0),
            requested_close: Mutex::new(None),
            queue: Mutex::new(Queue::default()),
            signal: Notify::new(),
        }
    }

    /// The close that won, None before one was requested.
    pub fn requested_close(&self) -> Option<CloseFrame> {
        *lock(&self.requested_close)
    }

    /// False once the writer completed.
    fn enqueue(&self, item: Outbound, complete: bool) -> bool {
        {
            let mut queue = lock(&self.queue);
            if queue.completed {
                return false;
            }
            queue.items.push_back(item);
            queue.completed = complete;
        }
        self.signal.notify_one();
        true
    }

    /// Queues a close. Forbidden overtakes an earlier close, so a revoked
    /// member cannot drain its queued frames.
    pub fn request_close(&self, close: CloseFrame) {
        let previous = {
            let mut requested = lock(&self.requested_close);
            if close == CLOSE_FORBIDDEN {
                requested.replace(close)
            } else if requested.is_none() {
                *requested = Some(close);
                None
            } else {
                *requested
            }
        };
        if previous.is_some() {
            return;
        }
        self.enqueue(Outbound::Close(close), true);
    }

    /// The next item, or None once the writer completed and drained, or the
    /// socket ended.
    async fn next(&self, gone: &Canceller) -> Option<Outbound> {
        loop {
            {
                let mut queue = lock(&self.queue);
                if let Some(item) = queue.items.pop_front() {
                    return Some(item);
                }
                if queue.completed {
                    return None;
                }
            }
            tokio::select! {
                () = self.signal.notified() => {}
                () = gone.fired() => return None,
            }
        }
    }

    /// Pumps outbound frames and reads inbound ones until the peer closes,
    /// the socket ends, or a requested close goes unanswered for the grace.
    /// It leaves the room and frees the lease BEFORE answering the peer's
    /// close, so a reconnecting client never races its own slot.
    pub async fn run(
        &self,
        socket: &dyn Socket,
        membership: Option<&dyn Membership>,
        max_message_bytes: usize,
        lease: Option<&Lease>,
    ) {
        let receiving = Canceller::new();
        let pump = self.pump(socket, &receiving);
        tokio::pin!(pump);
        // The canceller aborts the socket, which is what cancelling a .NET
        // receive does; it must keep running after the pump returns.
        let watchdog = async {
            receiving.fired().await;
            socket.abort();
        };
        tokio::pin!(watchdog);
        let receive = self.receive_loop(socket, membership, max_message_bytes, &receiving);
        tokio::pin!(receive);
        // C# links the receive token to RequestAborted for the whole run.
        let peer_gone = socket.peer_gone();
        tokio::pin!(peer_gone);

        let (mut pump_done, mut aborted, mut gone) = (false, false, false);
        loop {
            tokio::select! {
                () = &mut receive => break,
                () = &mut pump, if !pump_done => pump_done = true,
                () = &mut watchdog, if !aborted => aborted = true,
                () = &mut peer_gone, if !gone => {
                    gone = true;
                    receiving.after(Duration::ZERO);
                }
            }
        }

        if let Some(membership) = membership {
            membership.leave();
        }
        if let Some(lease) = lease {
            lease.release();
        }
        self.request_close(CLOSE_NORMAL);

        let grace = sleep(self.close_grace);
        tokio::pin!(grace);
        while !pump_done {
            tokio::select! {
                () = &mut pump => pump_done = true,
                () = &mut watchdog, if !aborted => aborted = true,
                () = &mut peer_gone, if !gone => {
                    gone = true;
                    receiving.after(Duration::ZERO);
                }
                () = &mut grace => {
                    socket.abort();
                    (&mut pump).await;
                    pump_done = true;
                }
            }
        }
    }

    async fn pump(&self, socket: &dyn Socket, receiving: &Canceller) {
        while let Some(item) = self.next(receiving).await {
            match item {
                Outbound::Frame(frame) => {
                    if self.requested_close() != Some(CLOSE_FORBIDDEN)
                        && socket.send_binary(&frame).await.is_err()
                    {
                        receiving.after(Duration::ZERO);
                        return;
                    }
                    self.queued_bytes
                        .fetch_sub(frame.len() as i64, Ordering::AcqRel);
                }
                Outbound::Close(queued) => {
                    let close = self.requested_close().unwrap_or(queued);
                    if socket
                        .close_output(close.status, close.reason)
                        .await
                        .is_err()
                    {
                        receiving.after(Duration::ZERO);
                        return;
                    }
                    // The peer now owes us its close; do not wait for it forever.
                    receiving.after(self.close_grace);
                    return;
                }
            }
        }
    }

    async fn receive_loop(
        &self,
        socket: &dyn Socket,
        membership: Option<&dyn Membership>,
        max_message_bytes: usize,
        receiving: &Canceller,
    ) {
        let mut buffer = vec![0u8; RECEIVE_BUFFER_SIZE];
        let mut message = Vec::new();
        // With no membership, or once a close was requested, frames are read
        // only to reach the peer's close.
        let mut discarding = false;
        let mut receives = 0;
        loop {
            let Ok((n, kind, end_of_message)) = socket.receive(&mut buffer).await else {
                return;
            };
            if kind == MessageType::Close {
                return;
            }
            let membership = match membership {
                Some(membership) if !discarding && self.requested_close().is_none() => membership,
                _ => {
                    discarding = true;
                    continue;
                }
            };
            if kind == MessageType::Text {
                self.request_close(CLOSE_TEXT_FRAME);
                discarding = true;
                continue;
            }
            let received = message.len() + n;
            receives += 1;
            if receives > RECEIVE_SLACK + received / MIN_BYTES_PER_RECEIVE {
                self.request_close(CLOSE_INBOUND_RATE_EXCEEDED);
                discarding = true;
                continue;
            }
            if received > max_message_bytes {
                self.request_close(CLOSE_TOO_BIG);
                discarding = true;
                continue;
            }
            message.extend_from_slice(&buffer[..n]);
            if !end_of_message {
                continue;
            }
            let frame = std::mem::take(&mut message);
            receives = 0;
            let allowed = lock(&self.inbound)
                .as_mut()
                .is_none_or(|budget| budget.allows(&frame));
            if !allowed {
                self.request_close(CLOSE_INBOUND_RATE_EXCEEDED);
                discarding = true;
                continue;
            }
            // C#'s receive token: when it fires, a frame still waiting for
            // the room lane is dropped, not applied.
            tokio::select! {
                result = membership.receive(frame) => {
                    if result.is_err() {
                        return;
                    }
                }
                () = receiving.fired() => return,
            }
        }
    }
}

impl Member for SocketMember {
    fn can_write(&self) -> bool {
        self.can_write
    }

    fn accepts_control_frames(&self) -> bool {
        self.accepts_control_frames
    }

    fn actor_id(&self) -> String {
        self.actor_id.clone()
    }

    fn protocol_source(&self) -> OperationSource {
        self.protocol_source
    }

    fn recheck_access(&self) -> BoxFuture<'_, Result<bool, Error>> {
        match &self.recheck {
            Some(recheck) => recheck(),
            None => Box::pin(async { Ok(true) }),
        }
    }

    /// Admits a frame while the backlog queued BEFORE it is within budget,
    /// so one large frame always fits.
    fn send(&self, frame: Vec<u8>) {
        if self.requested_close().is_some() {
            return;
        }
        let size = frame.len() as i64;
        let backlog = self.queued_bytes.fetch_add(size, Ordering::AcqRel);
        if backlog > self.max_queued_bytes {
            self.request_close(CLOSE_SLOW_CONSUMER);
            return;
        }
        self.enqueue(Outbound::Frame(frame), false);
    }

    fn close(&self, reason: CloseReason) {
        self.request_close(close_for(reason));
    }
}

/// CancellationTokenSource.CancelAfter over the receive: the latest call
/// sets the time.
struct Canceller {
    deadline: watch::Sender<Option<Instant>>,
}

impl Canceller {
    fn new() -> Self {
        Self {
            deadline: watch::Sender::new(None),
        }
    }

    fn after(&self, delay: Duration) {
        self.deadline.send_replace(Some(Instant::now() + delay));
    }

    async fn fired(&self) {
        let mut deadline = self.deadline.subscribe();
        loop {
            let at = *deadline.borrow_and_update();
            match at {
                None => {
                    let _ = deadline.changed().await;
                }
                Some(at) => {
                    tokio::select! {
                        () = sleep_until(at) => return,
                        _ = deadline.changed() => {}
                    }
                }
            }
        }
    }
}
