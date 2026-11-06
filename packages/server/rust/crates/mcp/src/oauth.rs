//! OAuth for the HTTP transport (src/mcp/auth/oauth.ts and the SDK's
//! requireBearerAuth). rmcp has no server-side OAuth, so all of it is ours.

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use ring::signature::{
    ECDSA_P256_SHA256_FIXED, RSA_PKCS1_2048_8192_SHA256, RsaPublicKeyComponents, UnparsedPublicKey,
};
use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

use crate::outbound::Outbound;

const JWKS_TTL: Duration = Duration::from_secs(600);
// Bounds how often made-up kids, or a down issuer, can make us fetch the JWKS.
const MISS_REFETCH_COOLDOWN: Duration = Duration::from_secs(30);
// Each request waits on this fetch; a hung issuer must not hold it forever.
const JWKS_TIMEOUT: Duration = Duration::from_secs(10);
pub const METADATA_PATH: &str = "/.well-known/oauth-protected-resource";
const REQUIRED_SCOPE: &str = "blok.read";

#[derive(Debug, Clone, PartialEq, Eq)]
enum KeyKind {
    Rsa {
        n: Vec<u8>,
        e: Vec<u8>,
    },
    P256 {
        point: Vec<u8>,
    },
    /// A key Node would load but no Blok algorithm can use (another curve, OKP).
    Other,
}

#[derive(Debug, Clone)]
struct SigningKey {
    kind: KeyKind,
    alg: Option<String>,
}

struct Cache {
    keys: HashMap<String, SigningKey>,
    fetched_at: Option<Instant>,
    failed_at: Option<Instant>,
    last_miss_refetch_at: Option<Instant>,
}

pub struct OAuth {
    issuer: String,
    audience: String,
    jwks_url: String,
    resource_metadata_url: String,
    outbound: Outbound,
    cache: Mutex<Cache>,
}

/// A verified caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    pub principal: String,
    pub scopes: Vec<String>,
}

/// A refusal as the SDK answers it: status, `WWW-Authenticate`, JSON body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub status: u16,
    pub challenge: String,
    pub body: String,
}

/// Node's Buffer.from(text, 'base64url'): both alphabets, other characters
/// skipped, and the first `=` ends the data.
pub fn base64url_lenient(text: &str) -> Vec<u8> {
    let mut bits: u32 = 0;
    let mut count = 0;
    let mut out = Vec::new();
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            _ => continue,
        };
        bits = (bits << 6) | u32::from(v);
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    out
}

fn decode_part(part: Option<&str>) -> Result<Map<String, Value>, String> {
    let bytes = base64url_lenient(part.unwrap_or_default());
    match serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err("Malformed token".to_owned()),
    }
}

fn header_quoted(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '\\' | '"' => vec!['\\', c],
            ' '..='~' => vec![c],
            _ => vec![' '],
        })
        .collect()
}

fn to_signing_key(jwk: &Map<String, Value>) -> Option<SigningKey> {
    // RFC 7517 §4.2: a key published for encryption must not verify signatures.
    if jwk.get("use").is_some_and(|u| u != "sig") {
        return None;
    }
    let field = |name: &str| jwk.get(name).and_then(Value::as_str);
    let bytes = |name: &str| field(name).map(base64url_lenient).filter(|b| !b.is_empty());
    let kind = match field("kty")? {
        "RSA" => KeyKind::Rsa {
            n: bytes("n")?,
            e: bytes("e")?,
        },
        "EC" => {
            let x = bytes("x")?;
            let y = bytes("y")?;
            match field("crv")? {
                "P-256" if x.len() == 32 && y.len() == 32 => {
                    let mut point = vec![4u8];
                    point.extend(x);
                    point.extend(y);
                    KeyKind::P256 { point }
                }
                "P-384" | "P-521" | "secp256k1" => KeyKind::Other,
                _ => return None,
            }
        }
        "OKP" => KeyKind::Other,
        _ => return None,
    };
    Some(SigningKey {
        kind,
        alg: field("alg").map(str::to_owned),
    })
}

fn now_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

