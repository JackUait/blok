//! trustd as C# asks it on macOS. `guarded` is MacOsCertificateTrust:
//! the guarded fetcher's check. `operator` is SslStream's check for an
//! HttpClient with default options, which the S3 and doc-endpoint clients
//! use. Go has the same in internal/sectrust.

use security_framework::certificate::SecCertificate;
use security_framework::policy::SecPolicy;
use security_framework::secure_transport::SslProtocolSide;
use security_framework::trust::SecTrust;

use std::net::IpAddr;
use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, SignatureScheme};

use crate::fetcher::{Check, Roots};
use crate::names::{PASSING_DETAILS, matches_host, server_auth_allowed};

fn certificates(ders: &[&[u8]]) -> Option<Vec<SecCertificate>> {
    ders.iter()
        .map(|der| SecCertificate::from_der(der).ok())
        .collect()
}

fn trust(
    chain: &[&[u8]],
    anchors: Option<&[&[u8]]>,
    policy: SecPolicy,
    anchors_only: bool,
) -> Option<SecTrust> {
    if chain.is_empty() {
        return None;
    }
    let chain = certificates(chain)?;
    let mut trust = SecTrust::create_with_certificates(&chain, &[policy]).ok()?;
    if let Some(anchors) = anchors {
        trust
            .set_anchor_certificates(&certificates(anchors)?)
            .ok()?;
        if anchors_only {
            trust.set_trust_anchor_certificates_only(true).ok()?;
        }
    }
    Some(trust)
}

/// MacOsCertificateTrust.IsTrusted: SecTrust over the chain as sent, with
/// an SSL policy for host and network fetch off, anchored only to anchors
/// when given.
pub(crate) fn guarded(chain: &[&[u8]], host: &str, anchors: Option<&[&[u8]]>) -> bool {
    let policy = SecPolicy::create_ssl(SslProtocolSide::SERVER, Some(host));
    let Some(mut trust) = trust(chain, anchors, policy, true) else {
        return false;
    };
    trust.set_network_fetch_allowed(false).is_ok() && trust.evaluate_with_error().is_ok()
}

/// SslStream's check for HttpClient's defaults (System.Net.Security and
/// System.Security.Cryptography 10.0.11): X509Chain on SecTrust with the
/// basic X.509 policy and network fetch on (SecTrustChainPal.cs,
/// pal_x509chain.c), read per certificate as MergeStatusCodes does with
/// revocation off, then serverAuth and the host name (names.rs). anchors is
/// CustomRootTrust, which sets anchors without "anchors only".
pub(crate) fn operator(chain: &[&[u8]], host: &str, anchors: Option<&[&[u8]]>) -> bool {
    let Some(mut trust) = trust(chain, anchors, SecPolicy::create_x509(), false) else {
        return false;
    };
    if trust.set_network_fetch_allowed(true).is_err() {
        return false;
    }
    if trust.evaluate_with_error().is_err() && !evaluated(&trust) {
        return false;
    }
    #[allow(deprecated)]
    let count = trust.certificate_count();
    #[allow(deprecated)]
    let Some(built) = (0..count)
        .map(|i| trust.certificate_at_index(i).map(|c| c.to_der()))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    if built.is_empty() || !details_pass(&trust, built.len()) {
        return false;
    }
    server_auth_allowed(&built) && matches_host(chain[0], host)
}

// security-framework binds neither call, and .NET's verdict needs both: a
// trust result of Invalid throws, and the per-certificate detail keys decide.
#[allow(unsafe_code)]
mod raw {
    use std::ffi::c_void;

    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use security_framework::trust::SecTrust;

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        fn SecTrustCopyResult(trust: *const c_void) -> *const c_void;
        fn SecTrustGetTrustResult(trust: *const c_void, result: *mut u32) -> i32;
    }

    /// SecTrustGetTrustResult succeeds with a result other than Invalid.
    pub(super) fn evaluated(trust: &SecTrust) -> bool {
        let mut result = 0u32;
        // SAFETY: `trust` is a live SecTrust and `result` a valid out pointer.
        let status = unsafe { SecTrustGetTrustResult(trust.as_CFTypeRef(), &mut result) };
        status == 0 && result != 0
    }

    /// The keys of each TrustResultDetails entry; None for a key that is
    /// not a string or an entry that is not a dictionary.
    pub(super) fn detail_keys(trust: &SecTrust) -> Option<Vec<Option<Vec<String>>>> {
        // SAFETY: `trust` is a live SecTrust; the copy follows the Create rule.
        let result = unsafe { SecTrustCopyResult(trust.as_CFTypeRef()) };
        if result.is_null() {
            return None;
        }
        // SAFETY: a non-null result is a CFDictionary this call now owns.
        let result: CFDictionary = unsafe { CFDictionary::wrap_under_create_rule(result.cast()) };
        let name = CFString::from_static_string("TrustResultDetails");
        let details = *result.find(name.as_CFTypeRef())?;
        // SAFETY: `details` is a value held by `result`, which lives on.
        let details = unsafe { CFType::wrap_under_get_rule(details) }.downcast::<CFArray>()?;
        let entries = details
            .iter()
            .map(|entry| {
                // SAFETY: `entry` is held by `details`.
                let entry =
                    unsafe { CFType::wrap_under_get_rule(*entry) }.downcast::<CFDictionary>()?;
                let (keys, _) = entry.get_keys_and_values();
                keys.into_iter()
                    .map(|key| {
                        // SAFETY: `key` is held by `entry`.
                        unsafe { CFType::wrap_under_get_rule(key) }
                            .downcast::<CFString>()
                            .map(|key| key.to_string())
                    })
                    .collect()
            })
            .collect();
        Some(entries)
    }
}

use raw::{detail_keys, evaluated};

/// TrustResultDetails read as AppleCryptoNative_X509ChainGetStatusAtIndex
/// does: any key that maps to a status fails, as does an unknown key or a
/// missing entry, which .NET throws on.
fn details_pass(trust: &SecTrust, count: usize) -> bool {
    let Some(entries) = detail_keys(trust) else {
        return false;
    };
    entries.len() >= count
        && entries.iter().take(count).all(|keys| {
            keys.as_ref().is_some_and(|keys| {
                keys.iter()
                    .all(|key| PASSING_DETAILS.contains(&key.as_str()))
            })
        })
}

#[derive(Debug)]
pub(crate) struct TrustdVerifier {
    pub(crate) provider: Arc<rustls::crypto::CryptoProvider>,
    pub(crate) anchors: Option<Roots>,
    pub(crate) check: Check,
}

impl ServerCertVerifier for TrustdVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let host = match server_name {
            ServerName::DnsName(name) => name.as_ref().to_owned(),
            ServerName::IpAddress(ip) => IpAddr::from(*ip).to_string(),
            _ => return Err(CertificateError::NotValidForName.into()),
        };
        let chain: Vec<&[u8]> = std::iter::once(end_entity)
            .chain(intermediates)
            .map(|c| c.as_ref())
            .collect();
        let anchors: Option<Vec<&[u8]>> = self
            .anchors
            .as_ref()
            .map(|roots| roots.iter().map(|c| c.as_ref()).collect());
        let trusted = match self.check {
            Check::Guarded => guarded(&chain, &host, anchors.as_deref()),
            Check::Operator => operator(&chain, &host, anchors.as_deref()),
        };
        if trusted {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(CertificateError::ApplicationVerificationFailure.into())
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}
