use std::net::{IpAddr, Ipv6Addr};

use unicode_normalization::UnicodeNormalization;

use crate::ip::{
    all_digits, digit_value, format_ipv6_groups, is_loopback, parse_ipv4, parse_ipv6_text,
};

/// The part of System.Uri the server reads. Only http and https are parsed
/// field by field; any other scheme sets `scheme` alone, which is all the
/// callers need to refuse it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Uri {
    pub scheme: String,
    /// Uri.Host: lowercase ASCII, Unicode kept, IPv6 in brackets.
    pub host: String,
    /// Uri.IdnHost: punycode, IPv6 without brackets.
    pub idn_host: String,
    /// Set, and `idn_host` empty, where reading Uri.IdnHost throws:
    /// TryCreate takes the name but ICU refuses it.
    pub idn_host_throws: bool,
    /// Uri.HostNameType: "Dns", "IPv4", "IPv6" or "Basic".
    pub host_type: String,
    pub user_info: String,
    pub port: u16,
    /// Escaped, as .NET returns them.
    pub absolute_path: String,
    pub query: String,
    pub fragment: String,
    pub absolute_uri: String,
    pub loopback: bool,
    authority: String,
}

impl Uri {
    fn with_scheme(scheme: &str) -> Uri {
        Uri {
            scheme: scheme.to_string(),
            ..Uri::default()
        }
    }

    /// Whether the scheme is http or https.
    pub fn is_http(&self) -> bool {
        self.scheme == "http" || self.scheme == "https"
    }
}

/// Uri.TryCreate(s, UriKind.Absolute).
pub fn parse_absolute_uri(s: &str) -> Option<Uri> {
    let s = trim_uri_whitespace(s);
    if s.starts_with('/') || s.starts_with('\\') {
        // .NET reads these as implicit file paths.
        return Some(Uri::with_scheme("file"));
    }
    let (scheme, rest) = split_scheme(s)?;
    if scheme != "http" && scheme != "https" {
        return Some(Uri::with_scheme(&scheme));
    }
    if !two_slashes(rest) {
        return None;
    }
    parse_hierarchical(&scheme, &rest[2..])
}

/// Whether `s` starts with two of `/` and `\`, in any mix, which .NET
/// reads as "//" after an http scheme.
fn two_slashes(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2 && matches!(b[0], b'/' | b'\\') && matches!(b[1], b'/' | b'\\')
}

/// Uri.TryCreate(base, reference) for an http(s) base.
pub fn resolve_uri(base: &Uri, reference: &str) -> Option<Uri> {
    let mut reference = trim_uri_whitespace(reference);
    if reference.starts_with("\\\\") {
        return Some(Uri::with_scheme("file"));
    }
    if let Some((scheme, rest)) = split_scheme(reference) {
        if scheme != base.scheme || two_slashes(rest) {
            return parse_absolute_uri(reference);
        }
        // "http:x" against an http base is relative, as in .NET.
        reference = rest;
    }
    let prefix = format!("{}://{}", base.scheme, base.authority);
    let (path, query) = (&base.absolute_path, &base.query);
    // "\/x" names a host as "//x" does; "/\x" is a path.
    if reference.starts_with("//") || reference.starts_with("\\/") {
        return parse_absolute_uri(&format!("{}:{reference}", base.scheme));
    }
    match reference.as_bytes().first() {
        None => parse_absolute_uri(&format!("{prefix}{path}{query}")),
        Some(b'#') => parse_absolute_uri(&format!("{prefix}{path}{query}{reference}")),
        Some(b'?') => parse_absolute_uri(&format!("{prefix}{path}{reference}")),
        Some(b'/' | b'\\') => parse_absolute_uri(&format!("{prefix}/{}", &reference[1..])),
        Some(_) => {
            let directory = &path[..path.rfind('/').map_or(0, |at| at + 1)];
            parse_absolute_uri(&format!("{prefix}{directory}{reference}"))
        }
    }
}

/// What .NET trims: space, tab, CR and LF. Other controls stay and are
/// escaped, or refuse a scheme they start.
fn trim_uri_whitespace(s: &str) -> &str {
    s.trim_matches([' ', '\t', '\r', '\n'])
}

fn split_scheme(s: &str) -> Option<(String, &str)> {
    let colon = s.find(':').filter(|&colon| colon >= 1)?;
    for (i, c) in s[..colon].bytes().enumerate() {
        let letter = c.is_ascii_alphabetic();
        if !letter && (i == 0 || !(c.is_ascii_digit() || c == b'+' || c == b'-' || c == b'.')) {
            return None;
        }
    }
    Some((s[..colon].to_ascii_lowercase(), &s[colon + 1..]))
}