fn origin_of(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
            format!("{}://{}", scheme.to_lowercase(), authority.to_lowercase())
        }
        None => url.to_owned(),
    }
}

impl OAuth {
    pub fn new(issuer: String, audience: String, jwks_url: String, outbound: Outbound) -> OAuth {
        let resource_metadata_url = format!("{}{METADATA_PATH}", origin_of(&audience));
        OAuth {
            issuer,
            audience,
            jwks_url,
            resource_metadata_url,
            outbound,
            cache: Mutex::new(Cache {
                keys: HashMap::new(),
                fetched_at: None,
                failed_at: None,
                last_miss_refetch_at: None,
            }),
        }
    }

    /// The protected-resource metadata document.
    pub fn metadata(&self) -> String {
        json!({
            "resource": self.audience,
            "authorization_servers": [self.issuer],
            "scopes_supported": ["blok.read", "blok.write"],
            "bearer_methods_supported": ["header"],
        })
        .to_string()
    }

    fn refusal(&self, code: &str, description: &str) -> Refusal {
        let status = if code == "insufficient_scope" {
            403
        } else {
            401
        };
        Refusal {
            status,
            challenge: format!(
                "Bearer error=\"{}\", error_description=\"{}\", scope=\"{}\", resource_metadata=\"{}\"",
                header_quoted(code),
                header_quoted(description),
                REQUIRED_SCOPE,
                header_quoted(&self.resource_metadata_url)
            ),
            body: json!({ "error": code, "error_description": description }).to_string(),
        }
    }

    /// The SDK's bearer gate around Blok's verifier.
    pub async fn authenticate(&self, authorization: Option<&str>) -> Result<Verified, Refusal> {
        let header = authorization
            .unwrap_or_default()
            .split(',')
            .next()
            .unwrap_or_default();
        if header.is_empty() {
            return Err(self.refusal("invalid_token", "Missing Authorization header"));
        }
        let mut parts = header.split(' ');
        let kind = parts.next().unwrap_or_default();
        let token = parts.next().unwrap_or_default();
        if !kind.eq_ignore_ascii_case("bearer") || token.is_empty() {
            return Err(self.refusal(
                "invalid_token",
                "Invalid Authorization header format, expected 'Bearer TOKEN'",
            ));
        }
        let verified = self
            .verify(token)
            .await
            .map_err(|message| self.refusal("invalid_token", &message))?;
        if !verified.scopes.iter().any(|s| s == REQUIRED_SCOPE) {
            return Err(self.refusal("insufficient_scope", "Insufficient scope"));
        }
        Ok(verified)
    }

    async fn fetch(&self) -> Result<Value, ()> {
        let answer = self
            .outbound
            .send("GET", &self.jwks_url, Vec::new(), None, JWKS_TIMEOUT)
            .await
            .map_err(|_| ())?;
        if !(200..=299).contains(&answer.status) {
            return Err(());
        }
        serde_json::from_slice(&answer.body).map_err(|_| ())
    }

    async fn refresh(&self, cache: &mut Cache) -> Result<(), ()> {
        let Ok(body) = self.fetch().await else {
            cache.failed_at = Some(Instant::now());
            return Err(());
        };
        let entries: HashMap<String, SigningKey> = body
            .get("keys")
            .and_then(Value::as_array)
            .map(|keys| {
                keys.iter()
                    .filter_map(Value::as_object)
                    .filter_map(|jwk| {
                        let kid = jwk.get("kid")?.as_str()?.to_owned();
                        Some((kid, to_signing_key(jwk)?))
                    })
                    .collect()
            })
            .unwrap_or_default();
        // A set with no usable key would refuse every token: treat it as a failed fetch.
        if entries.is_empty() {
            cache.failed_at = Some(Instant::now());
            return Err(());
        }
        cache.keys = entries;
        cache.fetched_at = Some(Instant::now());
        Ok(())
    }

