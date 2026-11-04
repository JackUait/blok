//! Mints the access pass a ticket-mode server verifies, like C#'s
//! BlokTicket.Create. A pass minted here verifies on the C# server and the
//! other way round, and the same claims mint the same bytes. Port of Go
//! `blokserver/ticket`.

use std::fmt;
use std::time::SystemTime;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use blok_jsjson::append_quoted;
use blok_ticket::{HEADER_SEGMENT, unix_seconds};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// The shortest secret, in UTF-16 code units.
pub const MINIMUM_SECRET_LENGTH: usize = 32;

/// The lifetime an unset `ttl_seconds` stands for.
pub const DEFAULT_TTL_SECONDS: i64 = 300;

/// Who a pass is for and how long it lives.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Claims {
    /// Your own user id. An empty id still verifies, but /sync closes such a
    /// pass with 4401.
    pub user: String,
    /// The one document the pass may open; None leaves the claim out.
    pub doc: Option<String>,
    pub write: bool,
    /// The lifetime in whole seconds; None means DEFAULT_TTL_SECONDS. Like
    /// C#, an explicit value below 1 is refused.
    pub ttl_seconds: Option<i64>,
}

/// Why a pass was not minted. The C# exception each stands for is named.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MintError {
    /// ArgumentException.
    ShortSecret,
    /// ArgumentOutOfRangeException.
    Lifetime,
    /// OverflowException.
    Overflow,
}

impl fmt::Display for MintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            MintError::ShortSecret => "the secret must be at least 32 characters",
            MintError::Lifetime => "the lifetime must be at least one second",
            MintError::Overflow => "the expiry overflows",
        })
    }
}

impl std::error::Error for MintError {}

/// Returns a pass for `claims`, signed with `secret`, that expires the
/// lifetime after `now`.
pub fn mint(secret: &str, claims: &Claims, now: SystemTime) -> Result<String, MintError> {
    if secret.encode_utf16().count() < MINIMUM_SECRET_LENGTH {
        return Err(MintError::ShortSecret);
    }
    let ttl = claims.ttl_seconds.unwrap_or(DEFAULT_TTL_SECONDS);
    if ttl < 1 {
        return Err(MintError::Lifetime);
    }
    let exp = unix_seconds(now)
        .checked_add(ttl)
        .ok_or(MintError::Overflow)?;
    let mut payload = b"{\"user\":".to_vec();
    append_quoted(
        &mut payload,
        &claims.user.encode_utf16().collect::<Vec<_>>(),
    );
    if let Some(doc) = &claims.doc {
        payload.extend_from_slice(b",\"doc\":");
        append_quoted(&mut payload, &doc.encode_utf16().collect::<Vec<_>>());
    }
    payload.extend_from_slice(b",\"write\":");
    payload.extend_from_slice(if claims.write { b"true" } else { b"false" });
    payload.extend_from_slice(format!(",\"exp\":{exp}}}").as_bytes());
    let input = format!("{HEADER_SEGMENT}.{}", URL_SAFE_NO_PAD.encode(&payload));
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC takes a key of any length");
    mac.update(input.as_bytes());
    Ok(format!(
        "{input}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    ))
}
