use std::collections::HashSet;
use std::future::Future;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use rustls::RootCertStore;
use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, SignatureScheme};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{Instant, timeout, timeout_at};
use tokio_rustls::TlsConnector;

use crate::body::read_bounded;
use crate::lanes::{CallerLanes, Lease};
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
    /// Takes a slot from the upload pool, so long downloads never starve
    /// the short checks.
    pub upload: bool,
    /// The rate-limit key. A caller runs at most two fetches at once in each
    /// pool; more wait for one of its own slots. Empty is no cap.
    pub caller: String,
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
    lease: Option<Lease>,
}

impl Response {
    /// Frees the fetch slot. It is safe to call twice.
    pub fn release(&mut self) {
        self.permit = None;
        self.lease = None;
    }
}

type Lookup = Pin<Box<dyn Future<Output = io::Result<Vec<IpAddr>>> + Send>>;

/// Looks a host up. Tests replace it.
pub type Resolver = Arc<dyn Fn(String) -> Lookup + Send + Sync>;

/// GuardedOutboundFetcher: at most four checks and four uploads at once
/// across the whole server, at most two of each per caller, each pinned to
/// addresses the policy vetted. Clones share the slots.
#[derive(Clone)]
pub struct Fetcher {
    pub policy: Arc<dyn Policy>,
    pub resolve: Resolver,
    /// Replaces the system roots; tests set it.
    pub roots: Option<Arc<RootCertStore>>,
    /// The certs the trust settings deny, by `cert_hash`, for `roots`; with
    /// `roots` None the system's set is used.
    pub(crate) denied: Option<Denied>,
    permits: Arc<Semaphore>,
    uploads: Arc<Semaphore>,
    check_callers: CallerLanes,
    upload_callers: CallerLanes,
    pub(crate) dial_hook: Option<Arc<dyn Fn(SocketAddr) + Send + Sync>>,
}

fn system_resolve(host: String) -> Lookup {
    Box::pin(async move {
        let answers = tokio::net::lookup_host((host.as_str(), 0)).await?;
        Ok(answers.map(|a| a.ip()).collect())
    })
}

/// The system roots and the certs the trust settings deny, read once.
/// Verification is rustls's own, which never fetches a missing issuer and
/// never checks revocation (tls_test pins both). On macOS both come from
/// the trust settings (tls_darwin), with /etc/ssl/cert.pem and no denials
/// only when a read fails.
fn system_trust() -> &'static (Arc<RootCertStore>, Denied) {
    static TRUST: OnceLock<(Arc<RootCertStore>, Denied)> = OnceLock::new();
    TRUST.get_or_init(|| {
        let mut store = RootCertStore::empty();
        #[cfg(target_os = "macos")]
        let (certificates, denied) =
            crate::tls_darwin::load_roots(std::path::Path::new(crate::tls_darwin::SECURITY_TOOL));
        #[cfg(not(target_os = "macos"))]
        let (certificates, denied) = (
            rustls_native_certs::load_native_certs().certs,
            HashSet::new(),
        );
        // Empty when nothing loads: every https fetch then fails closed.
        for certificate in certificates {
            let _ = store.add(certificate);
        }
        (Arc::new(store), Arc::new(denied))
    })
}

/// The roots and denials for a client: the given roots with their own
/// denials, else the system's.
pub(crate) fn trust_for(
    roots: &Option<Arc<RootCertStore>>,
    denied: &Option<Denied>,
) -> (Arc<RootCertStore>, Denied) {
    match roots {
        Some(roots) => (roots.clone(), denied.clone().unwrap_or_default()),
        None => system_trust().clone(),
    }
}

/// Certs denied by hash.
pub(crate) type Denied = Arc<HashSet<String>>;

/// A cert's SHA-1 in upper hex, as the trust settings key it.
pub(crate) fn cert_hash(der: &[u8]) -> String {
    Sha1::digest(der)
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect()
}

