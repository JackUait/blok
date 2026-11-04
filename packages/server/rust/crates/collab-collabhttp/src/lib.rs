//! The collab routes beside the sync door: POST /sync/{doc}/edit, GET
//! /sync/{doc}/state, POST /sync/{doc}/reset and the history routes. Port of
//! Go `internal/collab/collabhttp` (Blok.Server.AspNetCore/Collab/{Edit,
//! State,Reset,History}Endpoint.cs). Every route runs behind the server's
//! guard, which has already checked origin, ticket and rate limit.

mod edit;
mod history;
mod state;

use std::sync::Arc;
use std::time::Duration;

use blok_auth::{Authorization, User};
use blok_collab_room::Manager;
use blok_collab_synchttp::{is_single_segment, refuse};
use blok_http::{Request, ResponseWriter};

pub use edit::{IDEMPOTENCY_KEY_HEADER, write_edit_result};

/// Builds or returns the room manager.
pub type RoomsFn = Arc<dyn Fn() -> Result<Manager, String> + Send + Sync>;

/// Logs one document id.
pub type DocLog = Arc<dyn Fn(&str) + Send + Sync>;

/// What the routes read from the server.
#[derive(Clone)]
pub struct Config {
    /// The guard verified a pass, whose doc claim must match.
    pub ticket_mode: bool,
    pub authorization: Option<Arc<dyn Authorization>>,
    /// Builds the room manager on first use.
    pub rooms: RoomsFn,
    pub max_message_bytes: usize,
    /// Reports an unreadable stored version: C# logs it at Error, event id 3
    /// (CollabHistoryCorrupt).
    pub corrupt_log: Option<DocLog>,
}

/// Serves the routes. Clones share one config.
#[derive(Clone)]
pub struct Handlers {
    config: Arc<Config>,
}

const BAD_DOCUMENT: &str = "document ids must be a single path segment\n";

/// What admit hands a route.
pub(crate) struct Admitted {
    pub doc: String,
    pub user: User,
    pub has_user: bool,
}

impl Handlers {
    pub fn new(config: Config) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    /// The door every route shares: the doc id, the ticket's doc claim, then
    /// the hook. write asks the write gate too.
    pub(crate) async fn admit(
        &self,
        request: &Request,
        response: &mut ResponseWriter,
        write: bool,
    ) -> Option<Admitted> {
        let doc = blok_route::path_value(request, "doc").to_owned();
        if !is_single_segment(&doc) {
            refuse(response, 400, BAD_DOCUMENT).await;
            return None;
        }
        let found = request.extensions.get::<User>();
        let has_user = found.is_some();
        let user = found.cloned().unwrap_or_default();
        if self.config.ticket_mode && user.doc != doc {
            refuse(response, 403, "pass is for another document\n").await;
            return None;
        }
        if let Some(hook) = &self.config.authorization {
            let mut allowed = hook.can_read_document(&user, &doc).await;
            if matches!(allowed, Ok(true)) && write {
                allowed = hook.can_write_document(&user, &doc).await;
            }
            match allowed {
                Err(_) => {
                    internal_error(response).await;
                    return None;
                }
                Ok(false) => {
                    refuse(response, 403, "forbidden\n").await;
                    return None;
                }
                Ok(true) => {}
            }
        }
        Some(Admitted {
            doc,
            user,
            has_user,
        })
    }

    pub(crate) async fn manager(&self, response: &mut ResponseWriter) -> Option<Manager> {
        match (self.config.rooms)() {
            Ok(manager) => Some(manager),
            Err(_) => {
                internal_error(response).await;
                None
            }
        }
    }

    /// The ticket's user id in ticket mode, else "".
    pub(crate) fn ticket_user(&self, user: &User) -> String {
        if self.config.ticket_mode {
            user.id.clone()
        } else {
            String::new()
        }
    }
}

/// What the host answers when a handler throws.
pub(crate) async fn internal_error(response: &mut ResponseWriter) {
    response.headers_mut().set("Content-Length", "0");
    let _ = response.start(500).await;
}

/// Answers an error from below: nothing when the caller is gone, else the
/// host's empty 500.
pub(crate) async fn failed(request: &Request, response: &mut ResponseWriter) {
    if !request.is_cancelled() {
        internal_error(response).await;
    }
}

/// 503 with Retry-After in whole seconds, rounded up, at least 1.
pub(crate) async fn refuse_retry_later(
    response: &mut ResponseWriter,
    retry_after: Duration,
    body: &str,
) {
    let seconds = (retry_after.as_secs_f64().ceil() as i64).max(1);
    response
        .headers_mut()
        .set("Retry-After", seconds.to_string());
    refuse(response, 503, body).await;
}

const LINEAGE_HEADER: &str = "Blok-Doc-Lineage";
const SEQUENCE_HEADER: &str = "Blok-Doc-Sequence";

/// Sets the head headers and exposes them on a CORS answer.
pub(crate) fn write_head(response: &mut ResponseWriter, lineage: &str, sequence: u64) {
    let headers = response.headers_mut();
    headers.set(LINEAGE_HEADER, lineage);
    headers.set(SEQUENCE_HEADER, sequence.to_string());
    expose(response, &[LINEAGE_HEADER, SEQUENCE_HEADER, "ETag"]);
}

/// Merges names into Access-Control-Expose-Headers, only when the answer is
/// a CORS one.
pub(crate) fn expose(response: &mut ResponseWriter, names: &[&str]) {
    let headers = response.headers_mut();
    if !headers.contains("Access-Control-Allow-Origin") {
        return;
    }
    let mut exposed: Vec<String> = headers
        .get_all("Access-Control-Expose-Headers")
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect();
    for name in names {
        if !exposed.iter().any(|have| have.eq_ignore_ascii_case(name)) {
            exposed.push((*name).to_owned());
        }
    }
    headers.set("Access-Control-Expose-Headers", exposed.join(", "));
}

/// The strong tag for one journal head.
pub(crate) fn entity_tag(lineage: &str, sequence: u64) -> String {
    format!("\"{lineage}:{sequence}\"")
}

#[cfg(test)]
mod edit_result_test;
#[cfg(test)]
mod history_test;
#[cfg(test)]
mod retry_test;
#[cfg(test)]
mod test_support;
