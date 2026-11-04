#![allow(dead_code)]

use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use blok_dotnet::Uri;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

use crate::fetcher::{Fetcher, Limits, Resolver};
use crate::policy::{DefaultPolicy, Error, Failure, Policy, Target, fail, resolve};

pub trait Conn: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> Conn for T {}

/// One request an origin saw.
#[derive(Debug, Clone, Default)]
pub struct Seen {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub server_name: Option<String>,
    pub alpn: Option<Vec<u8>>,
    pub tls: bool,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

pub type Handler = Arc<
    dyn Fn(Seen, usize, Box<dyn Conn>) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync,
>;

/// LoopbackOrigin: reads each request head and hands the connection to the
/// handler, with the request count so far.
pub struct Origin {
    pub port: u16,
    pub seen: Arc<Mutex<Vec<Seen>>>,
    pub hellos: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Origin {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Origin {
    pub fn count(&self) -> usize {
        self.seen.lock().unwrap().len()
    }

    pub fn last(&self) -> Option<Seen> {
        self.seen.lock().unwrap().last().cloned()
    }

    pub async fn start(
        address: &str,
        tls: Option<tokio_rustls::TlsAcceptor>,
        handler: Handler,
    ) -> Option<Origin> {
        let listener = TcpListener::bind(address).await.ok()?;
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let hellos = Arc::new(AtomicUsize::new(0));
        let (seen2, hellos2) = (seen.clone(), hellos.clone());
        let task = tokio::spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else {
                    return;
                };
                let (seen, hellos, handler, tls) =
                    (seen2.clone(), hellos2.clone(), handler.clone(), tls.clone());
                tokio::spawn(async move {
                    let (conn, mut info): (Box<dyn Conn>, Seen) = match tls {
                        None => (Box::new(tcp), Seen::default()),
                        Some(acceptor) => {
                            let Ok(stream) = acceptor.accept(tcp).await else {
                                hellos.fetch_add(1, Ordering::SeqCst);
                                return;
                            };
                            hellos.fetch_add(1, Ordering::SeqCst);
                            let (_, session) = stream.get_ref();
                            let info = Seen {
                                server_name: session.server_name().map(str::to_owned),
                                alpn: session.alpn_protocol().map(<[u8]>::to_vec),
                                tls: true,
                                ..Seen::default()
                            };
                            (Box::new(stream), info)
                        }
                    };
                    let mut reader = BufReader::new(conn);
                    let mut line = String::new();
                    if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                        return;
                    }
                    let mut parts = line.trim_end().splitn(3, ' ');
                    info.method = parts.next().unwrap_or_default().to_owned();
                    info.target = parts.next().unwrap_or_default().to_owned();
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                            return;
                        }
                        let line = line.trim_end_matches(['\r', '\n']);
                        if line.is_empty() {
                            break;
                        }
                        if let Some((name, value)) = line.split_once(':') {
                            info.headers
                                .push((name.to_owned(), value.trim().to_owned()));
                        }
                    }
                    let count = {
                        let mut seen = seen.lock().unwrap();
                        seen.push(info.clone());
                        seen.len()
                    };
                    handler(info, count, Box::new(reader)).await;
                });
            }
        });
        Some(Origin {
            port,
            seen,
            hellos,
            task,
        })
    }
}

pub fn handler<F, Fut>(f: F) -> Handler
where
    F: Fn(Seen, usize, Box<dyn Conn>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    Arc::new(move |seen, count, conn| Box::pin(f(seen, count, conn)))
}

/// Writes one fixed answer per request.
pub fn answer(f: impl Fn(&Seen, usize) -> Vec<u8> + Send + Sync + 'static) -> Handler {
    let f = Arc::new(f);
    handler(move |seen, count, mut conn| {
        let response = f(&seen, count);
        async move {
            let _ = conn.write_all(&response).await;
            let _ = conn.flush().await;
            let _ = conn.shutdown().await;
        }
    })
}

/// 200 "ok" as text/plain; charset=utf-8, like Go's startOrigin.
pub fn ok_handler() -> Handler {
    answer(|_, _| {
        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
            .to_vec()
    })
}

pub async fn ok_origin(address: &str) -> Option<Origin> {
    Origin::start(address, None, ok_handler()).await
}

pub fn addrs(texts: &[&str]) -> Vec<IpAddr> {
    texts.iter().map(|t| t.parse().unwrap()).collect()
}

/// Answers the lookups in turn, repeating the last.
pub struct Counting {
    pub calls: Arc<AtomicUsize>,
    pub resolver: Resolver,
}

pub fn counting(answers: Vec<Vec<IpAddr>>) -> Counting {
    counting_with_delay(answers, std::time::Duration::ZERO)
}

