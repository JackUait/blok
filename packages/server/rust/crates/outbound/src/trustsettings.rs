//! macOS trust settings, read from `security trust-settings-export`. Built
//! on every OS so the decision and the parser are tested everywhere; only
//! `tls_darwin` calls them.

use std::collections::{BTreeMap, HashMap};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

/// One entry of a certificate's macOS trust settings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TrustSetting {
    pub(crate) policy_name: Option<String>,
    pub(crate) result: Option<i64>,
    /// kSecTrustSettingsPolicy, the OID's DER content bytes.
    pub(crate) policy_oid: Option<Vec<u8>>,
    /// A hostname, application, key usage or policy options rule, which a
    /// fixed root set cannot check.
    pub(crate) constrained: bool,
}

// kSecTrustSettingsResult values.
pub(crate) const TRUST_ROOT: i64 = 1;
pub(crate) const TRUST_AS_ROOT: i64 = 2;
pub(crate) const TRUST_DENY: i64 = 3;

/// kSecPolicyAppleSSL, 1.2.840.113635.100.1.3: the OID an SSL server check
/// compares with (SecPolicyGetCompatibilityOidString).
const SSL_POLICY_OID: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x03];

/// kSecTrustSettingsKeyUseAny.
const KEY_USE_ANY: i64 = 0xffff_ffff;

impl TrustSetting {
    /// trustd's policy rule for an SSL server check (SecPVCMeetsConstraint,
    /// trust/trustd/SecPolicyServer.c): with both a name and an OID, both
    /// must be SSL's; with one, that one; with neither, it applies.
    fn names_tls(&self) -> bool {
        if self
            .policy_name
            .as_deref()
            .is_some_and(|name| name != "sslServer")
        {
            return false;
        }
        self.policy_oid
            .as_deref()
            .is_none_or(|oid| oid == SSL_POLICY_OID)
    }
}

/// TrustSettings::evaluateCert (apple-oss-distributions/Security,
/// OSX/libsecurity_keychain/lib/TrustSettings.cpp): an empty list trusts;
/// else the first entry for TLS with a definite result decides, no result
/// meaning TrustRoot. Unspecified or an unknown result goes on to the next
/// entry. A constrained entry matches only some checks, so its Deny denies
/// and its trust is skipped: it fails closed. None when nothing definite
/// applies; then the next domain decides.
pub(crate) fn decide_trust(settings: &[TrustSetting]) -> Option<i64> {
    if settings.is_empty() {
        return Some(TRUST_ROOT);
    }
    for setting in settings {
        if !setting.names_tls() {
            continue;
        }
        let result = setting.result.unwrap_or(TRUST_ROOT);
        if setting.constrained && result != TRUST_DENY {
            continue;
        }
        if matches!(result, TRUST_ROOT | TRUST_AS_ROOT | TRUST_DENY) {
            return Some(result);
        }
    }
    None
}

/// The domains run user, admin, system; the first domain whose settings
/// decide a certificate decides it. `certs` maps SHA-1 (upper hex, as the
/// exports key them) to DER; a hash with no certificate is skipped. The
/// anchors come out in hash order.
pub(crate) fn trusted_anchors(
    domains: &[HashMap<String, Vec<TrustSetting>>],
    certs: &HashMap<String, Vec<u8>>,
) -> Vec<Vec<u8>> {
    let mut decided: BTreeMap<&str, i64> = BTreeMap::new();
    for domain in domains {
        for (hash, settings) in domain {
            if !certs.contains_key(hash) || decided.contains_key(hash.as_str()) {
                continue;
            }
            if let Some(result) = decide_trust(settings) {
                decided.insert(hash, result);
            }
        }
    }
    decided
        .into_iter()
        .filter(|(_, result)| matches!(*result, TRUST_ROOT | TRUST_AS_ROOT))
        .map(|(hash, _)| certs[hash].clone())
        .collect()
}

/// A plist value; only what the trust list needs is kept.
#[derive(Debug)]
enum Value {
    Dict(HashMap<String, Value>),
    Array(Vec<Value>),
    Text(String),
    Integer(i64),
    Data(Vec<u8>),
    Other,
}

/// Reads the trustList of a trust settings export (an XML plist): each
/// certificate's SHA-1 and its trust settings.
pub(crate) fn parse_trust_list(
    export: &[u8],
) -> Result<HashMap<String, Vec<TrustSetting>>, String> {
    let text = std::str::from_utf8(export).map_err(|e| e.to_string())?;
    let mut reader = Reader { text, at: 0 };
    let root = loop {
        match reader.next_tag()? {
            None => return Err("no dict".into()),
            Some(tag) if tag.name == "dict" => break reader.value(&tag)?,
            Some(_) => {}
        }
    };
    let mut out = HashMap::new();
    let Value::Dict(mut root) = root else {
        return Err("no dict".into());
    };
    let Some(Value::Dict(list)) = root.remove("trustList") else {
        return Ok(out);
    };
    for (hash, entry) in list {
        let mut settings = Vec::new();
        if let Value::Dict(mut fields) = entry
            && let Some(Value::Array(items)) = fields.remove("trustSettings")
        {
            settings.extend(items.into_iter().map(read_setting));
        }
        out.insert(hash, settings);
    }
    Ok(out)
}

