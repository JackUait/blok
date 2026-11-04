//! SyncHandshake.NegotiateAsync. Order: plumbing, origin, ticket, doc claim,
//! rate limit, the application's hook. A refusal costs nothing; a
//! rejection costs a socket, so it spends the rate limit too.

use blok_auth::User;
use blok_collab::OperationSource;
use blok_dotnet::equals_ordinal_ignore_case;
use blok_http::{Headers, Request};

use crate::close::*;
use crate::endpoint::Endpoint;

/// The two subprotocol tokens. Matched ordinally, never by case.
pub const PROTOCOL_V1: &str = "blok-sync.v1";
pub const PROTOCOL_V2: &str = "blok-sync.v2";

pub(crate) enum HandshakeResult {
    /// Answered before the upgrade with a plain status.
    Refused {
        status: u16,
        body: &'static str,
    },
    /// Accepted, echoing the subprotocol, and closed at once: refusing the
    /// subprotocol would leave a browser with no code at all.
    Rejected {
        sub_protocol: String,
        close: CloseFrame,
    },
    Accepted(Accepted),
    /// The hook raised; C# lets it escape to the host, which answers an
    /// empty 500.
    HookFailed,
}

/// Past the door. principal "" is uncapped; actor "" is none.
pub(crate) struct Accepted {
    pub sub_protocol: String,
    pub can_write: bool,
    pub principal: String,
    pub actor: String,
    pub source: OperationSource,
    pub user: User,
}

impl Endpoint {
    pub(crate) async fn negotiate(&self, request: &Request, doc: &str) -> HandshakeResult {
        let (admission, key) = self.admit(request, doc);
        if matches!(admission, HandshakeResult::Refused { .. }) {
            return admission;
        }
        if !(self.config().rate_limit)(&key) {
            return HandshakeResult::Refused {
                status: 429,
                body: "rate limit exceeded\n",
            };
        }
        match admission {
            HandshakeResult::Accepted(candidate) => self.authorize(doc, candidate).await,
            other => other,
        }
    }

    fn admit(&self, request: &Request, doc: &str) -> (HandshakeResult, String) {
        let config = self.config();
        let mut key = format!("addr:{}", request.remote_addr().ip());
        if !blok_ws::is_web_socket_request(request) {
            return (
                HandshakeResult::Refused {
                    status: 426,
                    body: "WebSocket upgrade required\n",
                },
                key,
            );
        }
        let headers = request.headers();
        let origin_required = config.auth == "ticket"
            || headers.contains("Origin")
            || equals_ordinal_ignore_case(
                first_value(headers, "Sec-Fetch-Site").as_bytes(),
                b"cross-site",
            );
        if origin_required && !(config.origin_allowed)(first_value(headers, "Origin")) {
            return (
                HandshakeResult::Refused {
                    status: 403,
                    body: "origin not allowed\n",
                },
                key,
            );
        }

        let offers = protocol_offers(headers);
        let sub_protocol = self.select_sub_protocol(&offers);
        let rejected = |close| HandshakeResult::Rejected {
            sub_protocol: sub_protocol.to_owned(),
            close,
        };
        if !is_single_segment(doc) {
            return (rejected(CLOSE_BAD_DOCUMENT), key);
        }

        let (mut user, mut has_user) = match request.extensions.get::<User>() {
            Some(user) => (user.clone(), true),
            None => (User::default(), false),
        };
        let mut principal = String::new();
        let mut ticket_user = String::new();
        let mut can_write = true;
        if config.auth == "ticket" {
            // A 101 echoing none of the offers is failed by every browser
            // before any close code arrives: a plain refusal instead.
            if sub_protocol.is_empty() {
                return (
                    HandshakeResult::Refused {
                        status: 400,
                        body: "blok-sync.v1 must be offered in Sec-WebSocket-Protocol\n",
                    },
                    key,
                );
            }
            let candidates: Vec<&str> = offers
                .iter()
                .copied()
                .filter(|offer| *offer != PROTOCOL_V1 && *offer != PROTOCOL_V2)
                .collect();
            if candidates.is_empty() {
                return (rejected(CLOSE_MISSING_PASS), key);
            }
            let now = (config.clock)();
            let Some(claims) = candidates
                .iter()
                .find_map(|candidate| blok_ticket::verify(&config.secret, candidate, now))
            else {
                return (rejected(CLOSE_INVALID_PASS), key);
            };
            if claims.doc != doc {
                return (rejected(CLOSE_OTHER_DOCUMENT), key);
            }
            if claims.user.is_empty() {
                return (rejected(CLOSE_USERLESS_PASS), key);
            }
            can_write = claims.write;
            principal = format!("user:{}", claims.user);
            key.clone_from(&principal);
            user = User {
                id: claims.user.clone(),
                name: claims.user.clone(),
                doc: claims.doc,
                write: claims.write,
                authenticated: true,
            };
            has_user = true;
            ticket_user = claims.user;
        }
        if principal.is_empty() {
            principal = signed_in_principal(&user, has_user);
        }
        let source = if sub_protocol == PROTOCOL_V2 {
            OperationSource::ClientV2
        } else {
            OperationSource::ClientV1
        };
        let actor = derive_actor(&ticket_user, &user, has_user);
        (
            HandshakeResult::Accepted(Accepted {
                sub_protocol: sub_protocol.to_owned(),
                can_write,
                principal,
                actor,
                source,
                user,
            }),
            key,
        )
    }