pub fn counting_with_delay(answers: Vec<Vec<IpAddr>>, delay: std::time::Duration) -> Counting {
    let calls = Arc::new(AtomicUsize::new(0));
    let calls2 = calls.clone();
    let answers = Arc::new(answers);
    Counting {
        calls,
        resolver: Arc::new(move |_host| {
            let call = calls2.fetch_add(1, Ordering::SeqCst);
            let answer = answers[call.min(answers.len() - 1)].clone();
            Box::pin(async move {
                tokio::time::sleep(delay).await;
                Ok(answer)
            })
        }),
    }
}

/// The C# FixtureOutboundPolicy: the listed hosts at one port, and only the
/// listed addresses.
pub struct FixturePolicy {
    pub hosts: Vec<String>,
    pub ports: Vec<u16>,
    pub allowed: Vec<IpAddr>,
}

impl FixturePolicy {
    pub fn new(host: &str, port: u16, allowed: Vec<IpAddr>) -> FixturePolicy {
        FixturePolicy {
            hosts: vec![host.to_owned()],
            ports: vec![port],
            allowed,
        }
    }
}

impl Policy for FixturePolicy {
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error> {
        let url = resolve(raw, base).ok_or(fail(Failure::Blocked))?;
        if !self.hosts.contains(&url.host)
            || !self.ports.contains(&url.port)
            || !url.user_info.is_empty()
        {
            return Err(fail(Failure::Blocked));
        }
        Ok(Target {
            host: url.idn_host.clone(),
            port: url.port,
            literal: None,
            url,
        })
    }

    fn address_allowed(&self, address: IpAddr) -> bool {
        self.allowed.contains(&address)
    }
}

/// LiteralFixturePolicy: one literal at one port.
pub struct LiteralPolicy {
    pub port: u16,
    pub literal: IpAddr,
}

impl Policy for LiteralPolicy {
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error> {
        let url = resolve(raw, base).ok_or(fail(Failure::Blocked))?;
        if url.port != self.port {
            return Err(fail(Failure::Blocked));
        }
        Ok(Target {
            url,
            host: self.literal.to_string(),
            port: self.port,
            literal: Some(self.literal),
        })
    }

    fn address_allowed(&self, address: IpAddr) -> bool {
        address == self.literal
    }
}

/// RecordingOutboundPolicy over DefaultPolicy.
#[derive(Default)]
pub struct RecordingPolicy {
    pub decisions: Mutex<Vec<bool>>,
}

impl Policy for RecordingPolicy {
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error> {
        DefaultPolicy.validate(raw, base)
    }

    fn address_allowed(&self, address: IpAddr) -> bool {
        let allowed = DefaultPolicy.address_allowed(address);
        self.decisions.lock().unwrap().push(allowed);
        allowed
    }
}

/// DefaultPolicy without the address ranges or the port rule.
pub struct AnyAddress;

impl Policy for AnyAddress {
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error> {
        let url = resolve(raw, base).ok_or(fail(Failure::Blocked))?;
        let literal = url.idn_host.parse().ok();
        Ok(Target {
            host: url.idn_host.clone(),
            port: url.port,
            literal,
            url,
        })
    }

    fn address_allowed(&self, _: IpAddr) -> bool {
        true
    }
}

pub fn fetcher(policy: impl Policy + 'static, resolver: &Counting) -> Fetcher {
    let mut f = Fetcher::new(Arc::new(policy));
    f.resolve = resolver.resolver.clone();
    f
}

pub fn fixture_fetcher(host: &str, port: u16) -> Fetcher {
    fetcher(
        FixturePolicy::new(host, port, addrs(&["127.0.0.1"])),
        &counting(vec![addrs(&["127.0.0.1"])]),
    )
}

pub fn limits() -> Limits {
    Limits {
        timeout: std::time::Duration::from_secs(5),
        max_bytes: 1 << 20,
        max_redirects: 5,
        hop: None,
        truncate: false,
    }
}

pub fn limits_of(timeout_ms: u64, max_bytes: u64, max_redirects: usize) -> Limits {
    Limits {
        timeout: std::time::Duration::from_millis(timeout_ms),
        max_bytes,
        max_redirects,
        hop: None,
        truncate: false,
    }
}

pub fn dial_log(f: &mut Fetcher) -> Arc<Mutex<Vec<SocketAddr>>> {
    let log = Arc::new(Mutex::new(Vec::new()));
    let log2 = log.clone();
    f.dial_hook = Some(Arc::new(move |a| log2.lock().unwrap().push(a)));
    log
}

pub fn failure<T>(result: Result<T, Error>) -> Option<Failure> {
    result.err().map(|e| e.failure)
}
