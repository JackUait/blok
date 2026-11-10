//! Kestrel's request head: the request line, the header block, its limits
//! and its grammar, as measured on the C# host (Kestrel 10, default limits).

use std::fmt::Write as _;

use crate::headers::Headers;

/// The request line counts its line end.
pub(crate) const MAX_REQUEST_LINE: usize = 8 << 10;
/// Every byte after the request line, blank line included.
pub(crate) const MAX_HEADER_BLOCK: usize = (32 << 10) + 2;
/// Header lines, Host included.
pub(crate) const MAX_HEADER_COUNT: usize = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Version {
    Http10,
    Http11,
}

/// RFC 9112 section 3.2 request-target forms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetForm {
    /// "/path?query"
    Origin,
    /// "http://host/path?query"
    Absolute,
    /// "host:port", CONNECT only.
    Authority,
    /// "*", OPTIONS only.
    Asterisk,
}

#[derive(Debug)]
pub(crate) struct Head {
    pub method: String,
    pub target: String,
    pub form: TargetForm,
    pub path: String,
    pub query: String,
    pub version: Version,
    pub headers: Headers,
    /// Bytes of the header lines and the blank line: a trailer counts on.
    pub header_bytes: usize,
}

/// Why Kestrel refuses a head. Each is a bare answer and a close.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    Status(u16),
    /// The HTTP/2 prior-knowledge preface: a GOAWAY frame.
    GoAway,
    /// 405 with this Allow value: a target form the method may not use.
    MethodNotAllowed(&'static str),
}

pub(crate) enum Parse {
    Incomplete,
    Done { head: Head, consumed: usize },
    Refused(Refusal),
}

/// What one head's parse has seen so far. A slow head is scanned once: each
/// call resumes where the last stopped.
#[derive(Default)]
pub(crate) struct HeadScan {
    /// Where the request line starts, once a byte other than CR or LF came.
    start: Option<usize>,
    /// Where the next line starts.
    line_start: usize,
    /// How far past line_start holds no LF.
    scanned: usize,
    line: Option<RequestLine>,
    header_bytes: usize,
    headers: Headers,
    host_lines: usize,
    host: String,
}

struct RequestLine {
    method: String,
    target: String,
    version: Version,
    form: TargetForm,
    path: String,
    query: String,
}

const BAD_REQUEST: Refusal = Refusal::Status(400);

impl HeadScan {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Reads the head at the front of buf. CR and LF before the request
    /// line are skipped, as Kestrel skips them; `consumed` counts them.
    /// buf must only grow between calls.
    pub(crate) fn parse(&mut self, buf: &[u8]) -> Parse {
        if self.start.is_none() {
            {
                let skip = buf
                    .iter()
                    .take_while(|&&b| b == b'\r' || b == b'\n')
                    .count();
                if skip == buf.len() {
                    return Parse::Incomplete;
                }
                self.start = Some(skip);
                self.line_start = skip;
            }
        }
        loop {
            let from = self.line_start + self.scanned;
            let found = buf[from..].iter().position(|&b| b == b'\n');
            let pending = buf.len() - self.line_start;
            let Some(offset) = found else {
                self.scanned = pending;
                // A line with no end yet is over the limit once it fills it:
                // its LF would be one byte more.
                if self.line.is_none() && pending >= MAX_REQUEST_LINE {
                    return Parse::Refused(Refusal::Status(414));
                }
                if self.line.is_some() && self.header_bytes + pending >= MAX_HEADER_BLOCK {
                    return Parse::Refused(Refusal::Status(431));
                }
                return Parse::Incomplete;
            };
            let end = from + offset + 1;
            let line = &buf[self.line_start..end];
            // The host turns on Kestrel's DisableHttp1LineFeedTerminators:
            // every head line ends in CRLF.
            if line.len() < 2 || line[line.len() - 2] != b'\r' {
                return Parse::Refused(BAD_REQUEST);
            }
            self.line_start = end;
            self.scanned = 0;
            if self.line.is_none() {
                if line.len() > MAX_REQUEST_LINE {
                    return Parse::Refused(Refusal::Status(414));
                }
                match parse_request_line(content(line)) {
                    Ok(parsed) => self.line = Some(parsed),
                    Err(refusal) => return Parse::Refused(refusal),
                }
                continue;
            }
            self.header_bytes += line.len();
            if self.header_bytes > MAX_HEADER_BLOCK {
                return Parse::Refused(Refusal::Status(431));
            }
            let text = content(line);
            if text.is_empty() {
                return match self.finish() {
                    Ok(head) => Parse::Done {
                        head,
                        consumed: end,
                    },
                    Err(refusal) => Parse::Refused(refusal),
                };
            }
            if self.headers.len() >= MAX_HEADER_COUNT {
                return Parse::Refused(Refusal::Status(431));
            }
            if let Err(refusal) = self.header_line(text) {
                return Parse::Refused(refusal);
            }
        }
    }

