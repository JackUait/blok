//! A request router that matches paths the way the C# host's Kestrel
//! routing does.

use std::sync::Arc;

use blok_dotnet::unescape_data_string;
use blok_http::{BoxFuture, Handler, Request, ResponseWriter};

/// Picks a route like ASP.NET endpoint routing does with the C# host's
/// orders. Routes that name methods are order 0 and routes that take any
/// method (the 405 fallbacks, WithOrder(1) in C#) are order 1, so they are
/// tried in two passes and a match in the first pass always wins. Within a
/// pass the route with a literal at the first segment where the matches
/// differ wins, so "/health" beats "/{fileName}" whichever was registered
/// first. Among routes with the same shape the first registered wins. A
/// request no route matches gets the 404 catch-all.
///
/// Paths match like Kestrel: literal segments compare case-insensitively
/// (ASCII only), one trailing slash is ignored, dot segments are removed
/// without a redirect, empty segments match nothing, and %2F stays encoded
/// in a parameter value. Method names compare case-insensitively too.
#[derive(Default)]
pub struct Router {
    routes: Vec<Entry>,
}

struct Entry {
    segments: Vec<Segment>,
    // None takes any method.
    methods: Option<Vec<String>>,
    handler: Arc<dyn Handler>,
}

enum Segment {
    Literal(String),
    Param(String),
}

/// The route parameters a request matched, set by the router.
#[derive(Clone, Debug, Default)]
pub struct PathValues(pub Vec<(String, String)>);

/// The value the route captured under name, or "".
pub fn path_value<'a>(request: &'a Request, name: &str) -> &'a str {
    request
        .extensions
        .get::<PathValues>()
        .and_then(|values| values.0.iter().find(|(n, _)| n == name))
        .map_or("", |(_, value)| value.as_str())
}

impl Router {
    pub fn new() -> Self {
        Self::default()
    }

    /// Maps pattern, such as "/sync/{doc}/state", to handler for methods.
    /// None takes any method, which is how a pattern's 405 answer is
    /// mapped. Panics on a malformed pattern.
    pub fn handle(&mut self, pattern: &str, methods: Option<&[&str]>, handler: impl Handler) {
        self.handle_arc(pattern, methods, Arc::new(handler));
    }

    pub fn handle_arc(
        &mut self,
        pattern: &str,
        methods: Option<&[&str]>,
        handler: Arc<dyn Handler>,
    ) {
        if !pattern.starts_with('/') || pattern == "/" || pattern.ends_with('/') {
            panic!("route: bad pattern {pattern}");
        }
        let mut segments = Vec::new();
        for part in pattern[1..].split('/') {
            if part.is_empty() {
                panic!("route: empty segment in {pattern}");
            }
            if part.starts_with('{') || part.ends_with('}') {
                let name = part.strip_prefix('{').unwrap_or(part);
                let name = name.strip_suffix('}').unwrap_or(name);
                if name.len() + 2 != part.len() || name.is_empty() {
                    panic!("route: bad parameter in {pattern}");
                }
                segments.push(Segment::Param(name.to_owned()));
            } else {
                segments.push(Segment::Literal(part.to_owned()));
            }
        }
        self.routes.push(Entry {
            segments,
            methods: methods.map(|list| list.iter().map(|m| (*m).to_owned()).collect()),
            handler,
        });
    }

    fn pick(&self, method: &str, parts: &[&str]) -> Option<(&Entry, Vec<(String, String)>)> {
        for any_method in [false, true] {
            let mut best: Option<(&Entry, Vec<(String, String)>)> = None;
            for entry in &self.routes {
                if entry.methods.is_none() != any_method || !entry.allows(method) {
                    continue;
                }
                if let Some(values) = entry.matches(parts)
                    && best
                        .as_ref()
                        .is_none_or(|(current, _)| entry.more_literal_than(current))
                {
                    best = Some((entry, values));
                }
            }
            if best.is_some() {
                return best;
            }
        }
        None
    }
}

impl Handler for Router {
    fn serve(&self, mut request: Request, response: ResponseWriter) -> BoxFuture<()> {
        let decoded = decode_keeping_slash(request.path());
        // Kestrel refuses a decoded NUL in the path, and a raw NUL or any raw
        // byte of 0x80 or above in the target, before routing. blok-http
        // refuses the raw ones first; this keeps a mounted router safe too.
        let target = request.target();
        if decoded.contains('\0') || target.contains('\0') || !target.is_ascii() {
            return Box::pin(bad_request(response));
        }
        let picked = path_segments(&decoded).and_then(|parts| self.pick(request.method(), &parts));
        match picked {
            Some((entry, values)) => {
                let handler = Arc::clone(&entry.handler);
                request.extensions.insert(PathValues(values));
                handler.serve(request, response)
            }
            None => Box::pin(not_found(request, response)),
        }
    }
}

impl Entry {
    fn allows(&self, method: &str) -> bool {
        self.methods
            .as_ref()
            .is_none_or(|list| list.iter().any(|m| m.eq_ignore_ascii_case(method)))
    }

