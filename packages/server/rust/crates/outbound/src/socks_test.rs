use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::operator::{OperatorClient, Request, RequestBody};
use crate::proxy::EnvironmentProxy;
use crate::wire::Source;

/// What the fake proxy read: the handshake bytes, then the HTTP request line.
#[derive(Debug, Default, Clone)]
struct Log {
    handshake: Vec<u8>,
    request_line: String,
}

async fn read(conn: &mut TcpStream, log: &Arc<Mutex<Log>>, n: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; n];
    conn.read_exact(&mut bytes).await.unwrap();
    log.lock().unwrap().handshake.extend_from_slice(&bytes);
    bytes
}

async fn read_until_nul(conn: &mut TcpStream, log: &Arc<Mutex<Log>>) {
    loop {
        if read(conn, log, 1).await[0] == 0 {
            return;
        }
    }
}

/// A SOCKS proxy that grants (or, with `refuse`, refuses) one tunnel and
/// then answers the tunnelled HTTP request itself.
async fn fake_proxy(version: u8, refuse: bool) -> (u16, Arc<Mutex<Log>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let log = Arc::new(Mutex::new(Log::default()));
    let log2 = log.clone();
    tokio::spawn(async move {
        let (mut conn, _) = listener.accept().await.unwrap();
        let log = log2;
        if version == 5 {
            let head = read(&mut conn, &log, 2).await;
            let methods = read(&mut conn, &log, usize::from(head[1])).await;
            if methods.contains(&2) {
                conn.write_all(&[5, 2]).await.unwrap();
                read(&mut conn, &log, 1).await;
                let user = read(&mut conn, &log, 1).await[0];
                read(&mut conn, &log, usize::from(user)).await;
                let password = read(&mut conn, &log, 1).await[0];
                read(&mut conn, &log, usize::from(password)).await;
                conn.write_all(&[1, 0]).await.unwrap();
            } else {
                conn.write_all(&[5, 0]).await.unwrap();
            }
            let request = read(&mut conn, &log, 4).await;
            match request[3] {
                1 => drop(read(&mut conn, &log, 4 + 2).await),
                4 => drop(read(&mut conn, &log, 16 + 2).await),
                _ => {
                    let length = read(&mut conn, &log, 1).await[0];
                    read(&mut conn, &log, usize::from(length) + 2).await;
                }
            }
            let status = if refuse { 5 } else { 0 };
            conn.write_all(&[5, status, 0, 1, 127, 0, 0, 1, 0, 80])
                .await
                .unwrap();
        } else {
            let head = read(&mut conn, &log, 8).await;
            read_until_nul(&mut conn, &log).await;
            if head[4..7] == [0, 0, 0] && head[7] != 0 {
                read_until_nul(&mut conn, &log).await;
            }
            let status = if refuse { 91 } else { 90 };
            conn.write_all(&[0, status, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
        }
        if refuse {
            return;
        }
        let mut reader = BufReader::new(conn);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        log.lock().unwrap().request_line = line.trim_end().to_owned();
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).await.unwrap() == 0 || header == "\r\n" {
                break;
            }
        }
        let _ = reader
            .get_mut()
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
            .await;
    });
    (port, log)
}

async fn fetch(proxy: String, url: &str) -> Result<Vec<u8>, String> {
    let client = OperatorClient {
        connect_timeout: Duration::from_secs(5),
        header_timeout: None,
        proxy: EnvironmentProxy::from_lookup(|name| (name == "ALL_PROXY").then(|| proxy.clone())),
        roots: None,
    };
    let url = blok_dotnet::parse_absolute_uri(url).unwrap();
    let host = url.host.clone();
    let mut response = client
        .send(Request {
            method: "GET",
            url: &url,
            host: &host,
            headers: Vec::new(),
            body: RequestBody::Bytes(&[]),
        })
        .await
        .map_err(|e| e.to_string())?;
    let mut body = vec![0u8; 16];
    let n = response
        .body
        .read(&mut body)
        .await
        .map_err(|e| e.to_string())?;
    body.truncate(n);
    Ok(body)
}

#[tokio::test]
async fn tunnels_through_socks5_by_name_without_resolving_it() {
    let (port, log) = fake_proxy(5, false).await;
    let body = fetch(
        format!("socks5://127.0.0.1:{port}"),
        "http://docs.blok-proxy.invalid/a?b",
    )
    .await;
    assert_eq!(body.unwrap(), b"ok");
    let log = log.lock().unwrap().clone();
    let name = b"docs.blok-proxy.invalid";
    let mut want = vec![5, 1, 0, 5, 1, 0, 3, name.len() as u8];
    want.extend_from_slice(name);
    want.extend_from_slice(&80u16.to_be_bytes());
    assert_eq!(log.handshake, want);
    // Through a tunnel the request names the path, not the whole URL.
    assert_eq!(log.request_line, "GET /a?b HTTP/1.1");
}

#[tokio::test]
async fn sends_socks5_credentials_by_rfc_1929() {
    let (port, log) = fake_proxy(5, false).await;
    let body = fetch(
        format!("socks5://us%40er:pw@127.0.0.1:{port}"),
        "http://127.0.0.1:9000/x",
    )
    .await;
    assert_eq!(body.unwrap(), b"ok");
    let mut want = vec![5, 2, 0, 2, 1, 5];
    want.extend_from_slice(b"us@er");
    want.push(2);
    want.extend_from_slice(b"pw");
    want.extend_from_slice(&[5, 1, 0, 1, 127, 0, 0, 1]);
    want.extend_from_slice(&9000u16.to_be_bytes());
    assert_eq!(log.lock().unwrap().handshake, want);
}

