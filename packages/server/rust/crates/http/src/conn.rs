//! One connection: heads, timers, the handler, keep-alive.

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::Mutex;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{Notify, watch};
use tokio::time::{Instant, sleep_until, timeout, timeout_at};

use crate::body::{self, Body, BodyState, Chunk, Framing as BodyFraming, Limits};
use crate::exchange::{
    Answer, Deadline, Exchange, Framing, RST_AVOIDANCE, Wire, bare_answer, lock,
};
use crate::head::{
    HeadScan, Parse, Refusal, Version, final_coding_is_chunked, parse_content_length,
};
use crate::inbound::Inbound;
use crate::request::{CancelToken, Extensions, Request};
use crate::response::{ResponseWriter, response_head};
use crate::server::{ActiveGuard, Shared};

/// net/http's maxPostHandlerReadBytes: an unread body bigger than this is
/// not drained after the handler; the connection closes instead.
const MAX_DRAIN: u64 = 256 << 10;

pub(crate) async fn serve(
    shared: Arc<Shared>,
    stream: TcpStream,
    remote: SocketAddr,
    guard: ActiveGuard,
) {
    let local = stream.local_addr().unwrap_or(remote);
    let _ = stream.set_nodelay(true);
    let (read, write) = stream.into_split();
    let inbound = Inbound::start(read);
    let mut write = Some(write);
    let mut guard = Some(guard);
    loop {
        // Before a request's first byte Kestrel waits KeepAliveTimeout and
        // closes with no answer, the first request too.
        if !wait_for_request(&shared, &inbound).await {
            break;
        }
        // RequestHeadersTimeout: from the first byte until the handler runs.
        let header_deadline = Instant::now() + shared.config.header_timeout;
        let mut scan = HeadScan::new();
        let parsed = loop {
            let have = {
                let state = inbound.lock();
                match scan.parse(&state.buf) {
                    Parse::Done { head, consumed } => break Ok((head, consumed)),
                    Parse::Refused(refusal) => break Err(refusal_answer(refusal)),
                    Parse::Incomplete if state.ended() => break Err(None),
                    Parse::Incomplete => state.buf.len(),
                }
            };
            if timeout_at(header_deadline, inbound.wait_for_more(have))
                .await
                .is_err()
            {
                break Err(Some(Answer::Status(408)));
            }
        };
        let (head, consumed) = match parsed {
            Ok(parsed) => parsed,
            Err(answer) => {
                if let (Some(answer), Some(mut write)) = (answer, write.take()) {
                    let _ = write.write_all(&bare_answer(&shared.config, answer)).await;
                    close_softly(&inbound, write).await;
                }
                break;
            }
        };
        inbound.consume(consumed);
        let Some(this_write) = write.take() else {
            break;
        };
        match exchange(
            &shared, &inbound, head, this_write, remote, local, &mut guard,
        )
        .await
        {
            Some(next) => write = Some(next),
            None => break,
        }
    }
}

fn refusal_answer(refusal: Refusal) -> Option<Answer> {
    Some(match refusal {
        Refusal::Status(status) => Answer::Status(status),
        Refusal::GoAway => Answer::GoAway,
        Refusal::MethodNotAllowed(allow) => Answer::MethodNotAllowed(allow),
    })
}

/// Waits for a request's first byte. CR and LF between requests are
/// dropped and do not start the header clock. False: close silently.
async fn wait_for_request(shared: &Shared, inbound: &Inbound) -> bool {
    let idle_deadline = Instant::now() + shared.config.keep_alive_timeout;
    loop {
        {
            let mut state = inbound.lock();
            let skip = state
                .buf
                .iter()
                .take_while(|&&b| b == b'\r' || b == b'\n')
                .count();
            if skip > 0 {
                state.consume(skip);
            }
            if !state.buf.is_empty() {
                return true;
            }
            if state.ended() {
                return false;
            }
        }
        if shared.stopping.load(std::sync::atomic::Ordering::Acquire) {
            return false;
        }
        tokio::select! {
            result = timeout_at(idle_deadline, inbound.wait_for_more(0)) => {
                if result.is_err() {
                    return false;
                }
            }
            () = shared.stopped() => return false,
        }
    }
}

