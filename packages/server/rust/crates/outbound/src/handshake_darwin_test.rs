//! The operator client's TLS handshake against servers whose leaf key
//! ring cannot check. C# measured (SslStream on macOS, trust set aside):
//! TLS 1.2 only, RSA keys of 512 to 2048 bits and ECDSA P-256, P-384 and
//! P-521 accepted, Ed25519 and RSA-PSS keys refused, a TLS 1.3-only server
//! refused. The test servers sign with SecKey, so any size macOS makes
//! works; the leaf is signed by the test root, which the operator trusts.

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
            &[
                (
                    SignatureScheme::ECDSA_NISTP521_SHA512,
                    Algorithm::ECDSASignatureMessageX962SHA512,
                ),
                (
                    SignatureScheme::ECDSA_NISTP384_SHA384,
                    Algorithm::ECDSASignatureMessageX962SHA384,
                ),
                (
                    SignatureScheme::ECDSA_NISTP256_SHA256,
                    Algorithm::ECDSASignatureMessageX962SHA256,
                ),
            ]
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

#[tokio::test]
async fn the_operator_handshake_takes_the_keys_dotnet_takes() {
    for (rsa, bits) in [
        (true, 1024),
        (true, 2048),
        (false, 256),
        (false, 384),
        (false, 521),
    ] {
        let (private, spki) = sec_key(rsa, bits);
        let o = origin(
            vec![leaf(spki)],
            Arc::new(SecSigning { key: private, rsa }),
            BOTH,
        )
        .await;
        assert!(get(&o).await, "rsa={rsa} {bits}: refused");
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
        }),
        &[&rustls::version::TLS13],
    )
    .await;
    assert!(!get(&o).await, "TLS 1.3 accepted");
}

// The signature_algorithms SslStream's ClientHello carries on macOS, in
// its order (openssl s_server -trace of a C# connect).
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
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
        ]
    );
}

// SecKey makes no RSA key under 1024 bits, so the smaller sizes C# took
// are checked at the verifier: a leaf and a SHA-256 PKCS#1 signature over
// MESSAGE, both made once with openssl (genpkey, x509 -req, dgst -sign).
const MESSAGE: &[u8] = b"blok remnants handshake";
const RSA512_LEAF: &str = "308201c030820167a00302010202142daab90ec3c0398c2d6433e37941a05378a52c0d300a06082a8648ce3d04030230183116301406035504030c0d72656d6e616e74732d726f6f74301e170d3236313130353136303235325a170d3236313132353136303235325a30143112301006035504030c096c6f63616c686f7374305c300d06092a864886f70d0101010500034b003048024100b37e27ff4701a9a1c5752a969db8323118d2c2aa0fd67ed8ac06ecaab8524978dde1e95cb616f6c5595527c82e0b2cba055ccb8df4d0a0854cf9b05a881172030203010001a3818f30818c30090603551d1304023000300e0603551d0f0101ff0404030205a030130603551d25040c300a06082b06010505070301301a0603551d110413301182096c6f63616c686f737487047f000001301d0603551d0e041604148fae51c42e757399735376e9b36e1f71931755cd301f0603551d23041830168014d6d33c963535dcdafb30509b9b5d614ddba2217a300a06082a8648ce3d04030203470030440220705c918ca9089f7602b875cc643de03bc2a37e2dd023541600e7c48965a0c72b02205f92a3e45f8c03fdd33c1fdea628d0b25807ace620175a080fc283528c0a89c1";
const RSA512_SIGNATURE: &str = "388073783a7fda4f99a0e3d737828942c27ecf8dfe0708108f37aab17fcb162230a55060b982d5f0bfe41c2c65f8c2cb42b0c3e6595dc3cea775d303346cb067";
const RSA768_LEAF: &str = "308201e130820187a00302010202142daab90ec3c0398c2d6433e37941a05378a52c0e300a06082a8648ce3d04030230183116301406035504030c0d72656d6e616e74732d726f6f74301e170d3236313130353136303235325a170d3236313132353136303235325a30143112301006035504030c096c6f63616c686f7374307c300d06092a864886f70d0101010500036b003068026100df659e61f6caee61b5527ef6b635da6aad72ff10285152cfbb4fcdd394b20b4b4215ee0b5f6eb13b6dd9b0a57d685c7efd4dfee027bd3427b95085b63768bcf58ae106ef96edea0e90aac6e0b9a5999f56281522becd8cac21e0a9c55d80b1b30203010001a3818f30818c30090603551d1304023000300e0603551d0f0101ff0404030205a030130603551d25040c300a06082b06010505070301301a0603551d110413301182096c6f63616c686f737487047f000001301d0603551d0e041604143ae18ec459df0a0324a5ba298a2184edb52b33c7301f0603551d23041830168014d6d33c963535dcdafb30509b9b5d614ddba2217a300a06082a8648ce3d04030203480030450221008e5660ad1d0ee6150a0b9636f69b2d1d24b6c076177114bf776d1ef2d89a1a7a022047c30a66f67f63cd2c6eb87e46399311fd7a9d7534911eda9b92f0ed47743889";
const RSA768_SIGNATURE: &str = "3390e70dac6da3d2e5c07c7a43c849171ccb83e5c7c3cf7daff7607a06bf84b4081824864e5089beb4e95ac0457a77b60a21424de14f4fcfd101c23c0a148e92067ba9c476603a0d6b079433bc1b92f5061857bdf22bcd020dc861477bc17f4b";

#[test]
fn the_operator_checks_rsa_signatures_under_1024_bits() {
    use crate::pki_test::unhex;
    for (leaf, signature) in [
        (RSA512_LEAF, RSA512_SIGNATURE),
        (RSA768_LEAF, RSA768_SIGNATURE),
    ] {
        let (leaf, signature) = (unhex(leaf), unhex(signature));
        assert!(crate::sectrust::signature_holds(
            &leaf,
            SignatureScheme::RSA_PKCS1_SHA256,
            MESSAGE,
            &signature
        ));
        assert!(!crate::sectrust::signature_holds(
            &leaf,
            SignatureScheme::RSA_PKCS1_SHA256,
            b"another message",
            &signature
        ));
    }
}
