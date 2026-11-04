use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_blokserver::{COLLAB_LOG_CATEGORY, Level, Logger, Options, Server};
use blok_jsjson::{Options as JsonOptions, parse_node, to_string_lossy};
use blok_server::args::{USAGE, parse_host_arguments};
use blok_server::collablog::{CollabStderr, Stderr};
use blok_server::{configure_collab, run};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;

/// stderr the test can read while run writes it.
#[derive(Clone, Default)]
struct Buffer(Arc<Mutex<Vec<u8>>>);

impl Write for Buffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Buffer {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }

    fn stderr(&self) -> Stderr {
        Arc::new(Mutex::new(self.clone()))
    }
}

fn no_env(_: &str) -> String {
    String::new()
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|a| (*a).to_owned()).collect()
}

/// Runs to the end with a shutdown that never comes; for runs that exit.
async fn run_to_exit(args: &[&str]) -> (i32, String) {
    run_to_exit_with(args, no_env).await
}

async fn run_to_exit_with(args: &[&str], getenv: fn(&str) -> String) -> (i32, String) {
    let out = Buffer::default();
    let code = tokio::time::timeout(
        Duration::from_secs(10),
        run(
            &strings(args),
            &getenv,
            out.stderr(),
            std::future::pending(),
            "dev",
        ),
    )
    .await
    .expect("run did not exit");
    (code, out.text())
}

/// A port that was free a moment ago. Another test can take it before the
/// host binds, so a host that must listen starts through Running::start or
/// listening_binary, which retry on a taken port.
fn free_port() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().to_string()
}

// The host listens within milliseconds; 30 s only covers a workspace run
// whose QuickJS suites take every core.
async fn wait_for(condition: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    while !condition() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "condition not met within 30s"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Waits for the listening line. False when the port was taken first.
async fn listened(text: &dyn Fn() -> String) -> bool {
    wait_for(|| {
        let text = text();
        text.contains(" listening on ") || text.contains("address already in use")
    })
    .await;
    text().contains(" listening on ")
}

/// A host running on a free port until stop is called.
struct Running {
    address: String,
    out: Buffer,
    stop: Option<oneshot::Sender<()>>,
    done: tokio::task::JoinHandle<i32>,
}

impl Running {
    async fn start(args: &[&str], getenv: fn(&str) -> String, version: &'static str) -> Running {
        loop {
            let address = free_port();
            let out = Buffer::default();
            let (stop, stopped) = oneshot::channel::<()>();
            let mut all = strings(&["--listen", &address]);
            all.extend(strings(args));
            let stderr = out.stderr();
            let done = tokio::spawn(async move {
                run(
                    &all,
                    &getenv,
                    stderr,
                    async {
                        let _ = stopped.await;
                    },
                    version,
                )
                .await
            });
            let watched = out.clone();
            if listened(&|| watched.text()).await {
                return Running {
                    address,
                    out,
                    stop: Some(stop),
                    done,
                };
            }
            let _ = done.await;
        }
    }

    async fn stop(mut self) -> (i32, String) {
        let _ = self.stop.take().unwrap().send(());
        let code = tokio::time::timeout(Duration::from_secs(5), &mut self.done)
            .await
            .expect("run did not return after the stop")
            .unwrap();
        (code, self.out.text())
    }
}

/// One raw request; the answer as text. Every caller asks for the close, so
/// the bound only stops a hang: a first edit takes 200 ms alone and past 5 s
/// when a workspace run takes every core.
async fn exchange(address: &str, request: &str) -> String {
    let mut conn = TcpStream::connect(address).await.unwrap();
    conn.write_all(request.as_bytes()).await.unwrap();
    let mut answer = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(30), conn.read_to_end(&mut answer)).await;
    String::from_utf8_lossy(&answer).into_owned()
}

/// Status, lower-cased header lines and body of one Connection: close
/// request.
async fn request(
    address: &str,
    method: &str,
    path: &str,
    proto: &str,
) -> (u16, Vec<(String, String)>, String) {
    let answer = exchange(
        address,
        &format!("{method} {path} {proto}\r\nHost: x\r\nConnection: close\r\n\r\n"),
    )
    .await;
    parse_answer(&answer)
}

fn parse_answer(answer: &str) -> (u16, Vec<(String, String)>, String) {
    let (head, body) = answer.split_once("\r\n\r\n").unwrap_or((answer, ""));
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap_or("")[9..12].parse().unwrap();
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(n, v)| (n.to_ascii_lowercase(), v.trim().to_owned()))
        .collect::<Vec<_>>();
    let chunked = headers
        .iter()
        .any(|(n, v)| n == "transfer-encoding" && v == "chunked");
    let body = if chunked {
        dechunk(body)
    } else {
        body.to_owned()
    };
    (status, headers, body)
}

