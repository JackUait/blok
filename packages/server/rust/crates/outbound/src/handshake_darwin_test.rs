//! The operator client's TLS handshake on macOS. C# measured (SslStream
//! on SecureTransport, trust set aside): TLS 1.2 only; RSA keys of 512 to
//! 2048 bits and ECDSA P-256, P-384 and P-521 accepted; Ed25519 and RSA-PSS
//! keys refused; a TLS 1.3-only server refused. Rust keeps ring's check
//! for the signatures, so RSA under 2048 bits and P-521 are refused here:
//! a security choice over parity. The test servers sign with SecKey, so
//! the key sizes ring cannot make still get served.

use std::sync::Arc;
use std::time::Duration;

use rustls::SignatureScheme;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::{CertifiedKey, Signer, SigningKey};
use security_framework::key::{Algorithm, GenerateKeyOptions, KeyType, SecKey};

use crate::origin_test::{Origin, ok_handler};
use crate::pki_test::{Fields, Key, bit_string, certificate, key, oid, seq, tlv};

struct SecSigning {
    key: SecKey,
    rsa: bool,
    /// The curve size; an ECDSA key signs with its curve's hash, as
    /// OpenSSL servers pick.
    bits: u32,
}

impl std::fmt::Debug for SecSigning {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecSigning")
    }
}

impl SecSigning {
    fn schemes(&self) -> &'static [(SignatureScheme, Algorithm)] {
        if self.rsa {
            &[
                (
                    SignatureScheme::RSA_PKCS1_SHA256,
                    Algorithm::RSASignatureMessagePKCS1v15SHA256,
                ),
                (
                    SignatureScheme::RSA_PKCS1_SHA384,
                    Algorithm::RSASignatureMessagePKCS1v15SHA384,
                ),
                (
                    SignatureScheme::RSA_PKCS1_SHA512,
                    Algorithm::RSASignatureMessagePKCS1v15SHA512,
                ),
                (
                    SignatureScheme::RSA_PSS_SHA256,
                    Algorithm::RSASignatureMessagePSSSHA256,
                ),
            ]
        } else {
            match self.bits {
                256 => &[(
                    SignatureScheme::ECDSA_NISTP256_SHA256,
                    Algorithm::ECDSASignatureMessageX962SHA256,
                )],
                384 => &[(
                    SignatureScheme::ECDSA_NISTP384_SHA384,
                    Algorithm::ECDSASignatureMessageX962SHA384,
                )],
                _ => &[(
                    SignatureScheme::ECDSA_NISTP521_SHA512,
                    Algorithm::ECDSASignatureMessageX962SHA512,
                )],
            }
        }
    }
}

impl SigningKey for SecSigning {
    fn choose_scheme(&self, offered: &[SignatureScheme]) -> Option<Box<dyn Signer>> {
        let (scheme, algorithm) = self
            .schemes()
            .iter()
            .find(|(scheme, _)| offered.contains(scheme))?;
        Some(Box::new(SecSigner {
            key: self.key.clone(),
            scheme: *scheme,
            algorithm: *algorithm,
        }))
    }

    fn algorithm(&self) -> rustls::SignatureAlgorithm {
        if self.rsa {
            rustls::SignatureAlgorithm::RSA
        } else {
            rustls::SignatureAlgorithm::ECDSA
        }
    }
}

struct SecSigner {
    key: SecKey,
    scheme: SignatureScheme,
    algorithm: Algorithm,
}

impl std::fmt::Debug for SecSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecSigner")
    }
}

impl Signer for SecSigner {
    fn sign(&self, message: &[u8]) -> Result<Vec<u8>, rustls::Error> {
        self.key
            .create_signature(self.algorithm, message)
            .map_err(|_| rustls::Error::General("SecKey could not sign".into()))
    }

    fn scheme(&self) -> SignatureScheme {
        self.scheme
    }
}

#[derive(Debug)]
struct One(Arc<CertifiedKey>);

impl ResolvesServerCert for One {
    fn resolve(&self, _: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        Some(self.0.clone())
    }
}

/// A leaf for localhost over `spki`, signed by the test root.
fn leaf(spki: Vec<u8>) -> CertificateDer<'static> {
    let fields = Fields {
        common: "localhost".into(),
        names: vec!["localhost".into()],
        ..Fields::default()
    };
    let subject = Key {
        pkcs8: Vec::new(),
        spki,
    };
    certificate(&fields, 2, &subject, "root", &key("root"))
}

