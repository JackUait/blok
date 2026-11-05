//! The client for endpoints the operator configured: the S3 store and the
//! doc endpoint. It is exempt from the outbound guard because it reaches
//! only those endpoints, never a URL a caller chose. Like SocketsHttpHandler
//! it honours the environment proxy, follows no redirect, asks for no
//! compression and pools nothing.

use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use blok_dotnet::Uri;
use rustls::RootCertStore;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::{Instant, timeout_at};

use crate::fetcher::{tls_connector, trust_for};
use crate::proxy::{EnvironmentProxy, ProxyUrl};
use crate::wire::{Body, Framing, Head, Headers, Source, framing, read_head, request_head};

/// .NET's default MaxResponseHeadersLength.
const MAX_HEAD: usize = 64 << 10;

pub trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}

#[derive(Debug)]
pub enum OperatorError {
    /// The TCP connect, the proxy tunnel or the TLS handshake passed the
    /// connect timeout.
    ConnectTimeout,
    /// The head did not arrive within the header timeout after the body.
    HeaderTimeout,
    /// A proxy refused the tunnel with this status.
    Tunnel(u16),
    Io(io::Error),
}

impl std::fmt::Display for OperatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OperatorError::ConnectTimeout => f.write_str("connect timeout: TCP or TLS handshake"),
            OperatorError::HeaderTimeout => f.write_str("timeout awaiting response headers"),
            OperatorError::Tunnel(status) => write!(f, "proxy refused the tunnel: {status}"),
            OperatorError::Io(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for OperatorError {}

impl From<io::Error> for OperatorError {
    fn from(err: io::Error) -> Self {
        OperatorError::Io(err)
    }
}

impl From<crate::wire::WireError> for OperatorError {
    fn from(err: crate::wire::WireError) -> Self {
        OperatorError::Io(err.into())
    }
}

/// A request body with a known length.
pub enum RequestBody<'a> {
    /// No content: no Content-Length, as .NET sends a GET without one.
    None,
    Bytes(&'a [u8]),
    Reader(&'a mut (dyn AsyncRead + Send + Unpin), u64),
}

impl RequestBody<'_> {
    fn len(&self) -> u64 {
        match self {
            RequestBody::None => 0,
            RequestBody::Bytes(bytes) => bytes.len() as u64,
            RequestBody::Reader(_, length) => *length,
        }
    }
}

/// One request: `headers` go out in order after Host, then Content-Length.
pub struct Request<'a, 'b> {
    pub method: &'a str,
    pub url: &'a Uri,
    /// The Host header, also the authority signed for S3.
    pub host: &'a str,
    pub headers: Vec<(String, String)>,
    pub body: RequestBody<'b>,
}

pub struct Response {
    pub status: u16,
    pub headers: Headers,
    pub body: Body<BufReader<Box<dyn Stream>>>,
}

#[derive(Clone)]
pub struct OperatorClient {
    /// SocketsHttpHandler.ConnectTimeout. One deadline spans the TCP
    /// connect, a proxy tunnel and the TLS handshake (whether .NET counts
    /// them together is unverified).
    pub connect_timeout: Duration,
    /// Counts from the end of the request body, like the PayloadContent
    /// callback in S3BlobStore.SendAsync; None waits forever.
    pub header_timeout: Option<Duration>,
    pub proxy: Option<EnvironmentProxy>,
    /// Replaces the system roots; tests set it.
    pub roots: Option<Arc<RootCertStore>>,
}

impl OperatorClient {
    /// A client with the process environment's proxy.
    pub fn new(connect_timeout: Duration, header_timeout: Option<Duration>) -> OperatorClient {
        OperatorClient {
            connect_timeout,
            header_timeout,
            proxy: EnvironmentProxy::from_env(),
            roots: None,
        }
    }

    /// Sends one request on a new connection and reads the head.
    pub async fn send(&self, request: Request<'_, '_>) -> Result<Response, OperatorError> {
        let scheme = request.url.scheme.as_str();
        let proxy = self
            .proxy
            .as_ref()
            .and_then(|p| p.for_target(scheme, &request.url.host))
            .cloned();
        if let Some(proxy) = &proxy
            && !matches!(
                proxy.scheme.as_str(),
                "http" | "https" | "socks4" | "socks4a" | "socks5"
            )
        {
            return Err(OperatorError::Io(io::Error::new(
                io::ErrorKind::Unsupported,
                format!("the {} proxy scheme is not supported", proxy.scheme),
            )));
        }
        let mut stream = self.connect(request.url, proxy.as_ref()).await?;
        let path = format!("{}{}", request.url.absolute_path, request.url.query);
        // A plain request through a proxy names the whole URL.
        let target = match (&proxy, scheme) {
            (Some(p), "http") if is_http_proxy(p) => format!("http://{}{path}", request.host),
            _ => path,
        };
        let length = request.body.len().to_string();
        let mut headers: Vec<(&str, &str)> = vec![("Host", request.host)];
        let authorization;
        if let (Some(proxy), "http") = (&proxy, scheme)
            && is_http_proxy(proxy)
            && let Some(value) = proxy_authorization(proxy)
        {
            authorization = value;
            headers.push(("Proxy-Authorization", &authorization));
        }
        headers.extend(
            request
                .headers
                .iter()
                .map(|(n, v)| (n.as_str(), v.as_str())),
        );
        if !matches!(request.body, RequestBody::None) {
            headers.push(("Content-Length", &length));
        }
        stream
            .write_all(&request_head(request.method, &target, &headers))
            .await?;
        match request.body {
            RequestBody::None => {}
            RequestBody::Bytes(bytes) => stream.write_all(bytes).await?,
            RequestBody::Reader(reader, length) => {
                let copied = tokio::io::copy(&mut reader.take(length), &mut stream).await?;
                if copied != length {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "the request body ended before its length",
                    )
                    .into());
                }
            }
        }
        stream.flush().await?;
        let mut reader = BufReader::new(stream);
        let head: Head = match self.header_timeout {
            Some(limit) => timeout_at(Instant::now() + limit, read_head(&mut reader, MAX_HEAD))
                .await
                .map_err(|_| OperatorError::HeaderTimeout)??,
            None => read_head(&mut reader, MAX_HEAD).await?,
        };
        let framing: Framing = framing(&head)?;
        Ok(Response {
            status: head.status,
            headers: head.headers,
            body: Body::after_head(reader, framing, head.budget),
        })
    }

    /// The first hop: TCP, a SOCKS tunnel, and TLS of its own to an https
    /// proxy, named by its host.
    async fn open_hop(
        &self,
        dial: &str,
        url: &Uri,
        proxy: Option<&ProxyUrl>,
        trust: &crate::fetcher::Trust,
        deadline: Instant,
    ) -> Result<Box<dyn Stream>, OperatorError> {
        let mut tcp = timeout_at(deadline, connect_authority(dial))
            .await
            .map_err(|_| OperatorError::ConnectTimeout)??;
        if let Some(proxy) = proxy.filter(|p| p.scheme.starts_with("socks")) {
            timeout_at(
                deadline,
                crate::socks::tunnel(&mut tcp, proxy, &url.host, url.port),
            )
            .await
            .map_err(|_| OperatorError::ConnectTimeout)??;
        }
        let mut stream: Box<dyn Stream> = Box::new(tcp);
        if let Some(proxy) = proxy.filter(|p| p.scheme == "https") {
            let name = proxy_server_name(&proxy.authority)?;
            let tls = timeout_at(deadline, tls_connector(trust.clone()).connect(name, stream))
                .await
                .map_err(|_| OperatorError::ConnectTimeout)??;
            stream = Box::new(tls);
        }
        Ok(stream)
    }

    async fn connect(
        &self,
        url: &Uri,
        proxy: Option<&ProxyUrl>,
    ) -> Result<Box<dyn Stream>, OperatorError> {
        let deadline = Instant::now() + self.connect_timeout;
        let authority = format!("{}:{}", url.host, url.port);
        let dial = proxy.map_or(authority.clone(), |p| p.authority.clone());
        let trust = trust_for(&self.roots, &None);
        let mut stream = self.open_hop(&dial, url, proxy, &trust, deadline).await?;
        if url.scheme != "https" {
            return Ok(stream);
        }
        if let Some(proxy) = proxy.filter(|p| is_http_proxy(p)) {
            let mut auth = ProxyAuth::default();
            loop {
                let step = timeout_at(deadline, tunnel(&mut stream, &authority, proxy, &mut auth))
                    .await
                    .map_err(|_| OperatorError::ConnectTimeout)??;
                match step {
                    Tunnel::Open => break,
                    Tunnel::Again { keep } => {
                        if !keep {
                            stream = self
                                .open_hop(&dial, url, Some(proxy), &trust, deadline)
                                .await?;
                        }
                    }
                }
            }
        }
        let name = match url.host_type.as_str() {
            "IPv4" | "IPv6" => ServerName::IpAddress(
                blok_dotnet::parse_ip(&url.idn_host)
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "a bad IP literal"))?
                    .into(),
            ),
            _ => ServerName::try_from(url.idn_host.clone())
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?,
        };
        let tls = timeout_at(deadline, tls_connector(trust).connect(name, stream))
            .await
            .map_err(|_| OperatorError::ConnectTimeout)??;
        Ok(Box::new(tls))
    }
}