/// One entry. An entry or a field it cannot read is kept as constrained,
/// so it may deny but never trusts; dropping it could leave an empty list,
/// which trusts.
fn read_setting(item: Value) -> TrustSetting {
    let Value::Dict(dict) = item else {
        return TrustSetting {
            constrained: true,
            ..TrustSetting::default()
        };
    };
    let mut unreadable = false;
    let policy_name = match dict.get("kSecTrustSettingsPolicyName") {
        None => None,
        Some(Value::Text(name)) => Some(name.clone()),
        Some(_) => {
            unreadable = true;
            None
        }
    };
    let result = match dict.get("kSecTrustSettingsResult") {
        None => None,
        Some(Value::Integer(result)) => Some(*result),
        Some(_) => {
            unreadable = true;
            None
        }
    };
    let policy_oid = match dict.get("kSecTrustSettingsPolicy") {
        None => None,
        Some(Value::Data(oid)) => Some(oid.clone()),
        Some(_) => {
            unreadable = true;
            None
        }
    };
    TrustSetting {
        policy_name,
        result,
        policy_oid,
        constrained: unreadable || constrained(&dict),
    }
}

/// A rule trustd checks per evaluation: a hostname, the calling app, policy
/// options, or a key usage other than any.
fn constrained(dict: &HashMap<String, Value>) -> bool {
    let keys = [
        "kSecTrustSettingsPolicyString",
        "kSecTrustSettingsApplication",
        "kSecTrustSettingsPolicyOptions",
    ];
    if keys.iter().any(|key| dict.contains_key(*key)) {
        return true;
    }
    match dict.get("kSecTrustSettingsKeyUsage") {
        None => false,
        Some(Value::Integer(usage)) => *usage != KEY_USE_ANY && *usage != -1,
        Some(_) => true,
    }
}

struct Tag {
    name: String,
    closing: bool,
    empty: bool,
}

struct Reader<'a> {
    text: &'a str,
    at: usize,
}

impl Reader<'_> {
    /// The next element tag, skipping text, the declaration, the doctype
    /// and comments.
    fn next_tag(&mut self) -> Result<Option<Tag>, String> {
        loop {
            let Some(open) = self.text[self.at..].find('<') else {
                self.at = self.text.len();
                return Ok(None);
            };
            let start = self.at + open;
            let rest = &self.text[start..];
            let end_marker = if rest.starts_with("<!--") { "-->" } else { ">" };
            let Some(close) = rest.find(end_marker) else {
                return Err("an unclosed tag".into());
            };
            self.at = start + close + end_marker.len();
            let inner = &rest[1..close];
            if inner.starts_with('?') || inner.starts_with('!') {
                continue;
            }
            let closing = inner.starts_with('/');
            let empty = inner.ends_with('/');
            let inner = inner.trim_start_matches('/').trim_end_matches('/');
            let name = inner.split_whitespace().next().unwrap_or("").to_string();
            return Ok(Some(Tag {
                name,
                closing,
                empty,
            }));
        }
    }

    /// The text up to the end of the element just started.
    fn text_until_end(&mut self, name: &str) -> Result<String, String> {
        let closing = format!("</{name}>");
        let Some(end) = self.text[self.at..].find(&closing) else {
            return Err(format!("no {closing}"));
        };
        let raw = &self.text[self.at..self.at + end];
        self.at += end + closing.len();
        Ok(unescape(raw))
    }

    /// The value whose start tag was just read.
    fn value(&mut self, tag: &Tag) -> Result<Value, String> {
        if tag.empty {
            return Ok(match tag.name.as_str() {
                "dict" => Value::Dict(HashMap::new()),
                "array" => Value::Array(Vec::new()),
                "string" => Value::Text(String::new()),
                _ => Value::Other,
            });
        }
        match tag.name.as_str() {
            "dict" => {
                let mut dict = HashMap::new();
                let mut key = String::new();
                loop {
                    let Some(next) = self.next_tag()? else {
                        return Err("an unclosed dict".into());
                    };
                    if next.closing {
                        return Ok(Value::Dict(dict));
                    }
                    if next.name == "key" {
                        key = if next.empty {
                            String::new()
                        } else {
                            self.text_until_end("key")?
                        };
                        continue;
                    }
                    let value = self.value(&next)?;
                    dict.insert(key.clone(), value);
                }
            }
            "array" => {
                let mut items = Vec::new();
                loop {
                    let Some(next) = self.next_tag()? else {
                        return Err("an unclosed array".into());
                    };
                    if next.closing {
                        return Ok(Value::Array(items));
                    }
                    items.push(self.value(&next)?);
                }
            }
            "integer" => {
                let text = self.text_until_end("integer")?;
                text.trim()
                    .parse()
                    .map(Value::Integer)
                    .map_err(|e| e.to_string())
            }
            "data" => {
                let text = self.text_until_end("data")?;
                let packed: String = text.split_whitespace().collect();
                STANDARD
                    .decode(packed)
                    .map(Value::Data)
                    .map_err(|e| e.to_string())
            }
            "string" => self.text_until_end("string").map(Value::Text),
            name => {
                // date, real: only strings are read.
                self.text_until_end(name)?;
                Ok(Value::Other)
            }
        }
    }
}

/// XML's predefined and numeric entities.
fn unescape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest.find(';') else {
            break;
        };
        let entity = &rest[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .map(|hex| u32::from_str_radix(hex, 16))
                .or_else(|| entity.strip_prefix('#').map(str::parse))
                .and_then(Result::ok)
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}
