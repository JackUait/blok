use std::collections::HashSet;

use blok_dotnet::parse_absolute_uri;

pub const ALLOWED: &str = "allowed";
pub const BLOCKED: &str = "blocked";
pub const INSECURE: &str = "insecure";
pub const UNKNOWN: &str = "unknown";

/// One response header line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Origin {
    scheme: String,
    host: String,
    domain: bool,
    /// 0 when it is the scheme's default, like a URL's null port.
    port: i32,
}

fn parse_origin(raw: &str) -> Option<Origin> {
    let u = parse_absolute_uri(raw)?;
    if !u.is_http() || u.idn_host.is_empty() || !u.user_info.is_empty() {
        return None;
    }
    let mut o = Origin {
        host: u.idn_host.to_ascii_lowercase(),
        domain: u.host_type == "Dns",
        port: i32::from(u.port),
        scheme: u.scheme,
    };
    if o.port == default_port(&o.scheme) {
        o.port = 0;
    }
    Some(o)
}

fn default_port(scheme: &str) -> i32 {
    match scheme {
        "http" | "ws" => 80,
        "https" | "wss" => 443,
        _ => -1,
    }
}

/// Rates `final_url` for an embedder origin ("" when unknown). Precedence:
/// blocked, then insecure (`final_url` is not https), then unknown (no
/// embedder), then allowed. Blocked comes first so a refusal shows even on
/// an http page.
pub fn verdict(final_url: &str, embedder: &str, headers: &[Header]) -> &'static str {
    let Some(this) = parse_origin(final_url) else {
        return UNKNOWN;
    };
    let ancestor = parse_origin(embedder);
    if let Some(ancestor) = &ancestor
        && blocked(&this, ancestor, headers)
    {
        return BLOCKED;
    }
    if this.scheme != "https" {
        return INSECURE;
    }
    if ancestor.is_none() {
        return UNKNOWN;
    }
    ALLOWED
}

fn blocked(this: &Origin, ancestor: &Origin, headers: &[Header]) -> bool {
    let mut saw_frame_ancestors = false;
    for h in headers {
        if !h.name.eq_ignore_ascii_case("Content-Security-Policy") {
            continue;
        }
        // Report-only policies never block, so only enforced ones are read.
        for serialized in h.value.split(',') {
            let Some(sources) = frame_ancestors(serialized) else {
                continue;
            };
            saw_frame_ancestors = true;
            if !matches_source_list(ancestor, &sources, this) {
                return true;
            }
        }
    }
    if saw_frame_ancestors {
        return false;
    }
    x_frame_options_blocks(this, ancestor, headers)
}

fn is_ascii_whitespace(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{c}' | '\r' | ' ')
}

/// CSP3 "parse a serialized CSP", keeping only the first frame-ancestors
/// directive.
fn frame_ancestors(serialized: &str) -> Option<Vec<&str>> {
    let mut seen = HashSet::new();
    for token in serialized.split(';') {
        let token = token.trim_matches(is_ascii_whitespace);
        if token.is_empty() || !token.is_ascii() {
            continue;
        }
        let mut fields = token.split(is_ascii_whitespace).filter(|f| !f.is_empty());
        let name = fields.next().unwrap_or_default().to_ascii_lowercase();
        if !seen.insert(name.clone()) {
            continue;
        }
        if name == "frame-ancestors" {
            return Some(fields.collect());
        }
    }
    None
}

/// CSP3 §6.7.2.7 with a redirect count of 0.
fn matches_source_list(u: &Origin, sources: &[&str], this: &Origin) -> bool {
    if sources.is_empty() || sources.len() == 1 && sources[0].eq_ignore_ascii_case("'none'") {
        return false;
    }
    sources
        .iter()
        .any(|expression| matches_expression(u, expression, this))
}

fn is_scheme(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b[0].is_ascii_alphabetic()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || b"+.-".contains(c))
}