/// Runs one request. Returns the write half when the connection stays
/// open for the next one.
async fn exchange(
    shared: &Arc<Shared>,
    inbound: &Arc<Inbound>,
    head: crate::head::Head,
    write: tokio::net::tcp::OwnedWriteHalf,
    remote: SocketAddr,
    local: SocketAddr,
    guard: &mut Option<ActiveGuard>,
) -> Option<tokio::net::tcp::OwnedWriteHalf> {
    let config = &shared.config;
    let chunked =
        head.headers.contains("transfer-encoding") && final_coding_is_chunked(&head.headers);
    let length = if chunked {
        None
    } else {
        head.headers
            .get("content-length")
            .and_then(parse_content_length)
    };
    let framing = if chunked {
        BodyFraming::Chunked(Chunk::Size)
    } else {
        match length {
            Some(0) | None => BodyFraming::Empty,
            Some(length) => BodyFraming::Length(length),
        }
    };
    let request_close = head.headers.has_token("connection", "close");
    let keep_alive_10 =
        head.version == Version::Http10 && head.headers.has_token("connection", "keep-alive");
    let expects_continue = head.version == Version::Http11
        && head
            .headers
            .get("expect")
            .is_some_and(|value| value.eq_ignore_ascii_case("100-continue"));
    let started = Instant::now();
    let deadline_at = config.request_timeout.map(|timeout| started + timeout);
    let (cancel, cancel_receiver) = watch::channel(false);
    let exchange = Arc::new(Exchange {
        config: Arc::clone(config),
        inbound: Arc::clone(inbound),
        wire: tokio::sync::Mutex::new(Wire {
            write: Some(write),
            started: false,
            framing: Framing::None,
            host_owned: false,
            pending_timeout: false,
            finished: false,
            close: false,
            hijacked: false,
        }),
        body: tokio::sync::Mutex::new(BodyState::new(framing)),
        limits: Mutex::new(Limits {
            limit: config.max_request_body,
            route_set: false,
            started: false,
            length,
        }),
        deadline: Mutex::new(Deadline {
            body: deadline_at,
            ..Deadline::default()
        }),
        deadline_changed: Notify::new(),
        hijacked: Notify::new(),
        cancel,
        left: Mutex::new(None),
        active: Mutex::new(guard.take()),
        method_head: head.method == "HEAD",
        version: head.version,
        request_close,
        keep_alive_10,
        expects_continue,
        stopping: Arc::clone(&shared.stopping),
    });
    let request = Request {
        method: head.method,
        target: head.target,
        form: head.form,
        path: head.path,
        query: head.query,
        version: head.version,
        headers: head.headers,
        remote_addr: remote,
        local_addr: local,
        body: Some(Body {
            exchange: Arc::clone(&exchange),
        }),
        cancel: CancelToken::from_receiver(cancel_receiver),
        exchange: Arc::clone(&exchange),
        extensions: Extensions::default(),
    };
    let response = ResponseWriter::new(Arc::clone(&exchange));
    let mut handler = tokio::spawn(shared.handler.serve(request, response));

    let mut deadline_armed = deadline_at.is_some();
    let mut peer_gone = false;
    let outcome = loop {
        let deadline = deadline_at.unwrap_or(started);
        tokio::select! {
            outcome = &mut handler => break outcome,
            () = exchange.hijacked.notified() => return None,
            () = exchange.deadline_changed.notified() => {
                if lock(&exchange.deadline).lifted {
                    deadline_armed = false;
                }
            }
            () = sleep_until(deadline), if deadline_armed => {
                deadline_armed = false;
                expire(&exchange);
            }
            () = inbound.wait_until(|state| state.ended()), if !peer_gone => {
                peer_gone = true;
                exchange.cancel();
            }
        }
    };
    // By the clock: a body read can end at the deadline and the handler
    // return before the timer branch runs.
    if deadline_armed && deadline_at.is_some_and(|at| Instant::now() >= at) {
        expire(&exchange);
    }
    *guard = lock(&exchange.active).take();

    let mut wire = exchange.wire.lock().await;
    if wire.hijacked {
        return None;
    }
    if !wire.started && inbound.lock().ended() {
        // Kestrel drops a request whose peer half-closed: no answer.
        wire.close = true;
    } else if outcome.is_err() && !wire.started {
        // A panic before the head went out: Kestrel's empty 500.
        let mut refused = crate::headers::Headers::new();
        refused.add("Content-Length", "0");
        let head = response_head(&exchange, &mut wire, 500, &refused, true);
        wire.started = true;
        let _ = wire.send(&head).await;
    } else if wire.pending_timeout && !wire.started {
        let mut timed_out = crate::headers::Headers::new();
        timed_out.add("Content-Length", "0");
        let head = response_head(&exchange, &mut wire, 504, &timed_out, true);
        wire.started = true;
        let _ = wire.send(&head).await;
    } else if !wire.started {
        let (status, headers) = lock(&exchange.left).take().unwrap_or_default();
        let status = if status == 0 { 200 } else { status };
        let head = response_head(&exchange, &mut wire, status, &headers, true);
        wire.started = true;
        if wire.send(&head).await.is_err() {
            wire.close = true;
        }
    } else if outcome.is_err() {
        wire.close = true;
    } else if !wire.host_owned {
        match wire.framing {
            Framing::Chunked => {
                if wire.send(b"0\r\n\r\n").await.is_err() {
                    wire.close = true;
                }
            }
            // Kestrel aborts a response shorter than its Content-Length.
            Framing::Length(remaining) if remaining > 0 => wire.close = true,
            _ => {}
        }
    }
    wire.finished = true;
    let close = wire.close;
    let write = wire.write.take();
    drop(wire);
    let write = write?;

    if close || peer_gone {
        close_softly(inbound, write).await;
        return None;
    }
    if !drain(&exchange).await {
        close_softly(inbound, write).await;
        return None;
    }
    Some(write)
}