fn dechunk(mut body: &str) -> String {
    let mut out = String::new();
    while let Some((size, rest)) = body.split_once("\r\n") {
        let size = usize::from_str_radix(size, 16).unwrap_or(0);
        if size == 0 {
            break;
        }
        out.push_str(&rest[..size]);
        body = &rest[size + 2..];
    }
    out
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> String {
    headers
        .iter()
        .filter(|(n, _)| n == name)
        .map(|(_, v)| v.as_str())
        .collect::<Vec<&'a str>>()
        .join(",")
}

#[tokio::test]
async fn help_prints_usage_and_exits_zero() {
    for flag in ["--help", "-h", "-help"] {
        let (code, stderr) = run_to_exit(&[flag]).await;
        assert_eq!(code, 0, "{flag}");
        assert_eq!(stderr, USAGE, "{flag}");
    }
}

// The C# host owns the usage text; this keeps the Rust copy in lockstep.
#[test]
fn usage_matches_the_csharp_host() {
    let path = format!(
        "{}/../../../dotnet/Blok.Server.Host/HostArguments.cs",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).unwrap();
    let start = text.find("internal const string Usage =").unwrap();
    let open = text[start..].find("\"\"\"").unwrap() + start + 3;
    let end = text[open..].find("\"\"\"").unwrap() + open;
    let lines: Vec<&str> = text[open..end].split('\n').skip(1).collect();
    let indent = lines[lines.len() - 1];
    let lines: Vec<&str> = lines
        .iter()
        .map(|l| l.strip_prefix(indent).unwrap_or(l))
        .collect();
    // A C# raw string drops the newline before its closing quotes.
    let want = lines[..lines.len() - 1].join("\n");
    assert_eq!(USAGE, want, "usage drifted from HostArguments.Usage");
}

#[tokio::test]
async fn unknown_flag_prints_error_then_usage_and_exits_two() {
    let (code, stderr) = run_to_exit(&["--not-a-real-flag"]).await;
    assert_eq!(code, 2);
    assert_eq!(
        stderr,
        format!("flag provided but not defined: -not-a-real-flag\n{USAGE}")
    );
}

// The ordinary build has no conformance flags; the host parser refuses them.
#[cfg(not(feature = "conformance"))]
#[tokio::test]
async fn the_ordinary_build_refuses_the_conformance_flags() {
    for flag in [
        "--conformance-origin=http://127.0.0.1:1",
        "--conformance-journal",
    ] {
        let (code, stderr) = run_to_exit(&[flag]).await;
        let name = flag.trim_start_matches('-').split('=').next().unwrap();
        assert_eq!(code, 2, "{flag}");
        assert_eq!(
            stderr,
            format!("flag provided but not defined: -{name}\n{USAGE}")
        );
    }
}

#[tokio::test]
async fn missing_flag_value_exits_two() {
    let (code, stderr) = run_to_exit(&["--listen"]).await;
    assert!(
        code == 2 && stderr.starts_with("flag needs an argument: -listen\n"),
        "{code} {stderr:?}"
    );
}

#[test]
fn listen_default() {
    let parsed = parse_host_arguments(&[], &no_env);
    assert_eq!(parsed.err, "");
    assert_eq!(parsed.options.listen_address, "127.0.0.1:4000");
    assert_eq!(parsed.options.auth, "none");
}

#[test]
fn listen_accepts_every_flag_spelling() {
    for args in [
        &["--listen", "127.0.0.1:5000"][..],
        &["-listen", "127.0.0.1:5000"],
        &["--listen=127.0.0.1:5000"],
        &["-listen=127.0.0.1:5000"],
    ] {
        let parsed = parse_host_arguments(&strings(args), &no_env);
        assert!(
            parsed.err.is_empty() && parsed.options.listen_address == "127.0.0.1:5000",
            "{args:?}"
        );
    }
}

#[test]
fn bare_boolean_flags_parse() {
    let parsed = parse_host_arguments(
        &strings(&["--no-unfurl", "--collab", "--collab-journal"]),
        &no_env,
    );
    assert!(parsed.err.is_empty());
    assert!(
        !parsed.options.unfurl_enabled
            && parsed.options.collab_enabled
            && parsed.options.collab_journal
    );
}

#[tokio::test]
async fn malformed_listen_refuses_to_start() {
    for (listen, want) in [
        (
            "localhost",
            "blok-server refused to start: listen tcp: address localhost: missing port in address\n",
        ),
        (
            "localhost:65536",
            "blok-server refused to start: listen tcp: address 65536: invalid port\n",
        ),
    ] {
        let (code, stderr) = run_to_exit(&["--listen", listen]).await;
        assert_eq!((code, stderr.as_str()), (1, want), "{listen}");
    }
}

#[tokio::test]
async fn lost_bind_refuses_to_start() {
    let owner = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = owner.local_addr().unwrap().to_string();
    let (code, stderr) = run_to_exit(&["--listen", &address]).await;
    assert_eq!(code, 1);
    assert!(
        stderr.starts_with("blok-server refused to start: ")
            && stderr.contains("address already in use")
            && !stderr.contains(" listening on "),
        "{stderr:?}"
    );
}

#[tokio::test]
async fn listening_line_comes_after_bind_and_health_answers() {
    let running = Running::start(&[], no_env, "dev").await;
    // The line is written only after bind, so the port answers at once.
    let (status, _, body) = request(&running.address, "GET", "/health", "HTTP/1.1").await;
    let want = format!(
        "blok-server dev listening on {} (--auth none)\n",
        running.address
    );
    assert_eq!(running.out.text(), want);
    assert_eq!(
        (status, body.as_str()),
        (200, "{\"status\":\"ok\",\"version\":\"dev\"}\n")
    );
    let (code, _) = running.stop().await;
    assert_eq!(code, 0);
}

#[tokio::test]
async fn health_wire() {
    let running = Running::start(&[], no_env, "dev").await;
    let address = running.address.clone();
    let (status, headers, body) = request(&address, "GET", "/health", "HTTP/1.1").await;
    assert_eq!(
        (
            status,
            header(&headers, "content-type").as_str(),
            body.as_str()
        ),
        (
            200,
            "application/json",
            "{\"status\":\"ok\",\"version\":\"dev\"}\n"
        )
    );
    let (status, headers, body) = request(&address, "HEAD", "/health", "HTTP/1.1").await;
    assert_eq!(
        (
            status,
            header(&headers, "content-type").as_str(),
            body.as_str()
        ),
        (200, "application/json", "")
    );
    let (status, headers, body) = request(&address, "POST", "/health", "HTTP/1.1").await;
    assert_eq!(
        (
            status,
            header(&headers, "allow").as_str(),
            header(&headers, "content-type").as_str(),
            body.as_str()
        ),
        (
            405,
            "GET, HEAD",
            "text/plain; charset=utf-8",
            "Method Not Allowed\n"
        )
    );
    let (status, headers, body) = request(&address, "GET", "/missing", "HTTP/1.1").await;
    assert_eq!(
        (
            status,
            header(&headers, "content-type").as_str(),
            body.as_str()
        ),
        (404, "text/plain; charset=utf-8", "404 page not found\n")
    );
    running.stop().await;
}

// The rest of the routing rules are pinned in blok-route and black-box in
// routing-contract.test.ts.
#[tokio::test]
async fn health_goes_through_the_kestrel_router() {
    let running = Running::start(&[], no_env, "dev").await;
    let address = running.address.clone();
    for path in ["/HEALTH", "/health/", "/./health"] {
        assert_eq!(
            request(&address, "GET", path, "HTTP/1.1").await.0,
            200,
            "GET {path}"
        );
    }
    for path in ["//health", "/health//"] {
        assert_eq!(
            request(&address, "GET", path, "HTTP/1.1").await.0,
            404,
            "GET {path}"
        );
    }
    let (status, headers, _) = request(&address, "POST", "/health", "HTTP/1.1").await;
    assert!(status == 405 && header(&headers, "x-content-type-options").is_empty());
    let (status, _, body) = request(&address, "head", "/health", "HTTP/1.1").await;
    assert_eq!((status, body.as_str()), (200, ""));
    running.stop().await;
}

// Kestrel sends "OPTIONS *" to the 404 catch-all.
#[tokio::test]
async fn options_star_gets_the_catch_all() {
    let running = Running::start(&[], no_env, "dev").await;
    let reply = exchange(
        &running.address,
        "OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert!(
        reply.starts_with("HTTP/1.1 404 ") && reply.contains("\r\n404 page not found\n\r\n"),
        "{reply:?}"
    );
    running.stop().await;
}

#[tokio::test]
async fn health_reports_the_stamped_version() {
    let running = Running::start(&[], no_env, "1.2.3").await;
    let (_, _, body) = request(&running.address, "GET", "/health", "HTTP/1.1").await;
    assert_eq!(body, "{\"status\":\"ok\",\"version\":\"1.2.3\"}\n");
    running.stop().await;
}

/// The binary listening on a free port, and that port.
async fn listening_binary(
    args: &[&str],
    envs: &[(&str, &str)],
) -> (std::process::Child, Arc<Mutex<String>>, String) {
    loop {
        let address = free_port();
        let mut all = vec!["--listen", address.as_str()];
        all.extend(args);
        let (mut child, text) = spawn_binary(&all, envs);
        if listened(&|| text.lock().unwrap().clone()).await {
            return (child, text, address);
        }
        let _ = child.wait();
    }
}

fn spawn_binary(args: &[&str], envs: &[(&str, &str)]) -> (std::process::Child, Arc<Mutex<String>>) {
    use std::io::Read;
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_blok-server"))
        .args(args)
        .envs(envs.iter().copied())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = child.stderr.take().unwrap();
    let text = Arc::new(Mutex::new(String::new()));
    let shared = Arc::clone(&text);
    std::thread::spawn(move || {
        let mut chunk = [0u8; 1024];
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            shared
                .lock()
                .unwrap()
                .push_str(&String::from_utf8_lossy(&chunk[..n]));
        }
    });
    (child, text)
}

