//! The client for endpoints the operator configured: the S3 store and the
//! doc endpoint. It is exempt from the outbound guard because it reaches
//! only those endpoints, never a URL a caller chose. Like SocketsHttpHandler
//! it honours the environment proxy, follows no redirect, asks for no
//! compression and pools nothing.

use std::collections::HashMap;
use std::io;

use std::time::Duration;

use base64::Engine;
use blok_dotnet::Uri;
use rustls::pki_types::ServerName;
use tokio::io::{
    AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::net::TcpStream;
use tokio::time::{Instant, timeout_at};

use crate::fetcher::{Check, Roots, tls_connector};
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
    /// Seekable, so a proxy's 407 can send it again from where it started,
    /// as .NET resends its content.
    Reader(&'a mut (dyn ReadSeek + Send + Unpin), u64),
}

pub trait ReadSeek: AsyncRead + AsyncSeek {}

impl<T: AsyncRead + AsyncSeek> ReadSeek for T {}

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
    pub roots: Option<Roots>,
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
    pub async fn send(&self, mut request: Request<'_, '_>) -> Result<Response, OperatorError> {
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
        // A plain request through a proxy names the whole URL and answers
        // the proxy's 407 (SendWithProxyAuthAsync); the CONNECT route
        // answers it in the tunnel.
        let forward = match (&proxy, scheme) {
            (Some(p), "http") if is_http_proxy(p) => Some(p),
            _ => None,
        };
        let target = match forward {
            Some(_) => format!("http://{}{path}", request.host),
            None => path.clone(),
        };
        let start = match &mut request.body {
            RequestBody::Reader(reader, _) => Some(reader.stream_position().await?),
            _ => None,
        };
        let mut auth = ProxyAuth::default();
        let mut content: Option<Vec<u8>> = None;
        loop {
            self.write_request(&mut stream, &mut request, &target, &auth, start)
                .await?;
            let mut reader = BufReader::new(stream);
            let head: Head = match self.header_timeout {
                Some(limit) => timeout_at(Instant::now() + limit, read_head(&mut reader, MAX_HEAD))
                    .await
                    .map_err(|_| OperatorError::HeaderTimeout)??,
                None => read_head(&mut reader, MAX_HEAD).await?,
            };
            if let Some(proxy) = forward {
                auth.check_final(&head)?;
                if head.status == 407 {
                    // Only Digest's auth-int reads the body.
                    let auth_int = head
                        .headers
                        .values("Proxy-Authenticate")
                        .any(|v| v.windows(8).any(|w| w.eq_ignore_ascii_case(b"auth-int")));
                    if auth_int && content.is_none() {
                        content = Some(self.content(&mut request, start).await?);
                    }
                    let content_type = request
                        .headers
                        .iter()
                        .find(|(name, _)| name.eq_ignore_ascii_case("Content-Type"))
                        .map(|(_, value)| value.as_str());
                    let signed = Signed {
                        method: request.method,
                        uri: &path,
                        content: content.as_deref().unwrap_or_default(),
                        content_type,
                    };
                    if let Some(next) = auth.answer(&head, proxy, &signed).await? {
                        stream = if auth.retry(next, &mut reader, &head).await? {
                            reader.into_inner()
                        } else {
                            self.connect(request.url, Some(proxy)).await?
                        };
                        continue;
                    }
                }
            }
            let framing: Framing = framing(&head)?;
            return Ok(Response {
                status: head.status,
                headers: head.headers,
                body: Body::after_head(reader, framing, head.budget),
            });
        }
    }

    /// Writes the head and the body; a reader body goes out from `start`.
    async fn write_request(
        &self,
        stream: &mut Box<dyn Stream>,
        request: &mut Request<'_, '_>,
        target: &str,
        auth: &ProxyAuth,
        start: Option<u64>,
    ) -> Result<(), OperatorError> {
        let length = request.body.len().to_string();
        let mut headers: Vec<(&str, &str)> = vec![("Host", request.host)];
        if let Some(value) = &auth.authorization {
            headers.push(("Proxy-Authorization", value));
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
            .write_all(&request_head(request.method, target, &headers)?)
            .await?;
        match &mut request.body {
            RequestBody::None => {}
            RequestBody::Bytes(bytes) => stream.write_all(bytes).await?,
            RequestBody::Reader(reader, length) => {
                reader
                    .seek(std::io::SeekFrom::Start(start.unwrap_or_default()))
                    .await?;
                let length = *length;
                let copied = tokio::io::copy(&mut reader.take(length), stream).await?;
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
        Ok(())
    }

    /// The body Digest's auth-int hashes.
    async fn content(
        &self,
        request: &mut Request<'_, '_>,
        start: Option<u64>,
    ) -> Result<Vec<u8>, OperatorError> {
        Ok(match &mut request.body {
            RequestBody::None => Vec::new(),
            RequestBody::Bytes(bytes) => bytes.to_vec(),
            RequestBody::Reader(reader, length) => {
                reader
                    .seek(std::io::SeekFrom::Start(start.unwrap_or_default()))
                    .await?;
                let mut out = Vec::new();
                reader.take(*length).read_to_end(&mut out).await?;
                out
            }
        })
    }

    /// The first hop: TCP, a SOCKS tunnel, and TLS of its own to an https
    /// proxy, named by its host.
    async fn open_hop(
        &self,
        dial: &str,
        url: &Uri,
        proxy: Option<&ProxyUrl>,
        roots: &Option<Roots>,
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
            let tls = timeout_at(
                deadline,
                tls_connector(roots, Check::Operator).connect(name, stream),
            )
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
        let mut stream = self
            .open_hop(&dial, url, proxy, &self.roots, deadline)
            .await?;
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
                                .open_hop(&dial, url, Some(proxy), &self.roots, deadline)
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
        let tls = timeout_at(
            deadline,
            tls_connector(&self.roots, Check::Operator).connect(name, stream),
        )
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

/// GetCredentialsFromString's NetworkCredential: the user name split at
/// its first backslash into domain and user. Digest and NTLM send the user
/// alone.
fn proxy_credential(name: &str) -> (&str, &str) {
    name.split_once('\\')
        .map_or((name, ""), |(domain, user)| (user, domain))
}

/// SetBasicAuthToken: a non-empty domain goes back in front of the user.
fn proxy_authorization(proxy: &ProxyUrl) -> Option<String> {
    let (name, password) = proxy.user.as_ref()?;
    let password = password.as_deref().unwrap_or("");
    let credentials = match proxy_credential(name) {
        (user, "") => format!("{user}:{password}"),
        (user, domain) => format!("{domain}\\{user}:{password}"),
    };
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

/// Where one request's proxy authentication stands: .NET's
/// SendWithProxyAuthAsync, which passes preAuthenticate false, so nothing
/// goes out before a 407 asks (AuthenticationHelper.cs:481). The challenge
/// is picked in .NET's order, Negotiate, NTLM, Digest, Basic. A Digest
/// answer gets one more try when the nonce is stale. NTLM and Negotiate
/// are SendWithNtAuthAsync (:630-745): Type 1 and Type 3 go on one stream.
#[derive(Default)]
struct ProxyAuth {
    /// The Proxy-Authorization the next request carries.
    authorization: Option<String>,
    /// The scheme answered, lower case.
    sent: Option<&'static str>,
    /// Whether the one stale-nonce retry was used.
    stale: bool,
    /// The NTLM or Negotiate handshake under way.
    nt: Option<crate::ntlm::NtlmAuth>,
}

/// What Digest signs: the method, the request URI's path and query, and
/// the body auth-int hashes, read under its raw Content-Type.
pub(crate) struct Signed<'a> {
    pub(crate) method: &'a str,
    pub(crate) uri: &'a str,
    pub(crate) content: &'a [u8],
    pub(crate) content_type: Option<&'a str>,
}

impl ProxyAuth {
    /// The Proxy-Authorization a 407 asks for next; None when .NET stops
    /// and the 407 is the answer. A value .NET cannot write as ASCII (a
    /// Digest realm or nonce from the proxy) fails before it goes out, as
    /// HttpConnection.WriteString does.
    async fn answer(
        &mut self,
        head: &Head,
        proxy: &ProxyUrl,
        signed: &Signed<'_>,
    ) -> Result<Option<String>, OperatorError> {
        let next = self.next_authorization(head, proxy, signed).await?;
        if next.as_ref().is_some_and(|next| !next.is_ascii()) {
            return Err(OperatorError::Io(io::Error::other(
                "Request headers must contain only ASCII characters.",
            )));
        }
        Ok(next)
    }

    async fn next_authorization(
        &mut self,
        head: &Head,
        proxy: &ProxyUrl,
        signed: &Signed<'_>,
    ) -> Result<Option<String>, OperatorError> {
        let Some((name, password)) = &proxy.user else {
            return Ok(None);
        };
        let (user, domain) = proxy_credential(name);
        let challenges = auth_challenges(head.headers.values("Proxy-Authenticate"));
        let password = password.as_deref().unwrap_or("");
        // A body .NET cannot read as a string fails the request.
        let digest =
            |p: &HashMap<String, String>| match crate::digest::token(user, password, p, signed) {
                Ok(token) => Ok(token.map(|token| format!("Digest {token}"))),
                Err(err) => Err(OperatorError::Io(io::Error::other(err.to_string()))),
            };
        Ok(match self.sent {
            None => {
                let scheme = choose_challenge(&challenges);
                self.sent = scheme;
                match scheme {
                    Some(scheme @ ("negotiate" | "ntlm")) => {
                        ntlm_first(
                            self,
                            scheme,
                            &challenges[scheme],
                            proxy,
                            user,
                            domain,
                            password,
                        )
                        .await?
                    }
                    Some("digest") => match crate::digest::parse(&challenges["digest"]) {
                        Some(p) => digest(&p)?,
                        None => None,
                    },
                    Some("basic") => proxy_authorization(proxy),
                    _ => None,
                }
            }
            Some(scheme @ ("negotiate" | "ntlm")) => match &mut self.nt {
                Some(nt) if !nt.authenticated => match challenges.get(scheme) {
                    None => None,
                    Some(data) => {
                        // A bare challenge is an empty blob: NTLM throws on
                        // it, SPNEGO gives no token.
                        let challenge = base64::engine::general_purpose::STANDARD
                            .decode(data)
                            .map_err(|_| ntlm_throw())?;
                        let (token, status) = nt.respond(&challenge).map_err(|_| ntlm_throw())?;
                        token
                            .filter(|_| status <= crate::ntlm::Status::Continue)
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
            Some("digest") if !self.stale => {
                let stale = challenges
                    .get("digest")
                    .and_then(|data| crate::digest::parse(data))
                    .filter(|p| p.get("stale").is_some_and(|v| v == "true"));
                match stale {
                    Some(p) => {
                        self.stale = true;
                        digest(&p)?
                    }
                    None => None,
                }
            }
            _ => None,
        })
    }

    /// SendWithNtAuthAsync's last step: an answer that is not a 407 but
    /// carries the scheme's token, while the handshake is still open
    /// (RequestMic), is read, and a failed read fails the request with 401.
    fn check_final(&mut self, head: &Head) -> Result<(), OperatorError> {
        if head.status != 407
            && self.authorization.is_some()
            && let (Some(scheme), Some(nt)) = (self.sent, &mut self.nt)
            && !nt.authenticated
            && let Some(data) =
                auth_challenges(head.headers.values("Proxy-Authenticate")).get(scheme)
        {
            let blob = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| ntlm_throw())?;
            let (_, status) = nt.respond(&blob).map_err(|_| ntlm_throw())?;
            if status > crate::ntlm::Status::Continue {
                return Err(OperatorError::Tunnel(401));
            }
        }
        Ok(())
    }

    /// Takes `next` for the following request and drains the 407 as .NET
    /// does: whether the stream is kept. NTLM and Negotiate keep it or fail
    /// (DrainResponseAsync), except that a first 407 that says close moves
    /// to a new stream; Basic and Digest drop a stream they cannot drain.
    async fn retry<T: AsyncRead + Unpin + Send>(
        &mut self,
        next: String,
        reader: &mut BufReader<T>,
        head: &Head,
    ) -> Result<bool, OperatorError> {
        let first = self.authorization.is_none();
        self.authorization = Some(next);
        let framed = framing(head)?;
        let closes = crate::wire::head_closes_conn(&head.headers);
        if self.nt.is_some() {
            if first && crate::wire::connection_header_closes(&head.headers) {
                return Ok(false);
            }
            if framed == Framing::Close || closes || !drain(reader, framed, head.budget).await {
                return Err(io::Error::other("the authentication conn failed").into());
            }
            return Ok(true);
        }
        Ok(framed != Framing::Close && !closes && drain(reader, framed, head.budget).await)
    }
}

/// HttpConnectionPool.EstablishProxyTunnelAsync (System.Net.Http 10.0.11,
/// decompiled; measured by C#'s ProxyConnectTunnelTests). Host, and no
/// User-Agent, as the operator requests have none (HttpConnectionPool.cs
/// :308-312, :660-664). Only 200 opens the tunnel (HttpConnectionPool.cs
/// :666).
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
    tcp.write_all(&request_head("CONNECT", authority, &headers)?)
        .await?;
    let mut reader = BufReader::new(&mut *tcp);
    let head = read_head(&mut reader, MAX_HEAD).await?;
    auth.check_final(&head)?;
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
    // The CONNECT request's URI is the proxy's, so Digest signs "/".
    let signed = Signed {
        method: "CONNECT",
        uri: "/",
        content: &[],
        content_type: None,
    };
    let next = match head.status {
        407 => auth.answer(&head, proxy, &signed).await?,
        _ => None,
    };
    let Some(next) = next else {
        return Err(OperatorError::Tunnel(head.status));
    };
    let keep = auth.retry(next, &mut reader, &head).await?;
    Ok(Tunnel::Again { keep })
}

/// SocketsHttpHandler's MaxResponseDrainSize and ResponseDrainTimeout.
const MAX_DRAIN: u64 = 1 << 20;
const DRAIN_TIME: Duration = Duration::from_secs(2);

/// HttpContentReadStream.DrainAsync, then CompleteResponse's check that
/// nothing follows the body. A length body is not read when more than the
/// cap is left past what is buffered; a chunked one fails at a fill with
/// DrainCount at the cap.
async fn drain<T: AsyncRead + Unpin + Send>(
    reader: &mut BufReader<T>,
    framed: Framing,
    budget: usize,
) -> bool {
    if let Framing::Length(n) = framed
        && n.saturating_sub(reader.buffer().len() as u64) > MAX_DRAIN
    {
        return false;
    }
    let chunked = framed == Framing::Chunked;
    let counted = DrainCount {
        count: reader.buffer().len() as u64,
        armed: chunked,
        reader: &mut *reader,
    };
    let mut body = Body::after_head(counted, framed, budget);
    let mut sink = [0u8; 4096];
    let read = timeout_at(Instant::now() + DRAIN_TIME, async {
        loop {
            match body.read(&mut sink).await {
                Ok(0) => return true,
                Ok(_) => {}
                Err(_) => return false,
            }
        }
    })
    .await;
    matches!(read, Ok(true)) && reader.buffer().is_empty()
}

/// ChunkedEncodingReadStream.DrainAsync's count: every byte after the
/// head, framing too. While armed, a fill with the count at the cap fails
/// instead: the body is not done, and .NET stops there. .NET also counts
/// a line cut by a read again; read_line holds those bytes, so they are
/// counted once here.
struct DrainCount<'a, T> {
    reader: &'a mut BufReader<T>,
    count: u64,
    armed: bool,
}

impl<T: AsyncRead + Unpin> tokio::io::AsyncRead for DrainCount<'_, T> {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        use tokio::io::AsyncBufRead;
        let filled = std::task::ready!(self.as_mut().poll_fill_buf(cx))?;
        let n = filled.len().min(buf.remaining());
        buf.put_slice(&filled[..n]);
        self.consume(n);
        std::task::Poll::Ready(Ok(()))
    }
}

impl<T: AsyncRead + Unpin> tokio::io::AsyncBufRead for DrainCount<'_, T> {
    fn poll_fill_buf(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<io::Result<&[u8]>> {
        let this = self.get_mut();
        if this.reader.buffer().is_empty() {
            if this.armed && this.count >= MAX_DRAIN {
                return std::task::Poll::Ready(Err(io::Error::other(
                    "the answer could not be drained",
                )));
            }
            let filled =
                std::task::ready!(std::pin::Pin::new(&mut *this.reader).poll_fill_buf(cx))?;
            this.count += filled.len() as u64;
        }
        std::pin::Pin::new(&mut *this.reader).poll_fill_buf(cx)
    }

    fn consume(self: std::pin::Pin<&mut Self>, amt: usize) {
        std::pin::Pin::new(&mut *self.get_mut().reader).consume(amt);
    }
}

/// Proxy-Authenticate lines as each scheme's parameter text, lower-case
/// scheme, the first of a scheme kept. Each line is a list of
/// AuthenticationHeaderValue (System.Net.Http 10.0.11, decompiled); a line
/// with any bad value is dropped whole, as HttpHeaders keeps it invalid.
/// Header bytes are Latin-1 chars, as .NET reads them.
fn auth_challenges<'a>(values: impl Iterator<Item = &'a [u8]>) -> HashMap<String, String> {
    let mut challenges = HashMap::new();
    for value in values {
        let Some(parsed) = parse_challenge_line(value) else {
            continue;
        };
        for (scheme, parameter) in parsed {
            challenges
                .entry(scheme)
                .or_insert_with(|| parameter.iter().map(|&b| char::from(b)).collect());
        }
    }
    challenges
}

fn space_length(s: &[u8], at: usize) -> usize {
    s[at.min(s.len())..]
        .iter()
        .take_while(|&&c| c == b' ' || c == b'\t')
        .count()
}

fn token_length(s: &[u8], at: usize) -> usize {
    s[at.min(s.len())..]
        .iter()
        .take_while(|&&c| crate::wire::is_token_char(c))
        .count()
}

/// HeaderUtilities.GetNextNonEmptyOrWhitespaceIndex with empty values
/// skipped: the next index, and whether a comma was passed.
fn next_non_empty(s: &[u8], mut i: usize) -> (usize, bool) {
    i += space_length(s, i);
    if i == s.len() || s[i] != b',' {
        return (i, false);
    }
    i += 1;
    i += space_length(s, i);
    while i < s.len() && s[i] == b',' {
        i += 1;
        i += space_length(s, i);
    }
    (i, true)
}

/// BaseHeaderParser.TryParseValue over one line: values split by commas,
/// empty ones skipped.
fn parse_challenge_line(line: &[u8]) -> Option<Vec<(String, &[u8])>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < line.len() {
        let (next, _) = next_non_empty(line, i);
        if next == line.len() {
            break;
        }
        let (scheme, parameter, length) = authentication_value(line, next)?;
        out.push((
            String::from_utf8_lossy(scheme).to_ascii_lowercase(),
            parameter,
        ));
        let separator;
        (i, separator) = next_non_empty(line, next + length);
        if !separator && i < line.len() {
            return None;
        }
    }
    Some(out)
}

/// AuthenticationHeaderValue.GetAuthenticationLength: a scheme token, then
/// either nothing or whitespace and a first blob of any bytes up to a
/// comma, then name=value pairs. A token without "=" ends the value: it
/// starts the next challenge.
fn authentication_value(s: &[u8], start: usize) -> Option<(&[u8], &[u8], usize)> {
    if s[start..].iter().any(|c| matches!(c, b'\r' | b'\n' | 0)) {
        return None;
    }
    let n = token_length(s, start);
    if n == 0 {
        return None;
    }
    let scheme = &s[start..start + n];
    let mut i = start + n;
    let space = space_length(s, i);
    i += space;
    if i == s.len() || s[i] == b',' {
        return Some((scheme, &[], i - start));
    }
    if space == 0 {
        return None;
    }
    let (from, mut end) = (i, i);
    while i < s.len() && s[i] != b',' {
        if s[i] == b'"' {
            let q = crate::wire::quoted_string_length(s, i);
            if q == 0 {
                return None;
            }
            i += q;
            end = i - 1;
        } else {
            let w = space_length(s, i);
            if w > 0 {
                i += w;
            } else {
                end = i;
                i += 1;
            }
        }
    }
    // TryGetParametersEndIndex, from the comma at i.
    while i < s.len() {
        let (mut j, _) = next_non_empty(s, i + 1);
        if j == s.len() {
            i = j;
            break;
        }
        let t = token_length(s, j);
        if t == 0 {
            return None;
        }
        j += t;
        j += space_length(s, j);
        if j == s.len() || s[j] != b'=' {
            break;
        }
        j += 1;
        j += space_length(s, j);
        let mut v = token_length(s, j);
        if v == 0 {
            v = crate::wire::quoted_string_length(s, j);
        }
        if v == 0 {
            return None;
        }
        j += v;
        end = j - 1;
        i = j + space_length(s, j);
        if i >= s.len() || s[i] != b',' {
            break;
        }
    }
    Some((scheme, &s[from..=end], i - start))
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

/// Starts SendWithNtAuthAsync; the SPN is "HTTP/" and the proxy host. The
/// first challenge's data is decoded, which can throw, and then not read.
async fn ntlm_first(
    auth: &mut ProxyAuth,
    sent: &str,
    data: &str,
    proxy: &ProxyUrl,
    user: &str,
    domain: &str,
    password: &str,
) -> Result<Option<String>, OperatorError> {
    if !data.is_empty()
        && base64::engine::general_purpose::STANDARD
            .decode(data)
            .is_err()
    {
        return Err(ntlm_throw());
    }
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