    fn header_line(&mut self, line: &[u8]) -> Result<(), Refusal> {
        // obs-fold, or a head that starts with whitespace.
        if line[0] == b' ' || line[0] == b'\t' {
            return Err(BAD_REQUEST);
        }
        let colon = line.iter().position(|&b| b == b':').ok_or(BAD_REQUEST)?;
        let (name, value) = (&line[..colon], &line[colon + 1..]);
        if name.is_empty() || !name.iter().all(|&b| is_name_byte(b)) {
            return Err(BAD_REQUEST);
        }
        let value = trim(value);
        if value.iter().any(|&b| b == 0 || b == b'\r') {
            return Err(BAD_REQUEST);
        }
        let value = std::str::from_utf8(value).map_err(|_| BAD_REQUEST)?;
        // name is ASCII by is_name_byte.
        let name = String::from_utf8_lossy(name).into_owned();
        if name.eq_ignore_ascii_case("host") {
            self.host_lines += 1;
            self.host = value.to_owned();
        }
        self.headers.add(name, value.to_owned());
        Ok(())
    }

    fn finish(&mut self) -> Result<Head, Refusal> {
        let line = self.line.take().ok_or(BAD_REQUEST)?;
        let headers = std::mem::take(&mut self.headers);
        if self.host_lines > 1
            || (self.host_lines == 0 && line.version == Version::Http11)
            || !valid_host(&self.host)
        {
            return Err(BAD_REQUEST);
        }
        let (form, path, query) = (line.form, line.path, line.query);
        match form {
            // Measured: HTTP/1.0 with no Host takes any absolute target.
            TargetForm::Absolute => {
                if self.host_lines > 0 && !absolute_matches_host(&line.target, &self.host) {
                    return Err(BAD_REQUEST);
                }
            }
            TargetForm::Authority => {
                if self.host != line.target {
                    return Err(BAD_REQUEST);
                }
            }
            TargetForm::Origin | TargetForm::Asterisk => {}
        }
        check_framing(&headers)?;
        Ok(Head {
            method: line.method,
            target: line.target,
            form,
            path,
            query,
            version: line.version,
            headers,
            header_bytes: self.header_bytes,
        })
    }
}

/// A line without its LF and one CR before it.
fn content(line: &[u8]) -> &[u8] {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    line.strip_suffix(b"\r").unwrap_or(line)
}

fn trim(value: &[u8]) -> &[u8] {
    let start = value
        .iter()
        .position(|&b| b != b' ' && b != b'\t')
        .unwrap_or(value.len());
    let end = value
        .iter()
        .rposition(|&b| b != b' ' && b != b'\t')
        .map_or(start, |i| i + 1);
    &value[start..end]
}

/// Kestrel takes any name byte but NUL, HT, LF, CR, SP and bytes over 0x7F.
fn is_name_byte(b: u8) -> bool {
    !matches!(b, 0 | b'\t' | b'\n' | b'\r' | b' ') && b < 0x80
}

/// RFC 9110 tchar.
pub(crate) fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b)
}