struct HostSource<'a> {
    scheme: &'a str,
    host: &'a str,
    port: &'a str,
    path: &'a str,
}

fn is_label_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-'
}

/// The CSP3 host-source grammar:
/// [scheme "://"] ("*" | ["*."] label *("." label) ["."]) [":" (digits | "*")] [path-abempty].
fn host_source(expression: &str) -> Option<HostSource<'_>> {
    let (scheme, rest) = match expression.find("://") {
        Some(i) if is_scheme(&expression[..i]) => (&expression[..i], &expression[i + 3..]),
        Some(_) => return None,
        None => ("", expression),
    };
    let b = rest.as_bytes();
    let mut i = 0;
    if rest.starts_with("*.") {
        i = 2;
    } else if rest.starts_with('*') {
        i = 1;
    }
    if i != 1 {
        let start = i;
        while i < b.len() && is_label_char(b[i]) {
            i += 1;
        }
        if i == start {
            return None;
        }
        while i + 1 < b.len() && b[i] == b'.' && is_label_char(b[i + 1]) {
            i += 1;
            while i < b.len() && is_label_char(b[i]) {
                i += 1;
            }
        }
        if i < b.len() && b[i] == b'.' {
            i += 1;
        }
    }
    let host = &rest[..i];
    let mut port = "";
    if i < b.len() && b[i] == b':' {
        let start = i + 1;
        let mut end = start;
        if b.get(start) == Some(&b'*') {
            end += 1;
        } else {
            while end < b.len() && b[end].is_ascii_digit() {
                end += 1;
            }
        }
        if end == start {
            return None;
        }
        port = &rest[start..end];
        i = end;
    }
    let path = &rest[i..];
    if !path.is_empty() && !valid_path(path) {
        return None;
    }
    Some(HostSource {
        scheme,
        host,
        port,
        path,
    })
}

/// "/" [segment-nz *("/" segment)], with pchar = unreserved / sub-delims
/// without "," and ";" / ":" / "@" / pct-encoded.
fn valid_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix('/') else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    for (index, segment) in rest.split('/').enumerate() {
        if index == 0 && segment.is_empty() {
            return false;
        }
        let b = segment.as_bytes();
        let mut i = 0;
        while i < b.len() {
            let c = b[i];
            if c == b'%' {
                if !(b.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
                    && b.get(i + 2).is_some_and(u8::is_ascii_hexdigit))
                {
                    return false;
                }
                i += 3;
                continue;
            }
            if !(c.is_ascii_alphanumeric() || b"-._~!$&'()*+=:@".contains(&c)) {
                return false;
            }
            i += 1;
        }
    }
    true
}

/// CSP3 §6.7.2.8 for an ancestor origin `u`.
fn matches_expression(u: &Origin, expression: &str, this: &Origin) -> bool {
    if expression == "*" {
        return u.scheme == "http" || u.scheme == "https" || u.scheme == this.scheme;
    }
    if let Some(scheme) = expression.strip_suffix(':')
        && is_scheme(scheme)
    {
        return scheme_part_matches(scheme, &u.scheme);
    }
    if let Some(source) = host_source(expression) {
        if !source.scheme.is_empty() && !scheme_part_matches(source.scheme, &u.scheme) {
            return false;
        }
        if source.scheme.is_empty() && !scheme_part_matches(&this.scheme, &u.scheme) {
            return false;
        }
        if !host_part_matches(source.host, u) || !port_part_matches(source.port, u) {
            return false;
        }
        // An origin's URL path serializes as "/".
        return source.path.is_empty() || path_part_matches(source.path, "/");
    }
    if expression.eq_ignore_ascii_case("'self'") {
        if this == u {
            return true;
        }
        return this.host == u.host
            && this.port == u.port
            && (u.scheme == "https" || this.scheme == "http" && u.scheme == "http");
    }
    false
}

