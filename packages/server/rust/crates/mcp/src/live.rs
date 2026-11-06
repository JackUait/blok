//! Live mode: the ticket (src/mcp/auth/tickets.ts) and opening a room
//! (src/mcp/live/open-live.ts). The room client itself is remote.rs.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_blokserver_ticket::{Claims, mint};
use blok_jsjson::Str;
use serde_json::{Value, json};

use crate::errors::{Fault, HostError};
use crate::outbound::Outbound;
use crate::remote::{self, LiveShared, Presence, RemoteRoom, RoomSpec};
use crate::sources::encode_uri_component;

// A collaboration pass is checked at the handshake only; 1800 s is the
// ceiling ticket.ts recommends.
const TTL_SECONDS: i64 = 1800;
// blok_open waits on this request; a hung host must not hold it forever.
const TICKET_TIMEOUT: Duration = Duration::from_secs(10);
// A cached ticket this close to expiry is fetched again.
const REFRESH_MARGIN_MS: i64 = 30_000;

#[derive(Clone)]
enum Mode {
    Secret(String),
    Url { url: String, host_token: String },
}

/// What a ticket is minted or fetched for.
#[derive(Clone, Debug)]
pub struct TicketRequest {
    pub document_id: String,
    pub write: bool,
    pub principal: String,
    pub client_name: String,
    pub actor_id: String,
}

/// One handle's ticket source. URL mode caches the ticket until it is near
/// expiry, as Node's provider does.
pub struct Tickets {
    mode: Mode,
    request: TicketRequest,
    outbound: Outbound,
    cached: Mutex<Option<(String, i64)>>,
}

fn unavailable(message: &str) -> HostError {
    HostError::surface("SOURCE_UNAVAILABLE", message)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
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

impl Tickets {
    /// The ticket to offer now. A URL ticket is fetched again near its
    /// expiry or when `fresh` asks for it.
    pub async fn get(&self, fresh: bool) -> Result<String, Fault> {
        match &self.mode {
            Mode::Secret(secret) => {
                let claims = Claims {
                    user: Some(Str::from(self.request.actor_id.as_str())),
                    doc: Some(Str::from(self.request.document_id.as_str())),
                    write: self.request.write,
                    ttl_seconds: Some(TTL_SECONDS),
                };
                mint(secret, &claims, SystemTime::now()).map_err(|e| Fault::Internal(e.to_string()))
            }
            Mode::Url { url, host_token } => {
                let cached = self
                    .cached
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .clone();
                if let Some((ticket, expires)) = cached
                    && !fresh
                    && expires - now_ms() >= REFRESH_MARGIN_MS
                {
                    return Ok(ticket);
                }
                let fetched = self.fetch(url, host_token).await?;
                *self.cached.lock().unwrap_or_else(|p| p.into_inner()) = Some(fetched.clone());
                Ok(fetched.0)
            }
        }
    }

    async fn fetch(&self, url: &str, host_token: &str) -> Result<(String, i64), HostError> {
        let r = &self.request;
        let body = json!({
            "doc": r.document_id,
            "write": r.write,
            "principal": r.principal,
            "clientName": r.client_name,
            "actorId": r.actor_id,
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
        let field = |key: &str| claims.as_ref().and_then(|c| c.get(key));
        // The journal names the ticket's user; it must be the agent, never the human.
        if field("user").and_then(Value::as_str) != Some(r.actor_id.as_str())
            || field("doc").and_then(Value::as_str) != Some(r.document_id.as_str())
        {
            return Err(HostError::surface(
                "FORBIDDEN",
                "The host minted a ticket for another user or document. Its \"user\" must equal actorId.",
            ));
        }
        if field("write") == Some(&Value::Bool(true)) && !r.write {
            return Err(HostError::surface(
                "FORBIDDEN",
                "The host minted a write ticket for a read-only open.",
            ));
        }
        let expires = field("exp")
            .and_then(Value::as_f64)
            .map_or_else(now_ms, |exp| (exp * 1000.0) as i64);
        Ok((ticket, expires))
    }
}

pub struct Live {
    url: String,
    origin: Option<String>,
    mode: Option<Mode>,
    outbound: Outbound,
}

impl Live {
    pub fn new(sync: &Value, tickets: Option<&Value>, outbound: Outbound) -> Live {
        let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        let mode = tickets.and_then(|t| match t.get("kind").and_then(Value::as_str) {
            Some("secret") => text(t, "secret").map(Mode::Secret),
            Some("url") => Some(Mode::Url {
                url: text(t, "url").unwrap_or_default(),
                host_token: text(t, "hostToken").unwrap_or_default(),
            }),
            _ => None,
        });
        Live {
            url: text(sync, "url").unwrap_or_default(),
            origin: text(sync, "origin"),
            mode,
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

    /// Mints the first ticket eagerly, so a refusal surfaces here, then
    /// joins the room and waits for its first sync.
    pub async fn open(
        &self,
        shared: Arc<LiveShared>,
        request: TicketRequest,
        presence: Presence,
    ) -> Result<RemoteRoom, Fault> {
        let url = self.room_url(&request.document_id)?;
        let tickets = match &self.mode {
            None => None,
            Some(mode) => {
                let tickets = Arc::new(Tickets {
                    mode: mode.clone(),
                    request: request.clone(),
                    outbound: self.outbound.clone(),
                    cached: Mutex::new(None),
                });
                tickets.get(false).await?;
                Some(tickets)
            }
        };
        remote::open(
            shared,
            RoomSpec {
                document_id: request.document_id,
                url,
                origin: self.origin.clone(),
                tickets,
                write: request.write,
                presence,
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claims_as_utf8_like_the_fixed_node() {
        let payload = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            r#"{"user":"agent:Jöhn:tix","doc":"документ-😀"}"#,
        );
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
