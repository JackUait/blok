use std::net::{IpAddr, Ipv6Addr};

use idna::uts46::{AsciiDenyList, DnsLength, Hyphens, Uts46};

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
    /// "Dns", "IPv4" or "IPv6".
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
    parse_hierarchical(&scheme, rest.strip_prefix("//")?)
}

/// Uri.TryCreate(base, reference) for an http(s) base.
pub fn resolve_uri(base: &Uri, reference: &str) -> Option<Uri> {
    let mut reference = trim_uri_whitespace(reference);
    if reference.starts_with("\\\\") {
        return Some(Uri::with_scheme("file"));
    }
    if let Some((scheme, rest)) = split_scheme(reference) {
        if scheme != base.scheme || rest.starts_with("//") {
            return parse_absolute_uri(reference);
        }
        // "http:x" against an http base is relative, as in .NET.
        reference = rest;
    }
    let prefix = format!("{}://{}", base.scheme, base.authority);
    let (path, query) = (&base.absolute_path, &base.query);
    if reference.starts_with("//") || reference.starts_with("\\\\") {
        return parse_absolute_uri(&format!("{}:{reference}", base.scheme));
    }
    match reference.as_bytes().first() {
        None => parse_absolute_uri(&format!("{prefix}{path}{query}")),
        Some(b'#') => parse_absolute_uri(&format!("{prefix}{path}{query}{reference}")),
        Some(b'?') => parse_absolute_uri(&format!("{prefix}{path}{reference}")),
        Some(b'/' | b'\\') => parse_absolute_uri(&format!("{prefix}{reference}")),
        Some(_) => {
            let directory = &path[..path.rfind('/').map_or(0, |at| at + 1)];
            parse_absolute_uri(&format!("{prefix}{directory}{reference}"))
        }
    }
}

fn trim_uri_whitespace(s: &str) -> &str {
    s.trim_matches(|c: char| c <= ' ')
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
    // A backslash ends the authority only when no '@' follows it there: .NET
    // refuses "host\@other" rather than reading "other" as the host.
    if rest.starts_with('\\') {
        let tail = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
        if tail.contains('@') {
            return None;
        }
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
        if host.contains("..") {
            return false;
        }
        let allowed = |c: char| c == '-' || c == '.' || c == '_' || c.is_ascii_alphanumeric();
        if host.chars().any(|c| c.is_ascii() && !allowed(c)) {
            return false;
        }
        self.host = host.to_ascii_lowercase();
        self.host_type = "Dns".into();
        self.idn_host = self.host.clone();
        if !host.is_ascii() {
            match idn_to_ascii(host) {
                Some(idn) => self.idn_host = idn,
                None => return false,
            }
        }
        self.loopback = self.host == "localhost";
        true
    }
}

/// Go's idna.New(MapForLookup(), StrictDomainName(false),
/// VerifyDNSLength(false)): UTS 46 nontransitional, no STD3 deny list, with
/// CheckHyphens. Only the fixture's accepting cases are pinned.
fn idn_to_ascii(host: &str) -> Option<String> {
    Uts46::new()
        .to_ascii(
            host.as_bytes(),
            AsciiDenyList::EMPTY,
            Hyphens::Check,
            DnsLength::Ignore,
        )
        .ok()
        .map(|cow| cow.into_owned())
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
