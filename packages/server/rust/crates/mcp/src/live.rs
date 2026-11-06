//! Live mode up to the room: the ticket (src/mcp/auth/tickets.ts) and the
//! sync upgrade (src/mcp/live/open-live.ts). The remote room client itself
//! is not built yet; a room that accepts the upgrade is refused.

use std::time::{Duration, SystemTime};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blok_blokserver_ticket::{Claims, mint};
use blok_jsjson::Str;
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{Value, json};

use crate::errors::{Fault, HostError};
use crate::outbound::Outbound;
use crate::server::Caller;
use crate::sources::encode_uri_component;

// A collaboration pass is checked at the handshake only; 1800 s is the
// ceiling ticket.ts recommends.
const TTL_SECONDS: i64 = 1800;
// blok_open waits on this request; a hung host must not hold it forever.
const TICKET_TIMEOUT: Duration = Duration::from_secs(10);
// Node's headless room gives up loading after this long.
const ROOM_SYNC_TIMEOUT: Duration = Duration::from_secs(15);
const UPGRADE_RETRY: Duration = Duration::from_millis(500);
const UPGRADE_TIMEOUT: Duration = Duration::from_secs(10);

enum Tickets {
    Secret(String),
    Url { url: String, host_token: String },
}

pub struct Live {
    url: String,
    origin: Option<String>,
    tickets: Option<Tickets>,
    outbound: Outbound,
}

fn unavailable(message: &str) -> HostError {
    HostError::surface("SOURCE_UNAVAILABLE", message)
}