/// Resolves and dials an operator-chosen host:port, trying each answer.
async fn connect_authority(authority: &str) -> io::Result<TcpStream> {
    let (host, port) = authority
        .rsplit_once(':')
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no port"))?;
    let port: u16 = port
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a bad port"))?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let mut last = io::Error::new(io::ErrorKind::NotFound, "no address");
    for address in tokio::net::lookup_host((host, port)).await? {
        match TcpStream::connect(address).await {
            Ok(stream) => return Ok(stream),
            Err(err) => last = err,
        }
    }
    Err(last)
}

fn proxy_authorization(proxy: &ProxyUrl) -> Option<String> {
    let (user, password) = proxy.user.as_ref()?;
    let credentials = format!("{user}:{}", password.as_deref().unwrap_or(""));
    Some(format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(credentials)
    ))
}

/// An http or https proxy: a plain request names the whole URL, and an
/// https target goes through CONNECT.
fn is_http_proxy(proxy: &ProxyUrl) -> bool {
    matches!(proxy.scheme.as_str(), "http" | "https")
}

/// The TLS name of an https proxy: its host, an IP literal as an address.
fn proxy_server_name(authority: &str) -> io::Result<ServerName<'static>> {
    let host = authority
        .rsplit_once(':')
        .map_or(authority, |(host, _)| host)
        .trim_start_matches('[')
        .trim_end_matches(']');
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) => Ok(ServerName::IpAddress(ip.into())),
        Err(_) => ServerName::try_from(host.to_owned())
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e)),
    }
}

