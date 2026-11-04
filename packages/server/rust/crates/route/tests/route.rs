use std::net::SocketAddr;
use std::time::Duration;

use blok_http::{Config, Handler, Request, ResponseWriter, Server};
use blok_jsjson::{Kind, Node, Options, parse_node};
use blok_route::{Router, method_not_allowed, path_value, strip_prefix};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

struct Running {
    address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn start(handler: impl Handler) -> Running {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, Config::default());
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    Running { address, task }
}

struct Answer {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Answer {
    fn header(&self, name: &str) -> &str {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map_or("", |(_, v)| v.as_str())
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Sends one request on a fresh connection; the target goes out as bytes.
async fn serve(address: SocketAddr, method: &str, target: &[u8]) -> Answer {
    let mut conn = TcpStream::connect(address).await.unwrap();
    let mut request = format!("{method} ").into_bytes();
    request.extend_from_slice(target);
    request.extend_from_slice(b" HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    conn.write_all(&request).await.unwrap();
    let mut bytes = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(5), conn.read_to_end(&mut bytes)).await;
    let end = find(&bytes, b"\r\n\r\n").expect("a response head");
    let head = String::from_utf8_lossy(&bytes[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap()[9..12].parse().unwrap();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(": "))
        .map(|(n, v)| (n.to_owned(), v.to_owned()))
        .collect();
    let mut rest = &bytes[end + 4..];
    let mut body = Vec::new();
    let chunked = headers
        .iter()
        .any(|(n, v)| n.eq_ignore_ascii_case("transfer-encoding") && v == "chunked");
    if chunked {
        loop {
            let line_end = find(rest, b"\r\n").unwrap();
            let size =
                usize::from_str_radix(&String::from_utf8_lossy(&rest[..line_end]), 16).unwrap();
            rest = &rest[line_end + 2..];
            if size == 0 {
                break;
            }
            body.extend_from_slice(&rest[..size]);
            rest = &rest[size + 2..];
        }
    } else if method != "HEAD" {
        body.extend_from_slice(rest);
    }
    Answer {
        status,
        headers,
        body,
    }
}

fn fixture() -> Node {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/routing.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let bytes = std::fs::read(&path).unwrap();
    parse_node(&bytes, Options::default()).unwrap()
}

fn member<'a>(node: &'a Node, name: &str) -> &'a Node {
    node.members
        .iter()
        .find(|m| m.key().unwrap().units() == blok_jsjson::Str::from_utf8(name.as_bytes()).units())
        .map(|m| &m.value)
        .unwrap_or_else(|| panic!("fixture has no {name}"))
}

fn text(node: &Node) -> String {
    assert_eq!(node.kind, Kind::String);
    blok_jsjson::to_string_lossy(node.text().unwrap().units())
}

fn list<'a>(node: &'a Node, host: &str, name: &str) -> &'a [Node] {
    &member(member(node, host), name).items
}

fn field(node: &Node, name: &str) -> String {
    text(member(node, name))
}

fn number(node: &Node, name: &str) -> u16 {
    std::str::from_utf8(member(node, name).raw())
        .unwrap()
        .parse()
        .unwrap()
}

/// Answers with its own name and the {doc} value.
fn named(name: &'static str) -> impl Handler {
    move |request: Request, mut response: ResponseWriter| async move {
        let text = format!("{name}|{}", path_value(&request, "doc"));
        let _ = response.write(text.as_bytes()).await;
    }
}

fn test_router() -> Router {
    let mut router = Router::new();
    router.handle("/health", Some(&["GET", "HEAD"]), named("health"));
    router.handle("/health", None, method_not_allowed("GET, HEAD"));
    router.handle("/sync/{doc}", Some(&["GET"]), named("sync"));
    router.handle("/sync/{doc}", None, method_not_allowed("GET"));
    router.handle("/sync/{doc}/state", Some(&["GET"]), named("state"));
    router.handle("/sync/{doc}/state", Some(&["OPTIONS"]), named("preflight"));
    router.handle(
        "/sync/{doc}/state",
        None,
        method_not_allowed("GET, OPTIONS"),
    );
    router.handle(
        "/sync/{doc}/history/{lineage}",
        Some(&["DELETE", "OPTIONS"]),
        named("history"),
    );
    router.handle(
        "/sync/{doc}/history/{lineage}",
        None,
        method_not_allowed("DELETE, OPTIONS"),
    );
    router.handle("/unfurl", Some(&["GET", "OPTIONS"]), named("unfurl"));
    router.handle("/unfurl", None, method_not_allowed("GET, HEAD, OPTIONS"));
    router.handle(
        "/frame-check",
        Some(&["GET", "OPTIONS"]),
        named("frame-check"),
    );
    router.handle(
        "/frame-check",
        None,
        method_not_allowed("GET, HEAD, OPTIONS"),
    );
    router
}

