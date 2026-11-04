use std::fmt;

use blok_jsjson::append_quoted;

use crate::*;

/// SyncWire.Encode's ArgumentException; the text is C#'s message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NotEncodable(pub &'static str);

impl fmt::Display for NotEncodable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for NotEncodable {}

/// SyncWire.Encode: one frame per message. Payloads must not be empty, ids
/// must be lineage-shaped, and an Unknown has no bytes.
pub fn encode(message: &Message) -> Result<Vec<u8>, NotEncodable> {
    let mut b = Vec::new();
    match message {
        Message::SyncStep1 { state_vector } => return encode_sync(SYNC_STEP1_TYPE, state_vector),
        Message::SyncStep2 { update } => return encode_sync(SYNC_STEP2_TYPE, update),
        Message::SyncUpdate { update } => return encode_sync(SYNC_UPDATE, update),
        Message::Awareness { update } => {
            if update.is_empty() {
                return Err(NotEncodable("collab: sync payloads must not be empty."));
            }
            append_var_uint(&mut b, MESSAGE_AWARENESS);
            append_var_bytes(&mut b, update);
        }
        Message::QueryAwareness => append_var_uint(&mut b, MESSAGE_QUERY_AWARENESS),
        Message::PermissionDenied { reason } => {
            append_var_uint(&mut b, MESSAGE_AUTH);
            append_var_uint(&mut b, AUTH_PERMISSION_DENIED);
            append_var_bytes(&mut b, reason.as_bytes());
        }
        Message::BlokControl { tag } => {
            if !tag.is_announceable() {
                return Err(NotEncodable("collab: the tag is not encodable."));
            }
            // Key order is pinned: the client writes {epoch, format, lineage}.
            let mut json = format!(
                "{{\"epoch\":{},\"format\":{},\"lineage\":",
                tag.epoch, tag.format
            )
            .into_bytes();
            quote(&mut json, &tag.lineage);
            json.push(b'}');
            append_var_uint(&mut b, MESSAGE_BLOK_CONTROL);
            append_var_bytes(&mut b, &json);
        }
        Message::BlokLimits { max_message_bytes } => {
            if *max_message_bytes <= 0 {
                return Err(NotEncodable("collab: the limit is not encodable."));
            }
            let json = format!("{{\"maxMessageBytes\":{max_message_bytes}}}");
            append_var_uint(&mut b, MESSAGE_BLOK_LIMITS);
            append_var_bytes(&mut b, json.as_bytes());
        }
        Message::Operation {
            lineage,
            operation_id,
            update,
        } => {
            let mut json = ids_json(lineage, operation_id)?;
            if update.is_empty() {
                return Err(NotEncodable("collab: operation updates must not be empty."));
            }
            json.push(b'}');
            append_var_uint(&mut b, MESSAGE_OPERATION);
            append_var_bytes(&mut b, &json);
            append_var_bytes(&mut b, update);
        }
        Message::Acknowledgement {
            lineage,
            operation_id,
            server_sequence,
        } => {
            let mut json = ids_json(lineage, operation_id)?;
            if *server_sequence == 0 {
                return Err(NotEncodable(
                    "collab: an acknowledgement cannot carry serverSequence 0.",
                ));
            }
            json.extend_from_slice(
                format!(",\"serverSequence\":\"{server_sequence}\"}}").as_bytes(),
            );
            append_var_uint(&mut b, MESSAGE_ACKNOWLEDGEMENT);
            append_var_bytes(&mut b, &json);
        }
        Message::Rejection {
            lineage,
            operation_id,
            code,
        } => {
            let mut json = ids_json(lineage, operation_id)?;
            if !is_rejection_code(code) {
                return Err(NotEncodable("collab: the rejection code is not encodable."));
            }
            json.extend_from_slice(format!(",\"code\":\"{code}\"}}").as_bytes());
            append_var_uint(&mut b, MESSAGE_REJECTION);
            append_var_bytes(&mut b, &json);
        }
        Message::Activity => append_var_uint(&mut b, MESSAGE_ACTIVITY),
        Message::Identities { identities } => {
            let mut json = b"{\"identities\":[".to_vec();
            for (i, identity) in identities.iter().enumerate() {
                if identity.actor_id.is_empty() {
                    return Err(NotEncodable(
                        "collab: an identity needs a non-empty ActorId.",
                    ));
                }
                if i > 0 {
                    json.push(b',');
                }
                json.extend_from_slice(
                    format!("{{\"clientId\":{},\"actorId\":", identity.client_id).as_bytes(),
                );
                quote(&mut json, &identity.actor_id);
                json.push(b'}');
            }
            json.extend_from_slice(b"]}");
            append_var_uint(&mut b, MESSAGE_IDENTITIES);
            append_var_bytes(&mut b, &json);
        }
        Message::Unknown { .. } => {
            return Err(NotEncodable(
                "collab: this message cannot be put on the wire.",
            ));
        }
    }
    Ok(b)
}

// Utf8JsonWriter.WriteString with the default encoder.
fn quote(dst: &mut Vec<u8>, s: &str) {
    append_quoted(dst, &s.encode_utf16().collect::<Vec<_>>());
}

// Opens {"lineage":"…","operationId":"…" for the v2 frames; the caller
// closes it. Ids are plain hex, so no escaping is needed.
fn ids_json(lineage: &str, operation_id: &str) -> Result<Vec<u8>, NotEncodable> {
    if !is_lineage(lineage) || !is_lineage(operation_id) {
        return Err(NotEncodable(
            "collab: the id is not 32 lowercase-hex characters.",
        ));
    }
    Ok(format!("{{\"lineage\":\"{lineage}\",\"operationId\":\"{operation_id}\"").into_bytes())
}

fn encode_sync(sub_type: u64, payload: &[u8]) -> Result<Vec<u8>, NotEncodable> {
    if payload.is_empty() {
        return Err(NotEncodable("collab: sync payloads must not be empty."));
    }
    let mut b = Vec::new();
    append_var_uint(&mut b, MESSAGE_SYNC);
    append_var_uint(&mut b, sub_type);
    append_var_bytes(&mut b, payload);
    Ok(b)
}

/// ^[a-z][a-z0-9-]{0,63}$.
pub(crate) fn is_rejection_code(text: &str) -> bool {
    let b = text.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_lowercase()
        && b[1..]
            .iter()
            .all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