/// What one CONNECT gave: the tunnel, or a 407 Basic challenge to answer
/// on this stream (`keep`) or on a new one.
enum Tunnel {
    Open,
    Again { keep: bool },
}

/// Where a CONNECT's proxy authentication stands.
#[derive(Default)]
struct ProxyAuth {
    /// The Proxy-Authorization the next CONNECT carries.
    authorization: Option<String>,
    /// The scheme answered, lower case.
    sent: Option<&'static str>,
    /// Whether the one stale-nonce retry was used.
    stale: bool,
    /// The NTLM or Negotiate handshake under way.
    nt: Option<crate::ntlm::NtlmAuth>,
}

/// HttpConnectionPool.EstablishProxyTunnelAsync (System.Net.Http 10.0.11,
/// decompiled; measured by C#'s ProxyConnectTunnelTests). Host, and no
/// User-Agent, as the operator requests have none (HttpConnectionPool.cs
/// :308-312, :660-664). Credentials only after a 407 challenge:
/// SendWithProxyAuthAsync passes preAuthenticate false
/// (AuthenticationHelper.cs:481). The challenge is picked in .NET's order,
/// Negotiate, NTLM, Digest, Basic. A Digest answer gets one more try when
/// the nonce is stale. NTLM and Negotiate are SendWithNtAuthAsync
/// (:630-745): Type 1 and Type 3 go on one stream; only the first 407 may
/// close it, and after the Type 3 the answer is final. Only 200 opens the
/// tunnel (HttpConnectionPool.cs:666).
async fn tunnel<S: AsyncRead + AsyncWrite + Unpin + Send>(
    tcp: &mut S,
    authority: &str,
    proxy: &ProxyUrl,
    auth: &mut ProxyAuth,
) -> Result<Tunnel, OperatorError> {
    let mut headers = vec![("Host", authority)];
    if let Some(value) = &auth.authorization {
        headers.push(("Proxy-Authorization", value));
    }
    tcp.write_all(&request_head("CONNECT", authority, &headers))
        .await?;
    let mut reader = BufReader::new(&mut *tcp);
    let head = read_head(&mut reader, MAX_HEAD).await?;
    if head.status == 200 {
        if !reader.buffer().is_empty() {
            // .NET hands these to the tunnel; before the server's TLS answer
            // they fail its handshake there too.
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bytes after the tunnel answer",
            )
            .into());
        }
        return Ok(Tunnel::Open);
    }
    let next = match (&proxy.user, head.status) {
        (Some((user, password)), 407) => {
            let challenges = auth_challenges(head.headers.values("Proxy-Authenticate"));
            let password = password.as_deref().unwrap_or("");
            match auth.sent {
                None => {
                    let scheme = choose_challenge(&challenges);
                    auth.sent = scheme;
                    match scheme {
                        Some(scheme @ ("negotiate" | "ntlm")) => {
                            ntlm_first(auth, scheme, &challenges[scheme], proxy, user, password)
                                .await?
                        }
                        Some("digest") => crate::digest::parse(&challenges["digest"])
                            .and_then(|p| crate::digest::token(user, password, &p))
                            .map(|token| format!("Digest {token}")),
                        Some("basic") => proxy_authorization(proxy),
                        _ => None,
                    }
                }
                Some(scheme @ ("negotiate" | "ntlm")) => match &mut auth.nt {
                    Some(nt) if !nt.authenticated => match challenges.get(scheme) {
                        None => None,
                        Some(data) => {
                            // A bare challenge is an empty blob: NTLM throws
                            // on it, SPNEGO gives no token.
                            let challenge = base64::engine::general_purpose::STANDARD
                                .decode(data)
                                .map_err(|_| ntlm_throw())?;
                            nt.respond(&challenge)
                                .map_err(|_| ntlm_throw())?
                                .map(|token| {
                                    format!(
                                        "{} {}",
                                        ntlm_scheme(scheme),
                                        base64::engine::general_purpose::STANDARD.encode(token)
                                    )
                                })
                        }
                    },
                    _ => None,
                },
                Some("digest") if !auth.stale => challenges
                    .get("digest")
                    .and_then(|data| crate::digest::parse(data))
                    .filter(|p| p.get("stale").is_some_and(|v| v == "true"))
                    .and_then(|p| {
                        auth.stale = true;
                        crate::digest::token(user, password, &p)
                    })
                    .map(|token| format!("Digest {token}")),
                _ => None,
            }
        }
        _ => None,
    };
    let Some(next) = next else {
        return Err(OperatorError::Tunnel(head.status));
    };
    // After the Type 1 the stream is kept whatever the answer says.
    let handshake = auth.nt.is_some() && auth.authorization.is_some();
    auth.authorization = Some(next);
    let framed = framing(&head)?;
    let close = head
        .headers
        .values("Connection")
        .flat_map(|v| v.split(|&c| c == b','))
        .any(|token| crate::wire::trim_space_tab(token).eq_ignore_ascii_case(b"close"));
    let mut keep = framed != Framing::Close && !head.http10 && !close;
    if keep {
        let mut body = Body::after_head(reader, framed, head.budget);
        let mut sink = [0u8; 512];
        loop {
            match body.read(&mut sink).await {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) => {
                    keep = false;
                    break;
                }
            }
        }
        keep = keep && body.into_inner().buffer().is_empty();
    } else if handshake {
        let mut body = Body::after_head(reader, framed, head.budget);
        let mut sink = [0u8; 512];
        while let Ok(1..) = body.read(&mut sink).await {}
    }
    Ok(Tunnel::Again {
        keep: keep || handshake,
    })
}

