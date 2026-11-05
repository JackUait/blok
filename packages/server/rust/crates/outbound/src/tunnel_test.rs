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
                        "challenge" if auth == "no" => {
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
                (name == "ALL_PROXY").then(|| format!("http://u:p@127.0.0.1:{port}"))
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