/// atob, then UTF-8 with replacement: whitespace dropped, `=` padding
/// optional, any other stray character refused.
fn atob_utf8(text: &str) -> Option<String> {
    let mut clean: String = text
        .chars()
        .filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\x0c' | '\r'))
        .collect();
    if clean.len().is_multiple_of(4) {
        for _ in 0..2 {
            if clean.ends_with('=') {
                clean.pop();
            }
        }
    }
    if clean.len() % 4 == 1
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/')
    {
        return None;
    }
    let mut bits: u32 = 0;
    let mut count = 0;
    let mut bytes = Vec::new();
    for c in clean.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            _ => 63,
        };
        bits = (bits << 6) | u32::from(v);
        count += 6;
        if count >= 8 {
            count -= 8;
            bytes.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The claims of a ticket, unverified (Node's readTicketClaims).
pub fn ticket_claims(ticket: &str) -> Option<serde_json::Map<String, Value>> {
    let payload = ticket.split('.').nth(1)?;
    let decoded = atob_utf8(&payload.replace('-', "+").replace('_', "/"))?;
    match serde_json::from_str::<Value>(&decoded).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

impl Live {
    pub fn new(sync: &Value, tickets: Option<&Value>, outbound: Outbound) -> Live {
        let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        let tickets = tickets.and_then(|t| match t.get("kind").and_then(Value::as_str) {
            Some("secret") => text(t, "secret").map(Tickets::Secret),
            Some("url") => Some(Tickets::Url {
                url: text(t, "url").unwrap_or_default(),
                host_token: text(t, "hostToken").unwrap_or_default(),
            }),
            _ => None,
        });
        Live {
            url: text(sync, "url").unwrap_or_default(),
            origin: text(sync, "origin"),
            tickets,
            outbound,
        }
    }

    fn room_url(&self, document_id: &str) -> Result<String, HostError> {
        if document_id.is_empty() || document_id == "." || document_id == ".." {
            return Err(HostError::surface(
                "INVALID_ARGS",
                format!("\"{document_id}\" is not a document id."),
            ));
        }
        let base = self.url.strip_suffix('/').unwrap_or(&self.url);
        Ok(format!("{base}/{}", encode_uri_component(document_id)))
    }

    /// Mints the first ticket, then waits for the room. Never succeeds yet.
    pub async fn open(
        &self,
        document_id: &str,
        write: bool,
        caller: &Caller,
        actor: &Value,
        client_name: &str,
    ) -> Result<(), Fault> {
        let url = self.room_url(document_id)?;
        let actor_id = actor.get("id").and_then(Value::as_str).unwrap_or_default();
        let ticket = match &self.tickets {
            None => None,
            Some(Tickets::Secret(secret)) => {
                let claims = Claims {
                    user: Some(Str::from(actor_id)),
                    doc: Some(Str::from(document_id)),
                    write,
                    ttl_seconds: Some(TTL_SECONDS),
                };
                Some(
                    mint(secret, &claims, SystemTime::now())
                        .map_err(|e| Fault::Internal(e.to_string()))?,
                )
            }
            Some(Tickets::Url { url, host_token }) => Some(
                self.fetch_ticket(
                    url,
                    host_token,
                    document_id,
                    write,
                    &caller.principal,
                    client_name,
                    actor_id,
                )
                .await?,
            ),
        };
        self.join(&url, ticket.as_deref()).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn fetch_ticket(
        &self,
        url: &str,
        host_token: &str,
        document_id: &str,
        write: bool,
        principal: &str,
        client_name: &str,
        actor_id: &str,
    ) -> Result<String, HostError> {
        let body = json!({
            "doc": document_id,
            "write": write,
            "principal": principal,
            "clientName": client_name,
            "actorId": actor_id,
        });
        let headers = vec![
            ("Authorization".to_owned(), format!("Bearer {host_token}")),
            ("Content-Type".to_owned(), "application/json".to_owned()),
        ];
        let answer = self
            .outbound
            .send(
                "POST",
                url,
                headers,
                Some(body.to_string().as_bytes()),
                TICKET_TIMEOUT,
            )
            .await
            .map_err(|_| unavailable("The ticket endpoint could not be reached."))?;
        // 401 refuses our host token, not the agent: retryable, so a token
        // rotation never ends live handles.
        match answer.status {
            401 => return Err(unavailable("The ticket endpoint refused the host token.")),
            403 => {
                return Err(HostError::surface(
                    "FORBIDDEN",
                    "The host did not grant this document to this agent.",
                ));
            }
            200..=299 => {}
            status => {
                return Err(unavailable(&format!(
                    "The ticket endpoint answered {status}."
                )));
            }
        }
        let ticket = serde_json::from_slice::<Value>(&answer.body)
            .ok()
            .and_then(|body| body.get("ticket").cloned());
        let Some(Value::String(ticket)) = ticket else {
            return Err(unavailable(
                "The ticket endpoint answered without a \"ticket\" field.",
            ));
        };
        let claims = ticket_claims(&ticket);
        let user = claims.as_ref().and_then(|c| c.get("user"));
        let doc = claims.as_ref().and_then(|c| c.get("doc"));
        // The journal names the ticket's user; it must be the agent, never the human.
        if user.and_then(Value::as_str) != Some(actor_id)
            || doc.and_then(Value::as_str) != Some(document_id)
        {
            return Err(HostError::surface(
                "FORBIDDEN",
                "The host minted a ticket for another user or document. Its \"user\" must equal actorId.",
            ));
        }
        if claims.as_ref().and_then(|c| c.get("write")) == Some(&Value::Bool(true)) && !write {
            return Err(HostError::surface(
                "FORBIDDEN",
                "The host minted a write ticket for a read-only open.",
            ));
        }
        Ok(ticket)
    }

    /// Offers the upgrade until the room sync timeout, as Node's provider
    /// retries a refused one.
    async fn join(&self, url: &str, ticket: Option<&str>) -> Result<(), Fault> {
        let http_url = match url.split_once("://") {
            Some(("wss", rest)) => format!("https://{rest}"),
            Some((_, rest)) => format!("http://{rest}"),
            None => url.to_owned(),
        };
        let deadline = tokio::time::Instant::now() + ROOM_SYNC_TIMEOUT;
        loop {
            let mut headers = vec![
                ("Connection".to_owned(), "Upgrade".to_owned()),
                ("Upgrade".to_owned(), "websocket".to_owned()),
                ("Sec-WebSocket-Version".to_owned(), "13".to_owned()),
                ("Sec-WebSocket-Key".to_owned(), websocket_key()),
            ];
            let mut protocols = vec!["blok-sync.v2", "blok-sync.v1"];
            if let Some(ticket) = ticket {
                protocols.push(ticket);
            }
            headers.push(("Sec-WebSocket-Protocol".to_owned(), protocols.join(", ")));
            if let Some(origin) = &self.origin {
                headers.push(("Origin".to_owned(), origin.clone()));
            }
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            let attempt = self
                .outbound
                .send("GET", &http_url, headers, None, UPGRADE_TIMEOUT.min(left))
                .await;
            if let Ok(answer) = attempt
                && answer.status == 101
            {
                return Err(Fault::Internal(
                    "blok-mcp (Rust) cannot join a remote room yet".to_owned(),
                ));
            }
            if tokio::time::Instant::now() + UPGRADE_RETRY >= deadline {
                tokio::time::sleep_until(deadline).await;
                return Err(HostError::surface(
                    "ROOM_SYNC_TIMEOUT",
                    "The room did not finish loading in time. Try again.",
                )
                .into());
            }
            tokio::time::sleep(UPGRADE_RETRY).await;
        }
    }
}

fn websocket_key() -> String {
    let mut key = [0u8; 16];
    let _ = SystemRandom::new().fill(&mut key);
    STANDARD.encode(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claims_as_utf8_like_the_fixed_node() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"user":"agent:Jöhn:tix","doc":"документ-😀"}"#);
        let claims = ticket_claims(&format!("h.{payload}.s")).unwrap();
        assert_eq!(claims["user"], "agent:Jöhn:tix");
        assert_eq!(claims["doc"], "документ-😀");
    }

    #[test]
    fn a_ticket_that_is_not_a_jwt_has_no_claims() {
        assert!(ticket_claims("abc").is_none());
        assert!(ticket_claims("a.!!!.c").is_none());
        assert!(ticket_claims("a.e30.c").is_some());
    }
}