/// Proxy-Authenticate lines as each scheme's parameter text, lower-case
/// scheme, the first of a scheme kept: a comma-separated piece (commas in
/// quotes do not split) that starts with a bare token starts a challenge,
/// the rest are its parameters.
fn auth_challenges<'a>(values: impl Iterator<Item = &'a [u8]>) -> HashMap<String, String> {
    let mut challenges = HashMap::new();
    for value in values {
        let value = String::from_utf8_lossy(value);
        let mut scheme: Option<String> = None;
        let mut data: Vec<String> = Vec::new();
        let mut flush = |scheme: &Option<String>, data: &mut Vec<String>| {
            if let Some(scheme) = scheme {
                challenges
                    .entry(scheme.clone())
                    .or_insert_with(|| data.join(", "));
            }
            data.clear();
        };
        for piece in split_outside_quotes(&value) {
            let piece = piece.trim_matches([' ', '\t']);
            let (token, rest) = piece.split_once(' ').unwrap_or((piece, ""));
            if !token.is_empty() && token.bytes().all(crate::wire::is_token_char) {
                flush(&scheme, &mut data);
                scheme = Some(token.to_ascii_lowercase());
                let rest = rest.trim_matches([' ', '\t']);
                if !rest.is_empty() {
                    data.push(rest.to_owned());
                }
            } else if !piece.is_empty() {
                data.push(piece.to_owned());
            }
        }
        flush(&scheme, &mut data);
    }
    challenges
}