/// A transient SecKey and the SPKI of its public half.
fn sec_key(rsa: bool, bits: u32) -> (SecKey, Vec<u8>) {
    let mut options = GenerateKeyOptions::default();
    options
        .set_key_type(if rsa { KeyType::rsa() } else { KeyType::ec() })
        .set_size_in_bits(bits);
    let private = SecKey::new(&options).unwrap_or_else(|e| panic!("{bits}: {e}"));
    let public = private
        .public_key()
        .unwrap()
        .external_representation()
        .unwrap()
        .to_vec();
    let algorithm = if rsa {
        seq(&[oid(&[1, 2, 840, 113549, 1, 1, 1]), tlv(0x05, &[])])
    } else {
        let curve = match bits {
            256 => oid(&[1, 2, 840, 10045, 3, 1, 7]),
            384 => oid(&[1, 3, 132, 0, 34]),
            _ => oid(&[1, 3, 132, 0, 35]),
        };
        seq(&[oid(&[1, 2, 840, 10045, 2, 1]), curve])
    };
    (private, seq(&[algorithm, bit_string(&public)]))
}

async fn origin(
    chain: Vec<CertificateDer<'static>>,
    signing: Arc<dyn SigningKey>,
    versions: &[&'static rustls::SupportedProtocolVersion],
) -> Origin {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(versions)
        .unwrap()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(One(Arc::new(CertifiedKey::new(chain, signing)))));
    Origin::start(
        "127.0.0.1:0",
        Some(tokio_rustls::TlsAcceptor::from(Arc::new(config))),
        ok_handler(),
    )
    .await
    .unwrap()
}

async fn get(origin: &Origin) -> bool {
    let client = crate::operator::OperatorClient {
        connect_timeout: Duration::from_secs(5),
        header_timeout: None,
        proxy: crate::proxy::EnvironmentProxy::from_lookup(|_| None),
        roots: Some(crate::pki_test::pki("localhost", |_| {}).roots),
    };
    let url =
        blok_dotnet::parse_absolute_uri(&format!("https://localhost:{}/", origin.port)).unwrap();
    let host = format!("localhost:{}", origin.port);
    client
        .send(crate::operator::Request {
            method: "GET",
            url: &url,
            host: &host,
            headers: Vec::new(),
            body: crate::operator::RequestBody::None,
        })
        .await
        .is_ok()
}

const BOTH: &[&rustls::SupportedProtocolVersion] =
    &[&rustls::version::TLS12, &rustls::version::TLS13];

// RSA-1024 and P-521: C# accepts both, and Rust refuses both on purpose
// (ring's floor and curves), so these rows pin the refusal.
#[tokio::test]
async fn the_operator_handshake_takes_the_keys_ring_checks() {
    for (rsa, bits, accepted) in [
        (true, 1024, false),
        (true, 2048, true),
        (false, 256, true),
        (false, 384, true),
        (false, 521, false),
    ] {
        let (private, spki) = sec_key(rsa, bits);
        let o = origin(
            vec![leaf(spki)],
            Arc::new(SecSigning {
                key: private,
                rsa,
                bits,
            }),
            BOTH,
        )
        .await;
        assert_eq!(get(&o).await, accepted, "rsa={rsa} {bits}");
    }
}

#[tokio::test]
async fn the_operator_handshake_refuses_what_dotnet_refuses() {
    // Ed25519: SecureTransport offers no scheme for it.
    let pkcs8 =
        ring::signature::Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
    let pair = ring::signature::Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
    use ring::signature::KeyPair as _;
    let spki = seq(&[
        seq(&[oid(&[1, 3, 101, 112])]),
        bit_string(pair.public_key().as_ref()),
    ]);
    let signing = rustls::crypto::ring::sign::any_supported_type(&PrivateKeyDer::Pkcs8(
        PrivatePkcs8KeyDer::from(pkcs8.as_ref().to_vec()),
    ))
    .unwrap();
    let o = origin(vec![leaf(spki)], signing, BOTH).await;
    assert!(!get(&o).await, "ed25519 accepted");

    // A TLS 1.3-only server: SecureTransport speaks TLS 1.2 at most.
    let (private, spki) = sec_key(false, 256);
    let o = origin(
        vec![leaf(spki)],
        Arc::new(SecSigning {
            key: private,
            rsa: false,
            bits: 256,
        }),
        &[&rustls::version::TLS13],
    )
    .await;
    assert!(!get(&o).await, "TLS 1.3 accepted");
}

// The signature_algorithms SslStream's ClientHello carries on macOS, in
// its order (openssl s_server -trace of a C# connect), less the two SHA-1
// schemes and ecdsa_secp521r1_sha512, which ring cannot check.
#[test]
fn the_operator_offers_the_schemes_dotnet_offers() {
    let verifier = crate::sectrust::TrustdVerifier {
        provider: Arc::new(rustls::crypto::ring::default_provider()),
        anchors: None,
        check: crate::fetcher::Check::Operator,
    };
    use rustls::client::danger::ServerCertVerifier as _;
    assert_eq!(
        verifier.supported_verify_schemes(),
        [
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
        ]
    );
}
