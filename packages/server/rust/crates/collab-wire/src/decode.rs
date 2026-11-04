use std::fmt;

use crate::encode::is_rejection_code;
use crate::jsonreader::{JsonReader, Token};
use crate::*;

/// A refused frame. `rule` is the blok-sync.v2 section-5 rule (1-12) a type
/// 102-104 frame broke, or 1 for a missing type; 0 otherwise.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodeError {
    pub reason: String,
    pub rule: u8,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.reason)
    }
}

impl std::error::Error for DecodeError {}

type Decoded<T> = Result<T, DecodeError>;

fn refuse(reason: impl Into<String>) -> DecodeError {
    DecodeError {
        reason: reason.into(),
        rule: 0,
    }
}

fn refuse_rule(rule: u8, reason: impl Into<String>) -> DecodeError {
    DecodeError {
        reason: reason.into(),
        rule,
    }
}

/// SyncWire.TryDecode. An unknown outer type is not an error.
pub fn decode(frame: &[u8]) -> Decoded<Message> {
    let Some((message_type, frame)) = read_var_uint(frame) else {
        return Err(refuse_rule(1, "the message type is missing or malformed"));
    };
    let (message, rest) = match message_type {
        MESSAGE_SYNC => return decode_sync(frame),
        MESSAGE_AWARENESS => {
            let (update, rest) = read_payload(frame)?;
            (Message::Awareness { update }, rest)
        }
        MESSAGE_AUTH => return decode_auth(frame),
        MESSAGE_QUERY_AWARENESS => (Message::QueryAwareness, frame),
        MESSAGE_BLOK_CONTROL => {
            let (json, rest) = read_var_bytes(frame)
                .ok_or_else(|| refuse("the control payload is missing or truncated"))?;
            (
                Message::BlokControl {
                    tag: decode_control(json)?,
                },
                rest,
            )
        }
        MESSAGE_BLOK_LIMITS => {
            let (json, rest) = read_var_bytes(frame)
                .ok_or_else(|| refuse("the limits payload is missing or truncated"))?;
            (
                Message::BlokLimits {
                    max_message_bytes: decode_limits(json)?,
                },
                rest,
            )
        }
        MESSAGE_OPERATION => return decode_operation(frame),
        MESSAGE_ACKNOWLEDGEMENT => return decode_acknowledgement(frame),
        MESSAGE_REJECTION => return decode_rejection(frame),
        MESSAGE_ACTIVITY => (Message::Activity, frame),
        MESSAGE_IDENTITIES => {
            let (json, rest) = read_var_bytes(frame)
                .ok_or_else(|| refuse("the identities payload is missing or truncated"))?;
            (
                Message::Identities {
                    identities: decode_identities(json)?,
                },
                rest,
            )
        }
        _ => return Ok(Message::Unknown { message_type }),
    };
    require_end(rest)?;
    Ok(message)
}

fn require_end(rest: &[u8]) -> Decoded<()> {
    if rest.is_empty() {
        Ok(())
    } else {
        Err(refuse(format!(
            "{} trailing byte(s) after the message",
            rest.len()
        )))
    }
}

fn read_payload(input: &[u8]) -> Decoded<(Vec<u8>, &[u8])> {
    let (b, rest) =
        read_var_bytes(input).ok_or_else(|| refuse("the payload is missing or truncated"))?;
    if b.is_empty() {
        return Err(refuse("the payload is empty"));
    }
    Ok((b.to_vec(), rest))
}

fn decode_sync(input: &[u8]) -> Decoded<Message> {
    let (sub_type, input) =
        read_var_uint(input).ok_or_else(|| refuse("the sync sub-type is missing or malformed"))?;
    if sub_type > SYNC_UPDATE {
        return Err(refuse(format!("unknown sync sub-type {sub_type}")));
    }
    let (payload, input) = read_payload(input)?;
    let message = match sub_type {
        SYNC_STEP1_TYPE => Message::SyncStep1 {
            state_vector: payload,
        },
        SYNC_STEP2_TYPE => Message::SyncStep2 { update: payload },
        _ => Message::SyncUpdate { update: payload },
    };
    require_end(input)?;
    Ok(message)
}

