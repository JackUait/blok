#![allow(dead_code)]

//! Test certificates: a tiny DER writer and fixed P-256 keys, signed with
//! rustls's ring signer, so no certificate crate is needed.

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::{RootCertStore, SignatureScheme};

// Made once with `openssl ecparam -genkey -name prime256v1`.
const ROOT_P8: &str = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b020101042033e71115770dc0b6ff1cf2e5a7141c28dd3130c9e483b123050bc9412ebd38f0a14403420004884bd0262d37ff4eb3c1f54654d85acee7bd4d0433a3de1e06e74b23fb829cccc76e519c91289f9b8a04ec9e71d8fb7753a8b61847c88c7dede789628a92b698";
const ROOT_SPKI: &str = "3059301306072a8648ce3d020106082a8648ce3d03010703420004884bd0262d37ff4eb3c1f54654d85acee7bd4d0433a3de1e06e74b23fb829cccc76e519c91289f9b8a04ec9e71d8fb7753a8b61847c88c7dede789628a92b698";
const MIDDLE_P8: &str = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b02010104205fdfa69d535988bdc484513e611a6aa4d45fab5b46ff1d0eaac679c4dde8384ea14403420004cb2f805fa71bd08898484ba691cae4c4393427810834e9d074b1a5c985925e865b9de89e09cccfb6aaf9d42c132fc4dee622a99c781c0e2a4ebd6be0c09f690d";
const MIDDLE_SPKI: &str = "3059301306072a8648ce3d020106082a8648ce3d03010703420004cb2f805fa71bd08898484ba691cae4c4393427810834e9d074b1a5c985925e865b9de89e09cccfb6aaf9d42c132fc4dee622a99c781c0e2a4ebd6be0c09f690d";
const LEAF_P8: &str = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b02010104203accab9960c606d2f9beaa1c94c1a2bc448f628cf48d41c9467fb80385f17ebea14403420004bc741efdc4759d84c6d4278cf344c9e1ee27054e41e00763710bbb4b14c177b59b7cced8532b8361b0f768b91b9ea26f61d073a456771f3096e5d23eeaf67d44";
const LEAF_SPKI: &str = "3059301306072a8648ce3d020106082a8648ce3d03010703420004bc741efdc4759d84c6d4278cf344c9e1ee27054e41e00763710bbb4b14c177b59b7cced8532b8361b0f768b91b9ea26f61d073a456771f3096e5d23eeaf67d44";

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let n = content.len();
    if n < 0x80 {
        out.push(n as u8);
    } else if n < 0x100 {
        out.extend_from_slice(&[0x81, n as u8]);
    } else {
        out.extend_from_slice(&[0x82, (n >> 8) as u8, n as u8]);
    }
    out.extend_from_slice(content);
    out
}

fn seq(parts: &[Vec<u8>]) -> Vec<u8> {
    tlv(0x30, &parts.concat())
}

fn oid(arcs: &[u64]) -> Vec<u8> {
    let mut body = vec![(arcs[0] * 40 + arcs[1]) as u8];
    for &arc in &arcs[2..] {
        let mut bytes = vec![(arc & 0x7f) as u8];
        let mut rest = arc >> 7;
        while rest > 0 {
            bytes.push((rest & 0x7f) as u8 | 0x80);
            rest >>= 7;
        }
        bytes.reverse();
        body.extend(bytes);
    }
    tlv(0x06, &body)
}

fn bit_string(content: &[u8]) -> Vec<u8> {
    tlv(0x03, &[&[0u8][..], content].concat())
}

fn name(common: &str) -> Vec<u8> {
    seq(&[tlv(
        0x31,
        &seq(&[oid(&[2, 5, 4, 3]), tlv(0x0c, common.as_bytes())]),
    )])
}

/// UTCTime for `seconds` after the epoch.
fn utc_time(seconds: i64) -> Vec<u8> {
    let days = seconds.div_euclid(86_400);
    let rem = seconds.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let text = format!(
        "{:02}{month:02}{day:02}{:02}{:02}{:02}Z",
        year % 100,
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    );
    tlv(0x17, text.as_bytes())
}

fn extension(id: &[u64], critical: bool, value: Vec<u8>) -> Vec<u8> {
    let mut parts = vec![oid(id)];
    if critical {
        parts.push(tlv(0x01, &[0xff]));
    }
    parts.push(tlv(0x04, &value));
    seq(&parts)
}

fn uri(text: &str) -> Vec<u8> {
    tlv(0x86, text.as_bytes())
}

/// A certificate's own fields.
#[derive(Default, Clone)]
pub struct Fields {
    pub common: String,
    pub ca: bool,
    pub names: Vec<String>,
    pub crl: Vec<String>,
    pub ocsp: Vec<String>,
    pub ca_issuers: Vec<String>,
}

pub struct Key {
    pkcs8: Vec<u8>,
    spki: Vec<u8>,
}