fn scheme_part_matches(a: &str, b: &str) -> bool {
    let (a, b) = (a.to_ascii_lowercase(), b.to_ascii_lowercase());
    if a == b {
        return true;
    }
    match a.as_str() {
        "http" => b == "https",
        "ws" => b == "wss" || b == "http" || b == "https",
        "wss" => b == "https",
        _ => false,
    }
}

fn host_part_matches(pattern: &str, u: &Origin) -> bool {
    if !u.domain {
        return false;
    }
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return u.host.ends_with(&suffix.to_ascii_lowercase());
    }
    pattern.to_ascii_lowercase() == u.host
}

fn port_part_matches(input: &str, u: &Origin) -> bool {
    if input == "*" {
        return true;
    }
    if input.is_empty() {
        return u.port == 0;
    }
    let trimmed = input.trim_start_matches('0');
    if trimmed.len() > 5 {
        return false;
    }
    let want: i32 = format!("0{trimmed}").parse().unwrap();
    if want == u.port {
        return true;
    }
    u.port == 0 && want == default_port(&u.scheme)
}

fn path_part_matches(a: &str, b: &str) -> bool {
    if a.is_empty() || a == "/" && b.is_empty() {
        return true;
    }
    let exact = !a.ends_with('/');
    let mut list_a: Vec<&str> = a.split('/').collect();
    let list_b: Vec<&str> = b.split('/').collect();
    if list_a.len() > list_b.len() || exact && list_a.len() != list_b.len() {
        return false;
    }
    if !exact {
        list_a.pop();
    }
    list_a
        .iter()
        .zip(&list_b)
        .all(|(x, y)| percent_decode(x) == percent_decode(y))
}

/// url.PathUnescape, or the input itself when an escape is bad.
fn percent_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = |c: Option<&u8>| c.and_then(|c| (*c as char).to_digit(16));
            match (hex(b.get(i + 1)), hex(b.get(i + 2))) {
                (Some(hi), Some(lo)) => {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                _ => return b.to_vec(),
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// HTML's X-Frame-Options check with one ancestor.
fn x_frame_options_blocks(this: &Origin, ancestor: &Origin, headers: &[Header]) -> bool {
    let lines: Vec<&str> = headers
        .iter()
        .filter(|h| h.name.eq_ignore_ascii_case("X-Frame-Options"))
        .map(|h| h.value.as_str())
        .collect();
    if lines.is_empty() {
        return false;
    }
    let mut set = HashSet::new();
    let mut first = String::new();
    for value in get_decode_split(&lines.join(", ")) {
        let value = value.to_ascii_lowercase();
        if set.is_empty() {
            first = value.clone();
        }
        set.insert(value);
    }
    if set.len() > 1 {
        return set.contains("deny") || set.contains("allowall") || set.contains("sameorigin");
    }
    match first.as_str() {
        "deny" => true,
        "sameorigin" => this != ancestor,
        _ => false,
    }
}

/// Fetch's "get, decode, and split" over a combined value.
fn get_decode_split(input: &str) -> Vec<String> {
    let b = input.as_bytes();
    let mut values = Vec::new();
    let mut position = 0;
    let mut temporary: Vec<u8> = Vec::new();
    loop {
        while position < b.len() && b[position] != b'"' && b[position] != b',' {
            temporary.push(b[position]);
            position += 1;
        }
        if position < b.len() && b[position] == b'"' {
            let start = position;
            position += 1;
            while position < b.len() {
                let c = b[position];
                position += 1;
                if c == b'\\' {
                    if position < b.len() {
                        position += 1;
                    }
                    continue;
                }
                if c == b'"' {
                    break;
                }
            }
            temporary.extend_from_slice(&b[start..position]);
            if position < b.len() {
                continue;
            }
        }
        let text = String::from_utf8_lossy(&temporary).into_owned();
        values.push(text.trim_matches(['\t', ' ']).to_owned());
        temporary.clear();
        if position >= b.len() {
            return values;
        }
        position += 1;
    }
}
