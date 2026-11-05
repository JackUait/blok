use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::operator::{OperatorClient, Request, RequestBody};
use crate::origin_test::{Origin, ok_handler};
use crate::pki_test::{acceptor, pki};
use crate::proxy::EnvironmentProxy;
use crate::wire::Source;

/// Answers CONNECT by `mode`, as C#'s ProxyConnectTunnelTests proxy does,
/// and logs "conn method auth=..." for each request.
async fn recording_proxy(mode: &'static str) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    tokio::spawn(async move {
        let mut conns = 0;
        loop {
            let Ok((client, _)) = listener.accept().await else {
                return;
            };
            conns += 1;
            let (id, log) = (conns, log.clone());
            tokio::spawn(async move {
                let mut reader = BufReader::new(client);
                loop {
                    let mut target = String::new();
                    let mut auth = "no".to_owned();
                    let mut method = String::new();
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                            return;
                        }
                        let line = line.trim_end();
                        if line.is_empty() {
                            break;
                        }
                        if method.is_empty() {
                            let mut parts = line.split(' ');
                            method = parts.next().unwrap().to_owned();
                            target = parts.next().unwrap_or_default().to_owned();
                        } else if let Some(value) = line.strip_prefix("Proxy-Authorization:") {
                            auth = value.trim().to_owned();
                        }
                    }
                    log.lock()
                        .unwrap()
                        .push(format!("{id} {method} auth={auth}"));
                    let answer = match mode {
                        "challenge" | "challenge-domain" | "challenge-empty-domain"
                            if auth == "no" =>
                        {
                            "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"r\"\r\nContent-Length: 0\r\n\r\n"
                        }
                        "challenge-close" if auth == "no" => {
                            "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"r\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        }
                        "no-challenge" => {
                            "HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n"
                        }
                        _ => "",
                    };
                    if !answer.is_empty() {
                        let _ = reader.get_mut().write_all(answer.as_bytes()).await;
                        if answer.contains("Connection: close") {
                            return;
                        }
                        continue;
                    }
                    let Ok(mut upstream) = TcpStream::connect(&target).await else {
                        return;
                    };
                    // A 201 tunnels anyway: a client that takes any 2xx gets through.
                    let status = if mode == "201" {
                        "201 Created"
                    } else {
                        "200 Connection established"
                    };
                    let _ = reader
                        .get_mut()
                        .write_all(format!("HTTP/1.1 {status}\r\n\r\n").as_bytes())
                        .await;
                    let _ = tokio::io::copy_bidirectional(&mut reader, &mut upstream).await;
                    return;
                }
            });
        }
    });
    (port, seen)
}

// The twin of C#'s ProxyConnectTunnelTests and Go's
// TestOpensATunnelAsSocketsHttpHandlerDoes: credentials only after a 407
// Basic challenge, the retry on the same conn unless the 407 closed it,
// and only 200 opens the tunnel.
#[tokio::test]
async fn opens_a_tunnel_as_sockets_http_handler_does() {
    let pki = pki("localhost", |_| {});
    let target = Origin::start(
        "127.0.0.1:0",
        Some(acceptor(pki.chain.clone(), pki.key.clone_key(), &[])),
        ok_handler(),
    )
    .await
    .unwrap();
    for (mode, want) in [
        (
            "challenge",
            "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic dTpw",
        ),
        (
            "challenge-domain",
            "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic RE9NXHU6cA==",
        ),
        // GetCredentialsFromString splits "domain\\user": "\\u" has an
        // empty domain, the same credential as C#'s plain "challenge" row.
        (
            "challenge-empty-domain",
            "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic dTpw",
        ),
        (
            "challenge-close",
            "200 ok|1 CONNECT auth=no|2 CONNECT auth=Basic dTpw",
        ),
        ("no-challenge", "error|1 CONNECT auth=no"),
        ("201", "error|1 CONNECT auth=no"),
        ("200", "200 ok|1 CONNECT auth=no"),
    ] {
        let (port, seen) = recording_proxy(mode).await;
        let client = OperatorClient {
            connect_timeout: Duration::from_secs(5),
            header_timeout: None,
            proxy: EnvironmentProxy::from_lookup(move |name| {
                let user = match mode {
                    "challenge-domain" => "DOM%5Cu",
                    "challenge-empty-domain" => "%5Cu",
                    _ => "u",
                };
                (name == "ALL_PROXY").then(|| format!("http://{user}:p@127.0.0.1:{port}"))
            }),
            roots: Some(pki.roots.clone()),
        };
        let url = blok_dotnet::parse_absolute_uri(&format!("https://localhost:{}/", target.port))
            .unwrap();
        let host = format!("localhost:{}", target.port);
        let outcome = match client
            .send(Request {
                method: "GET",
                url: &url,
                host: &host,
                headers: Vec::new(),
                body: RequestBody::None,
            })
            .await
        {
            Ok(mut response) => {
                let mut body = vec![0u8; 16];
                let n = response.body.read(&mut body).await.unwrap();
                format!(
                    "{} {}",
                    response.status,
                    String::from_utf8_lossy(&body[..n])
                )
            }
            Err(_) => "error".to_owned(),
        };
        let mut got = vec![outcome];
        got.extend(seen.lock().unwrap().iter().cloned());
        assert_eq!(got.join("|"), want, "{mode}");
    }
}

