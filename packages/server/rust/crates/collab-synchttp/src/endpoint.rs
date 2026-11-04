//! GET /sync/{doc}: SyncEndpoint.

use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use blok_auth::Authorization;
use blok_collab::{BoxFuture, JoinStatus, Member, Rooms};
use blok_http::{Handler, Request, ResponseWriter};

use crate::budget::{BudgetOptions, Clock, InboundBudget};
use crate::close::*;
use crate::conntable::ConnectionTable;
use crate::handshake::{Accepted, HandshakeResult};
use crate::member::{MemberOptions, Recheck, SocketMember};
use crate::upgradelimit::{UpgradeLimit, UpgradeSlot};

/// The backlog budget is this many inbound messages.
const OUTBOUND_QUEUE_FACTOR: i64 = 8;

/// A rejected client has nothing left to say, so a flood of bad passes
/// cannot park sockets on the server.
const REJECTED_CLOSE_GRACE: Duration = Duration::from_millis(250);

/// What the endpoint reads from the server's options and services.
pub struct Config {
    pub auth: String,
    pub secret: String,
    /// BlokServerCors.IsAllowed over the allowed origins.
    pub origin_allowed: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    /// The server's shared fixed-window limiter.
    pub rate_limit: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    /// The ticket clock.
    pub clock: Arc<dyn Fn() -> SystemTime + Send + Sync>,
    pub authorization: Option<Arc<dyn Authorization>>,
    pub rooms: Arc<dyn Rooms>,
    /// Lets the handshake select blok-sync.v2.
    pub has_operation_store: bool,
    pub max_message_bytes: usize,
    /// Zero turns pings off; an unanswered ping aborts after twice this.
    pub keep_alive_interval: Duration,
    pub connections: Arc<ConnectionTable>,
    pub budget: BudgetOptions,
    /// None means Instant::now.
    pub budget_clock: Option<Clock>,
    /// Kestrel's MaxConcurrentUpgradedConnections; None means no limit.
    pub upgrades: Option<Arc<UpgradeLimit>>,
}

/// Serves GET /sync/{doc}. Clones share one endpoint.
#[derive(Clone)]
pub struct Endpoint {
    inner: Arc<Inner>,
}

struct Inner {
    config: Config,
    #[cfg(test)]
    members: Mutex<Vec<Arc<SocketMember>>>,
}

impl Endpoint {
    pub fn new(mut config: Config) -> Self {
        if config.budget_clock.is_none() {
            config.budget_clock = Some(Arc::new(Instant::now));
        }
        Self {
            inner: Arc::new(Inner {
                config,
                #[cfg(test)]
                members: Mutex::new(Vec::new()),
            }),
        }
    }

    pub(crate) fn config(&self) -> &Config {
        &self.inner.config
    }

    #[cfg(test)]
    pub(crate) fn members(&self, i: usize) -> Arc<SocketMember> {
        Arc::clone(&self.inner.members.lock().unwrap()[i])
    }

    async fn handle(&self, request: Request, mut response: ResponseWriter) {
        let doc = blok_route::path_value(&request, "doc").to_owned();
        // Only the hook awaits in here; a client that leaves cancels it, as
        // RequestAborted does in C#.
        let cancel = request.cancel_token();
        let negotiated = tokio::select! {
            negotiated = self.negotiate(&request, &doc) => negotiated,
            () = cancel.cancelled() => return,
        };
        match negotiated {
            HandshakeResult::Refused { status, body } => refuse(&mut response, status, body).await,
            HandshakeResult::Rejected {
                sub_protocol,
                close,
            } => {
                self.accept_then_close(&request, response, &sub_protocol, close)
                    .await;
            }
            HandshakeResult::Accepted(accepted) => {
                self.serve(&request, response, &doc, accepted).await;
            }
            HandshakeResult::HookFailed => internal_error(&mut response).await,
        }
    }

    /// Checks what ws::upgrade would fail on before handing it the writer:
    /// .NET throws building the accept key, and Kestrel throws past its
    /// upgrade limit, both before the hijack, so both are the empty 500.
    async fn upgrade(
        &self,
        request: &Request,
        mut response: ResponseWriter,
        sub_protocol: &str,
    ) -> Option<(blok_ws::Conn, Option<UpgradeSlot>)> {
        let key = request
            .headers()
            .get_all("Sec-WebSocket-Key")
            .collect::<Vec<_>>()
            .join(",");
        if blok_ws::accept_key(&key).is_none() {
            internal_error(&mut response).await;
            return None;
        }
        let slot = match &self.config().upgrades {
            None => None,
            Some(limit) => match limit.try_take() {
                Some(slot) => Some(slot),
                None => {
                    internal_error(&mut response).await;
                    return None;
                }
            },
        };
        let interval = self.config().keep_alive_interval;
        let options = blok_ws::Options {
            sub_protocol: sub_protocol.to_owned(),
            keep_alive_interval: interval,
            keep_alive_timeout: interval * 2,
        };
        let conn = blok_ws::upgrade(response, request, options).await.ok()?;
        Some((conn, slot))
    }

