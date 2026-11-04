//! Verifies the HS256 access pass ticket mode accepts. It reads the payload
//! the way C#'s TicketVerifier does with System.Text.Json: case-sensitive
//! names, the last repeat wins, write must be a JSON boolean and exp a JSON
//! integer. Port of Go `internal/ticket`.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::alphabet::URL_SAFE;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use blok_jsjson::{Kind, Options, parse_node};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// The only JWT header accepted, byte for byte.
pub const HEADER_SEGMENT: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

/// What a verified pass carries; a missing string is "".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Claims {
    pub user: String,
    pub doc: String,
    pub write: bool,
    pub exp: i64,
}

// C#'s FromBase64String accepts non-zero trailing bits, so several encodings
// of one signature verify: never key anything on the token string.
const BASE64URL: GeneralPurpose = GeneralPurpose::new(
    &URL_SAFE,
    GeneralPurposeConfig::new()
        .with_decode_allow_trailing_bits(true)
        .with_decode_padding_mode(DecodePaddingMode::RequireNone),
);

/// The Unix second of `now`, floored like DateTimeOffset.ToUnixTimeSeconds.
pub fn unix_seconds(now: SystemTime) -> i64 {
    match now.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_secs() as i64,
        Err(before) => {
            let before = before.duration();
            -(before.as_secs() as i64) - i64::from(before.subsec_nanos() > 0)
        }
    }
}

/// Checks the pass against `secret` at `now`.
pub fn verify(secret: &str, token: &str, now: SystemTime) -> Option<Claims> {
    if secret.is_empty() {
        return None;
    }
    let segments: Vec<&str> = token.split('.').collect();
    if segments.len() != 3 || segments.iter().any(|s| s.is_empty()) {
        return None;
    }
    if segments[0] != HEADER_SEGMENT {
        return None;
    }
    let signature = decode_base64url(segments[2])?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(segments[0].as_bytes());
    mac.update(b".");
    mac.update(segments[1].as_bytes());
    mac.verify_slice(&signature).ok()?;
    let claims = read_payload(&decode_base64url(segments[1])?)?;
    (claims.exp > unix_seconds(now)).then_some(claims)
}

// Only the URL alphabet: a CR, LF or padding C# refuses must not pass.
fn decode_base64url(value: &str) -> Option<Vec<u8>> {
    if value.len() % 4 == 1
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return None;
    }
    BASE64URL.decode(value).ok()
}

fn read_payload(payload: &[u8]) -> Option<Claims> {
    let node = parse_node(payload, Options::default()).ok()?;
    if node.kind != Kind::Object {
        return None;
    }
    let mut claims = Claims::default();
    for member in &node.members {
        let Ok(key) = member.key() else {
            continue;
        };
        let key = key.to_string();
        let value = &member.value;
        match key.as_str() {
            "user" | "doc" => {
                let text = match value.kind {
                    Kind::Null => String::new(),
                    Kind::String => value.text().ok()?.to_string(),
                    _ => return None,
                };
                if key == "user" {
                    claims.user = text;
                } else {
                    claims.doc = text;
                }
            }
            "write" => match value.kind {
                Kind::True => claims.write = true,
                Kind::False => claims.write = false,
                _ => return None,
            },
            "exp" => {
                let raw = std::str::from_utf8(value.raw()).ok()?;
                if value.kind != Kind::Number || raw.contains(['.', 'e', 'E']) {
                    return None;
                }
                claims.exp = raw.parse().ok()?;
            }
            _ => {}
        }
    }
    Some(claims)
}
