//! AuthenticationHelper's Digest (System.Net.Http 10.0.11, decompiled), for
//! a CONNECT: the request URI is the proxy's, so uri is "/" and A2 is
//! "CONNECT:/". Pinned by C#'s AnswersADigestChallengeAsSocketsHttpHandlerDoes.

use std::collections::HashMap;

use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest as _, Sha256};

fn space_or_tab(c: u8) -> bool {
    c == b' ' || c == b'\t'
}

/// DigestResponse.Parse. Keys match without case; realm, nonce, opaque and
/// qop must be quoted, and parsing stops at the first pair that breaks the
/// rules. A key seen twice is refused, as Dictionary.Add throws.
pub(crate) fn parse(challenge: &str) -> Option<HashMap<String, String>> {
    let data = challenge.as_bytes();
    let mut parameters = HashMap::new();
    let mut i = 0;
    while i < data.len() {
        let (key, next) = next_key(data, i);
        i = next;
        let Some(key) = key else { break };
        if key.is_empty() || i >= data.len() {
            break;
        }
        let lower = key.to_ascii_lowercase();
        let quoted = matches!(lower.as_str(), "realm" | "nonce" | "opaque" | "qop");
        let (value, next) = next_value(data, i, quoted);
        i = next;
        let Some(value) = value else { break };
        if value.is_empty() && !matches!(lower.as_str(), "opaque" | "domain" | "realm") {
            break;
        }
        if parameters.insert(lower, value).is_some() {
            return None;
        }
    }
    Some(parameters)
}

/// GetNextKey: None when no '=' follows the key.
fn next_key(data: &[u8], mut i: usize) -> (Option<String>, usize) {
    while i < data.len() && space_or_tab(data[i]) {
        i += 1;
    }
    let start = i;
    while i < data.len() && data[i] != b'=' && !space_or_tab(data[i]) {
        i += 1;
    }
    if i == data.len() {
        return (None, i);
    }
    let end = i;
    if space_or_tab(data[i]) {
        while i < data.len() && space_or_tab(data[i]) {
            i += 1;
        }
        if i == data.len() || data[i] != b'=' {
            return (None, i);
        }
    }
    while i < data.len() && (space_or_tab(data[i]) || data[i] == b'=') {
        i += 1;
    }
    (
        Some(String::from_utf8_lossy(&data[start..end]).into_owned()),
        i,
    )
}

/// GetNextValue.
fn next_value(data: &[u8], mut i: usize, expect_quotes: bool) -> (Option<String>, usize) {
    let quoted = data[i] == b'"';
    if quoted {
        i += 1;
    }
    if expect_quotes && !quoted {
        return (None, i);
    }
    let mut value = Vec::new();
    while i < data.len() && (quoted && data[i] != b'"' || !quoted && data[i] != b',') {
        value.push(data[i]);
        i += 1;
        if i == data.len() || !quoted && space_or_tab(data[i]) {
            break;
        }
        if quoted && data[i] == b'"' && data[i - 1] == b'\\' {
            value.push(data[i]);
            i += 1;
        }
    }
    if quoted {
        i += 1;
    }
    while i < data.len() && space_or_tab(data[i]) {
        i += 1;
    }
    let value = String::from_utf8_lossy(&value).into_owned();
    if i >= data.len() {
        return (Some(value), i);
    }
    if data[i] != b',' {
        return (None, i + 1);
    }
    i += 1;
    while i < data.len() && space_or_tab(data[i]) {
        i += 1;
    }
    (Some(value), i)
}