fn digest_challenge(mode: &str, second: bool) -> &'static str {
    match mode {
        "plain" | "utf8" | "domain" => "Digest realm=\"r\", nonce=\"n\"",
        "qop" => "Digest realm=\"r\", nonce=\"n\", qop=\"auth\", algorithm=MD5, opaque=\"o\"",
        "sha-sess" => {
            "Digest realm=\"r\", nonce=\"n\", qop=\"auth,auth-int\", algorithm=SHA-256-sess"
        }
        "auth-int" => "Digest realm=\"r\", nonce=\"n\", qop=\"auth-int\", algorithm=SHA-256",
        "userhash" => "Digest realm=\"r\", nonce=\"n\", userhash=true, algorithm=MD5",
        "stale" if second => "Digest realm=\"r\", nonce=\"n2\", stale=true",
        "stale" => "Digest realm=\"r\", nonce=\"n\"",
        "unsupported" => "Digest realm=\"r\", nonce=\"n\", algorithm=SHA-512",
        "dup-ascii" => "Digest realm=\"r\", nonce=\"n\", NONCE=\"m\"",
        "dup-latin1" => "Digest realm=\"r\", nonce=\"n\", \u{e9}=1, \u{c9}=2",
        "dup-utf8" => "Digest realm=\"r\", nonce=\"n\", \u{c3}\u{a9}=1, \u{c3}\u{89}=2",
        "realm-latin1" => "Digest realm=\"\u{e9}\", nonce=\"n\"",
        "domain-quoted-latin1" => "Digest realm=\"r\", nonce=\"n\", domain=\"\u{e9}\"",
        "domain-token-latin1" => "Digest realm=\"r\", nonce=\"n\", domain=\u{e9}",
        "firstkey-latin1" => "Digest \u{e9}=1, realm=\"r\", nonce=\"n\"",
        _ => "",
    }
}