    /// Whether self has a literal at the first segment where the two differ
    /// in kind. Both matched the same path, so they have as many segments.
    fn more_literal_than(&self, other: &Entry) -> bool {
        for (mine, theirs) in self.segments.iter().zip(&other.segments) {
            let (is_param, other_is_param) = (
                matches!(mine, Segment::Param(_)),
                matches!(theirs, Segment::Param(_)),
            );
            if is_param != other_is_param {
                return other_is_param;
            }
        }
        false
    }

    fn matches(&self, parts: &[&str]) -> Option<Vec<(String, String)>> {
        if parts.len() != self.segments.len() {
            return None;
        }
        let mut values = Vec::new();
        for (segment, part) in self.segments.iter().zip(parts) {
            if part.is_empty() {
                return None;
            }
            match segment {
                // ASCII folding only: Kestrel does not match "ſ" to "s".
                Segment::Literal(literal) if !literal.eq_ignore_ascii_case(part) => return None,
                Segment::Literal(_) => {}
                Segment::Param(name) => values.push((name.clone(), (*part).to_owned())),
            }
        }
        Some(values)
    }
}

/// Removes dot segments and one trailing slash from the decoded path, and
/// splits it. Decoding comes first: Kestrel removes "/%2e/" too. None for a
/// path that does not start with "/", such as the "*" of "OPTIONS *".
fn path_segments(decoded: &str) -> Option<Vec<&str>> {
    if !decoded.starts_with('/') {
        return None;
    }
    let mut out: Vec<&str> = Vec::new();
    let parts: Vec<&str> = decoded[1..].split('/').collect();
    let count = parts.len();
    for (i, part) in parts.into_iter().enumerate() {
        let last = i == count - 1;
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
    // "/" + join(out) with one trailing slash trimmed.
    if out.last() == Some(&"") {
        out.pop();
    }
    Some(out)
}

/// Decodes the path like Kestrel: %2F stays as sent, so a decoded slash can
/// never split a segment, and an escape that is not part of valid UTF-8 (or
/// is malformed) stays as written. The doc id names the journal directory,
/// so decoding "%FF" to a raw byte would split one document into two across
/// the servers.
pub fn decode_keeping_slash(mut s: &str) -> String {
    if !s.contains('%') {
        return s.to_owned();
    }
    let mut out = String::new();
    loop {
        match index_encoded_slash(s) {
            None => {
                out.push_str(&unescape_data_string(s));
                return out;
            }
            Some(i) => {
                out.push_str(&unescape_data_string(&s[..i]));
                out.push_str(&s[i..i + 3]);
                s = &s[i + 3..];
            }
        }
    }
}

fn index_encoded_slash(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    (0..b.len().saturating_sub(2))
        .find(|&i| b[i] == b'%' && b[i + 1] == b'2' && (b[i + 2] == b'F' || b[i + 2] == b'f'))
}

/// Kestrel's answer to a NUL in the path: no body, a zero length even on
/// HEAD, and the connection closed.
async fn bad_request(mut response: ResponseWriter) {
    let headers = response.headers_mut();
    headers.set("Connection", "close");
    headers.set("Content-Length", "0");
    let _ = response.start(400).await;
}

/// The catch-all for a path no route matches, whatever the method.
pub async fn not_found(_request: Request, mut response: ResponseWriter) {
    write_plain(&mut response, 404, "404 page not found\n").await;
}

/// Answers 405 with the given Allow value, and no nosniff header (the C#
/// host never sends one).
pub fn method_not_allowed(allow: impl Into<String>) -> impl Handler {
    let allow: Arc<str> = allow.into().into();
    move |_request: Request, mut response: ResponseWriter| {
        let allow = Arc::clone(&allow);
        async move {
            response.headers_mut().set("Allow", &*allow);
            write_plain(&mut response, 405, "Method Not Allowed\n").await;
        }
    }
}

pub async fn write_plain(response: &mut ResponseWriter, status: u16, body: &str) {
    response
        .headers_mut()
        .set("Content-Type", "text/plain; charset=utf-8");
    start_stream(response, status).await;
    let _ = response.write(body.as_bytes()).await;
}

/// Sends the head before any body, so no Content-Length goes out: chunked on
/// HTTP/1.1, close-delimited on HTTP/1.0, and no length header on HEAD.
/// That is how Kestrel frames these answers.
pub async fn start_stream(response: &mut ResponseWriter, status: u16) {
    let _ = response.start(status).await;
}

/// Hands requests under prefix on with the prefix cut from the path, as
/// net/http's StripPrefix does; any other path gets the 404 catch-all.
pub fn strip_prefix(prefix: &'static str, next: impl Handler) -> impl Handler {
    let next: Arc<dyn Handler> = Arc::new(next);
    move |mut request: Request, response: ResponseWriter| {
        let next = Arc::clone(&next);
        async move {
            match request.path().strip_prefix(prefix) {
                Some(rest) => {
                    let rest = rest.to_owned();
                    request.set_path(rest);
                    next.serve(request, response).await;
                }
                None => not_found(request, response).await,
            }
        }
    }
}
