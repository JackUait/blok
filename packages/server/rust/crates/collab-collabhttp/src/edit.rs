use std::future::Future;
use std::time::Duration;

use blok_collab_convert::{
    Error as ConvertError, canonical_body_digest, normalize_idempotency_key, parse_edit_ops,
};
use blok_collab_room::{EditResult, EditStatus, Error, Precondition};
use blok_collab_synchttp::{derive_actor, refuse};
use blok_collab_workingset::is_lineage;
use blok_http::{Request, ResponseWriter};

use crate::{Handlers, failed, refuse_retry_later, write_head};

/// Names the edit's operation.
pub const IDEMPOTENCY_KEY_HEADER: &str = "Blok-Idempotency-Key";

/// Runs a room call; None when the caller left first, which drops (and so
/// cancels) the call, as r.Context() does in Go.
pub(crate) async fn while_connected<T>(
    request: &Request,
    work: impl Future<Output = Result<T, Error>>,
) -> Option<Result<T, Error>> {
    let cancel = request.cancel_token();
    tokio::select! {
        result = work => Some(result),
        () = cancel.cancelled() => None,
    }
}

/// The normalized key of the one key header, or None.
pub(crate) fn operation_id(request: &Request) -> Option<String> {
    let keys: Vec<&str> = request.headers().get_all(IDEMPOTENCY_KEY_HEADER).collect();
    match keys.as_slice() {
        [key] => normalize_idempotency_key(key.as_bytes()),
        _ => None,
    }
}

/// Ok(None) with no If-Match, Err(()) for a malformed one.
pub(crate) fn precondition(request: &Request) -> Result<Option<Precondition>, ()> {
    let values: Vec<&str> = request.headers().get_all("If-Match").collect();
    if values.is_empty() {
        return Ok(None);
    }
    parse_entity_tag(&values).map(Some).ok_or(())
}

pub(crate) const KEY_REQUIRED: &str = "a valid Blok-Idempotency-Key header is required\n";
pub(crate) const BAD_IF_MATCH: &str = "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n";

impl Handlers {
    /// POST /sync/{doc}/edit. Order: doc id, doc claim, hooks, key,
    /// If-Match, body cap, parse.
    pub async fn edit(&self, mut request: Request, mut response: ResponseWriter) {
        let Some(admitted) = self.admit(&request, &mut response, true).await else {
            return;
        };
        let Some(operation_id) = operation_id(&request) else {
            refuse(&mut response, 400, KEY_REQUIRED).await;
            return;
        };
        let Ok(expect) = precondition(&request) else {
            refuse(&mut response, 400, BAD_IF_MATCH).await;
            return;
        };
        let max = self.config.max_message_bytes;
        let body = match read_body(&mut request, max).await {
            Ok(body) => body,
            Err(ReadError::TooLarge) => {
                refuse(
                    &mut response,
                    413,
                    &format!("an edit request is at most {max} bytes\n"),
                )
                .await;
                return;
            }
            Err(ReadError::Failed) => {
                failed(&request, &mut response).await;
                return;
            }
        };
        let ops = match parse_edit_ops(&body) {
            Ok(ops) => ops,
            Err(ConvertError::Edit(refusal)) => {
                refuse(&mut response, 422, &format!("{}\n", refusal.message)).await;
                return;
            }
            Err(_) => {
                failed(&request, &mut response).await;
                return;
            }
        };
        let Ok(digest) = canonical_body_digest(&ops) else {
            failed(&request, &mut response).await;
            return;
        };
        let Some(manager) = self.manager(&mut response).await else {
            return;
        };
        let actor = derive_actor(
            &self.ticket_user(&admitted.user),
            &admitted.user,
            admitted.has_user,
        );
        // After the digest, which is of the request as sent, so a retry
        // still matches.
        let ops = if self.config.stamp_authority {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_millis() as u64);
            blok_collab_room::stamp_authority(ops, &actor, now as f64)
        } else {
            ops
        };
        let edit = manager.edit(&admitted.doc, ops, &operation_id, &digest, &actor, expect);
        match while_connected(&request, edit).await {
            Some(Ok(result)) => {
                write_edit_result(&mut response, &result, manager.retry_after()).await;
            }
            _ => failed(&request, &mut response).await,
        }
    }
}