#[tokio::test]
async fn a_refused_socks5_connect_fails_the_request() {
    let (port, _) = fake_proxy(5, true).await;
    let err = fetch(
        format!("socks5://127.0.0.1:{port}"),
        "http://docs.example/x",
    )
    .await
    .unwrap_err();
    assert!(err.contains("refused"), "{err}");
}

#[tokio::test]
async fn tunnels_through_socks4_with_an_address() {
    let (port, log) = fake_proxy(4, false).await;
    let body = fetch(
        format!("socks4://bob@127.0.0.1:{port}"),
        "http://127.0.0.1:8080/x",
    )
    .await;
    assert_eq!(body.unwrap(), b"ok");
    let mut want = vec![4, 1];
    want.extend_from_slice(&8080u16.to_be_bytes());
    want.extend_from_slice(&[127, 0, 0, 1]);
    want.extend_from_slice(b"bob\0");
    assert_eq!(log.lock().unwrap().handshake, want);
}

// SocksHelper.EstablishSocks4TunnelAsync (System.Net.Http 10.0.11,
// decompiled) marks the name with 0.0.0.255.
#[tokio::test]
async fn tunnels_through_socks4a_by_name() {
    let (port, log) = fake_proxy(4, false).await;
    let body = fetch(
        format!("socks4a://127.0.0.1:{port}"),
        "http://docs.blok-proxy.invalid/x",
    )
    .await;
    assert_eq!(body.unwrap(), b"ok");
    let mut want = vec![4, 1, 0, 80, 0, 0, 0, 255, 0];
    want.extend_from_slice(b"docs.blok-proxy.invalid\0");
    assert_eq!(log.lock().unwrap().handshake, want);
}

#[tokio::test]
async fn a_refused_socks4_connect_fails_the_request() {
    let (port, _) = fake_proxy(4, true).await;
    let err = fetch(
        format!("socks4://127.0.0.1:{port}"),
        "http://127.0.0.1:80/x",
    )
    .await
    .unwrap_err();
    assert!(err.contains("refused"), "{err}");
}

/// An https proxy: TLS to the proxy itself, then a plain proxied request,
/// or a CONNECT and TLS to the target inside that TLS.
async fn https_proxy(pki: &crate::pki_test::Pki) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let lines = Arc::new(Mutex::new(Vec::new()));
    let seen = lines.clone();
    let acceptor = crate::pki_test::acceptor(pki.chain.clone(), pki.key.clone_key(), &[]);
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let Ok(tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut reader = BufReader::new(tls);
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                seen.lock().unwrap().push(line.trim_end().to_owned());
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).await.unwrap() == 0 || header == "\r\n" {
                        break;
                    }
                }
                let mut tls = reader.into_inner();
                if !line.starts_with("CONNECT ") {
                    let _ = tls
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                        .await;
                    return;
                }
                tls.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .await
                    .unwrap();
                let Ok(inner) = acceptor.accept(tls).await else {
                    return;
                };
                let mut reader = BufReader::new(inner);
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).await.unwrap() == 0 || header == "\r\n" {
                        break;
                    }
                }
                let _ = reader
                    .get_mut()
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                    .await;
            });
        }
    });
    (port, lines)
}

// HttpEnvironmentProxy takes an https:// proxy, and HttpConnectionPool
// opens TLS to it before the request or the tunnel (System.Net.Http
// 10.0.11, decompiled).
#[tokio::test]
async fn reaches_http_and_https_targets_through_an_https_proxy() {
    let pki = crate::pki_test::pki("localhost", |fields| {
        fields.names.push("target.blok-proxy.test".into());
    });
    let (port, lines) = https_proxy(&pki).await;
    for url in [
        "http://target.blok-proxy.test/a?b",
        "https://target.blok-proxy.test/c",
    ] {
        let client = OperatorClient {
            connect_timeout: Duration::from_secs(5),
            header_timeout: None,
            proxy: EnvironmentProxy::from_lookup(move |name| {
                (name == "ALL_PROXY").then(|| format!("https://localhost:{port}"))
            }),
            roots: Some(pki.roots.clone()),
        };
        let url = blok_dotnet::parse_absolute_uri(url).unwrap();
        let host = url.host.clone();
        let mut response = client
            .send(Request {
                method: "GET",
                url: &url,
                host: &host,
                headers: Vec::new(),
                body: RequestBody::None,
            })
            .await
            .unwrap_or_else(|e| panic!("{}: {e}", url.absolute_uri));
        let mut body = vec![0u8; 16];
        let n = response.body.read(&mut body).await.unwrap();
        assert_eq!(&body[..n], b"ok");
    }
    assert_eq!(
        *lines.lock().unwrap(),
        [
            "GET http://target.blok-proxy.test/a?b HTTP/1.1",
            "CONNECT target.blok-proxy.test:443 HTTP/1.1"
        ]
    );
}

// .NET unmaps an IPv4-mapped IPv6 literal for SOCKS4.
#[tokio::test]
async fn socks4_sends_an_ipv4_mapped_literal_as_ipv4() {
    let (port, log) = fake_proxy(4, false).await;
    let body = fetch(
        format!("socks4://127.0.0.1:{port}"),
        "http://[::ffff:127.0.0.1]:8080/x",
    )
    .await;
    assert_eq!(body.unwrap(), b"ok");
    let mut want = vec![4, 1];
    want.extend_from_slice(&8080u16.to_be_bytes());
    want.extend_from_slice(&[127, 0, 0, 1, 0]);
    assert_eq!(log.lock().unwrap().handshake, want);
}