fn parse_hierarchical(scheme: &str, s: &str) -> Option<Uri> {
    let end = s.find(['/', '?', '#', '\\']).unwrap_or(s.len());
    let (mut authority, mut rest) = (&s[..end], s[end..].to_string());
    // A backslash right after the authority is refused: .NET tries it as
    // part of a Basic host, which http does not allow.
    if rest.starts_with('\\') {
        return None;
    }
    let mut u = Uri::with_scheme(scheme);
    if let Some(at) = authority.rfind('@') {
        u.user_info = authority[..at].to_string();
        if u.user_info.contains('@') {
            return None;
        }
        authority = &authority[at + 1..];
    }
    let (host_text, mut port_text, mut ok) = split_host_port(authority);
    if host_text.starts_with('[')
        && host_text.len() < authority.len()
        && authority.as_bytes()[host_text.len()] != b':'
    {
        // .NET reads text right after "]" as the start of the path.
        rest = format!("/{}{rest}", &authority[host_text.len()..]);
        (port_text, ok) = ("", true);
    }
    if !ok || !u.read_host(host_text) {
        return None;
    }
    let default_port = if scheme == "https" { 443 } else { 80 };
    u.port = default_port;
    if !port_text.is_empty() {
        if !all_digits(port_text) {
            return None;
        }
        u.port = port_text.parse().ok()?;
    }

    let path_end = rest.find(['?', '#']).unwrap_or(rest.len());
    let mut path = rest[..path_end].replace('\\', "/");
    let mut rest = &rest[path_end..];
    if rest.starts_with('?') {
        let end = rest.find('#').unwrap_or(rest.len());
        u.query = escape_component(&rest[..end]);
        rest = &rest[end..];
    }
    if rest.starts_with('#') {
        u.fragment = escape_component(rest);
    }
    if path.is_empty() {
        path = "/".into();
    }
    u.absolute_path = remove_dot_segments(&escape_component(&path));

    u.authority = u.host.clone();
    if u.port != default_port {
        u.authority += &format!(":{}", u.port);
    }
    let user_info = if u.user_info.is_empty() {
        String::new()
    } else {
        format!("{}@", u.user_info)
    };
    u.absolute_uri = format!(
        "{scheme}://{user_info}{}{}{}{}",
        u.authority, u.absolute_path, u.query, u.fragment
    );
    u.authority = user_info + &u.authority;
    Some(u)
}

/// The host, the port text and whether the split worked.
fn split_host_port(authority: &str) -> (&str, &str, bool) {
    if authority.starts_with('[') {
        let Some(end) = authority.find(']') else {
            return ("", "", false);
        };
        let (host, rest) = (&authority[..=end], &authority[end + 1..]);
        return match rest.strip_prefix(':') {
            Some(port) => (host, port, true),
            None => (host, "", rest.is_empty()),
        };
    }
    let Some(colon) = authority.find(':') else {
        return (authority, "", true);
    };
    if authority[colon + 1..].contains(':') {
        return ("", "", false);
    }
    (&authority[..colon], &authority[colon + 1..], true)
}

impl Uri {
    fn read_host(&mut self, host: &str) -> bool {
        if host.is_empty() {
            return false;
        }
        if host.starts_with('[') {
            let mut inner = &host[1..host.len() - 1];
            let mut zone = "";
            if let Some(i) = inner.find('%') {
                (inner, zone) = (&inner[..i], &inner[i..]);
            }
            let Some(address) = parse_ipv6_text(inner) else {
                return false;
            };
            let text = format_ipv6(address);
            self.host = format!("[{text}]");
            self.idn_host = format!("{text}{zone}");
            self.host_type = "IPv6".into();
            self.loopback = is_loopback(IpAddr::V6(address));
            return true;
        }
        if let Some(address) = parse_ipv4(host) {
            self.host = address.to_string();
            self.idn_host = address.to_string();
            self.host_type = "IPv4".into();
            self.loopback = is_loopback(IpAddr::V4(address));
            return true;
        }
        if is_iri_dns_name(host) {
            self.host_type = "Dns".into();
            let host = if host.is_ascii() {
                host.to_string()
            } else {
                strip_bidi_controls(host).nfc().collect()
            };
            (self.host, self.loopback) = canonical_name(&host);
            match idn_equivalent(&self.host) {
                Some(idn) => self.idn_host = idn,
                None => self.idn_host_throws = true,
            }
        } else if host.encode_utf16().count() <= MAX_UNC_NAME_UNITS && is_unc_name(host) {
            // A UNC name, which HostNameType reports as Basic. IdnHost is Host.
            self.host_type = "Basic".into();
            (self.host, self.loopback) = canonical_name(host);
            self.idn_host = self.host.clone();
        } else {
            return false;
        }
        true
    }
}