    async fn serve(
        &self,
        request: &Request,
        mut response: ResponseWriter,
        doc: &str,
        accepted: Accepted,
    ) {
        let config = self.config();
        // Held until the request ends; the per-principal lease is freed
        // earlier, before the close is answered.
        let Some(_slot) = config.connections.try_enter() else {
            refuse(&mut response, 503, "too many connections on this server\n").await;
            return;
        };
        let lease = if accepted.principal.is_empty() {
            None
        } else {
            match config.connections.try_reserve(doc, &accepted.principal) {
                Some(lease) => Some(lease),
                None => {
                    refuse(&mut response, 429, "too many connections\n").await;
                    return;
                }
            }
        };

        let recheck = config
            .authorization
            .as_ref()
            .map(|hook| recheck(Arc::clone(hook), &accepted, doc));
        let member = Arc::new(SocketMember::new(MemberOptions {
            can_write: accepted.can_write,
            accepts_control_frames: !accepted.sub_protocol.is_empty(),
            max_queued_bytes: OUTBOUND_QUEUE_FACTOR * config.max_message_bytes as i64,
            inbound: Some(InboundBudget::new(
                config.budget,
                config
                    .budget_clock
                    .clone()
                    .unwrap_or_else(|| Arc::new(Instant::now)),
            )),
            close_grace: Duration::ZERO,
            actor_id: accepted.actor.clone(),
            protocol_source: accepted.source,
            recheck,
        }));
        #[cfg(test)]
        self.inner.members.lock().unwrap().push(Arc::clone(&member));

        // Join before the upgrade: a draining server can still answer 503,
        // and the room's first frames wait in the member's queue.
        let cancel = request.cancel_token();
        let joined = tokio::select! {
            joined = config.rooms.join(doc, Arc::clone(&member) as Arc<dyn Member>) => joined,
            () = cancel.cancelled() => return,
        };
        let join = match joined {
            Ok(join) => join,
            Err(_) => {
                if !cancel.is_cancelled() {
                    internal_error(&mut response).await;
                }
                return;
            }
        };
        match join.status {
            JoinStatus::Draining => {
                refuse(&mut response, 503, "shutting down\n").await;
                return;
            }
            JoinStatus::Forbidden | JoinStatus::Purged => {
                refuse(&mut response, 403, "forbidden\n").await;
                return;
            }
            _ => {}
        }

        let Some((conn, _upgrade_slot)) = self
            .upgrade(request, response, &accepted.sub_protocol)
            .await
        else {
            if let Some(membership) = &join.membership {
                membership.leave();
            }
            return;
        };
        if matches!(
            join.status,
            JoinStatus::SeedFailed | JoinStatus::Unavailable
        ) {
            member.request_close(CLOSE_SEED_FAILED);
        }
        member
            .run(
                &conn,
                join.membership.as_deref(),
                config.max_message_bytes,
                lease.as_ref(),
            )
            .await;
        conn.abort();
    }

    async fn accept_then_close(
        &self,
        request: &Request,
        response: ResponseWriter,
        sub_protocol: &str,
        close: CloseFrame,
    ) {
        let Some((conn, _upgrade_slot)) = self.upgrade(request, response, sub_protocol).await
        else {
            return;
        };
        let member = SocketMember::new(MemberOptions {
            close_grace: REJECTED_CLOSE_GRACE,
            ..MemberOptions::default()
        });
        member.request_close(close);
        member
            .run(&conn, None, self.config().max_message_bytes, None)
            .await;
        conn.abort();
    }
}

/// Asks the hook for read, and for write only for a writer.
fn recheck(hook: Arc<dyn Authorization>, accepted: &Accepted, doc: &str) -> Recheck {
    let user = accepted.user.clone();
    let doc = doc.to_owned();
    let can_write = accepted.can_write;
    Arc::new(move || {
        let (hook, user, doc) = (Arc::clone(&hook), user.clone(), doc.clone());
        Box::pin(async move {
            if !hook.can_read_document(&user, &doc).await? {
                return Ok(false);
            }
            if !can_write {
                return Ok(true);
            }
            hook.can_write_document(&user, &doc).await
        }) as BoxFuture<'static, _>
    })
}

impl Handler for Endpoint {
    fn serve(&self, request: Request, response: ResponseWriter) -> blok_http::BoxFuture<()> {
        let endpoint = self.clone();
        Box::pin(async move { endpoint.handle(request, response).await })
    }
}

/// SyncEndpoint.RefuseAsync: a plain-text answer, streamed.
pub async fn refuse(response: &mut ResponseWriter, status: u16, body: &str) {
    blok_route::write_plain(response, status, body).await;
}

/// What the host answers when a handler throws.
async fn internal_error(response: &mut ResponseWriter) {
    response.headers_mut().set("Content-Length", "0");
    let _ = response.start(500).await;
}