/// Answers one edit's outcome; a restore answers the same way.
pub async fn write_edit_result(
    response: &mut ResponseWriter,
    result: &EditResult,
    retry_after: Duration,
) {
    let message = |fallback: &str| match &result.err {
        Some(err) => format!("{err}\n"),
        None => format!("{fallback}\n"),
    };
    match result.status {
        EditStatus::Applied => {
            if let Some(receipt) = &result.receipt {
                write_head(response, &receipt.tag.lineage, receipt.server_sequence);
            }
            response.set_status(204);
        }
        EditStatus::PreconditionFailed => {
            if let Some(head) = &result.receipt {
                write_head(response, &head.tag.lineage, head.server_sequence);
            }
            refuse(
                response,
                412,
                "the document is no longer at the If-Match head\n",
            )
            .await;
        }
        EditStatus::PreconditionRequired => {
            refuse(
                response,
                428,
                "If-Match needs the operation journal, and this server keeps none\n",
            )
            .await;
        }
        EditStatus::Conflict => {
            refuse(
                response,
                409,
                "the idempotency key was already used for a different edit\n",
            )
            .await;
        }
        EditStatus::Invalid => {
            refuse(response, 422, &message("collab: the edit was refused.")).await;
        }
        EditStatus::Overloaded => {
            refuse_retry_later(
                response,
                retry_after,
                "the server ran past its limits reading this edit's rich text, retry\n",
            )
            .await;
        }
        EditStatus::TooLarge => {
            refuse(
                response,
                413,
                &message("collab: the edit's rich text is too large to read."),
            )
            .await;
        }
        EditStatus::Purged => refuse(response, 403, "forbidden\n").await,
        EditStatus::Unavailable => {
            refuse(response, 503, "the document is unavailable, retry\n").await;
        }
        EditStatus::Draining | EditStatus::SeedFailed => {
            refuse(response, 503, "the document could not be loaded\n").await;
        }
    }
}

/// Reads exactly one strong "<lineage>:<sequence>" tag with a canonical
/// decimal; a list, * or a weak tag is refused.
pub(crate) fn parse_entity_tag(values: &[&str]) -> Option<Precondition> {
    let [value] = values else {
        return None;
    };
    // C# indexes UTF-16 units; a quote is one unit and one byte alike.
    let inner = value.strip_prefix('"')?.strip_suffix('"')?;
    let (lineage, digits) = inner.split_once(':')?;
    if digits.contains(':') || !is_lineage(lineage) || !is_digits(digits) {
        return None;
    }
    let sequence: u64 = digits.parse().ok()?;
    if sequence.to_string() != digits {
        return None;
    }
    Some(Precondition {
        lineage: lineage.to_owned(),
        sequence,
    })
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

pub(crate) enum ReadError {
    TooLarge,
    Failed,
}

/// Counts while it reads, in 8 KiB chunks; Content-Length is not trusted.
pub(crate) async fn read_body(
    request: &mut Request,
    max_bytes: usize,
) -> Result<Vec<u8>, ReadError> {
    let mut buffer = Vec::new();
    let Some(body) = request.body_mut() else {
        return Ok(buffer);
    };
    let mut chunk = vec![0u8; 8192];
    loop {
        match body.read(&mut chunk).await {
            Ok(0) => return Ok(buffer),
            Ok(n) => {
                if buffer.len() + n > max_bytes {
                    return Err(ReadError::TooLarge);
                }
                buffer.extend_from_slice(&chunk[..n]);
            }
            Err(_) => return Err(ReadError::Failed),
        }
    }
}