/// .NET's UncNameHelper.MaximumInternetNameLength, in UTF-16 units. A
/// longer name that is not a DNS name is refused, so no long label reaches
/// punycode.
const MAX_UNC_NAME_UNITS: usize = 256;

const IRI_DOTS: [char; 4] = ['.', '\u{3002}', '\u{ff0e}', '\u{ff61}'];

/// DomainNameHelper.IsValid(iri: true): no ASCII but letters, digits, '-',
/// '_' and '.', nothing in U+0080..U+009F, and labels split by any IRI dot,
/// each starting with an ASCII letter or digit or a char from U+00A0 up, 1
/// to 63 long. A non-ASCII label counts "xn--" and two units for each UTF-16
/// unit above U+00FF. Only a last label may be empty.
fn is_iri_dns_name(host: &str) -> bool {
    let bad = |c: char| {
        c.is_ascii() && !(c == '-' || c == '.' || c == '_' || c.is_ascii_alphanumeric())
            || ('\u{80}'..='\u{9f}').contains(&c)
    };
    if host.chars().any(bad) {
        return false;
    }
    let mut rest = host;
    loop {
        let (label, next) = match rest.find(IRI_DOTS) {
            Some(end) => {
                let dot = rest[end..].chars().next().map_or(1, char::len_utf8);
                (&rest[..end], Some(&rest[end + dot..]))
            }
            None => (rest, None),
        };
        let Some(first) = label.chars().next() else {
            return false;
        };
        if first < '\u{a0}' && !first.is_ascii_alphanumeric() {
            return false;
        }
        let mut length: usize = label
            .chars()
            .map(|c| match u32::from(c) {
                0..0x100 => 1,
                0x100..0x10000 => 2,
                _ => 4,
            })
            .sum();
        if !label.is_ascii() {
            length += 4;
        }
        if length > 63 {
            return false;
        }
        match next {
            None | Some("") => return true,
            Some(next) => rest = next,
        }
    }
}

/// UncNameHelper.IsValid, step for step: letters, ASCII digits, '-' and
/// '_' between dots. The first label may start with '-' or '_' but not be
/// all digits; a '.' then needs the label before it to have a letter or
/// digit, so the second label may start with '-' too. A trailing dot is
/// fine. char.IsLetter reads UTF-16 units: a char above U+FFFF is no letter.
fn is_unc_name(host: &str) -> bool {
    let adapter = idna_adapter::Adapter::new();
    // Letter is Alphabetic without its marks, numbers and circled letters.
    let letter = |c: char| {
        u32::from(c) <= 0xffff
            && c.is_alphabetic()
            && !c.is_numeric()
            && !adapter.is_mark(c)
            && !('\u{24b6}'..='\u{24e9}').contains(&c)
    };
    let mut chars = host.chars();
    let mut valid = false;
    let mut previous = '\0';
    for c in chars.by_ref() {
        previous = c;
        if c == '.' {
            break;
        }
        if letter(c) || c == '-' || c == '_' {
            valid = true;
        } else if !c.is_ascii_digit() {
            return false;
        }
    }
    if !valid {
        return false;
    }
    for c in chars {
        match c {
            '.' => {
                if !valid || previous == '.' {
                    return false;
                }
                valid = false;
            }
            '-' | '_' => {
                if !valid {
                    return false;
                }
            }
            _ if letter(c) || c.is_ascii_digit() => valid = true,
            _ => return false,
        }
        previous = c;
    }
    valid || previous == '.'
}

/// DomainNameHelper.ParseCanonicalName: "localhost" and "loopback" read as
/// localhost, and the whole name is lowercased only when it holds an ASCII
/// capital.
fn canonical_name(host: &str) -> (String, bool) {
    let upper = host.bytes().any(|b| b.is_ascii_uppercase());
    let folded = host.to_ascii_lowercase();
    if host == "localhost"
        || host == "loopback"
        || upper && (folded == "localhost" || folded == "loopback")
    {
        return ("localhost".into(), true);
    }
    if upper {
        return (host.chars().map(lower_invariant).collect(), false);
    }
    (host.to_string(), false)
}

