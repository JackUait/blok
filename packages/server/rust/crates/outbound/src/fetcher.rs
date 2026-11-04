use std::future::Future;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use rustls::RootCertStore;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{Instant, timeout, timeout_at};
use tokio_rustls::TlsConnector;

use crate::body::read_bounded;
use crate::policy::{Error, Failure, Policy, Target, fail};
use crate::wire::{Body, Headers, framing, header_text, read_head, request_head};

/// Sent with every fetch, and no other header but Host.
pub const USER_AGENT: &str = "blok-server (+https://blokeditor.com)";

const CONNECT_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(1);

/// .NET's default MaxResponseHeadersLength, 64 KiB; C# sets the same value
/// explicitly.
const MAX_RESPONSE_HEADER_BYTES: usize = 64 << 10;

/// GuardedFetchLimits.
#[derive(Clone)]
pub struct Limits {
    /// Covers the wait for a slot, DNS, every hop and the body.
    pub timeout: Duration,
    pub max_bytes: u64,
    pub max_redirects: usize,
    /// Asked before every redirect hop. A false answer fails the fetch as
    /// RateLimited, so one request cannot fan out.
    pub hop: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    /// Keeps the first `max_bytes` of the body instead of failing past
    /// them. Content-Length is not checked.
    pub truncate: bool,
}

/// GuardedResponse. Dropping it frees the concurrency slot; callers hold it
/// until they are done with the body, as C# holds it until dispose.
pub struct Response {
    pub status_code: u16,
    pub body: Vec<u8>,
    pub content_type: String,
    pub final_url: String,
    /// The final response's header lines as received.
    pub header: Headers,
    pub redirects: usize,
    permit: Option<OwnedSemaphorePermit>,
}

impl Response {
    /// Frees the fetch slot. It is safe to call twice.
    pub fn release(&mut self) {
        self.permit = None;
    }
}

type Lookup = Pin<Box<dyn Future<Output = io::Result<Vec<IpAddr>>> + Send>>;

/// Looks a host up. Tests replace it.
pub type Resolver = Arc<dyn Fn(String) -> Lookup + Send + Sync>;

/// GuardedOutboundFetcher: at most four fetches at once across the whole
/// server, each pinned to addresses the policy vetted. Clones share the
/// slots.
#[derive(Clone)]
pub struct Fetcher {
    pub policy: Arc<dyn Policy>,
    pub resolve: Resolver,
    /// Replaces the system roots; tests set it.
    pub roots: Option<Arc<RootCertStore>>,
    permits: Arc<Semaphore>,
    pub(crate) dial_hook: Option<Arc<dyn Fn(SocketAddr) + Send + Sync>>,
}

fn system_resolve(host: String) -> Lookup {
    Box::pin(async move {
        let answers = tokio::net::lookup_host((host.as_str(), 0)).await?;
        Ok(answers.map(|a| a.ip()).collect())
    })
}

/// The system roots, read once. Verification is rustls's own, which never
/// fetches a missing issuer, never checks revocation, and on macOS still
/// trusts roots added to the Keychain.
pub(crate) fn system_roots() -> Arc<RootCertStore> {
    static ROOTS: OnceLock<Arc<RootCertStore>> = OnceLock::new();
    ROOTS
        .get_or_init(|| {
            let mut store = RootCertStore::empty();
            // Empty when nothing loads: every https fetch then fails closed.
            for certificate in rustls_native_certs::load_native_certs().certs {
                let _ = store.add(certificate);
            }
            Arc::new(store)
        })
        .clone()
}

pub(crate) fn tls_connector(roots: Arc<RootCertStore>) -> TlsConnector {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("the ring provider supports the default versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    TlsConnector::from(Arc::new(config))
}

trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}