fn challenge_lines(mode: &str, second: bool) -> String {
    match mode {
        "digest+basic" => "Proxy-Authenticate: Basic realm=\"r\"\r\nProxy-Authenticate: Digest realm=\"r\", nonce=\"n\"\r\n".to_owned(),
        "negotiate+basic" => "Proxy-Authenticate: Negotiate\r\nProxy-Authenticate: Basic realm=\"r\"\r\n".to_owned(),
        "sameline-basic" => "Proxy-Authenticate: Basic realm=\"r\", Digest realm=\"r\", nonce=\"n\", \u{e9}=1\r\n".to_owned(),
        _ => format!("Proxy-Authenticate: {}\r\n", digest_challenge(mode, second)),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The fields of a Digest answer: key=value or key="value".
fn digest_fields(header: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    for part in header.trim_start_matches("Digest ").split(", ") {
        if let Some((key, value)) = part.split_once('=') {
            fields.insert(key.to_owned(), value.trim_matches('"').to_owned());
        }
    }
    fields
}

/// The RFC 7616 check C#'s test makes, password p.
fn digest_valid(header: &str, user: &str) -> bool {
    use sha2::Digest as _;
    let fields = digest_fields(header);
    let algorithm = fields
        .get("algorithm")
        .cloned()
        .unwrap_or_else(|| "MD5".to_owned());
    let hash = |data: &str| {
        if algorithm.starts_with("SHA-256") {
            hex(&sha2::Sha256::digest(data.as_bytes()))
        } else {
            hex(&crate::digest::md5(data.as_bytes()))
        }
    };
    let nonce = &fields["nonce"];
    let mut a1 = hash(&format!("{user}:r:p"));
    if algorithm.ends_with("-sess") {
        a1 = hash(&format!("{a1}:{nonce}:{}", fields["cnonce"]));
    }
    let a2 = if fields.get("qop").is_some_and(|q| q == "auth-int") {
        hash(&format!("CONNECT:/:{}", hash("")))
    } else {
        hash("CONNECT:/")
    };
    let want = match fields.get("qop") {
        Some(qop) => hash(&format!(
            "{a1}:{nonce}:{}:{}:{qop}:{a2}",
            fields["nc"], fields["cnonce"]
        )),
        None => hash(&format!("{a1}:{nonce}:{a2}")),
    };
    fields["uri"] == "/" && fields["response"] == want
}

/// Masks the random cnonce as C and the response as R.
pub(crate) fn mask(auth: &str) -> String {
    auth.split(", ")
        .map(|part| match part.split_once('=') {
            Some(("response", _)) => "response=\"R\"".to_owned(),
            Some(("cnonce", value))
                if value.len() == 18 && value[1..17].bytes().all(|b| b.is_ascii_alphanumeric()) =>
            {
                "cnonce=\"C\"".to_owned()
            }
            _ => part.to_owned(),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

async fn digest_proxy(mode: &'static str, user: &'static str) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    tokio::spawn(async move {
        let mut conns = 0;
        loop {
            let Ok((client, _)) = listener.accept().await else {
                return;
            };
            conns += 1;
            let (id, log) = (conns, log.clone());
            tokio::spawn(async move {
                let mut reader = BufReader::new(client);
                let mut digests = 0;
                for _ in 0..4 {
                    let mut target = String::new();
                    let mut auth: Option<String> = None;
                    let mut first = true;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                            return;
                        }
                        let line = line.trim_end();
                        if line.is_empty() {
                            break;
                        }
                        if first {
                            target = line.split(' ').nth(1).unwrap_or_default().to_owned();
                            first = false;
                        } else if let Some(value) = line.strip_prefix("Proxy-Authorization:") {
                            auth = Some(value.trim().to_owned());
                        }
                    }
                    let logged = match &auth {
                        None => "no".to_owned(),
                        Some(a) if a.starts_with("Negotiate ") => "Negotiate T".to_owned(),
                        Some(a) => mask(a),
                    };
                    log.lock().unwrap().push(format!("{id} auth={logged}"));
                    let digest = auth.as_deref().is_some_and(|a| a.starts_with("Digest "));
                    if digest {
                        digests += 1;
                    }
                    let stale = mode == "stale" && digests == 1;
                    if digest && !stale && digest_valid(auth.as_deref().unwrap(), user) {
                        let Ok(mut upstream) = TcpStream::connect(&target).await else {
                            return;
                        };
                        let _ = reader
                            .get_mut()
                            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                            .await;
                        let _ = tokio::io::copy_bidirectional(&mut reader, &mut upstream).await;
                        return;
                    }
                    let answer = format!(
                        "HTTP/1.1 407 Proxy Authentication Required\r\n{}Content-Length: 0\r\n\r\n",
                        challenge_lines(mode, stale)
                    );
                    // Latin-1: each char of a challenge is one byte on the wire.
                    let answer: Vec<u8> = answer.chars().map(|c| c as u8).collect();
                    let _ = reader.get_mut().write_all(&answer).await;
                }
            });
        }
    });
    (port, seen)
}

#[test]
fn md5_matches_rfc_1321() {
    for (input, want) in [
        ("", "d41d8cd98f00b204e9800998ecf8427e"),
        ("abc", "900150983cd24fb0d6963f7d28e17f72"),
        ("message digest", "f96b697d7cb7938d525a2f31aaf161d0"),
        (
            "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
            "57edf4a22be3c955ac49da2e2107b67a",
        ),
    ] {
        assert_eq!(
            hex(&crate::digest::md5(input.as_bytes())),
            want,
            "{input:?}"
        );
    }
}

// The twin of C#'s AnswersADigestChallengeAsSocketsHttpHandlerDoes.
#[tokio::test]
async fn answers_a_digest_challenge_as_sockets_http_handler_does() {
    let pki = pki("localhost", |_| {});
    let target = Origin::start(
        "127.0.0.1:0",
        Some(acceptor(pki.chain.clone(), pki.key.clone_key(), &[])),
        ok_handler(),
    )
    .await
    .unwrap();
    for (mode, user, want) in [
        (
            "plain",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"",
        ),
        (
            "qop",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", opaque=\"o\", algorithm=MD5, qop=auth, nc=00000001, cnonce=\"C\"",
        ),
        (
            "sha-sess",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", algorithm=SHA-256-sess, qop=auth, nc=00000001, cnonce=\"C\"",
        ),
        (
            "auth-int",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", algorithm=SHA-256, qop=auth-int, nc=00000001, cnonce=\"C\"",
        ),
        (
            "userhash",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"ba84be203fdfc7d34e054a76d285d0c9\", userhash=true, realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", algorithm=MD5",
        ),
        (
            "utf8",
            "é",
            "200 ok|1 auth=no|1 auth=Digest username*=utf-8''%C3%A9, realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"",
        ),
        (
            "domain",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"",
        ),
        (
            "stale",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n2\", uri=\"/\", response=\"R\"",
        ),
        ("unsupported", "u", "error|1 auth=no"),
        (
            "digest+basic",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"",
        ),
        ("negotiate+basic", "u", "error|1 auth=no|1 auth=Negotiate T"),
        ("dup-ascii", "u", "error|1 auth=no"),
        ("dup-latin1", "u", "error|1 auth=no"),
        ("dup-utf8", "u", "error|1 auth=no"),
        ("sameline-basic", "u", "error|1 auth=no"),
        (
            "domain-quoted-latin1",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"",
        ),
        ("domain-token-latin1", "u", "error|1 auth=no"),
        (
            "firstkey-latin1",
            "u",
            "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"",
        ),
        ("realm-latin1", "u", "error|1 auth=no"),
    ] {
        let (port, seen) = digest_proxy(mode, user).await;
        let proxy_user = match (mode, user) {
            (_, "é") => "%C3%A9",
            ("domain", _) => "DOM%5Cu",
            _ => user,
        };
        let client = OperatorClient {
            connect_timeout: Duration::from_secs(5),
            header_timeout: None,
            proxy: EnvironmentProxy::from_lookup(move |name| {
                (name == "ALL_PROXY").then(|| format!("http://{proxy_user}:p@127.0.0.1:{port}"))
            }),
            roots: Some(pki.roots.clone()),
        };
        let url = blok_dotnet::parse_absolute_uri(&format!("https://localhost:{}/", target.port))
            .unwrap();
        let host = format!("localhost:{}", target.port);
        let outcome = match client
            .send(Request {
                method: "GET",
                url: &url,
                host: &host,
                headers: Vec::new(),
                body: RequestBody::None,
            })
            .await
        {
            Ok(mut response) => {
                let mut body = vec![0u8; 16];
                let n = response.body.read(&mut body).await.unwrap();
                format!(
                    "{} {}",
                    response.status,
                    String::from_utf8_lossy(&body[..n])
                )
            }
            Err(_) => "error".to_owned(),
        };
        let mut got = vec![outcome];
        got.extend(seen.lock().unwrap().iter().cloned());
        assert_eq!(got.join("|"), want, "{mode}");
    }
}

/// The C# fixture test's Serve: logs "conn method" for each request,
/// answers the run's first request with `first` and every later one with
/// `rest`, and hangs up after the first when `closing`.
async fn reuse_server(
    first: Vec<u8>,
    rest: &'static [u8],
    closing: bool,
) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let first = Arc::new(first);
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    tokio::spawn(async move {
        let mut conns = 0;
        while let Ok((client, _)) = listener.accept().await {
            conns += 1;
            let (id, log, first, requests) = (conns, log.clone(), first.clone(), requests.clone());
            tokio::spawn(async move {
                let mut reader = BufReader::new(client);
                loop {
                    let mut method = String::new();
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                            return;
                        }
                        let line = line.trim_end();
                        if line.is_empty() {
                            break;
                        }
                        if method.is_empty() {
                            method = line.split(' ').next().unwrap().to_owned();
                        }
                    }
                    log.lock().unwrap().push(format!("{id} {method}"));
                    let is_first = requests.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0;
                    let answer: &[u8] = if is_first { &first } else { rest };
                    if reader.get_mut().write_all(answer).await.is_err() || is_first && closing {
                        return;
                    }
                }
            });
        }
    });
    (port, seen)
}

