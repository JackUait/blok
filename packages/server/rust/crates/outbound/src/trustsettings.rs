//! macOS trust settings, read from `security trust-settings-export`, and
//! the anchor choice trustd makes from them. Built on every OS so the
//! decision and the parser are tested everywhere; only `tls_darwin` calls
//! them.
//!
//! The rules are trustd's, which C#'s SecTrust runs on macOS. Cited from
//! apple-oss-distributions/Security at db15acbe6a7f, as in Go's
//! trustsettings.go:
//! - trust/trustd/SecTrustServer.c:260-285 (anchor source order) and
//!   :641-669 (SecPathBuilderIsAnchor: the first source that anchors or
//!   denies decides);
//! - trust/trustd/SecPolicyServer.c:3303-3346 (SecPVCMeetsConstraint),
//!   :3359-3375 (SecPVCGetTrustSettingsResult: the first entry that meets
//!   decides, whatever its result) and :3378-3423
//!   (SecPVCIsAnchorPerConstraints: TrustRoot only for a self-signed cert,
//!   TrustAsRoot only for one that is not, Deny denies);
//! - trust/trustd/SecCertificateSource.c:330-366 (a system anchor's
//!   constraints end in TrustRoot) and :998-1021 (admin settings, when
//!   present, replace the user's);
//! - OSX/libsecurity_keychain/lib/TrustSettings.cpp:1009-1128 (which fields
//!   reach trustd: policy options do not, and an entry with none of them is
//!   dropped);
//! - OSX/utilities/SecAppleAnchor.c:141-180, 590-606 (Apple's own roots,
//!   checked before any trust setting).

use std::collections::{BTreeSet, HashMap, HashSet};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

/// One entry of a certificate's macOS trust settings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TrustSetting {
    pub(crate) policy_name: Option<String>,
    pub(crate) result: Option<i64>,
    /// kSecTrustSettingsPolicy, the OID's DER content bytes.
    pub(crate) policy_oid: Option<Vec<u8>>,
    /// Whether the entry meets depends on the evaluation (a hostname, the
    /// calling app, a key usage other than any), or a field could not be
    /// read.
    pub(crate) constrained: bool,
}

// kSecTrustSettingsResult values.
pub(crate) const TRUST_ROOT: i64 = 1;
pub(crate) const TRUST_AS_ROOT: i64 = 2;
pub(crate) const TRUST_DENY: i64 = 3;

/// kSecPolicyAppleSSL, 1.2.840.113635.100.1.3: the OID an SSL server check
/// compares with (SecPolicyGetCompatibilityOidString).
const SSL_POLICY_OID: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x01, 0x03];

/// kSecTrustSettingsKeyUseAny, read as a 64-bit number.
const KEY_USE_ANY: i64 = 0xffff_ffff;

/// Caps the evaluations tried for one certificate.
const MAX_CONSTRAINED: usize = 10;