fn decode_auth(input: &[u8]) -> Decoded<Message> {
    let (sub_type, input) =
        read_var_uint(input).ok_or_else(|| refuse("the auth sub-type is missing or malformed"))?;
    if sub_type != AUTH_PERMISSION_DENIED {
        return Err(refuse(format!("unknown auth sub-type {sub_type}")));
    }
    let (reason, input) =
        read_var_bytes(input).ok_or_else(|| refuse("the auth reason is missing or truncated"))?;
    let reason = std::str::from_utf8(reason)
        .map_err(|_| refuse("the auth reason is not valid UTF-8"))?
        .to_owned();
    require_end(input)?;
    Ok(Message::PermissionDenied { reason })
}

enum SectionRead<'a> {
    Ok(&'a [u8], &'a [u8]),
    Missing,
    Exceeds,
}

// Tells "nothing left" (rule 3) from "a length that is unreadable or larger
// than what remains" (rule 2).
fn read_bounded_section(input: &[u8]) -> SectionRead<'_> {
    if input.is_empty() {
        return SectionRead::Missing;
    }
    match read_var_bytes(input) {
        Some((b, rest)) => SectionRead::Ok(b, rest),
        None => SectionRead::Exceeds,
    }
}

// Reads the varstring metadata (and, for an operation, the update) under
// framing rules 2-5, before any byte is read as JSON.
fn read_sections<'a>(
    input: &'a [u8],
    name: &str,
    with_update: bool,
) -> Decoded<(&'a [u8], &'a [u8])> {
    let (metadata, mut input) = match read_bounded_section(input) {
        SectionRead::Ok(b, rest) => (b, rest),
        SectionRead::Missing => {
            return Err(refuse_rule(
                3,
                format!("the {name} metadata section is missing"),
            ));
        }
        SectionRead::Exceeds => {
            return Err(refuse_rule(
                2,
                format!("the {name} metadata length exceeds the remaining bytes"),
            ));
        }
    };
    let mut update: &[u8] = &[];
    if with_update {
        match read_bounded_section(input) {
            SectionRead::Ok(b, rest) => (update, input) = (b, rest),
            SectionRead::Missing => {
                return Err(refuse_rule(
                    3,
                    format!("the {name} update section is missing"),
                ));
            }
            SectionRead::Exceeds => {
                return Err(refuse_rule(
                    2,
                    format!("the {name} update length exceeds the remaining bytes"),
                ));
            }
        }
        if update.is_empty() {
            return Err(refuse_rule(
                4,
                format!("the {name} update must not be empty"),
            ));
        }
    }
    if !input.is_empty() {
        return Err(refuse_rule(
            5,
            format!("{} trailing byte(s) after the {name} frame", input.len()),
        ));
    }
    Ok((metadata, update))
}

fn decode_operation(input: &[u8]) -> Decoded<Message> {
    let (metadata, update) = read_sections(input, "operation", true)?;
    let properties = read_metadata_object(metadata)?;
    if has_key_set_violation(&properties, &["lineage", "operationId"]) {
        return Err(refuse_rule(
            11,
            "the operation metadata needs exactly lineage and operationId, each once",
        ));
    }
    match (
        metadata_value(&properties, "lineage"),
        metadata_value(&properties, "operationId"),
    ) {
        (Some(lineage), Some(operation_id)) if is_lineage(lineage) && is_lineage(operation_id) => {
            Ok(Message::Operation {
                lineage: lineage.to_owned(),
                operation_id: operation_id.to_owned(),
                update: update.to_vec(),
            })
        }
        _ => Err(refuse_rule(
            12,
            "the operation metadata has an ill-shaped lineage or operationId",
        )),
    }
}