/// The deadline passed: the request is cancelled and, if nothing was
/// written yet, a 504 goes out once the handler returns.
fn expire(exchange: &Exchange) {
    {
        let mut deadline = lock(&exchange.deadline);
        if deadline.lifted {
            return;
        }
        deadline.expired = true;
    }
    exchange.cancel();
    // A held lock is a write in progress, so the answer has started.
    if let Ok(mut wire) = exchange.wire.try_lock()
        && !wire.started
    {
        wire.host_owned = true;
        wire.pending_timeout = true;
    }
}

/// Reads off what the handler left of the body, so the next request can be
/// read. False: the connection must close instead.
async fn drain(exchange: &Exchange) -> bool {
    {
        let state = exchange.body.lock().await;
        if state.failed.is_some() {
            return false;
        }
        if state.done() {
            return true;
        }
        if let BodyFraming::Length(remaining) = state.framing
            && remaining > MAX_DRAIN
        {
            return false;
        }
    }
    let mut chunk = vec![0u8; 16 << 10];
    let mut drained = 0u64;
    loop {
        match body::read(exchange, &mut chunk, false).await {
            Ok(0) => return true,
            Ok(n) => {
                drained += n as u64;
                if drained > MAX_DRAIN {
                    return false;
                }
            }
            Err(_) => return false,
        }
    }
}

/// Half-closes, then reads for a moment before the close, so the peer gets
/// the answer rather than a reset for its unread bytes.
async fn close_softly(inbound: &Inbound, mut write: tokio::net::tcp::OwnedWriteHalf) {
    let _ = write.shutdown().await;
    let Some((mut read, _)) = inbound.stop().await else {
        return;
    };
    let mut sink = [0u8; 4096];
    let _ = timeout(RST_AVOIDANCE, async {
        while let Ok(n) = read.read(&mut sink).await {
            if n == 0 {
                break;
            }
        }
    })
    .await;
}