#[tokio::test]
async fn matches_like_kestrel() {
    let fixture = fixture();
    let mut cases: Vec<(String, String, String)> = [
        ("HEAD", "/health/", "health|"),
        ("GET", "/SYNC/AbC/STATE/", "state|AbC"),
        ("GET", "/sync/a%20b", "sync|a b"),
        ("GET", "/sync/a%2Fb", "sync|a%2Fb"),
        ("GET", "/sync/a%252Fb", "sync|a%2Fb"),
        ("OPTIONS", "/sync/x/state", "preflight|x"),
    ]
    .iter()
    .map(|(m, t, b)| ((*m).to_owned(), (*t).to_owned(), (*b).to_owned()))
    .collect();
    for path in list(&fixture, "healthHost", "matchesHealth") {
        cases.push(("GET".into(), text(path), "health|".into()));
    }
    // An escape that is not valid UTF-8 stays as written, as in Kestrel.
    for name in ["encodedSeparator", "decodedDoc"] {
        for case in list(&fixture, "collabHost", name) {
            cases.push((
                "GET".into(),
                field(case, "path"),
                format!("state|{}", field(case, "doc")),
            ));
        }
    }
    let running = start(test_router()).await;
    for (method, target, want) in cases {
        let got = serve(running.address, &method, target.as_bytes()).await;
        // HEAD drops the body; the route is told apart by the status.
        let body_ok = method == "HEAD" || got.text() == want;
        assert!(
            got.status == 200 && body_ok,
            "{method} {target}: {} {:?}, want 200 {want:?}",
            got.status,
            got.text()
        );
    }
}

#[tokio::test]
async fn unmatched_paths_get_the_catch_all() {
    let fixture = fixture();
    let mut targets: Vec<String> = list(&fixture, "collabHost", "notFound")
        .iter()
        .map(text)
        .collect();
    for request in list(&fixture, "healthHost", "notFound") {
        let path = field(request, "path");
        // test_router serves /unfurl and /frame-check; the health-only host does not.
        if path != "/unfurl" && path != "/frame-check" {
            targets.push(path);
        }
    }
    let running = start(test_router()).await;
    for target in targets {
        for method in ["GET", "POST", "OPTIONS"] {
            // blok-http answers any other method on "*" itself, as Kestrel does.
            if target == "*" && method != "OPTIONS" {
                continue;
            }
            let got = serve(running.address, method, target.as_bytes()).await;
            assert!(
                got.status == 404
                    && got.text() == "404 page not found\n"
                    && got.header("Content-Type") == "text/plain; charset=utf-8"
                    && got.header("Allow").is_empty()
                    && got.header("X-Content-Type-Options").is_empty(),
                "{method} {target}: {} {:?} {:?}",
                got.status,
                got.text(),
                got.headers
            );
        }
    }
}

#[tokio::test]
async fn method_routes_beat_the_fallback() {
    let fixture = fixture();
    let mut cases: Vec<(String, String, String)> = vec![
        ("OPTIONS".into(), "/HEALTH/".into(), "GET, HEAD".into()),
        (
            "DELETE".into(),
            "/sync/x/state/".into(),
            "GET, OPTIONS".into(),
        ),
    ];
    for host in ["healthHost", "collabHost"] {
        for case in list(&fixture, host, "methodNotAllowed") {
            cases.push((
                field(case, "method"),
                field(case, "path"),
                field(case, "allow"),
            ));
        }
    }
    let running = start(test_router()).await;
    for (method, path, allow) in cases {
        let got = serve(running.address, &method, path.as_bytes()).await;
        assert!(
            got.status == 405
                && got.header("Allow") == allow
                && got.header("Content-Type") == "text/plain; charset=utf-8"
                && got.header("X-Content-Type-Options").is_empty()
                && (method == "HEAD" || got.text() == "Method Not Allowed\n"),
            "{method} {path}: {} {:?} {:?}",
            got.status,
            got.text(),
            got.headers
        );
    }
}

#[tokio::test]
async fn registration_order_does_not_let_a_fallback_win() {
    let mut router = Router::new();
    router.handle("/health", None, method_not_allowed("GET, HEAD"));
    router.handle("/health", Some(&["GET"]), named("health"));
    let running = start(router).await;
    let got = serve(running.address, "GET", b"/health").await;
    assert_eq!((got.status, got.text().as_str()), (200, "health|"));
}

#[tokio::test]
async fn method_names_fold_case() {
    // Kestrel answers "get /health" with 200 and "post /health" with 405.
    let running = start(test_router()).await;
    let got = serve(running.address, "get", b"/health").await;
    assert_eq!((got.status, got.text().as_str()), (200, "health|"));
    let got = serve(running.address, "post", b"/health").await;
    assert_eq!(got.status, 405);
}

#[test]
fn rejects_bad_patterns() {
    for pattern in ["", "health", "/a//b", "/{}", "/{doc", "/a/"] {
        let result = std::panic::catch_unwind(|| {
            Router::new().handle(pattern, None, named("x"));
        });
        assert!(result.is_err(), "pattern {pattern:?} did not panic");
    }
}