// The twin of C#'s ConnectionReuseMatchesTheFixture, tunnel rows: after a
// 407 the retry takes the conn SocketsHttpHandler would take. The plain
// rows do not apply: this client opens a new conn for every request.
#[tokio::test]
async fn connection_reuse_matches_the_fixture() {
    use crate::test_json::{field, items, load, string};
    let fixture = load("outbound-conn-reuse.json");
    let answers = items(field(&fixture, "answers"));
    let mut wrong = Vec::new();
    for (i, case) in items(field(&fixture, "cases")).iter().enumerate() {
        let answer: Vec<u8> = crate::fixtures_test::expand_pads(&string(case, "answer"))
            .chars()
            .map(|c| u8::try_from(c).unwrap())
            .collect();
        let closing = matches!(field(case, "close"), blok_jsjson::Value::Bool(true));
        let (port, seen) = reuse_server(
            answer,
            b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n",
            closing,
        )
        .await;
        let client = OperatorClient {
            connect_timeout: Duration::from_secs(10),
            header_timeout: None,
            proxy: EnvironmentProxy::from_lookup(move |name| {
                (name == "ALL_PROXY").then(|| format!("http://u:p@127.0.0.1:{port}"))
            }),
            roots: None,
        };
        let url = blok_dotnet::parse_absolute_uri("https://localhost:1/").unwrap();
        let outcome = match client
            .send(Request {
                method: "GET",
                url: &url,
                host: "localhost:1",
                headers: Vec::new(),
                body: RequestBody::None,
            })
            .await
        {
            Ok(response) => response.status.to_string(),
            Err(crate::operator::OperatorError::Tunnel(status)) => format!("error {status}"),
            Err(_) => "error ".to_owned(),
        };
        let mut got = vec![outcome];
        got.extend(seen.lock().unwrap().iter().cloned());
        let want = string(&answers[i], "tunnel");
        if got.join("|") != want {
            wrong.push(format!("case {i}: got {:?}, C# {want:?}", got.join("|")));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

// The twin of C#'s DigestKeysFoldTheseLatin1Pairs.
#[test]
fn digest_keys_fold_these_latin1_pairs() {
    let fold = |b: u32| crate::digest::latin1_fold(&char::from_u32(b).unwrap().to_string());
    let mut got = Vec::new();
    for a in 0..256u32 {
        for b in a + 1..256 {
            if fold(a) == fold(b) {
                got.push(format!("{a:02X}{b:02X}"));
            }
        }
    }
    let want: Vec<String> = (0x41..0x41 + 26)
        .chain((0xC0..0xC0 + 0x1F).filter(|&c| c != 0xD7))
        .map(|c: u32| format!("{c:02X}{:02X}", c + 0x20))
        .collect();
    assert_eq!(got, want);
}