    async fn key_for(&self, kid: &str) -> Result<SigningKey, String> {
        // One lock: concurrent callers share one fetch, as Node shares its pending one.
        let mut cache = self.cache.lock().await;
        let cooling = |cache: &Cache| {
            cache
                .failed_at
                .is_some_and(|t| t.elapsed() < MISS_REFETCH_COOLDOWN)
        };
        if cache.fetched_at.is_none_or(|t| t.elapsed() > JWKS_TTL) && !cooling(&cache) {
            let _ = self.refresh(&mut cache).await;
        }
        // A miss may mean the issuer rotated keys: refetch, at most once per cooldown.
        if !cache.keys.contains_key(kid)
            && !cooling(&cache)
            && cache
                .last_miss_refetch_at
                .is_none_or(|t| t.elapsed() >= MISS_REFETCH_COOLDOWN)
        {
            cache.last_miss_refetch_at = Some(Instant::now());
            let _ = self.refresh(&mut cache).await;
        }
        cache.keys.get(kid).cloned().ok_or_else(|| {
            if cache.keys.is_empty() {
                "Signing keys unavailable".to_owned()
            } else {
                "Unknown signing key".to_owned()
            }
        })
    }

    /// Blok's token rules, in Node's order. Err is the refusal's description.
    pub async fn verify(&self, token: &str) -> Result<Verified, String> {
        let pieces: Vec<&str> = token.split('.').collect();
        let header = decode_part(pieces.first().copied())?;
        let claims = decode_part(pieces.get(1).copied())?;
        let alg = header
            .get("alg")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let kid = header.get("kid").and_then(Value::as_str);
        if !matches!(alg, "RS256" | "ES256") || kid.is_none() || pieces.len() != 3 {
            return Err("Unsupported token".to_owned());
        }
        // RFC 7515 §4.1.11: no critical extension is understood here.
        if header.contains_key("crit") {
            return Err("Unsupported critical header".to_owned());
        }
        // RFC 9068 §4: an ID token for the same audience must not pass.
        let typ = header
            .get("typ")
            .and_then(Value::as_str)
            .map(str::to_lowercase);
        if !matches!(typ.as_deref(), Some("at+jwt" | "application/at+jwt")) {
            return Err("Not an access token".to_owned());
        }
        let key = self.key_for(kid.unwrap_or_default()).await?;
        let fits = matches!(
            (&key.kind, alg),
            (KeyKind::Rsa { .. }, "RS256") | (KeyKind::P256 { .. }, "ES256")
        );
        if key.alg.as_deref().is_some_and(|a| a != alg) || !fits {
            return Err("Signing key does not match the token algorithm".to_owned());
        }
        let data = format!("{}.{}", pieces[0], pieces[1]);
        let signature = base64url_lenient(pieces[2]);
        let valid = match &key.kind {
            KeyKind::Rsa { n, e } => RsaPublicKeyComponents { n, e }
                .verify(&RSA_PKCS1_2048_8192_SHA256, data.as_bytes(), &signature)
                .is_ok(),
            KeyKind::P256 { point } => UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, point)
                .verify(data.as_bytes(), &signature)
                .is_ok(),
            KeyKind::Other => false,
        };
        if !valid {
            return Err("Bad signature".to_owned());
        }
        check_claims(&claims, &self.issuer, &self.audience, now_seconds().floor())
    }
}

