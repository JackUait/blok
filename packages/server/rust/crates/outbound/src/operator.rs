//! The client for endpoints the operator configured: the S3 store and the
//! doc endpoint. It is exempt from the outbound guard because it reaches
//! only those endpoints, never a URL a caller chose. Like SocketsHttpHandler
//! it honours the environment proxy, follows no redirect, asks for no
//! compression and pools nothing.

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
use crate::wire::{Body, Framing, Head, Headers, framing, read_head, request_head};

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

    async fn connect(
        &self,
        url: &Uri,
        proxy: Option<&ProxyUrl>,
    ) -> Result<Box<dyn Stream>, OperatorError> {
        let deadline = Instant::now() + self.connect_timeout;
        let authority = format!("{}:{}", url.host, url.port);
        let dial = proxy.map_or(authority.clone(), |p| p.authority.clone());
        let tcp = timeout_at(deadline, connect_authority(&dial))
            .await
            .map_err(|_| OperatorError::ConnectTimeout)??;
        let mut tcp = tcp;
        if let Some(proxy) = proxy.filter(|p| p.scheme.starts_with("socks")) {
            timeout_at(
                deadline,
                crate::socks::tunnel(&mut tcp, proxy, &url.host, url.port),
            )
            .await
            .map_err(|_| OperatorError::ConnectTimeout)??;
        }
        let trust = trust_for(&self.roots, &None);
        let mut stream: Box<dyn Stream> = Box::new(tcp);
        // An https proxy gets TLS of its own first, named by its host.
        if let Some(proxy) = proxy.filter(|p| p.scheme == "https") {
            let name = proxy_server_name(&proxy.authority)?;
            let tls = timeout_at(deadline, tls_connector(trust.clone()).connect(name, stream))
                .await
                .map_err(|_| OperatorError::ConnectTimeout)??;
            stream = Box::new(tls);
        }
        if url.scheme != "https" {
            return Ok(stream);
        }
        if let Some(proxy) = proxy.filter(|p| is_http_proxy(p)) {
            timeout_at(deadline, tunnel(&mut stream, &authority, proxy))
                .await
                .map_err(|_| OperatorError::ConnectTimeout)??;
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

/// CONNECT through an http proxy; any status but 2xx refuses the tunnel.
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

async fn tunnel<S: AsyncRead + AsyncWrite + Unpin>(
    tcp: &mut S,
    authority: &str,
    proxy: &ProxyUrl,
) -> Result<(), OperatorError> {
    let mut headers = vec![("Host", authority)];
    let authorization = proxy_authorization(proxy);
    if let Some(value) = &authorization {
        headers.push(("Proxy-Authorization", value));
    }
    tcp.write_all(&request_head("CONNECT", authority, &headers))
        .await?;
    let mut reader = BufReader::new(&mut *tcp);
    let head = read_head(&mut reader, MAX_HEAD).await?;
    if !(200..300).contains(&head.status) {
        return Err(OperatorError::Tunnel(head.status));
    }
    if !reader.buffer().is_empty() {
        return Err(
            io::Error::new(io::ErrorKind::InvalidData, "bytes after the tunnel answer").into(),
        );
    }
    Ok(())
}