/// char.ToLowerInvariant: one char to one char, and U+0130 (İ) kept.
fn lower_invariant(c: char) -> char {
    if c == '\u{130}' {
        return c;
    }
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

/// DomainNameHelper.IdnEquivalent: ICU's UTS 46 ToASCII, None where it
/// throws, as it does for an answer holding a URL delimiter.
fn idn_equivalent(host: &str) -> Option<String> {
    if host.is_ascii() {
        return Some(host.to_ascii_lowercase());
    }
    let ascii = crate::idna::to_ascii(&strip_bidi_controls(host))?;
    if ascii.contains(['\\', '/', '?', '@', '#', ':', '[', ']']) {
        return None;
    }
    Some(ascii)
}

/// UriHelper.StripBidiControlCharacters: U+200E..U+202E but U+2010..U+2029.
fn strip_bidi_controls(s: &str) -> String {
    s.chars()
        .filter(|&c| {
            !(('\u{200e}'..='\u{202e}').contains(&c) && !('\u{2010}'..='\u{2029}').contains(&c))
        })
        .collect()
}

/// Writes an IPv4-mapped or IPv4-compatible address with a dotted tail, as
/// .NET does.
fn format_ipv6(address: Ipv6Addr) -> String {
    let b = address.octets();
    let zero = b[..10].iter().all(|&v| v == 0);
    let mapped = b[10] == 0xff && b[11] == 0xff;
    let compatible = b[10] == 0 && b[11] == 0 && (b[12] != 0 || b[13] != 0);
    if zero && (mapped || compatible) {
        let prefix = if mapped { "::ffff:" } else { "::" };
        return format!("{prefix}{}.{}.{}.{}", b[12], b[13], b[14], b[15]);
    }
    format_ipv6_groups(address)
}

const UPPER_HEX: &[u8; 16] = b"0123456789ABCDEF";

fn push_escaped(out: &mut String, c: u8) {
    out.push('%');
    out.push(char::from(UPPER_HEX[usize::from(c >> 4)]));
    out.push(char::from(UPPER_HEX[usize::from(c & 15)]));
}

fn is_hex(c: u8) -> bool {
    digit_value(c).is_some()
}

fn unhex(c: u8) -> u8 {
    digit_value(c).unwrap_or(0) as u8
}

/// Escapes what .NET escapes in a path, query or fragment, decodes escaped
/// unreserved characters, and keeps other escapes as sent.
fn escape_component(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'%' {
            if i + 2 < b.len() && is_hex(b[i + 1]) && is_hex(b[i + 2]) {
                let decoded = unhex(b[i + 1]) << 4 | unhex(b[i + 2]);
                if is_unreserved(decoded) {
                    out.push(char::from(decoded));
                } else {
                    out.push_str(&s[i..i + 3]);
                }
                i += 3;
                continue;
            }
            out.push_str("%25");
            i += 1;
            continue;
        }
        // Every byte of a non-ASCII char is escaped; a &str holds no invalid
        // UTF-8, which Go escapes as U+FFFD.
        if c >= 0x80 || c <= 0x20 || c == 0x7f || b"\"<>^`{|}\\".contains(&c) {
            push_escaped(&mut out, c);
        } else {
            out.push(char::from(c));
        }
        i += 1;
    }
    out
}

fn is_unreserved(c: u8) -> bool {
    c == b'-' || c == b'.' || c == b'_' || c == b'~' || c.is_ascii_alphanumeric()
}

/// RFC 3986 section 5.2.4; ".." stops at the root.
fn remove_dot_segments(path: &str) -> String {
    let parts: Vec<&str> = path[1..].split('/').collect();
    let mut out: Vec<&str> = Vec::with_capacity(parts.len());
    for (i, &part) in parts.iter().enumerate() {
        let last = i == parts.len() - 1;
        match part {
            "." => {
                if last {
                    out.push("");
                }
            }
            ".." => {
                out.pop();
                if last {
                    out.push("");
                }
            }
            _ => out.push(part),
        }
    }
    format!("/{}", out.join("/"))
}

/// Uri.UnescapeDataString: escapes that form valid UTF-8 are decoded, and
/// any other escape is kept as written.
pub fn unescape_data_string(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let escape_at =
        |i: usize| i + 2 < b.len() && b[i] == b'%' && is_hex(b[i + 1]) && is_hex(b[i + 2]);
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if !escape_at(i) {
            out.push(b[i]);
            i += 1;
            continue;
        }
        // Gather the run of escapes, then decode it as UTF-8.
        let start = i;
        let mut raw = Vec::new();
        while escape_at(i) {
            raw.push(unhex(b[i + 1]) << 4 | unhex(b[i + 2]));
            i += 3;
        }
        let mut j = 0;
        while j < raw.len() {
            match crate::ordinal::decode_rune(&raw[j..]) {
                (Some(c), size) => {
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                    j += size;
                }
                (None, _) => {
                    out.extend_from_slice(&b[start + 3 * j..start + 3 * j + 3]);
                    j += 1;
                }
            }
        }
    }
    String::from_utf8(out).expect("valid UTF-8 in, decoded UTF-8 and ASCII escapes out")
}