pub(crate) fn tls_connector(roots: Arc<RootCertStore>, denied: Denied) -> TlsConnector {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("the ring provider supports the default versions");
    let verifier = (!denied.is_empty())
        .then(|| {
            WebPkiServerVerifier::builder_with_provider(roots.clone(), provider)
                .build()
                .ok()
        })
        .flatten();
    let mut config = match verifier {
        Some(inner) => builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(DenyingVerifier { inner, denied }))
            .with_no_client_auth(),
        // No denials, or no roots: every chain then fails anyway.
        None => builder.with_root_certificates(roots).with_no_client_auth(),
    };
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    TlsConnector::from(Arc::new(config))
}

/// rustls's own check, run without the certs the trust settings deny: a
/// denied leaf fails, and a chain must avoid every denied intermediate.
/// trustd checks the leaf and every parent (SecTrustServer.c:855-875,
/// 910-925) and fails a path with a denied cert (SecPolicyServer.c
/// :3425-3440); another path that avoids it still works.
#[derive(Debug)]
struct DenyingVerifier {
    inner: Arc<WebPkiServerVerifier>,
    denied: Denied,
}

impl ServerCertVerifier for DenyingVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if self.denied.contains(&cert_hash(end_entity)) {
            return Err(rustls::Error::InvalidCertificate(
                CertificateError::ApplicationVerificationFailure,
            ));
        }
        let kept: Vec<CertificateDer<'_>> = intermediates
            .iter()
            .filter(|c| !self.denied.contains(&cert_hash(c)))
            .cloned()
            .collect();
        self.inner
            .verify_server_cert(end_entity, &kept, server_name, ocsp_response, now)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
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
            denied: None,
            permits: Arc::new(Semaphore::new(4)),
            uploads: Arc::new(Semaphore::new(4)),
            check_callers: CallerLanes::default(),
            upload_callers: CallerLanes::default(),
            dial_hook: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn permits_available(&self) -> usize {
        self.permits.available_permits()
    }

    /// Fetches `raw`. Every failure is an `Error`; the caller cancels by
    /// dropping the future, which closes the connection and frees the slot.
    ///
    /// # Panics
    ///
    /// When `max_bytes` is above .NET's `Array.MaxLength`, where C# throws
    /// ArgumentOutOfRangeException.
    pub async fn get(&self, raw: &str, limits: &Limits) -> Result<Response, Error> {
        assert!(
            limits.max_bytes <= 0x7FFF_FFC7,
            "The response byte limit is outside the supported range."
        );
        let timed_out = fail(Failure::TimedOut);
        if limits.timeout.is_zero() {
            return Err(timed_out);
        }
        let deadline = Instant::now() + limits.timeout;
        let (permits, callers) = if limits.upload {
            (&self.uploads, &self.upload_callers)
        } else {
            (&self.permits, &self.check_callers)
        };
        // The caller's own lane comes first, so a waiting fetch never holds a
        // pool slot others could use.
        let lease = timeout_at(deadline, callers.enter(&limits.caller))
            .await
            .map_err(|_| timed_out)?;
        let permit = timeout_at(deadline, permits.clone().acquire_owned())
            .await
            .map_err(|_| timed_out)?
            .expect("the semaphore is never closed");
        let mut response = timeout_at(deadline, self.fetch(raw, limits))
            .await
            .map_err(|_| timed_out)??;
        response.permit = Some(permit);
        response.lease = lease;
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
            // C# follows only a Location .NET parses as a Uri; else the 3xx
            // is the answer.
            let location = head
                .headers
                .get("Location")
                .filter(|l| !l.is_empty())
                .map(header_text)
                .filter(|l| blok_dotnet::parses_as_uri(l));
            if let (true, Some(location)) = (is_redirect(head.status), location) {
                drop(reader);
                if redirects >= limits.max_redirects {
                    return Err(fail(Failure::TooManyRedirects));
                }
                let next = self.policy.validate(&location, Some(&target.url))?;
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
                lease: None,
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
            let (roots, denied) = trust_for(&self.roots, &self.denied);
            let tls = tls_connector(roots, denied)
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