impl Fetcher {
    /// A fetcher over `policy` with the system resolver.
    pub fn new(policy: Arc<dyn Policy>) -> Fetcher {
        Fetcher {
            policy,
            resolve: Arc::new(system_resolve),
            roots: None,
            permits: Arc::new(Semaphore::new(4)),
            dial_hook: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn permits_available(&self) -> usize {
        self.permits.available_permits()
    }

    /// Fetches `raw`. Every failure is an `Error`; the caller cancels by
    /// dropping the future, which closes the connection and frees the slot.
    pub async fn get(&self, raw: &str, limits: &Limits) -> Result<Response, Error> {
        let timed_out = fail(Failure::TimedOut);
        if limits.timeout.is_zero() {
            return Err(timed_out);
        }
        let deadline = Instant::now() + limits.timeout;
        let permit = timeout_at(deadline, self.permits.clone().acquire_owned())
            .await
            .map_err(|_| timed_out)?
            .expect("the semaphore is never closed");
        let mut response = timeout_at(deadline, self.fetch(raw, limits))
            .await
            .map_err(|_| timed_out)??;
        response.permit = Some(permit);
        Ok(response)
    }

    async fn fetch(&self, raw: &str, limits: &Limits) -> Result<Response, Error> {
        let blocked = fail(Failure::Blocked);
        let mut raw = raw.to_owned();
        let mut redirects = 0;
        loop {
            let target = self.policy.validate(&raw, None)?;
            let addresses = match target.literal {
                Some(literal) => vec![literal],
                None => (self.resolve)(target.host.clone())
                    .await
                    .map_err(|_| blocked)?,
            };
            if addresses.is_empty() || !addresses.iter().all(|&a| self.policy.address_allowed(a)) {
                return Err(blocked);
            }
            let stream = self.connect(&target, &addresses).await?;
            let mut reader = BufReader::new(stream);
            let head = read_head(&mut reader, MAX_RESPONSE_HEADER_BYTES)
                .await
                .map_err(|_| blocked)?;
            let location = head.headers.get("Location").filter(|l| !l.is_empty());
            if let (true, Some(location)) = (is_redirect(head.status), location) {
                drop(reader);
                if redirects >= limits.max_redirects {
                    return Err(fail(Failure::TooManyRedirects));
                }
                let next = self
                    .policy
                    .validate(&header_text(location), Some(&target.url))?;
                if target.url.scheme == "https" && next.url.scheme != "https" {
                    return Err(blocked);
                }
                if limits.hop.as_ref().is_some_and(|hop| !hop()) {
                    return Err(fail(Failure::RateLimited));
                }
                raw = next.url.absolute_uri;
                redirects += 1;
                continue;
            }
            let framing = framing(&head).map_err(|_| blocked)?;
            let content_length = match framing {
                crate::wire::Framing::Length(n) => Some(n),
                _ => None,
            };
            let encodings: Vec<&[u8]> = head.headers.values("Content-Encoding").collect();
            let body = read_bounded(
                Body::new(reader, framing),
                content_length,
                &encodings,
                limits.max_bytes,
                limits.truncate,
            )
            .await?;
            return Ok(Response {
                status_code: head.status,
                body,
                content_type: content_type(head.headers.get("Content-Type")),
                final_url: target.url.absolute_uri.clone(),
                header: head.headers.clone(),
                redirects,
                permit: None,
            });
        }
    }

    /// Dials only the vetted addresses, uses no proxy, and speaks TLS for
    /// https with http/1.1 as the only protocol offered.
    async fn connect(
        &self,
        target: &Target,
        addresses: &[IpAddr],
    ) -> Result<Box<dyn Stream>, Error> {
        let blocked = fail(Failure::Blocked);
        if target.literal.is_none() && !plain_host_name(&target.host) {
            return Err(blocked);
        }
        let mut connected = None;
        for (i, &ip) in addresses.iter().enumerate() {
            // .NET dials a mapped address on an IPv6-only socket, which fails
            // at once; a dual-stack socket would reach the IPv4 address.
            if let IpAddr::V6(v6) = ip
                && v6.to_ipv4_mapped().is_some()
            {
                continue;
            }
            let address = SocketAddr::new(ip, target.port);
            if let Some(hook) = &self.dial_hook {
                hook(address);
            }
            let attempt = TcpStream::connect(address);
            let result = if i < addresses.len() - 1 {
                timeout(CONNECT_ATTEMPT_TIMEOUT, attempt)
                    .await
                    .unwrap_or_else(|_| Err(io::ErrorKind::TimedOut.into()))
            } else {
                attempt.await
            };
            if let Ok(stream) = result {
                connected = Some(stream);
                break;
            }
        }
        let tcp = connected.ok_or(blocked)?;
        let mut stream: Box<dyn Stream> = if target.url.scheme == "https" {
            let name = match target.literal {
                Some(ip) => ServerName::IpAddress(ip.into()),
                None => ServerName::try_from(target.host.clone()).map_err(|_| blocked)?,
            };
            let roots = self.roots.clone().unwrap_or_else(system_roots);
            let tls = tls_connector(roots)
                .connect(name, tcp)
                .await
                .map_err(|_| blocked)?;
            Box::new(tls)
        } else {
            Box::new(tcp)
        };
        let path = format!("{}{}", target.url.absolute_path, target.url.query);
        let head = request_head(
            "GET",
            &path,
            &[("Host", &host_header(target)), ("User-Agent", USER_AGENT)],
        );
        stream.write_all(&head).await.map_err(|_| blocked)?;
        stream.flush().await.map_err(|_| blocked)?;
        Ok(stream)
    }
}

fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

/// Only letters, digits, '-', '.' and '_'. .NET's HttpClient refuses any
/// other name before it connects.
fn plain_host_name(host: &str) -> bool {
    !host.is_empty()
        && host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._".contains(&c))
}

/// CreateHostHeader: every IPv6 literal in brackets, mapped ones too.
pub(crate) fn host_header(target: &Target) -> String {
    let mut host = target.host.clone();
    if matches!(target.literal, Some(IpAddr::V6(_))) {
        host = format!("[{host}]");
    }
    let scheme = target.url.scheme.as_str();
    if target.port != 80 && scheme == "http" || target.port != 443 && scheme == "https" {
        host = format!("{host}:{}", target.port);
    }
    host
}

/// HttpContentHeaders.ContentType.ToString(): the header re-serialized as
/// "type; name=value", or "" when it does not parse.
fn content_type(header: Option<&[u8]>) -> String {
    let Some(header) = header else {
        return String::new();
    };
    let Some((media_type, params)) = blok_mediatype::parse(&header_text(header)) else {
        return String::new();
    };
    let mut out = media_type;
    for param in params {
        out.push_str("; ");
        out.push_str(&param.name);
        if !param.value.is_empty() {
            out.push('=');
            out.push_str(&param.value);
        }
    }
    out
}