impl TrustSetting {
    /// The policy part of SecPVCMeetsConstraint for an SSL server check
    /// (SecPVCContainsPolicy, SecPolicyServer.c:3041-3083): with both a name
    /// and an OID, both must be SSL's; with one, that one; with neither, it
    /// applies.
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

#[derive(PartialEq)]
enum AnchorVerdict {
    /// The next anchor source decides.
    PassOn,
    Anchored,
    Denied,
}

/// SecPVCIsAnchorPerConstraints over one list. `meets` says whether a
/// constrained entry meets in this evaluation.
fn legacy_verdict(
    settings: &[TrustSetting],
    self_signed: bool,
    meets: impl Fn(usize) -> bool,
) -> AnchorVerdict {
    if settings.is_empty() {
        return if self_signed {
            AnchorVerdict::Anchored
        } else {
            AnchorVerdict::PassOn
        };
    }
    // kSecTrustSettingsResultInvalid: nothing met.
    let mut result = 0;
    for (index, setting) in settings.iter().enumerate() {
        if !setting.names_tls() || setting.constrained && !meets(index) {
            continue;
        }
        result = setting.result.unwrap_or(TRUST_ROOT);
        break;
    }
    if self_signed && result == TRUST_ROOT || !self_signed && result == TRUST_AS_ROOT {
        AnchorVerdict::Anchored
    } else if result == TRUST_DENY {
        AnchorVerdict::Denied
    } else {
        AnchorVerdict::PassOn
    }
}

/// The anchors trustd would use for an SSL server check. `certs` maps SHA-1
/// (upper hex, as the exports key them) to DER; `system` holds the hashes of
/// the system root keychain. Apple's roots anchor first. Then the trust
/// settings: admin's list when admin lists the cert, else the user's. A
/// list that neither anchors nor denies leaves it to the system roots,
/// which anchor a self-signed cert. A cert whose constrained entries could
/// go either way is an anchor only if it is one in every case, so the set
/// never trusts more than trustd. The anchors come out in hash order.
pub(crate) fn trusted_anchors(
    user: &HashMap<String, Vec<TrustSetting>>,
    admin: &HashMap<String, Vec<TrustSetting>>,
    system: &HashSet<String>,
    certs: &HashMap<String, Vec<u8>>,
    self_signed: impl Fn(&[u8]) -> bool,
    apple: impl Fn(&[u8]) -> bool,
) -> Vec<Vec<u8>> {
    let candidates: BTreeSet<&String> = user
        .keys()
        .chain(admin.keys())
        .chain(system.iter())
        .collect();
    candidates
        .into_iter()
        .filter_map(|hash| certs.get(hash).map(|der| (hash, der)))
        .filter(|(hash, der)| is_anchor(hash, der, user, admin, system, &self_signed, &apple))
        .map(|(_, der)| der.clone())
        .collect()
}

fn is_anchor(
    hash: &str,
    der: &[u8],
    user: &HashMap<String, Vec<TrustSetting>>,
    admin: &HashMap<String, Vec<TrustSetting>>,
    system: &HashSet<String>,
    self_signed: &impl Fn(&[u8]) -> bool,
    apple: &impl Fn(&[u8]) -> bool,
) -> bool {
    if apple(der) {
        return true;
    }
    let own = self_signed(der);
    let system_anchor = system.contains(hash) && own;
    let Some(settings) = admin.get(hash).or_else(|| user.get(hash)) else {
        return system_anchor;
    };
    let open: Vec<usize> = settings
        .iter()
        .enumerate()
        .filter(|(_, setting)| setting.constrained && setting.names_tls())
        .map(|(index, _)| index)
        .collect();
    if open.len() > MAX_CONSTRAINED {
        return false;
    }
    (0..1usize << open.len()).all(|world| {
        let meets = |index: usize| {
            open.iter()
                .position(|&i| i == index)
                .is_some_and(|bit| world & (1 << bit) != 0)
        };
        match legacy_verdict(settings, own, meets) {
            AnchorVerdict::Anchored => true,
            AnchorVerdict::PassOn => system_anchor,
            AnchorVerdict::Denied => false,
        }
    })
}

/// SHA-256 digests of SecGetAppleTrustAnchors (SecAppleAnchor.c:141-180):
/// Apple Root CA, G2, G3 and the two Platform Backport roots.
pub(crate) const APPLE_ROOTS: [[u8; 32]; 5] = [
    [
        0xb0, 0xb1, 0x73, 0x0e, 0xcb, 0xc7, 0xff, 0x45, 0x05, 0x14, 0x2c, 0x49, 0xf1, 0x29, 0x5e,
        0x6e, 0xda, 0x6b, 0xca, 0xed, 0x7e, 0x2c, 0x68, 0xc5, 0xbe, 0x91, 0xb5, 0xa1, 0x10, 0x01,
        0xf0, 0x24,
    ],
    [
        0xc2, 0xb9, 0xb0, 0x42, 0xdd, 0x57, 0x83, 0x0e, 0x7d, 0x11, 0x7d, 0xac, 0x55, 0xac, 0x8a,
        0xe1, 0x94, 0x07, 0xd3, 0x8e, 0x41, 0xd8, 0x8f, 0x32, 0x15, 0xbc, 0x3a, 0x89, 0x04, 0x44,
        0xa0, 0x50,
    ],
    [
        0x63, 0x34, 0x3a, 0xbf, 0xb8, 0x9a, 0x6a, 0x03, 0xeb, 0xb5, 0x7e, 0x9b, 0x3f, 0x5f, 0xa7,
        0xbe, 0x7c, 0x4f, 0x5c, 0x75, 0x6f, 0x30, 0x17, 0xb3, 0xa8, 0xc4, 0x88, 0xc3, 0x65, 0x3e,
        0x91, 0x79,
    ],
    [
        0xfb, 0x3f, 0x6c, 0xf6, 0x94, 0x67, 0xb5, 0xfa, 0x9f, 0xfa, 0x2b, 0x3b, 0x39, 0x2b, 0x6e,
        0x5e, 0x77, 0x5b, 0xbb, 0x09, 0xc7, 0x7b, 0x6e, 0x75, 0x9e, 0x90, 0x38, 0xe2, 0x6b, 0xbf,
        0x90, 0x49,
    ],
    [
        0xed, 0xa2, 0x3b, 0x3f, 0x22, 0x4f, 0x45, 0xe0, 0x95, 0x2f, 0x20, 0xe4, 0xd2, 0xb3, 0x3e,
        0x00, 0x0d, 0x49, 0xc8, 0x04, 0x4c, 0x11, 0x68, 0xde, 0x47, 0xb4, 0x43, 0xcd, 0x2b, 0x35,
        0x36, 0xdc,
    ],
];

/// A plist value; only what the trust list needs is kept.
#[derive(Debug)]
pub(crate) enum Value {
    Dict(HashMap<String, Value>),
    Array(Vec<Value>),
    Text(String),
    Integer(i64),
    Data(Vec<u8>),
    Other,
}

/// Reads the top dict of an XML plist.
pub(crate) fn read_plist_dict(data: &[u8]) -> Result<HashMap<String, Value>, String> {
    let text = std::str::from_utf8(data).map_err(|e| e.to_string())?;
    let mut reader = Reader { text, at: 0 };
    loop {
        match reader.next_tag()? {
            None => return Err("no dict".into()),
            Some(tag) if tag.name == "dict" => {
                return match reader.value(&tag)? {
                    Value::Dict(dict) => Ok(dict),
                    _ => Err("no dict".into()),
                };
            }
            Some(_) => {}
        }
    }
}

/// Reads the trustList of a trust settings export (an XML plist): each
/// certificate's SHA-1 and its trust settings.
pub(crate) fn parse_trust_list(
    export: &[u8],
) -> Result<HashMap<String, Vec<TrustSetting>>, String> {
    let mut root = read_plist_dict(export)?;
    let mut out = HashMap::new();
    let Some(Value::Dict(list)) = root.remove("trustList") else {
        return Ok(out);
    };
    for (hash, entry) in list {
        let mut settings = Vec::new();
        if let Value::Dict(mut fields) = entry
            && let Some(Value::Array(items)) = fields.remove("trustSettings")
        {
            settings.extend(items.into_iter().filter_map(read_setting));
        }
        out.insert(hash, settings);
    }
    Ok(out)
}

/// The fields TrustSettings::copyTrustSettings hands trustd
/// (TrustSettings.cpp:1040-1123); an entry with none of them is dropped.
/// Policy options are not among them.
const COPIED_KEYS: [&str; 6] = [
    "kSecTrustSettingsPolicy",
    "kSecTrustSettingsApplication",
    "kSecTrustSettingsPolicyString",
    "kSecTrustSettingsAllowedError",
    "kSecTrustSettingsResult",
    "kSecTrustSettingsKeyUsage",
];

/// One entry; None for an entry trustd never sees. An entry or a field it
/// cannot read is kept as constrained.
fn read_setting(item: Value) -> Option<TrustSetting> {
    let Value::Dict(dict) = item else {
        return Some(TrustSetting {
            constrained: true,
            ..TrustSetting::default()
        });
    };
    if !COPIED_KEYS.iter().any(|key| dict.contains_key(*key)) {
        return None;
    }
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
    Some(TrustSetting {
        policy_name,
        result,
        policy_oid,
        constrained: unreadable || constrained(&dict),
    })
}

/// An entry whose match depends on the evaluation: a hostname
/// (SecPVCContainsString), the calling app, or a key usage other than any
/// (SecPVCContainsTrustSettingsKeyUsage, SecPolicyServer.c:3174-3227).
fn constrained(dict: &HashMap<String, Value>) -> bool {
    if [
        "kSecTrustSettingsPolicyString",
        "kSecTrustSettingsApplication",
    ]
    .iter()
    .any(|key| dict.contains_key(*key))
    {
        return true;
    }
    match dict.get("kSecTrustSettingsKeyUsage") {
        None => false,
        Some(Value::Integer(usage)) => *usage != KEY_USE_ANY,
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