fn parse_request_line(line: &[u8]) -> Result<RequestLine, Refusal> {
    let space = line.iter().position(|&b| b == b' ').ok_or(BAD_REQUEST)?;
    let method = &line[..space];
    if method.is_empty() || !method.iter().all(|&b| is_token_byte(b)) {
        return Err(BAD_REQUEST);
    }
    let mut offset = space + 1;
    match line.get(offset) {
        None | Some(b' ' | b'?' | b'%') => return Err(BAD_REQUEST),
        Some(_) => {}
    }
    let target_end = line[offset..]
        .iter()
        .position(|&b| b == b' ')
        .map(|i| offset + i)
        .ok_or(BAD_REQUEST)?;
    let target = &line[offset..target_end];
    offset = target_end + 1;
    // Some clients send more than one space before the version.
    while line.get(offset) == Some(&b' ') {
        offset += 1;
    }
    if offset >= line.len() {
        return Err(BAD_REQUEST);
    }
    let version_text = &line[offset..];
    if method == b"PRI" && target == b"*" && version_text == b"HTTP/2.0" {
        return Err(Refusal::GoAway);
    }
    let version = match version_text {
        b"HTTP/1.1" => Version::Http11,
        b"HTTP/1.0" => Version::Http10,
        // Measured: an unknown version of 8 bytes is 505, any other length a
        // malformed line.
        other if other.len() == 8 => return Err(Refusal::Status(505)),
        _ => return Err(BAD_REQUEST),
    };
    if target.iter().any(|&b| b == 0 || b >= 0x80) {
        return Err(BAD_REQUEST);
    }
    // Both are ASCII: tchar, and the checks above.
    let method = String::from_utf8_lossy(method).into_owned();
    let target = String::from_utf8_lossy(target).into_owned();
    // Measured: Kestrel checks the target's form from the request line
    // alone, before any header comes.
    let (form, path, query) = target_form(&method, &target)?;
    Ok(RequestLine {
        method,
        target,
        version,
        form,
        path,
        query,
    })
}

/// The form, then the path and the query (with its '?') Kestrel routes on.
fn target_form(method: &str, target: &str) -> Result<(TargetForm, String, String), Refusal> {
    // Measured: Kestrel refuses a '#' anywhere in a target (since .NET 10.0.15).
    if target.contains('#') {
        return Err(BAD_REQUEST);
    }
    if target.starts_with('/') {
        let (path, query) = split_query(target);
        return Ok((TargetForm::Origin, path.to_owned(), query.to_owned()));
    }
    if target == "*" {
        if method != "OPTIONS" {
            return Err(Refusal::MethodNotAllowed("OPTIONS"));
        }
        return Ok((TargetForm::Asterisk, String::new(), String::new()));
    }
    if let Some(rest) = target
        .strip_prefix("http://")
        .or_else(|| target.strip_prefix("https://"))
    {
        let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
        let (host, _, _) = split_authority(&rest[..authority_end]).ok_or(BAD_REQUEST)?;
        if host.is_empty() || host.contains('%') {
            return Err(BAD_REQUEST);
        }
        let (path, query) = split_query(&rest[authority_end..]);
        let path = if path.is_empty() { "/" } else { path };
        return Ok((TargetForm::Absolute, path.to_owned(), query.to_owned()));
    }
    if method != "CONNECT" {
        // Measured: off CONNECT a byte outside these is a 400, not the 405.
        let plain = |b: u8| b.is_ascii_alphanumeric() || b"-.:@[]".contains(&b);
        if !target.bytes().all(plain) {
            return Err(BAD_REQUEST);
        }
        return Err(Refusal::MethodNotAllowed("CONNECT"));
    }
    if !valid_host(target) {
        return Err(BAD_REQUEST);
    }
    Ok((TargetForm::Authority, String::new(), String::new()))
}

fn split_query(target: &str) -> (&str, &str) {
    match target.find('?') {
        Some(at) => (&target[..at], &target[at..]),
        None => (target, ""),
    }
}

/// An absolute target's authority, without userinfo: host and port text.
fn split_authority(authority: &str) -> Option<(&str, &str, bool)> {
    let authority = match authority.rfind('@') {
        Some(at) => &authority[at + 1..],
        None => authority,
    };
    let (host, port) = if authority.starts_with('[') {
        let end = authority.find(']')?;
        let rest = &authority[end + 1..];
        match rest.strip_prefix(':') {
            Some(port) => (&authority[..=end], port),
            None if rest.is_empty() => (&authority[..=end], ""),
            None => return None,
        }
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host, port),
            None => (authority, ""),
        }
    };
    if !port.bytes().all(|b| b.is_ascii_digit())
        || (!port.is_empty() && port.parse::<u16>().is_err())
    {
        return None;
    }
    Some((host, port, true))
}

/// Kestrel's absolute-form rule: Host must equal the target's authority as
/// System.Uri prints it (host lowered, default port dropped), or that with
/// the default port spelled out.
fn absolute_matches_host(target: &str, host_header: &str) -> bool {
    let (default_port, rest) = match target.strip_prefix("http://") {
        Some(rest) => (80, rest),
        None => (443, target.strip_prefix("https://").unwrap_or(target)),
    };
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let Some((host, port, _)) = split_authority(&rest[..authority_end]) else {
        return false;
    };
    let port = if port.is_empty() {
        default_port
    } else {
        port.parse::<u16>().unwrap_or(0)
    };
    let mut authority = host.to_ascii_lowercase();
    if port != default_port {
        let _ = write!(authority, ":{port}");
    }
    host_header == authority
        || (port == default_port && host_header == format!("{authority}:{default_port}"))
}