    /// A denied read is closed 4403, a denied write makes the member
    /// read-only. A hook error fails closed.
    async fn authorize(&self, doc: &str, mut candidate: Accepted) -> HandshakeResult {
        let Some(hook) = &self.config().authorization else {
            return HandshakeResult::Accepted(candidate);
        };
        match hook.can_read_document(&candidate.user, doc).await {
            Err(_) => return HandshakeResult::HookFailed,
            Ok(false) => {
                return HandshakeResult::Rejected {
                    sub_protocol: candidate.sub_protocol,
                    close: CLOSE_FORBIDDEN,
                };
            }
            Ok(true) => {}
        }
        if candidate.can_write {
            match hook.can_write_document(&candidate.user, doc).await {
                Err(_) => return HandshakeResult::HookFailed,
                Ok(allowed) => candidate.can_write = allowed,
            }
        }
        HandshakeResult::Accepted(candidate)
    }

    /// v2 only with an operation store, else v1, else "".
    fn select_sub_protocol(&self, offers: &[&str]) -> &'static str {
        if self.config().has_operation_store && offers.contains(&PROTOCOL_V2) {
            PROTOCOL_V2
        } else if offers.contains(&PROTOCOL_V1) {
            PROTOCOL_V1
        } else {
            ""
        }
    }
}

/// The application's signed-in user: name, else the id. C# falls back to
/// the id only for a null name; a User cannot tell null from "", so an
/// empty name falls back too, as in Go.
fn signed_in_principal(user: &User, has_user: bool) -> String {
    if !has_user || !user.authenticated {
        return String::new();
    }
    let name = if user.name.is_empty() {
        &user.id
    } else {
        &user.name
    };
    if name.is_empty() {
        String::new()
    } else {
        format!("app:{name}")
    }
}

/// SyncHandshake.DeriveActor: the ticket's user, else the stable id, else
/// the name. The opposite order from signed_in_principal, because a name
/// can change.
pub fn derive_actor(ticket_user: &str, user: &User, has_user: bool) -> String {
    if !ticket_user.is_empty() {
        return ticket_user.to_owned();
    }
    if !has_user || !user.authenticated {
        return String::new();
    }
    if user.id.is_empty() {
        user.name.clone()
    } else {
        user.id.clone()
    }
}

/// Both header shapes: one comma-joined value and repeated lines.
/// String.Trim drops what char::is_whitespace calls space.
fn protocol_offers(headers: &Headers) -> Vec<&str> {
    headers
        .get_all("Sec-WebSocket-Protocol")
        .flat_map(|value| value.split(','))
        .map(|token| token.trim_matches(char::is_whitespace))
        .filter(|token| !token.is_empty())
        .collect()
}

/// SyncEndpoint.IsSingleSegment: a route value keeps an encoded slash
/// encoded, so "a/b" arrives as "a%2Fb" and would never match its ticket's
/// doc claim.
pub fn is_single_segment(doc: &str) -> bool {
    let lower = doc.to_ascii_lowercase();
    !doc.is_empty()
        && !doc.contains(['/', '\\'])
        && !lower.contains("%2f")
        && !lower.contains("%5c")
}

fn first_value<'a>(headers: &'a Headers, name: &str) -> &'a str {
    headers.get(name).unwrap_or("")
}