/// `s` split at the commas outside quoted strings.
fn split_outside_quotes(s: &str) -> Vec<&str> {
    let bytes = s.as_bytes();
    let (mut pieces, mut start, mut quoted, mut i) = (Vec::new(), 0, false, 0);
    while i < bytes.len() {
        match bytes[i] {
            b'\\' if quoted => i += 1,
            b'"' => quoted = !quoted,
            b',' if !quoted => {
                pieces.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    pieces.push(&s[start..]);
    pieces
}

/// TryGetAuthenticationChallenge's order: Negotiate, NTLM, Digest, Basic.
fn choose_challenge(challenges: &HashMap<String, String>) -> Option<&'static str> {
    ["negotiate", "ntlm", "digest", "basic"]
        .into_iter()
        .find(|scheme| challenges.contains_key(*scheme))
}

fn ntlm_throw() -> OperatorError {
    OperatorError::Io(io::Error::new(
        io::ErrorKind::InvalidData,
        "the NTLM challenge cannot be read",
    ))
}

/// The SPN host of a proxy: an IP literal as it is (IPv6 without
/// brackets), else Dns.GetHostEntryAsync's HostName, getaddrinfo's
/// canonical name. When the lookup fails the name stands as given, as in
/// Go: the dial has found it.
pub(crate) async fn spn_host(host: &str) -> String {
    if host.parse::<std::net::IpAddr>().is_ok() {
        return host.to_owned();
    }
    let owned = host.to_owned();
    let canonical = tokio::task::spawn_blocking(move || {
        let hints = dns_lookup::AddrInfoHints {
            // AI_CANONNAME on macOS, Linux and Windows.
            flags: 2,
            ..dns_lookup::AddrInfoHints::default()
        };
        dns_lookup::getaddrinfo(Some(&owned), None, Some(hints))
            .ok()?
            .next()?
            .ok()?
            .canonname
    })
    .await
    .ok()
    .flatten();
    canonical
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| host.to_owned())
}

/// The scheme name .NET writes, whatever the server's case.
fn ntlm_scheme(sent: &str) -> &'static str {
    if sent == "negotiate" {
        "Negotiate"
    } else {
        "NTLM"
    }
}

/// Starts SendWithNtAuthAsync: the credentials are
/// GetCredentialsFromString's, "domain\\user" split at the first
/// backslash, and the SPN is "HTTP/" and the proxy host. The first
/// challenge's data is decoded, which can throw, and then not read.
async fn ntlm_first(
    auth: &mut ProxyAuth,
    sent: &str,
    data: &str,
    proxy: &ProxyUrl,
    user: &str,
    password: &str,
) -> Result<Option<String>, OperatorError> {
    if !data.is_empty()
        && base64::engine::general_purpose::STANDARD
            .decode(data)
            .is_err()
    {
        return Err(ntlm_throw());
    }
    let (domain, user) = user.split_once('\\').unwrap_or(("", user));
    let host = proxy
        .authority
        .rsplit_once(':')
        .map_or(proxy.authority.as_str(), |(host, _)| host)
        .trim_start_matches('[')
        .trim_end_matches(']');
    let host = spn_host(host).await;
    let Some(mut nt) = crate::ntlm::NtlmAuth::new(
        sent == "negotiate",
        user,
        domain,
        password,
        &format!("HTTP/{host}"),
    ) else {
        return Ok(None);
    };
    let token = base64::engine::general_purpose::STANDARD.encode(nt.initial());
    auth.nt = Some(nt);
    Ok(Some(format!("{} {token}", ntlm_scheme(sent))))
}