/// Kestrel's Host grammar, measured with a byte sweep: an empty value is
/// valid; otherwise a reg-name of these bytes or a bracketed IPv6 literal,
/// then an optional ":digits" port.
pub(crate) fn valid_host(host: &str) -> bool {
    let bytes = host.as_bytes();
    if bytes.is_empty() {
        return true;
    }
    let after = if bytes[0] == b'[' {
        let Some(end) = bytes.iter().position(|&b| b == b']') else {
            return false;
        };
        // Kestrel's IsIPv6HostValid: "[::1]" is the shortest literal it takes.
        if end < 4
            || !bytes[1..end]
                .iter()
                .all(|&b| b.is_ascii_hexdigit() || b == b':' || b == b'.')
        {
            return false;
        }
        end + 1
    } else {
        if bytes[0] == b':' {
            return false;
        }
        bytes
            .iter()
            .position(|&b| !is_host_byte(b))
            .unwrap_or(bytes.len())
    };
    match &bytes[after..] {
        [] => true,
        [b':', port @ ..] => !port.is_empty() && port.iter().all(u8::is_ascii_digit),
        _ => false,
    }
}

fn is_host_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"!$&'()-._~".contains(&b)
}

/// Content-Length and Transfer-Encoding as Kestrel reads them.
fn check_framing(headers: &Headers) -> Result<(), Refusal> {
    let lengths: Vec<&str> = headers.get_all("content-length").collect();
    if lengths.len() > 1 {
        return Err(BAD_REQUEST);
    }
    if let Some(value) = lengths.first()
        && parse_content_length(value).is_none()
    {
        return Err(BAD_REQUEST);
    }
    if headers.contains("transfer-encoding") && !final_coding_is_chunked(headers) {
        return Err(BAD_REQUEST);
    }
    Ok(())
}

/// Measured: one optional '+', or one '-' before zeros only, then decimal
/// digits that fit an i64.
pub(crate) fn parse_content_length(value: &str) -> Option<u64> {
    let (negative, digits) = match value.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, value.strip_prefix('+').unwrap_or(value)),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if negative && !digits.bytes().all(|b| b == b'0') {
        return None;
    }
    digits.parse::<i64>().ok().map(|n| n as u64)
}