fn decode_acknowledgement(input: &[u8]) -> Decoded<Message> {
    let (metadata, _) = read_sections(input, "acknowledgement", false)?;
    let properties = read_metadata_object(metadata)?;
    if has_key_set_violation(&properties, &["lineage", "operationId", "serverSequence"]) {
        return Err(refuse_rule(
            11,
            "the acknowledgement metadata needs exactly lineage, operationId and serverSequence, each once",
        ));
    }
    let sequence = metadata_value(&properties, "serverSequence").and_then(parse_server_sequence);
    match (
        metadata_value(&properties, "lineage"),
        metadata_value(&properties, "operationId"),
        sequence,
    ) {
        // 0 means "nothing committed yet", which an acknowledgement never says.
        (Some(lineage), Some(operation_id), Some(sequence))
            if is_lineage(lineage) && is_lineage(operation_id) && sequence != 0 =>
        {
            Ok(Message::Acknowledgement {
                lineage: lineage.to_owned(),
                operation_id: operation_id.to_owned(),
                server_sequence: sequence,
            })
        }
        _ => Err(refuse_rule(
            12,
            "the acknowledgement metadata has an ill-shaped field",
        )),
    }
}

fn decode_rejection(input: &[u8]) -> Decoded<Message> {
    let (metadata, _) = read_sections(input, "rejection", false)?;
    let properties = read_metadata_object(metadata)?;
    if has_key_set_violation(&properties, &["lineage", "operationId", "code"]) {
        return Err(refuse_rule(
            11,
            "the rejection metadata needs exactly lineage, operationId and code, each once",
        ));
    }
    match (
        metadata_value(&properties, "lineage"),
        metadata_value(&properties, "operationId"),
        metadata_value(&properties, "code"),
    ) {
        (Some(lineage), Some(operation_id), Some(code))
            if is_lineage(lineage) && is_lineage(operation_id) && is_rejection_code(code) =>
        {
            Ok(Message::Rejection {
                lineage: lineage.to_owned(),
                operation_id: operation_id.to_owned(),
                code: code.to_owned(),
            })
        }
        _ => Err(refuse_rule(
            12,
            "the rejection metadata has an ill-shaped field",
        )),
    }
}

struct MetadataProperty {
    key: String,
    // None when the value is not a JSON string.
    value: Option<String>,
}

// Rules 6-10: strict UTF-8, no backslash, no JSON whitespace, exactly one
// object. With no escapes and plain ASCII, a key compare on the text is
// exact (protocol 4.2).
fn read_metadata_object(json: &[u8]) -> Decoded<Vec<MetadataProperty>> {
    if std::str::from_utf8(json).is_err() {
        return Err(refuse_rule(6, "the metadata is not valid UTF-8"));
    }
    if json.contains(&b'\\') {
        return Err(refuse_rule(7, "the metadata contains a backslash"));
    }
    if json
        .iter()
        .any(|c| matches!(c, b' ' | b'\t' | b'\n' | b'\r'))
    {
        return Err(refuse_rule(8, "the metadata contains JSON whitespace"));
    }
    let invalid = || refuse_rule(9, "the metadata is not valid JSON");
    let mut reader = JsonReader::new(json);
    if !reader.read().map_err(|_| invalid())? {
        return Err(refuse_rule(9, "the metadata is empty"));
    }
    if reader.token != Token::StartObject {
        if reader.token == Token::StartArray {
            reader.skip().map_err(|_| invalid())?;
        }
        if reader.read().map_err(|_| invalid())? {
            return Err(refuse_rule(9, "content follows the metadata value"));
        }
        return Err(refuse_rule(
            10,
            "the metadata top-level value is not an object",
        ));
    }
    let mut properties = Vec::new();
    loop {
        if !reader.read().map_err(|_| invalid())? {
            return Err(refuse_rule(9, "the metadata object is not terminated"));
        }
        if reader.token == Token::EndObject {
            break;
        }
        // Valid UTF-8 with no escapes, so this cannot fail.
        let key = reader.get_string().unwrap_or_default();
        if !reader.read().map_err(|_| invalid())? {
            return Err(refuse_rule(9, "a metadata property has no value"));
        }
        let mut value = None;
        match reader.token {
            Token::String => value = Some(reader.get_string().unwrap_or_default()),
            Token::StartObject | Token::StartArray => reader.skip().map_err(|_| invalid())?,
            _ => {}
        }
        properties.push(MetadataProperty { key, value });
    }
    if reader.read().map_err(|_| invalid())? {
        return Err(refuse_rule(9, "content follows the metadata object"));
    }
    Ok(properties)
}