/// The claim rules after the signature, in Node's order.
fn check_claims(
    claims: &Map<String, Value>,
    issuer: &str,
    audience: &str,
    now: f64,
) -> Result<Verified, String> {
    if claims.get("iss").and_then(Value::as_str) != Some(issuer) {
        return Err("Wrong issuer".to_owned());
    }
    // RFC 8707: the token must be issued for this server.
    let aud = claims.get("aud");
    let matches = match aud {
        Some(Value::Array(list)) => list.iter().any(|a| a == audience),
        Some(value) => value == audience,
        None => false,
    };
    if !matches {
        return Err("Token not issued for this server".to_owned());
    }
    match claims.get("exp").and_then(Value::as_f64) {
        Some(exp) if exp > now => {}
        _ => return Err("Token expired".to_owned()),
    }
    if claims
        .get("nbf")
        .and_then(Value::as_f64)
        .is_some_and(|nbf| nbf > now)
    {
        return Err("Token not valid yet".to_owned());
    }
    let scopes: Vec<String> = match claims.get("scope") {
        Some(Value::String(scope)) => scope
            .split(' ')
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect(),
        _ => claims
            .get("scp")
            .and_then(Value::as_array)
            .map(|scp| {
                scp.iter()
                    .filter_map(|s| s.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
    };
    // A missing sub becomes `client:<id>`, so a sub in that namespace would share handles.
    let sub = claims.get("sub");
    if sub.is_some_and(|s| s.as_str().is_none_or(str::is_empty)) {
        return Err("Malformed subject".to_owned());
    }
    let sub = sub.and_then(Value::as_str);
    if sub.is_some_and(|s| s.starts_with("client:")) {
        return Err("Reserved subject".to_owned());
    }
    let client = ["client_id", "azp", "sub"]
        .iter()
        .filter_map(|k| claims.get(*k).and_then(Value::as_str))
        .find(|v| !v.is_empty())
        .ok_or_else(|| "Token names no subject or client".to_owned())?;
    let principal = sub.map_or_else(|| format!("client:{client}"), str::to_owned);
    Ok(Verified { principal, scopes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn decodes_base64url_as_node_buffer_does() {
        assert_eq!(base64url_lenient("eyJhIjoxfQ"), br#"{"a":1}"#);
        assert_eq!(base64url_lenient("eyJh!IjoxfQ=="), br#"{"a":1}"#);
        assert_eq!(base64url_lenient("-_"), vec![0xfb]);
    }

    #[test]
    fn the_principal_is_sub_else_client_id() {
        let base = json!({ "iss": "i", "aud": "a", "exp": 10.0, "scope": "blok.read" });
        let mut with_sub = base.clone();
        with_sub["sub"] = json!("alice");
        assert_eq!(
            check_claims(&claims(with_sub), "i", "a", 5.0)
                .unwrap()
                .principal,
            "alice"
        );
        let mut with_client = base.clone();
        with_client["client_id"] = json!("app-1");
        with_client["azp"] = json!("ignored");
        assert_eq!(
            check_claims(&claims(with_client), "i", "a", 5.0)
                .unwrap()
                .principal,
            "client:app-1"
        );
        let mut with_azp = base;
        with_azp["azp"] = json!("app-2");
        assert_eq!(
            check_claims(&claims(with_azp), "i", "a", 5.0)
                .unwrap()
                .principal,
            "client:app-2"
        );
    }

    #[test]
    fn claim_checks_run_in_node_order() {
        let ok = json!({ "iss": "i", "aud": ["x", "a"], "exp": 10.0, "sub": "s", "scp": ["blok.read", 5] });
        assert_eq!(
            check_claims(&claims(ok.clone()), "i", "a", 5.0)
                .unwrap()
                .scopes,
            vec!["blok.read"]
        );
        let mut wrong = ok.clone();
        wrong["iss"] = json!("o");
        wrong["aud"] = json!("x");
        assert_eq!(
            check_claims(&claims(wrong), "i", "a", 5.0).unwrap_err(),
            "Wrong issuer"
        );
        assert_eq!(
            check_claims(&claims(ok.clone()), "i", "a", 10.0).unwrap_err(),
            "Token expired"
        );
        let mut early = ok.clone();
        early["nbf"] = json!(6);
        assert_eq!(
            check_claims(&claims(early), "i", "a", 5.0).unwrap_err(),
            "Token not valid yet"
        );
        let mut empty = ok.clone();
        empty["sub"] = json!("");
        assert_eq!(
            check_claims(&claims(empty), "i", "a", 5.0).unwrap_err(),
            "Malformed subject"
        );
        let mut reserved = ok;
        reserved["sub"] = json!("client:x");
        assert_eq!(
            check_claims(&claims(reserved), "i", "a", 5.0).unwrap_err(),
            "Reserved subject"
        );
    }

    #[test]
    fn the_metadata_url_sits_at_the_audience_origin() {
        let oauth = OAuth::new(
            "https://i".into(),
            "https://mcp.test/mcp".into(),
            "https://j".into(),
            Outbound::new(),
        );
        assert_eq!(
            oauth.resource_metadata_url,
            "https://mcp.test/.well-known/oauth-protected-resource"
        );
    }
}