pub fn key(which: &str) -> Key {
    let (p8, spki) = match which {
        "root" => (ROOT_P8, ROOT_SPKI),
        "middle" => (MIDDLE_P8, MIDDLE_SPKI),
        _ => (LEAF_P8, LEAF_SPKI),
    };
    Key {
        pkcs8: unhex(p8),
        spki: unhex(spki),
    }
}

impl Key {
    pub fn private(&self) -> PrivateKeyDer<'static> {
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.pkcs8.clone()))
    }
}

/// A certificate for `subject` signed by `issuer_key` under `issuer`.
pub fn certificate(
    fields: &Fields,
    serial: u8,
    subject_key: &Key,
    issuer: &str,
    issuer_key: &Key,
) -> CertificateDer<'static> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let algorithm = seq(&[oid(&[1, 2, 840, 10045, 4, 3, 2])]);
    let mut extensions = Vec::new();
    if fields.ca {
        extensions.push(extension(&[2, 5, 29, 19], true, seq(&[tlv(0x01, &[0xff])])));
        extensions.push(extension(&[2, 5, 29, 15], true, tlv(0x03, &[1, 0x06])));
    } else {
        extensions.push(extension(
            &[2, 5, 29, 37],
            false,
            seq(&[oid(&[1, 3, 6, 1, 5, 5, 7, 3, 1])]),
        ));
    }
    if !fields.names.is_empty() {
        let names: Vec<Vec<u8>> = fields
            .names
            .iter()
            .map(|n| match n.parse::<IpAddr>() {
                Ok(IpAddr::V4(v4)) => tlv(0x87, &v4.octets()),
                Ok(IpAddr::V6(v6)) => tlv(0x87, &v6.octets()),
                Err(_) => tlv(0x82, n.as_bytes()),
            })
            .collect();
        extensions.push(extension(&[2, 5, 29, 17], false, seq(&names)));
    }
    if !fields.crl.is_empty() {
        let points: Vec<Vec<u8>> = fields
            .crl
            .iter()
            .map(|u| seq(&[tlv(0xa0, &tlv(0xa0, &uri(u)))]))
            .collect();
        extensions.push(extension(&[2, 5, 29, 31], false, seq(&points)));
    }
    let mut access = Vec::new();
    for u in &fields.ocsp {
        access.push(seq(&[oid(&[1, 3, 6, 1, 5, 5, 7, 48, 1]), uri(u)]));
    }
    for u in &fields.ca_issuers {
        access.push(seq(&[oid(&[1, 3, 6, 1, 5, 5, 7, 48, 2]), uri(u)]));
    }
    if !access.is_empty() {
        extensions.push(extension(&[1, 3, 6, 1, 5, 5, 7, 1, 1], false, seq(&access)));
    }
    let tbs = seq(&[
        tlv(0xa0, &tlv(0x02, &[2])),
        tlv(0x02, &[serial]),
        algorithm.clone(),
        name(issuer),
        seq(&[utc_time(now - 3600), utc_time(now + 3600)]),
        name(&fields.common),
        subject_key.spki.clone(),
        tlv(0xa3, &seq(&extensions)),
    ]);
    let signer = rustls::crypto::ring::sign::any_ecdsa_type(&issuer_key.private())
        .unwrap()
        .choose_scheme(&[SignatureScheme::ECDSA_NISTP256_SHA256])
        .unwrap();
    let signature = signer.sign(&tbs).unwrap();
    CertificateDer::from(seq(&[tbs, algorithm, bit_string(&signature)]))
}

/// TestCertificates.Create: a root and a leaf for `name`, the leaf with
/// `extra` fields.
pub struct Pki {
    pub root: CertificateDer<'static>,
    pub roots: Arc<RootCertStore>,
    pub chain: Vec<CertificateDer<'static>>,
    pub key: PrivateKeyDer<'static>,
}

pub fn pki(subject: &str, extra: impl FnOnce(&mut Fields)) -> Pki {
    let root_fields = Fields {
        common: "root".into(),
        ca: true,
        ..Fields::default()
    };
    let root = certificate(&root_fields, 1, &key("root"), "root", &key("root"));
    let mut leaf_fields = Fields {
        common: subject.into(),
        names: vec![subject.into()],
        ..Fields::default()
    };
    extra(&mut leaf_fields);
    let leaf = certificate(&leaf_fields, 2, &key("leaf"), "root", &key("root"));
    let mut roots = RootCertStore::empty();
    roots.add(root.clone()).unwrap();
    Pki {
        root,
        roots: Arc::new(roots),
        chain: vec![leaf],
        key: key("leaf").private(),
    }
}

pub fn acceptor(
    chain: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
    protocols: &[&[u8]],
) -> tokio_rustls::TlsAcceptor {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .unwrap();
    config.alpn_protocols = protocols.iter().map(|p| p.to_vec()).collect();
    tokio_rustls::TlsAcceptor::from(Arc::new(config))
}