#[tokio::test]
async fn binary_exits_within_two_seconds_of_sigterm() {
    for signal in ["TERM", "INT", "QUIT"] {
        let (mut child, _, _) = listening_binary(&[], &[]).await;
        let killed = std::process::Command::new("kill")
            .args([&format!("-{signal}"), &child.id().to_string()])
            .status()
            .unwrap();
        assert!(killed.success());
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert_eq!(status.code(), Some(0), "SIG{signal}");
                break;
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                panic!("did not exit within 2s of SIG{signal}");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

#[test]
#[ignore = "stamping 9.8.7 needs a second cargo build of the binary from inside the test, which would rebuild the binary the other tests run; published_host_reports_the_supplied_build_version checks the stamp this build carries on stderr and /health"]
fn binary_version_comes_from_ldflags() {}

// Kestrel streams answers with a body: chunked on HTTP/1.1, closed on
// HTTP/1.0, and no length header on HEAD. It frames "head" like GET, and an
// answer with no body written gets Content-Length: 0.
#[tokio::test]
async fn answers_are_framed_like_kestrel() {
    let running = Running::start(&[], no_env, "dev").await;
    let cases = [
        ("GET", "/health", "HTTP/1.1", 200, "chunked", ""),
        ("HEAD", "/health", "HTTP/1.1", 200, "", ""),
        ("head", "/health", "HTTP/1.1", 200, "", "0"),
        ("GET", "/health", "HTTP/1.0", 200, "", ""),
        ("HEAD", "/health", "HTTP/1.0", 200, "", ""),
        ("GET", "/nope", "HTTP/1.1", 404, "chunked", ""),
        ("HEAD", "/nope", "HTTP/1.1", 404, "", ""),
        ("head", "/nope", "HTTP/1.1", 404, "chunked", ""),
        ("GET", "/nope", "HTTP/1.0", 404, "", ""),
        ("HEAD", "/nope", "HTTP/1.0", 404, "", ""),
        ("POST", "/health", "HTTP/1.1", 405, "chunked", ""),
        ("DELETE", "/health", "HTTP/1.0", 405, "", ""),
    ];
    for (method, path, proto, status, transfer_encoding, content_length) in cases {
        let (got, headers, _) = request(&running.address, method, path, proto).await;
        assert_eq!(
            (
                got,
                header(&headers, "transfer-encoding"),
                header(&headers, "content-length")
            ),
            (
                status,
                transfer_encoding.to_owned(),
                content_length.to_owned()
            ),
            "{method} {path} {proto}"
        );
    }
    running.stop().await;
}

// HostCollab.Configure: the host caps upgraded sockets at 1024 so the
// service refuses 503 before a room is seeded.
#[test]
fn the_host_caps_sync_connections_only_when_collaborating() {
    let sink: Stderr = Arc::new(Mutex::new(std::io::sink()));
    let mut options = Options::default();
    configure_collab(&mut options, &sink);
    assert_eq!(options.collab_max_connections, 0);
    options.collab_enabled = true;
    configure_collab(&mut options, &sink);
    assert_eq!(options.collab_max_connections, 1024);
}

// args_number_test.go: the flag number grammar is strconv.ParseInt(s, 0,
// 64), which the C# host writes out in TryParseBaseZeroInt64.

#[test]
fn flag_numbers_accept_the_base_zero_grammar() {
    for value in ["16", "+16", "020", "0o20", "0x10", "0b10000", "1_6"] {
        let parsed = parse_host_arguments(
            &strings(&["--max-upload", value, "--rate-limit", value]),
            &no_env,
        );
        assert!(
            parsed.err.is_empty()
                && parsed.options.max_upload_bytes == 16
                && parsed.options.rate_limit_per_minute == 16,
            "{value:?}: {:?} {} {}",
            parsed.err,
            parsed.options.max_upload_bytes,
            parsed.options.rate_limit_per_minute
        );
    }
}

#[test]
fn a_leading_zero_is_octal() {
    let parsed = parse_host_arguments(
        &strings(&["--max-upload", "040000000", "--rate-limit", "010"]),
        &no_env,
    );
    assert!(parsed.err.is_empty());
    assert_eq!(
        (
            parsed.options.max_upload_bytes,
            parsed.options.rate_limit_per_minute
        ),
        (8 << 20, 8)
    );
}

#[test]
fn a_rate_limit_takes_signed64_bits() {
    let parsed = parse_host_arguments(&strings(&["--rate-limit", "0x80000000"]), &no_env);
    assert!(parsed.err.is_empty());
    assert_eq!(parsed.options.rate_limit_per_minute, 1 << 31);
}

#[tokio::test]
async fn invalid_or_overflowing_flag_numbers_are_parse_errors() {
    for (flag, value) in [
        ("--max-upload", "08"),
        ("--max-upload", "1__0"),
        ("--max-upload", "0x8000000000000000"),
        ("--rate-limit", "0x8000000000000000"),
    ] {
        let (code, stderr) =
            run_to_exit(&["--listen", "0.0.0.0:0", "--storage-dir", "", flag, value]).await;
        let want = format!("invalid value \"{value}\" for flag -{}", &flag[2..]);
        assert!(
            code == 2 && stderr.contains(&want),
            "{flag} {value}: {code} {stderr:?}"
        );
    }
}

#[test]
fn the_most_negative_number_parses() {
    let parsed = parse_host_arguments(&strings(&["--rate-limit", "-0x8000000000000000"]), &no_env);
    assert!(parsed.err.is_empty());
    assert_eq!(parsed.options.rate_limit_per_minute, i64::MIN);
}

// A signed value parses; the refusal is validation's, with exit 1.
#[tokio::test]
async fn a_signed_maximum_is_a_validation_refusal() {
    let (code, stderr) = run_to_exit(&[
        "--listen",
        "127.0.0.1:0",
        "--storage-dir",
        "",
        "--max-upload",
        "-0x1",
    ])
    .await;
    assert!(
        code == 1 && stderr.contains("--max-upload must be a positive number of bytes (got -1)"),
        "{code} {stderr:?}"
    );
}

#[test]
fn every_explicit_negative_rate_limit_is_refused() {
    for value in ["-1", "-2", "-010", "-0x1"] {
        let parsed = parse_host_arguments(&strings(&["--rate-limit", value]), &no_env);
        assert!(parsed.err.is_empty(), "{value}: {}", parsed.err);
        let error = Server::new(parsed.options)
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(error.contains("--rate-limit"), "{value}: {error:?}");
    }
}

// collablog_test.go

fn room_logger(out: &Buffer) -> CollabStderr {
    CollabStderr { out: out.stderr() }
}

// H37: only the room category, Warning and up, one line each.
#[test]
fn the_host_prints_only_room_warnings_and_errors() {
    let out = Buffer::default();
    let logger = room_logger(&out);
    logger.log(Level::Info, COLLAB_LOG_CATEGORY, "an info line");
    logger.log(Level::Warn, COLLAB_LOG_CATEGORY, "collab: a warning");
    logger.log(Level::Error, COLLAB_LOG_CATEGORY, "collab: an error");
    logger.log(Level::Warn, "Blok.Server.AspNetCore", "open routes");
    logger.log(Level::Warn, "", "no category");
    assert_eq!(
        out.text(),
        "warning: collab: a warning\nerror: collab: an error\n"
    );
}

// host-log-lines.json is shared with HostCollabLogTests in C#.
#[test]
fn the_host_escapes_control_characters_in_room_lines() {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/host-log-lines.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let node = parse_node(&std::fs::read(path).unwrap(), JsonOptions::default()).unwrap();
    assert!(!node.items.is_empty());
    for case in &node.items {
        let field = |name: &str| {
            let member = case
                .members
                .iter()
                .find(|m| to_string_lossy(m.key().unwrap().units()) == name)
                .unwrap();
            to_string_lossy(member.value.text().unwrap().units())
        };
        let out = Buffer::default();
        let level = if field("level") == "error" {
            Level::Error
        } else {
            Level::Warn
        };
        room_logger(&out).log(level, COLLAB_LOG_CATEGORY, &field("message"));
        assert_eq!(out.text(), field("line"), "{}", field("name"));
    }
}

#[test]
#[ignore = "Go only: a Rust string, like a C# one, cannot hold an invalid UTF-8 byte"]
fn the_host_keeps_invalid_utf8_bytes_in_room_lines() {}

// collab_test.go

// Twins of HostProcessTests.WarnsWhenTheDocEndpointAuthComesFromTheFlag
// and ReadsTheDocEndpointAuthFromTheEnvironmentWithoutWarning (H20).
#[tokio::test]
async fn the_doc_endpoint_auth_warns_only_when_it_comes_from_the_flag() {
    let collab_dir = std::env::temp_dir().join(format!("blok-host-collab-{}", std::process::id()));
    let collab_dir = collab_dir.display().to_string();
    let collab = [
        "--collab",
        "--doc-endpoint",
        "https://app.example.com/api/blok-docs",
        "--storage-dir",
        "",
        "--collab-dir",
        &collab_dir,
    ];

    let mut with_flag = collab.to_vec();
    with_flag.extend(["--doc-endpoint-auth", "Bearer app-token"]);
    let (code, from_flag) = Running::start(&with_flag, no_env, "dev").await.stop().await;
    assert_eq!(code, 0);
    assert!(
        from_flag.contains(
            "warning: --doc-endpoint-auth puts the credential in this machine's process list"
        ),
        "no warning from the flag: {from_flag:?}"
    );

    fn from_environment(name: &str) -> String {
        if name == "BLOK_DOC_ENDPOINT_AUTH" {
            "Bearer environment-token".into()
        } else {
            String::new()
        }
    }
    let (code, text) = Running::start(&collab, from_environment, "dev")
        .await
        .stop()
        .await;
    assert_eq!(code, 0);
    let listening = text.find(" listening on ").unwrap();
    assert!(
        !text[..listening].contains("--doc-endpoint-auth"),
        "the environment warned: {text:?}"
    );
}

// H34: the host gives the drain C#'s 30 s (HostCollab.ShutdownTimeout), so a
// doc endpoint that takes 2 s to save still gets the room's last state.
#[tokio::test(flavor = "multi_thread")]
async fn the_shutdown_drain_outlasts_a_slow_doc_endpoint() {
    let endpoint = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint_address = endpoint.local_addr().unwrap();
    let (saved_tx, mut saved) = tokio::sync::mpsc::unbounded_channel::<String>();
    let server = blok_http::Server::new(
        move |mut request: blok_http::Request, mut response: blok_http::ResponseWriter| {
            let saved_tx = saved_tx.clone();
            async move {
                if request.method() == "GET" {
                    let _ = response.write(b"null").await;
                    return;
                }
                let mut body = Vec::new();
                if let Some(reader) = request.body_mut() {
                    let _ = reader.read_to_end(&mut body).await;
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
                response.set_status(204);
                let _ = saved_tx.send(String::from_utf8_lossy(&body).into_owned());
            }
        },
        blok_http::Config::default(),
    );
    let serving = tokio::spawn(async move {
        let _ = server.serve(endpoint).await;
    });
    let collab_dir = std::env::temp_dir().join(format!(
        "blok-host-drain-{}-{}",
        std::process::id(),
        endpoint_address.port()
    ));
    let collab_dir = collab_dir.display().to_string();
    let doc_endpoint = format!("http://{endpoint_address}");
    let mut running = Running::start(
        &[
            "--auth",
            "none",
            "--collab",
            "--doc-endpoint",
            &doc_endpoint,
            "--storage-dir",
            "",
            "--collab-dir",
            &collab_dir,
        ],
        no_env,
        "dev",
    )
    .await;

    let body =
        r#"{"ops":[{"op":"insert","id":"a","block":{"type":"paragraph","data":{"text":"kept"}}}]}"#;
    let answer = exchange(
        &running.address,
        &format!(
            "POST /sync/doc/edit HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Type: application/json\r\nBlok-Idempotency-Key: k1\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        ),
    )
    .await;
    assert!(answer.starts_with("HTTP/1.1 204"), "edit: {answer:?}");

    let _ = running.stop.take().unwrap().send(());
    let code = tokio::time::timeout(Duration::from_secs(10), &mut running.done)
        .await
        .expect("run did not return")
        .unwrap();
    let text = running.out.text();
    assert_eq!(code, 0, "exit {code}: {text}");
    assert!(
        !text.contains("the shutdown drain did not complete"),
        "the drain was cut short: {text}"
    );
    let body = saved
        .try_recv()
        .expect("the endpoint never finished a save");
    assert!(body.contains(r#""kept""#), "saved {body}");
    serving.abort();
}

// HostCollab.Configure sets Kestrel's MaxConcurrentUpgradedConnections to
// 1024 only with collab; without it Kestrel has no limit.
#[test]
fn the_host_limits_upgraded_sockets_only_when_collaborating() {
    let mut options = Options::default();
    assert_eq!(blok_server::upgrade_limit(&options), None);
    options.collab_enabled = true;
    assert_eq!(blok_server::upgrade_limit(&options), Some(1024));
}

// HostProcessTests.cs

const VALID_SECRET: &str = "a-secret-value-with-at-least-32-characters";
const VALID_DOC_ENDPOINT: &str = "https://app.example.test/api/blok-docs";

/// Status and body of one POST with a Connection: close.
async fn post(address: &str, path: &str, content_type: &str, body: &[u8]) -> (u16, String) {
    let mut conn = TcpStream::connect(address).await.unwrap();
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    conn.write_all(head.as_bytes()).await.unwrap();
    conn.write_all(body).await.unwrap();
    let mut answer = Vec::new();
    // A hang guard, as in exchange.
    let _ = tokio::time::timeout(Duration::from_secs(30), conn.read_to_end(&mut answer)).await;
    let (status, _, body) = parse_answer(&String::from_utf8_lossy(&answer));
    (status, body)
}

fn scratch_dir(name: &str) -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("blok-host-{name}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn spool_files(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".blok-upload-"))
        .collect()
}

#[tokio::test]
async fn starts_with_defaults_and_reports_the_development_version() {
    let running = Running::start(&[], no_env, "dev").await;
    let address = running.address.clone();
    let (status, headers, body) = request(&address, "GET", "/health", "HTTP/1.1").await;
    assert_eq!(
        (
            status,
            header(&headers, "content-type").as_str(),
            body.as_str()
        ),
        (
            200,
            "application/json",
            "{\"status\":\"ok\",\"version\":\"dev\"}\n"
        )
    );
    let (status, _, body) = request(&address, "GET", "/unfurl", "HTTP/1.1").await;
    assert_eq!((status, body.as_str()), (400, "{\"success\":0}\n"));
    let (status, body) = post(&address, "/upload", "text/plain; charset=utf-8", b"").await;
    assert_eq!((status, body.as_str()), (400, "malformed upload\n"));
    let (status, body) = post(
        &address,
        "/upload-by-url",
        "application/json; charset=utf-8",
        b"",
    )
    .await;
    assert_eq!(
        (status, body.as_str()),
        (400, "expected {\"url\": \"...\"}\n")
    );
    running.stop().await;
}

// The stamp is read at compile time, and cargo builds this test and the
// binary with the same environment, so both see the same value.
#[tokio::test]
async fn published_host_reports_the_supplied_build_version() {
    let want = option_env!("BLOK_SERVER_VERSION").unwrap_or("dev");
    let (mut child, text, address) = listening_binary(&[], &[]).await;
    let (status, _, body) = request(&address, "GET", "/health", "HTTP/1.1").await;
    let _ = child.kill();
    let _ = child.wait();
    let stderr = text.lock().unwrap().clone();
    assert!(
        stderr.starts_with(&format!("blok-server {want} listening on ")),
        "{stderr:?}"
    );
    assert_eq!(
        (status, body),
        (
            200,
            format!("{{\"status\":\"ok\",\"version\":\"{want}\"}}\n")
        )
    );
}

#[tokio::test]
async fn removes_the_endpoint_spool_after_malformed_trailing_data() {
    let root = scratch_dir("malformed-cleanup");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let storage = root.join("storage").display().to_string();
    let (mut child, _, address) = listening_binary(
        &["--storage-dir", &storage],
        &[("TMPDIR", temp.to_str().unwrap())],
    )
    .await;
    let b = "blok-host-malformed-cleanup-boundary";
    let body = format!(
        "--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"first.txt\"\r\nContent-Type: text/plain\r\n\r\nvalid file\r\n--{b}\r\nContent-Disposition: form-data; name=\"note\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=\r\n--{b}--\r\n"
    );
    let answer = post(
        &address,
        "/upload",
        &format!("multipart/form-data; boundary={b}"),
        body.as_bytes(),
    )
    .await;
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(answer, (400, "malformed upload\n".to_owned()));
    assert_eq!(spool_files(&temp), Vec::<String>::new());
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn removes_the_endpoint_spool_after_storage_failure() {
    let root = scratch_dir("storage-failure-cleanup");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let storage = root.join("storage-file");
    std::fs::write(&storage, "occupied").unwrap();
    let (mut child, _, address) = listening_binary(
        &["--storage-dir", storage.to_str().unwrap()],
        &[("TMPDIR", temp.to_str().unwrap())],
    )
    .await;
    let b = "blok-host-storage-failure-cleanup-boundary";
    let body = format!(
        "--{b}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: form-data; name=file; filename=upload.bin; filename*=utf-8''upload.bin\r\n\r\nuploaded bytes\r\n--{b}--\r\n"
    );
    let answer = post(
        &address,
        "/upload",
        &format!("multipart/form-data; boundary=\"{b}\""),
        body.as_bytes(),
    )
    .await;
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(answer, (502, "upload failed\n".to_owned()));
    assert_eq!(spool_files(&temp), Vec::<String>::new());
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn refuses_a_malformed_local_public_url_before_binding() {
    let (code, stderr) = run_to_exit(&[
        "--listen",
        &free_port(),
        "--public-url",
        "https://uploads.example/%zz",
    ])
    .await;
    assert_eq!(code, 1, "{stderr:?}");
    assert!(
        stderr.starts_with("blok-server refused to start: ")
            && stderr.contains("PublicUrl")
            && !stderr.contains(" listening on "),
        "{stderr:?}"
    );
}

#[test]
fn uses_a_loopback_public_url_for_wildcard_listeners() {
    for listen in ["*:4000", "+:4000"] {
        let parsed = parse_host_arguments(&strings(&["--listen", listen]), &no_env);
        assert_eq!(parsed.err, "", "{listen}");
        assert_eq!(
            parsed.options.public_url, "http://127.0.0.1:4000/files",
            "{listen}"
        );
    }
}

#[test]
fn uses_the_auth_default_rate_limit_when_the_flag_is_omitted() {
    for (auth, want) in [("none", 0), ("proxy", 0), ("ticket", 60)] {
        let parsed = parse_host_arguments(&strings(&["--auth", auth]), &no_env);
        assert_eq!(parsed.err, "", "{auth}");
        assert_eq!(parsed.options.rate_limit_per_minute, want, "{auth}");
    }
}

#[tokio::test]
async fn accepts_every_flag_and_lets_an_explicit_secret_override_the_environment() {
    fn environment(name: &str) -> String {
        match name {
            "BLOK_SECRET" => "short",
            "BLOK_S3_ACCESS_KEY" => "access-key",
            "BLOK_S3_SECRET_KEY" => "secret-key",
            _ => "",
        }
        .to_owned()
    }
    let collab_dir = scratch_dir("every-flag").display().to_string();
    let running = Running::start(
        &[
            "--auth",
            "ticket",
            "--secret",
            VALID_SECRET,
            "--allow-origin",
            "https://app.example.com, https://admin.example.com",
            "--storage-dir",
            "",
            "--public-url",
            "https://uploads.example.com/files",
            "--max-upload",
            "1024",
            "--rate-limit",
            "7",
            "--no-unfurl",
            "--s3-endpoint",
            "https://s3.example.com",
            "--s3-region",
            "eu-central-1",
            "--s3-bucket",
            "blok",
            "--s3-bucket-url",
            "https://uploads.example.com",
            "--s3-addressing",
            "path",
            "--collab",
            "--doc-endpoint",
            VALID_DOC_ENDPOINT,
            "--doc-endpoint-auth",
            "Bearer app-token",
            "--collab-dir",
            &collab_dir,
            "--collab-s3-prefix",
            "collab/",
        ],
        environment,
        "dev",
    )
    .await;
    let address = running.address.clone();
    assert_eq!(request(&address, "GET", "/health", "HTTP/1.1").await.0, 200);
    assert_eq!(request(&address, "GET", "/unfurl", "HTTP/1.1").await.0, 404);
    let answer = post(&address, "/upload", "text/plain; charset=utf-8", b"").await;
    assert_eq!(answer, (403, "origin not allowed\n".to_owned()));
    let (status, _) = post(&address, "/upload-by-url", "text/plain; charset=utf-8", b"").await;
    assert_eq!(status, 404);
    let (code, _) = running.stop().await;
    assert_eq!(code, 0);
    let _ = std::fs::remove_dir_all(&collab_dir);
}

#[tokio::test]
async fn keeps_port_zero_when_binding_a_blank_host_listener() {
    // The later --listen wins over the one Running::start puts first.
    let running = Running::start(
        &[
            "--listen",
            ":0",
            "--auth",
            "ticket",
            "--secret",
            VALID_SECRET,
            "--allow-origin",
            "https://app.example.com",
            "--storage-dir",
            "",
        ],
        no_env,
        "dev",
    )
    .await;
    assert!(
        running.out.text().contains("listening on :0"),
        "{:?}",
        running.out.text()
    );
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(!running.done.is_finished(), "{:?}", running.out.text());
    let (code, _) = running.stop().await;
    assert_eq!(code, 0);
}

fn doc_endpoint_auth_environment(name: &str) -> String {
    if name == "BLOK_DOC_ENDPOINT_AUTH" {
        "Bearer environment-token".into()
    } else {
        String::new()
    }
}

#[test]
fn parses_the_doc_endpoint_auth_from_the_environment() {
    let parsed = parse_host_arguments(
        &strings(&["--collab", "--doc-endpoint", VALID_DOC_ENDPOINT]),
        &doc_endpoint_auth_environment,
    );
    assert_eq!(parsed.err, "");
    assert!(parsed.options.collab_enabled);
    assert_eq!(parsed.options.doc_endpoint, VALID_DOC_ENDPOINT);
    assert_eq!(parsed.options.doc_endpoint_auth, "Bearer environment-token");
    assert!(!parsed.doc_endpoint_auth_from_flag);
}

#[test]
fn lets_an_explicit_doc_endpoint_auth_flag_override_the_environment() {
    let parsed = parse_host_arguments(
        &strings(&[
            "--collab",
            "--doc-endpoint",
            VALID_DOC_ENDPOINT,
            "--doc-endpoint-auth",
            "Bearer flag-token",
        ]),
        &doc_endpoint_auth_environment,
    );
    assert_eq!(parsed.err, "");
    assert_eq!(parsed.options.doc_endpoint_auth, "Bearer flag-token");
    assert!(parsed.doc_endpoint_auth_from_flag);
}

#[test]
fn defaults_collab_off_with_a_working_set_directory_beside_the_uploads() {
    let parsed = parse_host_arguments(&[], &no_env);
    assert_eq!(parsed.err, "");
    let o = &parsed.options;
    assert!(!o.collab_enabled);
    assert_eq!(o.collab_directory, "./blok-collab");
    assert_eq!(
        (
            o.doc_endpoint.as_str(),
            o.doc_endpoint_auth.as_str(),
            o.collab_s3_prefix.as_str()
        ),
        ("", "", "")
    );
}

#[test]
fn parses_the_boolean_collab_flag_forms() {
    let enabled = parse_host_arguments(&strings(&["--collab"]), &no_env);
    assert!(enabled.err.is_empty() && enabled.options.collab_enabled);
    let disabled = parse_host_arguments(&strings(&["--collab=false"]), &no_env);
    assert!(disabled.err.is_empty() && !disabled.options.collab_enabled);
}

#[test]
fn parses_the_boolean_collab_journal_flag_forms() {
    let enabled = parse_host_arguments(&strings(&["--collab-journal"]), &no_env);
    assert!(enabled.err.is_empty() && enabled.options.collab_journal);
    let disabled = parse_host_arguments(&strings(&["--collab-journal=false"]), &no_env);
    assert!(disabled.err.is_empty() && !disabled.options.collab_journal);
    let invalid = parse_host_arguments(&strings(&["--collab-journal=maybe"]), &no_env);
    assert_eq!(
        invalid.err,
        "invalid value \"maybe\" for flag -collab-journal: parse error"
    );
}

#[test]
fn reads_the_collab_journal_from_the_environment_unless_the_flag_is_given() {
    let journal = |name: &str| {
        if name == "BLOK_COLLAB_JOURNAL" {
            "true".to_owned()
        } else {
            String::new()
        }
    };
    let from_environment = parse_host_arguments(&strings(&["--collab"]), &journal);
    assert!(from_environment.err.is_empty() && from_environment.options.collab_journal);
    let flag_wins = parse_host_arguments(&strings(&["--collab-journal=false"]), &journal);
    assert!(flag_wins.err.is_empty() && !flag_wins.options.collab_journal);
    let empty = parse_host_arguments(&[], &no_env);
    assert!(empty.err.is_empty() && !empty.options.collab_journal);
    let invalid = parse_host_arguments(&[], &|name: &str| {
        if name == "BLOK_COLLAB_JOURNAL" {
            "maybe".to_owned()
        } else {
            String::new()
        }
    });
    assert_eq!(
        invalid.err,
        "invalid value \"maybe\" for BLOK_COLLAB_JOURNAL: parse error"
    );
}

#[test]
fn parses_the_rich_text_fields_flag_as_a_json_object_of_field_lists() {
    let parsed = parse_host_arguments(
        &strings(&[
            "--rich-text-fields",
            r#"{ "callout": ["title", "caption"], "widget": [] }"#,
        ]),
        &no_env,
    );
    assert_eq!(parsed.err, "");
    let fields = &parsed.options.rich_text_fields;
    assert_eq!(fields.keys().collect::<Vec<_>>(), ["callout", "widget"]);
    assert_eq!(fields["callout"], ["title", "caption"]);
    assert!(fields["widget"].is_empty());
}

#[test]
fn defaults_the_rich_text_fields_to_none() {
    let parsed = parse_host_arguments(&[], &no_env);
    assert_eq!(parsed.err, "");
    assert!(parsed.options.rich_text_fields.is_empty());
}

#[test]
fn refuses_rich_text_fields_that_are_not_an_object_of_string_lists() {
    for value in [
        "not json",
        r#"["callout"]"#,
        r#"{ "callout": "title" }"#,
        r#"{ "callout": [1] }"#,
        r#"{ "callout": [null] }"#,
        r#"{ "callout": null }"#,
        r#"{ "a": ["x"], "a": ["y"] }"#,
    ] {
        let parsed = parse_host_arguments(&strings(&["--rich-text-fields", value]), &no_env);
        assert_eq!(
            parsed.err,
            format!("invalid value \"{value}\" for flag -rich-text-fields: parse error")
        );
    }
}

#[test]
fn reads_the_rich_text_fields_from_the_environment_unless_the_flag_is_given() {
    let fields = |name: &str| {
        if name == "BLOK_RICH_TEXT_FIELDS" {
            r#"{ "callout": ["title"] }"#.to_owned()
        } else {
            String::new()
        }
    };
    let from_environment = parse_host_arguments(&[], &fields);
    assert_eq!(from_environment.err, "");
    assert_eq!(
        from_environment.options.rich_text_fields["callout"],
        ["title"]
    );
    let flag_wins = parse_host_arguments(
        &strings(&["--rich-text-fields", r#"{ "widget": ["text"] }"#]),
        &fields,
    );
    assert_eq!(flag_wins.err, "");
    assert_eq!(
        flag_wins
            .options
            .rich_text_fields
            .keys()
            .collect::<Vec<_>>(),
        ["widget"]
    );
    let empty = parse_host_arguments(&[], &no_env);
    assert!(empty.err.is_empty() && empty.options.rich_text_fields.is_empty());
    let invalid = parse_host_arguments(&[], &|name: &str| {
        if name == "BLOK_RICH_TEXT_FIELDS" {
            "nope".to_owned()
        } else {
            String::new()
        }
    });
    assert_eq!(
        invalid.err,
        "invalid value \"nope\" for BLOK_RICH_TEXT_FIELDS: parse error"
    );
}

// Only the rows no other Rust test or conformance case covers.
#[tokio::test]
async fn exits_with_the_contract_code() {
    fn journal_one(name: &str) -> String {
        if name == "BLOK_COLLAB_JOURNAL" {
            "1".into()
        } else {
            String::new()
        }
    }
    let listen = free_port();
    type Case<'a> = (&'a [&'a str], i32, &'a str, fn(&str) -> String);
    let cases: [Case; 4] = [
        (
            &["--collab=maybe"],
            2,
            "invalid value \"maybe\" for flag -collab: parse error",
            no_env,
        ),
        (
            &["--collab=false", "--doc-endpoint", VALID_DOC_ENDPOINT],
            1,
            "--doc-endpoint needs --collab",
            no_env,
        ),
        (&[], 1, "--collab-journal needs --collab", journal_one),
        (
            // The default --collab-dir ./blok-collab resolves against the cwd.
            &[
                "--collab",
                "--doc-endpoint",
                VALID_DOC_ENDPOINT,
                "--storage-dir",
                ".",
            ],
            1,
            "--collab-dir must not resolve inside --storage-dir",
            no_env,
        ),
    ];
    for (args, want_code, want, getenv) in cases {
        let mut all = vec!["--listen", listen.as_str()];
        all.extend(args);
        let (code, stderr) = run_to_exit_with(&all, getenv).await;
        assert!(
            code == want_code && stderr.contains(want),
            "{args:?}: {code} {stderr:?}"
        );
    }
}

// HostCollabTests.cs

const DOC_ID: &str = "doc-1";

fn fixture(relative: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../../test/unit/server-conformance/fixtures")
        .join(relative);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn base64_decode(text: &[u8]) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => panic!("bad base64 byte {c}"),
    };
    let digits: Vec<u8> = text
        .iter()
        .copied()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
        .map(value)
        .collect();
    let mut out = Vec::new();
    for chunk in digits.chunks(4) {
        let mut n = 0u32;
        for (i, d) in chunk.iter().enumerate() {
            n |= u32::from(*d) << (18 - 6 * i);
        }
        let bytes = n.to_be_bytes();
        out.extend_from_slice(&bytes[1..chunk.len()]);
    }
    out
}

fn json_node(bytes: &[u8]) -> blok_jsjson::Node {
    parse_node(bytes, JsonOptions::default()).unwrap()
}

fn node_text(node: &blok_jsjson::Node) -> String {
    to_string_lossy(node.text().unwrap().units())
}

fn block_ids(blocks: &blok_jsjson::Node) -> Vec<String> {
    blocks
        .items
        .iter()
        .map(|b| node_text(b.lookup("id").unwrap().unwrap()))
        .collect()
}

/// Each block's data.text as compact JSON, by block id.
fn block_texts(output: &[u8]) -> std::collections::BTreeMap<String, String> {
    let node = json_node(output);
    let blocks = node.lookup("blocks").unwrap().expect("no blocks array");
    blocks
        .items
        .iter()
        .map(|b| {
            let mut text = Vec::new();
            if let Some(t) = b
                .lookup("data")
                .unwrap()
                .and_then(|d| d.lookup("text").unwrap())
            {
                t.append_json(&mut text).unwrap();
            }
            (
                node_text(b.lookup("id").unwrap().unwrap()),
                // C#'s UnsafeRelaxedJsonEscaping leaves these as they are.
                String::from_utf8(text)
                    .unwrap()
                    .replace("\\u003C", "<")
                    .replace("\\u003E", ">")
                    .replace("\\u0026", "&"),
            )
        })
        .collect()
}

fn write_var_uint(out: &mut Vec<u8>, mut value: usize) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn read_var_uint(input: &mut &[u8]) -> Option<usize> {
    let (mut value, mut shift) = (0usize, 0);
    loop {
        let (&b, rest) = input.split_first()?;
        *input = rest;
        value |= usize::from(b & 0x7f) << shift;
        if b < 0x80 {
            return Some(value);
        }
        shift += 7;
    }
}

const STEP1_EMPTY: [u8; 4] = [0, 0, 1, 0];

fn update_frame(update: &[u8]) -> Vec<u8> {
    let mut frame = vec![0, 2];
    write_var_uint(&mut frame, update.len());
    frame.extend_from_slice(update);
    frame
}

/// The payload of a sync frame of `sub_type`, or None for any other frame.
fn sync_payload(frame: &[u8], sub_type: usize) -> Option<Vec<u8>> {
    let mut input = frame;
    (read_var_uint(&mut input)? == 0
        && read_var_uint(&mut input)? == sub_type
        && read_var_uint(&mut input)? == input.len())
    .then(|| input.to_vec())
}

/// A raw WebSocket client on /sync/doc-1; it answers pings as it reads.
struct Socket(TcpStream);

impl Socket {
    async fn connect(address: &str) -> Socket {
        let mut conn = TcpStream::connect(address).await.unwrap();
        conn.write_all(
            format!(
                "GET /sync/{DOC_ID} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .unwrap();
        let mut head = Vec::new();
        tokio::time::timeout(Duration::from_secs(10), async {
            while !head.ends_with(b"\r\n\r\n") {
                head.push(conn.read_u8().await.unwrap());
            }
        })
        .await
        .expect("no upgrade answer");
        assert!(
            head.starts_with(b"HTTP/1.1 101"),
            "{}",
            String::from_utf8_lossy(&head)
        );
        Socket(conn)
    }

    async fn write_frame(&mut self, first: u8, payload: &[u8]) {
        let mut frame = vec![first];
        match payload.len() {
            n if n <= 125 => frame.push(0x80 | n as u8),
            n if n <= 0xffff => {
                frame.push(0x80 | 126);
                frame.extend_from_slice(&(n as u16).to_be_bytes());
            }
            n => {
                frame.push(0x80 | 127);
                frame.extend_from_slice(&(n as u64).to_be_bytes());
            }
        }
        frame.extend_from_slice(&[0, 0, 0, 0]);
        frame.extend_from_slice(payload);
        self.0.write_all(&frame).await.unwrap();
    }

    async fn send(&mut self, payload: &[u8]) {
        self.write_frame(0x82, payload).await;
    }

    /// The next data or close frame: (opcode, payload).
    async fn next(&mut self) -> (u8, Vec<u8>) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let first = self.0.read_u8().await.unwrap();
                let mut length = u64::from(self.0.read_u8().await.unwrap() & 0x7f);
                if length == 126 {
                    length = u64::from(self.0.read_u16().await.unwrap());
                } else if length == 127 {
                    length = self.0.read_u64().await.unwrap();
                }
                let mut payload = vec![0u8; usize::try_from(length).unwrap()];
                self.0.read_exact(&mut payload).await.unwrap();
                match first & 0x0f {
                    0x9 => self.write_frame(0x8a, &payload).await,
                    0xa => {}
                    opcode => return (opcode, payload),
                }
            }
        })
        .await
        .expect("no frame within 10 s")
    }

    async fn receive_sync(&mut self, sub_type: usize) -> Vec<u8> {
        loop {
            let (opcode, payload) = self.next().await;
            assert_ne!(opcode, 0x8, "closed while waiting: {payload:?}");
            if let Some(found) = sync_payload(&payload, sub_type) {
                return found;
            }
        }
    }

    /// SyncStep1 with an empty state vector; the reply is SyncStep2 then
    /// SyncStep1.
    async fn handshake(&mut self) {
        self.send(&STEP1_EMPTY).await;
        self.receive_sync(1).await;
        self.receive_sync(0).await;
    }

    async fn receive_close(&mut self) -> (u16, String) {
        loop {
            let (opcode, payload) = self.next().await;
            if opcode == 0x8 {
                // Answer the close, as ClientWebSocket.CloseOutputAsync does.
                self.write_frame(0x88, &1000u16.to_be_bytes()).await;
                return (
                    u16::from_be_bytes([payload[0], payload[1]]),
                    String::from_utf8_lossy(&payload[2..]).into_owned(),
                );
            }
        }
    }
}

type Puts = Arc<Mutex<Vec<(String, Vec<u8>)>>>;

/// FixtureDocEndpoint: GET answers `get_body`, each PUT is kept with its
/// path and answered 204.
async fn fixture_doc_endpoint(
    get_body: &'static str,
) -> (String, Puts, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let puts: Puts = Arc::default();
    let kept = puts.clone();
    let server = blok_http::Server::new(
        move |mut request: blok_http::Request, mut response: blok_http::ResponseWriter| {
            let kept = kept.clone();
            async move {
                if request.method() == "GET" {
                    response
                        .headers_mut()
                        .set("Content-Type", "application/json; charset=utf-8");
                    let _ = response.write(get_body.as_bytes()).await;
                    return;
                }
                let mut body = Vec::new();
                if let Some(reader) = request.body_mut() {
                    let _ = reader.read_to_end(&mut body).await;
                }
                kept.lock().unwrap().push((request.path().to_owned(), body));
                response.set_status(204);
            }
        },
        blok_http::Config::default(),
    );
    let serving = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    (format!("http://{address}/docs"), puts, serving)
}

#[tokio::test(flavor = "multi_thread")]
async fn drains_sync_rooms_on_sigterm() {
    let (endpoint, puts, serving) = fixture_doc_endpoint("null").await;
    let collab_dir = scratch_dir("sigterm");
    let dir = collab_dir.display().to_string();
    let running = Running::start(
        &[
            "--auth",
            "none",
            "--storage-dir",
            "",
            "--rate-limit",
            "0",
            "--collab",
            "--collab-dir",
            &dir,
            "--doc-endpoint",
            &endpoint,
        ],
        no_env,
        "dev",
    )
    .await;

    let mut editor = Socket::connect(&running.address).await;
    editor.handshake().await;
    let mut observer = Socket::connect(&running.address).await;
    observer.handshake().await;

    // The observer's relayed copy proves the room applied the edit.
    let update = base64_decode(&fixture("collab/hierarchy-3-deep/update.b64"));
    editor.send(&update_frame(&update)).await;
    assert_eq!(observer.receive_sync(2).await, update);

    let Running {
        address,
        out,
        mut stop,
        done,
    } = running;
    let _ = stop.take().unwrap().send(());
    let closes = (editor.receive_close().await, observer.receive_close().await);
    let want = (1001, "server shutting down".to_owned());
    assert_eq!(closes, (want.clone(), want));
    // HostOptions.ShutdownTimeout is 30 s; a drain that misses it fails.
    let code = tokio::time::timeout(Duration::from_secs(35), done)
        .await
        .expect("the host did not exit after the stop")
        .unwrap();
    let stderr = out.text();
    assert_eq!(code, 0, "{stderr}");

    let canonical = json_node(&fixture("collab/hierarchy-3-deep/canonical.json"));
    let doc_puts: Vec<Vec<u8>> = puts
        .lock()
        .unwrap()
        .iter()
        .filter(|(path, _)| path.ends_with(&format!("/{DOC_ID}")))
        .map(|(_, body)| body.clone())
        .collect();
    assert_eq!(doc_puts.len(), 1, "PUTs for {DOC_ID} via {address}");
    let put = json_node(&doc_puts[0]);
    assert_eq!(
        block_ids(put.lookup("blocks").unwrap().expect("no blocks")),
        block_ids(&canonical)
    );

    let blob = collab_dir.join(blok_collab_workingset::doc_key(DOC_ID));
    let length = std::fs::metadata(&blob)
        .unwrap_or_else(|e| panic!("no working-set blob at {}: {e}", blob.display()))
        .len();
    // 16 bytes is a header-only (empty-log) working set.
    assert!(
        length > 16,
        "the working-set blob holds no frames ({length} bytes)"
    );
    assert!(
        !stderr.contains("Unhandled exception") && !stderr.contains("error:"),
        "{stderr}"
    );
    serving.abort();
    let _ = std::fs::remove_dir_all(&collab_dir);
}

// The keep-alive half of the C# test lives in http's sync_deadline.rs, since
// the host's keep-alive cannot be shortened from the command line. This is
// the other half: the host's own config must not take an idle socket for a
// stalled body once Kestrel's 5 s body-rate grace has passed.
#[tokio::test(flavor = "multi_thread")]
async fn a_sync_socket_outlives_kestrels_keep_alive_timeout() {
    let (endpoint, _puts, serving) = fixture_doc_endpoint("null").await;
    let collab_dir = scratch_dir("keep-alive");
    let dir = collab_dir.display().to_string();
    let running = Running::start(
        &[
            "--storage-dir",
            "",
            "--collab",
            "--collab-dir",
            &dir,
            "--doc-endpoint",
            &endpoint,
        ],
        no_env,
        "dev",
    )
    .await;
    let mut socket = Socket::connect(&running.address).await;
    socket.handshake().await;
    tokio::time::sleep(Duration::from_secs(6)).await;
    socket.handshake().await;
    drop(socket);
    running.stop().await;
    serving.abort();
    let _ = std::fs::remove_dir_all(&collab_dir);
}

// --rich-text-fields reaches the room: a listed custom field is stored as
// formatted text and answered as segments; an unlisted one stays a string.
#[tokio::test(flavor = "multi_thread")]
async fn the_rich_text_fields_flag_makes_a_custom_field_segments() {
    for listed in [true, false] {
        let (endpoint, _puts, serving) = fixture_doc_endpoint("null").await;
        let collab_dir = scratch_dir("rich-fields");
        let dir = collab_dir.display().to_string();
        let mut args = vec![
            "--storage-dir",
            "",
            "--collab",
            "--collab-dir",
            &dir,
            "--doc-endpoint",
            &endpoint,
        ];
        if listed {
            args.extend(["--rich-text-fields", r#"{ "widget": ["text"] }"#]);
        }
        let running = Running::start(&args, no_env, "dev").await;
        let body = r#"{ "ops": [ { "op": "insert", "id": "w", "block": { "type": "widget", "data": { "text": "<i>w</i>" } } } ] }"#;
        let edit = exchange(
            &running.address,
            &format!(
                "POST /sync/{DOC_ID}/edit HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nBlok-Idempotency-Key: widget-edit\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        )
        .await;
        let (status, _, state) = request(
            &running.address,
            "GET",
            &format!("/sync/{DOC_ID}/state"),
            "HTTP/1.1",
        )
        .await;
        assert!(edit.starts_with("HTTP/1.1 204"), "{listed}: {edit:?}");
        assert_eq!(status, 200, "{listed}: {state}");
        let want = if listed {
            r#"[{"text":"w","marks":{"italic":true}}]"#
        } else {
            r#""<i>w</i>""#
        };
        assert_eq!(block_texts(state.as_bytes())["w"], want, "{listed}");
        running.stop().await;
        serving.abort();
        let _ = std::fs::remove_dir_all(&collab_dir);
    }
}