/// GetDigestTokenForCredential for a CONNECT; None when .NET gives no token
/// (an algorithm it lacks, no nonce, no realm).
pub(crate) fn token(user: &str, password: &str, p: &HashMap<String, String>) -> Option<String> {
    let specified = p.get("algorithm");
    let algorithm = match specified {
        Some(a) => {
            let lower = a.to_ascii_lowercase();
            if !matches!(
                lower.as_str(),
                "sha-256" | "md5" | "sha-256-sess" | "md5-sess"
            ) {
                return None;
            }
            a.clone()
        }
        None => "MD5".to_owned(),
    };
    let nonce = p.get("nonce")?;
    let realm = p.get("realm")?;
    let opaque = p.get("opaque");
    let sha = algorithm.len() >= 7 && algorithm[..7].eq_ignore_ascii_case("SHA-256");
    let hash = |data: &str| -> String {
        let bytes: Vec<u8> = if sha {
            Sha256::digest(data.as_bytes()).to_vec()
        } else {
            md5(data.as_bytes()).to_vec()
        };
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    };
    let mut out = String::new();
    let mut pair = |key: &str, value: &str, quotes: bool, comma: bool| {
        out.push_str(key);
        out.push('=');
        if quotes {
            out.push('"');
            out.push_str(&value.replace('\\', "\\\\").replace('"', "\\\""));
            out.push('"');
        } else {
            out.push_str(value);
        }
        if comma {
            out.push_str(", ");
        }
    };
    match p.get("userhash") {
        Some(userhash) if userhash == "true" => {
            pair("username", &hash(&format!("{user}:{realm}")), true, true);
            pair("userhash", userhash, false, true);
        }
        _ if !user.is_ascii() => pair("username*", &encode_5987(user), false, true),
        _ => pair("username", user, true, true),
    }
    pair("realm", realm, true, true);
    pair("nonce", nonce, true, true);
    pair("uri", "/", true, true);
    let offered = p.get("qop");
    let mut qop = "auth";
    if let Some(offered) = offered
        && let Some(at) = offered.find("auth-int")
        && offered.find("auth") == Some(at)
        && !offered[at + "auth-int".len()..].contains("auth")
    {
        qop = "auth-int";
    }
    let cnonce = random_alphanumeric(16)?;
    let mut a1 = format!("{user}:{realm}:{password}");
    if algorithm.len() >= 4 && algorithm[algorithm.len() - 4..].eq_ignore_ascii_case("sess") {
        a1 = format!("{}:{nonce}:{cnonce}", hash(&a1));
    }
    let mut a2 = "CONNECT:/".to_owned();
    if qop == "auth-int" {
        // A CONNECT has no content.
        a2 = format!("{a2}:{}", hash(""));
    }
    let response = if offered.is_some() {
        hash(&format!(
            "{}:{nonce}:00000001:{cnonce}:{qop}:{}",
            hash(&a1),
            hash(&a2)
        ))
    } else {
        hash(&format!("{}:{nonce}:{}", hash(&a1), hash(&a2)))
    };
    let has_qop = offered.is_some();
    pair(
        "response",
        &response,
        true,
        opaque.is_some() || specified.is_some() || has_qop,
    );
    if let Some(opaque) = opaque {
        pair("opaque", opaque, true, specified.is_some() || has_qop);
    }
    if specified.is_some() {
        pair("algorithm", &algorithm, false, has_qop);
    }
    if has_qop {
        pair("qop", qop, false, true);
        pair("nc", "00000001", false, true);
        pair("cnonce", &cnonce, true, false);
    }
    Some(out)
}

/// HeaderUtilities.Encode5987: utf-8'' and the attr-chars, anything else
/// as %XX.
fn encode_5987(s: &str) -> String {
    const ATTR: &[u8] =
        b"!#$&+-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ^_`abcdefghijklmnopqrstuvwxyz|~";
    let mut out = String::from("utf-8''");
    for &b in s.as_bytes() {
        if ATTR.contains(&b) {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// GetRandomAlphaNumericString: n chars drawn evenly from the 62 letters
/// and digits (bytes of 248 and above are drawn again).
fn random_alphanumeric(n: usize) -> Option<String> {
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let rng = SystemRandom::new();
    let mut out = String::with_capacity(n);
    while out.len() < n {
        let mut byte = [0u8; 1];
        rng.fill(&mut byte).ok()?;
        if usize::from(byte[0]) < 248 {
            out.push(char::from(ALPHABET[usize::from(byte[0]) % ALPHABET.len()]));
        }
    }
    Some(out)
}

/// MD5 (RFC 1321), which Digest needs and no crate here has.
pub(crate) fn md5(input: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64)
        .map(|i: i32| (f64::from(i + 1).sin().abs() * 4_294_967_296.0) as u32)
        .collect();
    let mut message = input.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&((input.len() as u64).wrapping_mul(8)).to_le_bytes());
    let (mut a0, mut b0, mut c0, mut d0) = (
        0x6745_2301u32,
        0xefcd_ab89u32,
        0x98ba_dcfeu32,
        0x1032_5476u32,
    );
    for chunk in message.chunks(64) {
        let m: Vec<u32> = chunk
            .chunks(4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(m[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(f.rotate_left(S[i]));
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    let mut out = [0u8; 16];
    for (i, word) in [a0, b0, c0, d0].iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out
}