/// The last coding, over every Transfer-Encoding line, is "chunked".
/// Kestrel's split: each line trimmed of spaces and tabs, split on commas,
/// each coding trimmed of spaces only, so "gzip,\tchunked" ends in
/// "\tchunked" and is refused.
pub(crate) fn final_coding_is_chunked(headers: &Headers) -> bool {
    headers
        .get_all("transfer-encoding")
        .flat_map(|value| value.trim_matches([' ', '\t']).split(','))
        .map(|coding| coding.trim_matches(' '))
        .filter(|coding| !coding.is_empty())
        .last()
        .is_some_and(|coding| coding.eq_ignore_ascii_case("chunked"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "ok" or the refusal, for a head read whole.
    fn verdict(input: &[u8]) -> String {
        match HeadScan::new().parse(input) {
            Parse::Incomplete => "incomplete".into(),
            Parse::Done { .. } => "ok".into(),
            Parse::Refused(Refusal::Status(status)) => status.to_string(),
            Parse::Refused(Refusal::GoAway) => "goaway".into(),
            Parse::Refused(Refusal::MethodNotAllowed(allow)) => format!("405 {allow}"),
        }
    }

    fn head(input: &[u8]) -> (Head, usize) {
        match HeadScan::new().parse(input) {
            Parse::Done { head, consumed } => (head, consumed),
            _ => panic!("{:?} did not parse", String::from_utf8_lossy(input)),
        }
    }

    fn line(request_line: &[u8]) -> String {
        let mut input = request_line.to_vec();
        input.extend_from_slice(b"\r\nHost: x\r\n\r\n");
        verdict(&input)
    }

    // Measured on the C# host with raw request lines.
    #[test]
    fn request_lines_follow_kestrels_grammar() {
        let cases: &[(&[u8], &str)] = &[
            (b"GET /health HTTP/1.1", "ok"),
            (b"GET /health HTTP/1.0", "ok"),
            (b"GET /health  HTTP/1.1", "ok"),
            (b"GET /health   HTTP/1.1", "ok"),
            (b"GET  /health HTTP/1.1", "400"),
            (b"GET /health HTTP/1.1  ", "400"),
            (b"GET /health HTTP/1.1 ", "400"),
            (b"GET /health HTTP/1.1x", "400"),
            (b"GET /health HTTP/1.10", "400"),
            (b"GET /a b HTTP/1.1", "400"),
            (b"GET /health X HTTP/1.1", "400"),
            (b"GET /health HTTP/1.1\r", "400"),
            (b"GET /health\tHTTP/1.1", "400"),
            (b"GET\t/health HTTP/1.1", "400"),
            (b"GET /health HTTP/1.2", "505"),
            (b"GET /health HTTP/2.0", "505"),
            (b"GET /health http/1.1", "505"),
            (b"GET /health HTTP/1.9", "505"),
            (b"GET /health HTTP/0.9", "505"),
            (b"GET /health HTTP/1.", "400"),
            (b"GET /health abcdefg", "400"),
            (b"GET /health abcdefgh", "505"),
            (b"GET /health HTTPX1.1", "505"),
            (b"GET /health HTTP/3", "400"),
            (b"GET /health HTTP/1", "400"),
            (b"GET /health HTTP/", "400"),
            (b"GET /health X", "400"),
            (b"GET /health HTTP/11.1", "400"),
            (b"GET /health HTTPS/1.1", "400"),
            (b"GET /health HTTP/1.1\x00", "400"),
            (b"GET /health", "400"),
            (b"GET", "400"),
            (b"GET ", "400"),
            (b" /health HTTP/1.1", "400"),
            (b"G@T /health HTTP/1.1", "400"),
            (b"GeT /health HTTP/1.1", "ok"),
            (b"GET ?x HTTP/1.1", "400"),
            (b"GET %41 HTTP/1.1", "400"),
            (b"GET /% HTTP/1.1", "ok"),
            (b"GET /health?x HTTP/1.1", "ok"),
            (b"GET /health#frag HTTP/1.1", "400"),
            (b"GET /health?x#frag HTTP/1.1", "400"),
            (b"GET /health?x=%23 HTTP/1.1", "ok"),
            (b"GET /health#frag HTTP/1.2", "505"),
            (b"GET /h\xc3\xa9 HTTP/1.1", "400"),
            (b"GET /health\x00 HTTP/1.1", "400"),
            (b"GET /health?\x00 HTTP/1.1", "400"),
            (b"GET /health\x01\x7f\r HTTP/1.1", "ok"),
            (b"GET * HTTP/1.1", "405 OPTIONS"),
            (b"CONNECT * HTTP/1.1", "405 OPTIONS"),
            (b"OPTIONS * HTTP/1.1", "ok"),
            (b"OPTIONS * HTTP/1.0", "ok"),
            (b"GET ** HTTP/1.1", "400"),
            (b"OPTIONS *x HTTP/1.1", "400"),
            (b"GET x HTTP/1.1", "405 CONNECT"),
            (b"OPTIONS x HTTP/1.1", "405 CONNECT"),
            (b"GET x:1 HTTP/1.1", "405 CONNECT"),
            (b"GET health HTTP/1.1", "405 CONNECT"),
            (b"CONNECT x HTTP/1.1", "ok"),
            (b"CONNECT x:1 HTTP/1.1", "400"),
            (b"CONNECT /health HTTP/1.1", "ok"),
            (b"GET HTTP://X/health HTTP/1.1", "400"),
            (b"GET ftp://x/health HTTP/1.1", "400"),
            (b"GET http:/x HTTP/1.1", "400"),
            (b"GET http:// HTTP/1.1", "400"),
            (b"GET http://x HTTP/1.1", "ok"),
            (b"GET http://x?q HTTP/1.1", "ok"),
            (b"GET http://x/health HTTP/1.1", "ok"),
            (b"GET https://x/health HTTP/1.1", "ok"),
            (b"GET http://x:80/health HTTP/1.1", "ok"),
            (b"GET http://x:/health HTTP/1.1", "ok"),
            (b"GET http://X/health HTTP/1.1", "ok"),
            (b"GET http://y/health HTTP/1.1", "400"),
            (b"GET http://x@y/ HTTP/1.1", "400"),
            (b"GET http://[::1]/ HTTP/1.1", "400"),
            (b"GET http://x/a%zz HTTP/1.1", "ok"),
            (b"GET http://x/a\x01 HTTP/1.1", "ok"),
            (b"CONNECT http://x/health?q HTTP/1.1", "ok"),
            (b"CONNECT http://x/health?q#f HTTP/1.1", "400"),
            (b"PRI * HTTP/2.0", "goaway"),
        ];
        for (request_line, want) in cases {
            assert_eq!(
                line(request_line),
                *want,
                "{:?}",
                String::from_utf8_lossy(request_line)
            );
        }
    }

    // A byte sweep on the C# host: method, path, query, header name and
    // value, and Host, each with one byte swapped in.
    #[test]
    fn single_bytes_follow_kestrels_sweep() {
        let ok_method = |b: u8| is_token_byte(b);
        let ok_path = |b: u8| b != 0 && b != b'\n' && b != b'#' && b < 0x80;
        let ok_name = |b: u8| !matches!(b, 0 | b'\t' | b'\n' | b'\r' | b' ') && b < 0x80;
        let ok_value = |b: u8| !matches!(b, 0 | b'\n' | b'\r') && b < 0x80;
        let ok_host = |b: u8| b.is_ascii_alphanumeric() || b"!$&'()-._~".contains(&b);
        for b in 0..=255u8 {
            let with = |prefix: &[u8], suffix: &[u8]| [prefix, &[b], suffix].concat();
            let method = with(b"G", b"T /health HTTP/1.1\r\nHost: x\r\n\r\n");
            let path = with(b"GET /health", b" HTTP/1.1\r\nHost: x\r\n\r\n");
            let query = with(b"GET /health?a", b" HTTP/1.1\r\nHost: x\r\n\r\n");
            let name = with(b"GET / HTTP/1.1\r\nHost: x\r\nX", b"a: v\r\n\r\n");
            let value = with(b"GET / HTTP/1.1\r\nHost: x\r\nXa: a", b"b\r\n\r\n");
            let host = with(b"GET / HTTP/1.1\r\nHost: a", b"b\r\n\r\n");
            // A space ends the target; the version check then decides.
            let space_ok = b == b' ';
            let cases = [
                ("method", method, ok_method(b)),
                ("path", path, ok_path(b) || space_ok),
                ("query", query, ok_path(b) || space_ok),
                ("name", name, ok_name(b) || b == b':'),
                ("value", value, ok_value(b)),
                ("host", host, ok_host(b)),
            ];
            for (kind, input, ok) in cases {
                let got = verdict(&input);
                assert_eq!(got == "ok", ok, "{kind} byte {b:#04x}: {got}");
            }
        }
    }

    #[test]
    fn kestrel_host_grammar() {
        let ok = [
            "", "a:80", "[::1]", "[::1]:80", "a:99999", "1.2.3.4", "a.b.", "a..b", "-a", "a:0",
            "a:080", " a ", "x", "a.b-c_d~", "a:65536", "a:0080",
        ];
        let bad = [
            "a:", ":80", "[::1", "a:8x", "a%41", "[v1.x]", "[::1]x", "\u{e9}", "a\tb", "a b",
            "a:b", "a:80:80", "[::]", "[g::1]", "a@b",
        ];
        for host in ok {
            let input = format!("GET / HTTP/1.1\r\nHost: {host}\r\n\r\n");
            assert_eq!(verdict(input.as_bytes()), "ok", "{host:?}");
        }
        let long = "x".repeat(300);
        assert_eq!(
            verdict(format!("GET / HTTP/1.1\r\nHost: {long}\r\n\r\n").as_bytes()),
            "ok"
        );
        for host in bad {
            let input = format!("GET / HTTP/1.1\r\nHost: {host}\r\n\r\n");
            assert_eq!(verdict(input.as_bytes()), "400", "{host:?}");
        }
    }

    #[test]
    fn host_lines_and_absolute_targets_follow_kestrel() {
        let cases: &[(&[u8], &str)] = &[
            (b"GET / HTTP/1.1\r\n\r\n", "400"),
            (b"GET / HTTP/1.0\r\n\r\n", "ok"),
            (b"GET / HTTP/1.0\r\nHost: a b\r\n\r\n", "400"),
            (b"GET / HTTP/1.1\r\nHost: x\r\nhost: x\r\n\r\n", "400"),
            (b"GET / HTTP/1.1\r\nHOST: x\r\n\r\n", "ok"),
            (b"GET / HTTP/1.1\r\nHost : x\r\n\r\n", "400"),
            (b"GET / HTTP/1.1\r\nHost:\r\n\r\n", "ok"),
            (b"GET http://x/health HTTP/1.1\r\n\r\n", "400"),
            (
                b"GET http://x:81/health HTTP/1.1\r\nHost: x:81\r\n\r\n",
                "ok",
            ),
            (b"GET http://x:81/health HTTP/1.1\r\nHost: x\r\n\r\n", "400"),
            (b"GET http://x/health HTTP/1.1\r\nHost:\r\n\r\n", "400"),
            (b"GET http://x/health HTTP/1.1\r\nHost: x:80\r\n\r\n", "ok"),
            (b"CONNECT x:443 HTTP/1.1\r\nHost: x:443\r\n\r\n", "ok"),
        ];
        for (input, want) in cases {
            assert_eq!(
                verdict(input),
                *want,
                "{:?}",
                String::from_utf8_lossy(input)
            );
        }
    }

    #[test]
    fn header_lines_follow_kestrels_grammar() {
        let with = |headers: &str| format!("GET /health HTTP/1.1\r\nHost: x\r\n{headers}\r\n");
        let cases = [
            ("X-A: a\x7fb\r\n", "ok"),
            ("X-A: a\x01b\r\n", "ok"),
            ("X-A: a\tb\r\n", "ok"),
            ("X-A: a\x00b\r\n", "400"),
            ("X-A: a\rb\r\n", "400"),
            ("X-A: a\r\n b\r\n", "400"),
            ("X\"A: a\r\n", "ok"),
            ("X\x01A: a\r\n", "ok"),
            ("X-A : a\r\n", "400"),
            ("NoColon\r\n", "400"),
            (": v\r\n", "400"),
            ("X-A: \u{e9}\r\n", "ok"),
        ];
        for (headers, want) in cases {
            assert_eq!(verdict(with(headers).as_bytes()), want, "{headers:?}");
        }
        assert_eq!(verdict(b"GET /health HTTP/1.1\r\n Host: x\r\n\r\n"), "400");
        assert_eq!(
            verdict(b"GET /health HTTP/1.1\r\nHost: x\r\nX-A: \xe9\r\n\r\n"),
            "400"
        );
        // A CR alone ends no line.
        assert_eq!(verdict(b"GET /health HTTP/1.1\rHost: x\r\n\r\n"), "400");
        assert_eq!(verdict(b"GET /health HTTP/1.1\r\nHost: x\r\r\n\r\n"), "400");
        assert_eq!(verdict(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\r\n"), "400");
        // With DisableHttp1LineFeedTerminators every line needs its CR.
        assert_eq!(verdict(b"GET /health HTTP/1.1\r\nHost: x\r\n\n"), "400");
        assert_eq!(verdict(b"GET /health HTTP/1.1\nHost: x\n\n"), "400");
    }

    #[test]
    fn values_are_trimmed_and_names_keep_their_case() {
        let (head, _) =
            head(b"GET /a?b=1 HTTP/1.1\r\nHost:  x \t\r\nX-A:\t a \t\r\nx-a: b\r\n\r\n");
        assert_eq!(head.headers.get("host"), Some("x"));
        assert_eq!(head.headers.get_all("X-A").collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(head.headers.iter().nth(2), Some(("x-a", "b")));
        assert_eq!((head.path.as_str(), head.query.as_str()), ("/a", "?b=1"));
        assert_eq!(head.form, TargetForm::Origin);
    }

    #[test]
    fn framing_headers_follow_kestrel() {
        let with = |headers: &str| format!("POST / HTTP/1.1\r\nHost: x\r\n{headers}\r\n");
        let cases = [
            ("Content-Length: 11\r\n", "ok"),
            ("Content-Length: +11\r\n", "ok"),
            ("Content-Length: 011\r\n", "ok"),
            ("Content-Length: 11 \r\n", "ok"),
            ("Content-Length: \t11\r\n", "ok"),
            ("Content-Length: 9223372036854775807\r\n", "ok"),
            ("Content-Length: 0x0B\r\n", "400"),
            ("Content-Length: 1 1\r\n", "400"),
            ("Content-Length: 99999999999999999999\r\n", "400"),
            ("Content-Length: \r\n", "400"),
            ("Content-Length: abc\r\n", "400"),
            ("Content-Length: -1\r\n", "400"),
            ("Content-Length: 2,2\r\n", "400"),
            ("Content-Length: 2\r\nContent-Length: 2\r\n", "400"),
            ("Transfer-Encoding: chunked\r\nContent-Length: 5\r\n", "ok"),
            ("Transfer-Encoding: Chunked\r\n", "ok"),
            ("Transfer-Encoding: gzip, chunked\r\n", "ok"),
            ("Transfer-Encoding: gzip,chunked\r\n", "ok"),
            ("Transfer-Encoding: chunked,\r\n", "ok"),
            ("Transfer-Encoding: ,chunked\r\n", "ok"),
            ("Transfer-Encoding: chunked, chunked\r\n", "ok"),
            ("Transfer-Encoding:  chunked \r\n", "ok"),
            (
                "Transfer-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n",
                "ok",
            ),
            ("Transfer-Encoding: gzip\r\n", "400"),
            ("Transfer-Encoding: chunked, gzip\r\n", "400"),
            ("Transfer-Encoding: chunked;q=1\r\n", "400"),
            ("Transfer-Encoding: identity\r\n", "400"),
        ];
        for (headers, want) in cases {
            assert_eq!(verdict(with(headers).as_bytes()), want, "{headers:?}");
        }
    }

    // Kestrel's defaults, as request-heads.json pins them black-box.
    #[test]
    fn heads_stop_at_kestrels_limits() {
        let with = |headers: &str| {
            format!("GET /health HTTP/1.1\r\nHost: x\r\n{headers}Connection: close\r\n\r\n")
        };
        let numbered = |count: usize| {
            (0..count)
                .map(|i| format!("X{i}: v\r\n"))
                .collect::<String>()
        };
        let a = |n: usize| "a".repeat(n);
        let cases = [
            (with(&format!("X: {}\r\n", a(32_735))), "ok"),
            (with(&format!("X: {}\r\n", a(32_736))), "431"),
            (
                format!(
                    "GET /health HTTP/1.1\nHost: x\nX: {}\nConnection: close\n\n",
                    a(32_740)
                ),
                "400",
            ),
            (
                format!("GET /health HTTP/1.1\r\nHost: x\r\nX: {}", a(33_000)),
                "431",
            ),
            (
                format!(
                    "GET /health?{} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
                    a(8_169)
                ),
                "ok",
            ),
            (
                format!(
                    "GET /health?{} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
                    a(8_170)
                ),
                "414",
            ),
            (
                format!(
                    "GET /health?{} HTTP/1.1\nHost: x\nConnection: close\n\n",
                    a(8_170)
                ),
                "400",
            ),
            (format!("GET /health?{}", a(8_300)), "414"),
            (
                format!("{} / HTTP/1.1\r\nHost: x\r\n\r\n", "G".repeat(8_300)),
                "414",
            ),
            (with(&numbered(98)), "ok"),
            (with(&numbered(99)), "431"),
        ];
        for (input, want) in cases {
            assert_eq!(verdict(input.as_bytes()), want, "{:.60?}", input);
        }
    }

    #[test]
    fn leading_line_ends_are_skipped_and_counted() {
        let input = b"\r\n\r\n\n\rGET / HTTP/1.1\r\nHost: x\r\n\r\nrest";
        let (head, consumed) = head(input);
        assert_eq!(head.target, "/");
        assert_eq!(&input[consumed..], b"rest");
        assert_eq!(verdict(b"\r\n\r\n"), "incomplete");
    }

    // A head that comes a byte at a time is scanned once, so its cost is
    // linear in its length.
    #[test]
    fn a_slow_line_costs_linear_time() {
        fn dribble(size: usize) -> std::time::Duration {
            let mut input = b"GET /".to_vec();
            input.resize(5 + size, b'a');
            let started = std::time::Instant::now();
            let mut scan = HeadScan::new();
            for end in 1..=input.len() {
                if !matches!(scan.parse(&input[..end]), Parse::Incomplete) {
                    break;
                }
            }
            started.elapsed()
        }
        let fastest = |size| (0..3).map(|_| dribble(size)).min().unwrap();
        // Linear is 8x, quadratic 64x. Lines stop at 8 KiB, so the header
        // block is what a quadratic scan would hurt; the line shows it too.
        let (small, big) = (fastest(1 << 10), fastest(8 << 10));
        let ratio = big.as_secs_f64() / small.as_secs_f64().max(1e-9);
        assert!(ratio < 32.0, "8x the line took {ratio:.0}x the time");
    }
}