// Rule 11: a missing, unknown or repeated key.
fn has_key_set_violation(properties: &[MetadataProperty], required: &[&str]) -> bool {
    let mut seen: Vec<&str> = Vec::new();
    for property in properties {
        if !required.contains(&property.key.as_str()) || seen.contains(&property.key.as_str()) {
            return true;
        }
        seen.push(&property.key);
    }
    seen.len() != required.len()
}

// The key's string value; None when it is absent or not a JSON string.
fn metadata_value<'a>(properties: &'a [MetadataProperty], key: &str) -> Option<&'a str> {
    properties
        .iter()
        .find(|p| p.key == key)
        .and_then(|p| p.value.as_deref())
}

// ^(0|[1-9][0-9]*)$ up to 2^64-1.
fn parse_server_sequence(text: &str) -> Option<u64> {
    if text.is_empty() {
        return None;
    }
    if text.starts_with('0') {
        return (text.len() == 1).then_some(0);
    }
    if !text.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

fn decode_control(json: &[u8]) -> Decoded<Tag> {
    let mut epoch = None;
    let mut format = None;
    let mut lineage = None;
    let invalid = || refuse("the control payload is not valid JSON");
    let mut reader = JsonReader::new(json);
    if !reader.read().map_err(|_| invalid())? || reader.token != Token::StartObject {
        return Err(refuse("the control payload is not a JSON object"));
    }
    loop {
        if !reader.read().map_err(|_| invalid())? || reader.token != Token::PropertyName {
            break;
        }
        let is_epoch = reader.value_text_equals("epoch");
        let is_format = reader.value_text_equals("format");
        let is_lineage = reader.value_text_equals("lineage");
        if !reader.read().map_err(|_| invalid())? {
            return Err(refuse("a control property has no value"));
        }
        let ok = if is_epoch && epoch.is_none() && reader.token == Token::Number {
            epoch = reader.try_get_i64();
            epoch.is_some()
        } else if is_format && format.is_none() && reader.token == Token::Number {
            format = reader.try_get_i32();
            format.is_some()
        } else if is_lineage && lineage.is_none() && reader.token == Token::String {
            // A string that is not valid text is ill-typed.
            lineage = reader.get_string().ok();
            lineage.is_some()
        } else {
            false
        };
        if !ok {
            return Err(refuse(
                "the control payload has an unknown, repeated or ill-typed property",
            ));
        }
    }
    if reader.token != Token::EndObject {
        return Err(refuse("the control payload has trailing content"));
    }
    if reader.read().map_err(|_| invalid())? {
        return Err(refuse("the control payload has trailing content"));
    }
    let (Some(epoch), Some(format), Some(lineage)) = (epoch, format, lineage) else {
        return Err(refuse(
            "the control payload needs epoch, format and lineage",
        ));
    };
    let tag = Tag {
        format,
        epoch,
        lineage,
    };
    if !tag.is_announceable() {
        return Err(refuse(
            "the control payload needs format >= 1, epoch >= 0 and a 32-hex lineage",
        ));
    }
    Ok(tag)
}

fn decode_limits(json: &[u8]) -> Decoded<i64> {
    let mut limit = None;
    let invalid = || refuse("the limits payload is not valid JSON");
    let mut reader = JsonReader::new(json);
    if !reader.read().map_err(|_| invalid())? || reader.token != Token::StartObject {
        return Err(refuse("the limits payload is not a JSON object"));
    }
    loop {
        if !reader.read().map_err(|_| invalid())? || reader.token != Token::PropertyName {
            break;
        }
        let is_limit = reader.value_text_equals("maxMessageBytes");
        if !reader.read().map_err(|_| invalid())? {
            return Err(refuse("a limits property has no value"));
        }
        let mut ok = false;
        if is_limit && limit.is_none() && reader.token == Token::Number {
            limit = reader.try_get_i64();
            ok = limit.is_some();
        }
        if !ok {
            return Err(refuse(
                "the limits payload has an unknown, repeated or ill-typed property",
            ));
        }
    }
    if reader.token != Token::EndObject {
        return Err(refuse("the limits payload has trailing content"));
    }
    if reader.read().map_err(|_| invalid())? {
        return Err(refuse("the limits payload has trailing content"));
    }
    match limit {
        Some(limit) if limit > 0 => Ok(limit),
        _ => Err(refuse(
            "the limits payload needs a positive maxMessageBytes",
        )),
    }
}

fn decode_identities(json: &[u8]) -> Decoded<Vec<Identity>> {
    let mut list = Vec::new();
    let mut saw_key = false;
    let invalid = || refuse("the identities payload is not valid JSON");
    let mut reader = JsonReader::new(json);
    if !reader.read().map_err(|_| invalid())? || reader.token != Token::StartObject {
        return Err(refuse("the identities payload is not a JSON object"));
    }
    loop {
        if !reader.read().map_err(|_| invalid())? || reader.token != Token::PropertyName {
            break;
        }
        let is_identities = reader.value_text_equals("identities");
        if !reader.read().map_err(|_| invalid())? {
            return Err(refuse("an identities property has no value"));
        }
        if !is_identities || saw_key || reader.token != Token::StartArray {
            return Err(refuse(
                "the identities payload has an unknown, repeated or ill-typed property",
            ));
        }
        saw_key = true;
        loop {
            if !reader.read().map_err(|_| invalid())? {
                return Err(refuse("the identities array is not terminated"));
            }
            if reader.token == Token::EndArray {
                break;
            }
            match decode_identity_entry(&mut reader) {
                Ok(entry) => list.push(entry),
                Err(None) => return Err(invalid()),
                Err(Some(error)) => return Err(error),
            }
        }
    }
    if reader.token != Token::EndObject {
        return Err(refuse("the identities payload has trailing content"));
    }
    if reader.read().map_err(|_| invalid())? {
        return Err(refuse("the identities payload has trailing content"));
    }
    if !saw_key {
        return Err(refuse("the identities payload needs the identities key"));
    }
    Ok(list)
}

// Reads one {"clientId":N,"actorId":"..."}; Err(None) is a reader throw,
// which the caller turns into "not valid JSON".
fn decode_identity_entry(reader: &mut JsonReader) -> Result<Identity, Option<DecodeError>> {
    if reader.token != Token::StartObject {
        return Err(Some(refuse("an identities entry is not a JSON object")));
    }
    let mut client_id = None;
    let mut actor_id = None;
    loop {
        if !reader.read().map_err(|_| None)? || reader.token != Token::PropertyName {
            break;
        }
        let is_client_id = reader.value_text_equals("clientId");
        let is_actor_id = reader.value_text_equals("actorId");
        if !reader.read().map_err(|_| None)? {
            return Err(Some(refuse("an identities entry property has no value")));
        }
        let mut ok = false;
        if is_client_id && client_id.is_none() && reader.token == Token::Number {
            if let Some(value) = reader.try_get_u64() {
                if value > MAX_AWARENESS_CLIENT_ID {
                    return Err(Some(refuse(
                        "an identities entry clientId is past the safe-integer ceiling",
                    )));
                }
                client_id = Some(value);
                ok = true;
            }
        } else if is_actor_id
            && actor_id.is_none()
            && reader.token == Token::String
            && let Ok(text) = reader.get_string()
            && !text.is_empty()
        {
            actor_id = Some(text);
            ok = true;
        }
        if !ok {
            return Err(Some(refuse(
                "an identities entry has an unknown, repeated or ill-typed property",
            )));
        }
    }
    if reader.token != Token::EndObject {
        return Err(Some(refuse("an identities entry is not terminated")));
    }
    match (client_id, actor_id) {
        (Some(client_id), Some(actor_id)) => Ok(Identity {
            client_id,
            actor_id,
        }),
        _ => Err(Some(refuse(
            "an identities entry needs both clientId and actorId",
        ))),
    }
}