// The C# host maps the local file route "/{fileName}" before /health. Kestrel
// still sends /health to health, and sends GET /upload to the file route
// rather than to /upload's 405 fallback, which sits one order later.
#[tokio::test]
async fn a_literal_beats_a_parameter_in_the_same_pass() {
    let mut router = Router::new();
    router.handle("/{fileName}", Some(&["GET", "HEAD"]), named("file"));
    router.handle("/health", Some(&["GET", "HEAD"]), named("health"));
    router.handle("/health", None, method_not_allowed("GET, HEAD"));
    router.handle("/upload", Some(&["POST"]), named("upload"));
    router.handle("/upload", None, method_not_allowed("OPTIONS, POST"));
    let running = start(router).await;
    for (method, target, want) in [
        ("GET", "/health", "health|"),
        ("GET", "/HEALTH/", "health|"),
        ("GET", "/upload", "file|"),
        ("POST", "/upload", "upload|"),
        ("GET", "/other", "file|"),
    ] {
        let got = serve(running.address, method, target.as_bytes()).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, want),
            "{method} {target}"
        );
    }
    let got = serve(running.address, "HEAD", b"/health").await;
    assert_eq!(got.status, 200);
}

fn assert_bare_400(got: &Answer, what: &str) {
    assert!(
        got.status == 400
            && got.body.is_empty()
            && got.header("Content-Length") == "0"
            && got.header("Content-Type").is_empty(),
        "{what}: {} {:?} {:?}",
        got.status,
        got.text(),
        got.headers
    );
}

// Kestrel refuses a decoded NUL anywhere in the path, before routing, with an
// empty 400. It does not refuse %00 in the query, %2500, or other controls.
#[tokio::test]
async fn encoded_nul_in_the_path_is_a_bad_request() {
    let fixture = fixture();
    let running = start(test_router()).await;
    let mut encoded: Vec<(String, String)> = list(&fixture, "healthHost", "encodedNul")
        .iter()
        .map(|c| (field(c, "method"), field(c, "path")))
        .collect();
    encoded.push(("GET".into(), "/sync/a%00/state".into()));
    for (method, path) in encoded {
        let got = serve(running.address, &method, path.as_bytes()).await;
        assert_bare_400(&got, &format!("{method} {path}"));
        assert_eq!(got.header("Connection"), "close", "{method} {path}");
    }
    // Kestrel refuses a raw byte of 0x80 or above anywhere in the target.
    let mut raw: Vec<Vec<u8>> = vec![b"/sync/d\xff/state".to_vec(), b"/health?x=\x80".to_vec()];
    for path in list(&fixture, "healthHost", "rawNonAscii") {
        raw.push(text(path).into_bytes());
    }
    for target in raw {
        let got = serve(running.address, "GET", &target).await;
        assert_bare_400(&got, &format!("GET {target:?}"));
    }
    for case in list(&fixture, "healthHost", "notRefused") {
        let path = field(case, "path");
        let got = serve(running.address, "GET", path.as_bytes()).await;
        assert_eq!(got.status, number(case, "status"), "GET {path}");
    }
}

// A consumer may mount the router under a prefix; the router still reads the
// path as sent.
#[tokio::test]
async fn routes_under_strip_prefix() {
    let running = start(strip_prefix("/api", test_router())).await;
    for (target, want) in [
        ("/api/health", "health|"),
        ("/api/sync/u37%Ff|/state", "state|u37%Ff|"),
        ("/api/sync/a%2Fb/state", "state|a%2Fb"),
        ("/api/sync/u29%zz/state", "state|u29%zz"),
        ("/api/sync/u33\x01x/state", "state|u33\x01x"),
    ] {
        let got = serve(running.address, "GET", target.as_bytes()).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, want),
            "GET {target:?}"
        );
    }
    let got = serve(running.address, "GET", b"/health").await;
    assert_eq!(got.status, 404);
}

// The router reads the target as sent, so a malformed escape or a raw
// control byte routes the way Kestrel routes it.
#[tokio::test]
async fn unparsed_targets_route_like_kestrel() {
    let fixture = fixture();
    let running = start(test_router()).await;
    for case in list(&fixture, "healthHost", "unparsedTargets") {
        let (method, path, status) = (
            field(case, "method"),
            field(case, "path"),
            number(case, "status"),
        );
        let want = match status {
            200 => "health|",
            404 => "404 page not found\n",
            _ => "",
        };
        let got = serve(running.address, &method, path.as_bytes()).await;
        assert!(
            got.status == status && (method == "HEAD" || got.text() == want),
            "{method} {path:?}: {} {:?}, want {status} {want:?}",
            got.status,
            got.text()
        );
    }
    for case in list(&fixture, "collabHost", "unparsedDoc") {
        let (path, doc) = (field(case, "path"), field(case, "doc"));
        let got = serve(running.address, "GET", path.as_bytes()).await;
        assert_eq!(
            (got.status, got.text()),
            (200, format!("state|{doc}")),
            "GET {path:?}"
        );
    }
    for case in list(&fixture, "healthHost", "rawNul") {
        let (method, path) = (field(case, "method"), field(case, "path"));
        let got = serve(running.address, &method, path.as_bytes()).await;
        assert!(
            got.status == 400
                && got.body.is_empty()
                && got.header("Content-Length") == "0"
                && got.header("Connection") == "close",
            "{method} {path:?}: {} {:?} {:?}",
            got.status,
            got.text(),
            got.headers
        );
    }
}
