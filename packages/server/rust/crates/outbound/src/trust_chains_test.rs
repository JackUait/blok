//! The chains of test/unit/server-conformance/fixtures/macos-trust-chains.json,
//! built as C#'s MacOsTrustChainFixtureTests builds them, and the answers
//! C# measured.

use std::net::IpAddr;
use std::time::{SystemTime, UNIX_EPOCH};

use rustls::SignatureScheme;
use rustls::client::danger::ServerCertVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use sha1::{Digest, Sha1};

use crate::fetcher::Check;
use crate::pki_test::{Key, bit_string, extension, key, name, oid, seq, tlv, unhex, utc_time};
use blok_jsjson::Value;

use crate::test_json::{field, items, load, text};

// A 1024-bit RSA public key, made once with `openssl genrsa 1024`. Only the
// leaf's key is RSA; nothing signs with it.
const RSA1024_SPKI: &str = "30819f300d06092a864886f70d010101050003818d0030818902818100de8200c1af21c2c983704b1dc6ee02ed2dc0eb2afa7351fac9d6d9069de7ce16802faeffc065c431ae79dd386cbd76599b1ecdb86654b85853860b9c8191f39e4579e71a9534a768ebbe2dcaa96b8adef07bb5171a2cf0eae276793d92d91b0fa6db2652cbc92060e6c3726b5aba2ebaa2cdf0eb4b64132044a2d90bda4d0cb10203010001";

const DAY: i64 = 86_400;

/// A member, or None when the row leaves it out.
fn get<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match field(value, key) {
        Value::Undefined => None,
        member => Some(member),
    }
}

fn flag(value: &Value, key: &str) -> Option<bool> {
    match get(value, key)? {
        Value::Bool(b) => Some(*b),
        _ => None,
    }
}

fn number(value: &Value, key: &str) -> Option<i64> {
    match get(value, key)? {
        Value::Number(n) => Some(*n as i64),
        _ => None,
    }
}

fn word(value: &Value, key: &str) -> Option<String> {
    text(field(value, key))
}

fn key_id(spki: &[u8]) -> Vec<u8> {
    // The SHA-1 of the subjectPublicKey bits, the last element of the SPKI.
    let mut outer = spki;
    let mut info = take(&mut outer).1;
    take(&mut info);
    let bits = take(&mut info).1;
    Sha1::digest(&bits[1..]).to_vec()
}

fn take<'a>(input: &mut &'a [u8]) -> (u8, &'a [u8]) {
    let tag = input[0];
    let (length, header) = match input[1] {
        n if n < 0x80 => (usize::from(n), 2),
        0x81 => (usize::from(input[2]), 3),
        _ => (usize::from(input[2]) << 8 | usize::from(input[3]), 4),
    };
    let content = &input[header..header + length];
    *input = &input[header + length..];
    (tag, content)
}

struct Cert<'a> {
    serial: u8,
    subject: &'a str,
    issuer: &'a str,
    spki: Vec<u8>,
    issuer_key: &'a Key,
    issuer_spki: &'a [u8],
    start: i64,
    end: i64,
    extensions: Vec<Vec<u8>>,
}

fn sign(c: Cert<'_>) -> CertificateDer<'static> {
    let algorithm = seq(&[oid(&[1, 2, 840, 10045, 4, 3, 2])]);
    let mut extensions = c.extensions;
    extensions.push(extension(
        &[2, 5, 29, 14],
        false,
        tlv(0x04, &key_id(&c.spki)),
    ));
    if c.serial != 1 {
        extensions.push(extension(
            &[2, 5, 29, 35],
            false,
            seq(&[tlv(0x80, &key_id(c.issuer_spki))]),
        ));
    }
    let tbs = seq(&[
        tlv(0xa0, &tlv(0x02, &[2])),
        tlv(0x02, &[c.serial]),
        algorithm.clone(),
        name(c.issuer),
        seq(&[utc_time(c.start), utc_time(c.end)]),
        name(c.subject),
        c.spki,
        tlv(0xa3, &seq(&extensions)),
    ]);
    let signer = rustls::crypto::ring::sign::any_ecdsa_type(&c.issuer_key.private())
        .unwrap()
        .choose_scheme(&[SignatureScheme::ECDSA_NISTP256_SHA256])
        .unwrap();
    let signature = signer.sign(&tbs).unwrap();
    CertificateDer::from(seq(&[tbs, algorithm, bit_string(&signature)]))
}

fn usages(spec: Option<&Value>, default: bool) -> Option<Vec<u8>> {
    let list: Vec<String> = match spec {
        Some(Value::Array(list)) => list.iter().map(|i| text(i).unwrap()).collect(),
        None if default => vec!["serverAuth".into()],
        _ => return None,
    };
    let oids: Vec<Vec<u8>> = list
        .iter()
        .map(|usage| match usage.as_str() {
            "serverAuth" => oid(&[1, 3, 6, 1, 5, 5, 7, 3, 1]),
            "clientAuth" => oid(&[1, 3, 6, 1, 5, 5, 7, 3, 2]),
            "any" => oid(&[2, 5, 29, 37, 0]),
            other => panic!("{other}"),
        })
        .collect();
    Some(extension(&[2, 5, 29, 37], false, seq(&oids)))
}

/// The chain as sent, and the root.
fn build(row: &Value) -> (Vec<CertificateDer<'static>>, CertificateDer<'static>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let root_key = key("root");
    let middle_key = key("middle");
    let ca = |extensions: &mut Vec<Vec<u8>>| {
        extensions.push(extension(&[2, 5, 29, 19], true, seq(&[tlv(0x01, &[0xff])])));
        extensions.push(extension(&[2, 5, 29, 15], true, tlv(0x03, &[1, 0x06])));
    };
    let mut root_extensions = Vec::new();
    ca(&mut root_extensions);
    let root = sign(Cert {
        serial: 1,
        subject: "Blok Trust Test Root",
        issuer: "Blok Trust Test Root",
        spki: root_key.spki.clone(),
        issuer_key: &root_key,
        issuer_spki: &root_key.spki,
        start: now - 30 * DAY,
        end: now + 3650 * DAY,
        extensions: root_extensions,
    });

    let mut issuer = ("Blok Trust Test Root", &root_key);
    let mut middle = None;
    if let Some(spec) = get(row, "intermediate") {
        let mut extensions = Vec::new();
        if flag(spec, "ca").unwrap_or(true) {
            ca(&mut extensions);
        }
        extensions.extend(usages(get(spec, "eku"), false));
        middle = Some((
            sign(Cert {
                serial: 2,
                subject: "Blok Trust Test Intermediate",
                issuer: "Blok Trust Test Root",
                spki: middle_key.spki.clone(),
                issuer_key: &root_key,
                issuer_spki: &root_key.spki,
                start: now - 2 * DAY,
                end: now + 1000 * DAY,
                extensions,
            }),
            flag(spec, "sent").unwrap_or(true),
        ));
        issuer = ("Blok Trust Test Intermediate", &middle_key);
    }

    let leaf = field(row, "leaf");
    let is_ca = flag(leaf, "ca").unwrap_or(false);
    let mut extensions = vec![if is_ca {
        extension(&[2, 5, 29, 19], true, seq(&[tlv(0x01, &[0xff])]))
    } else {
        extension(&[2, 5, 29, 19], true, seq(&[]))
    }];
    if !is_ca {
        extensions.push(extension(&[2, 5, 29, 15], true, tlv(0x03, &[7, 0x80])));
    }
    extensions.extend(usages(get(leaf, "eku"), true));
    let mut names = Vec::new();
    for dns in items(field(leaf, "dns")) {
        names.push(tlv(0x82, text(dns).unwrap().as_bytes()));
    }
    for ip in items(field(leaf, "ips")) {
        names.push(match text(ip).unwrap().parse::<IpAddr>().unwrap() {
            IpAddr::V4(v4) => tlv(0x87, &v4.octets()),
            IpAddr::V6(v6) => tlv(0x87, &v6.octets()),
        });
    }
    if !names.is_empty() {
        extensions.push(extension(&[2, 5, 29, 17], false, seq(&names)));
    }
    let start = now + number(leaf, "start").unwrap_or(-1) * DAY;
    let days = number(leaf, "days").unwrap_or(365);
    let spki = if word(leaf, "key").as_deref() == Some("rsa1024") {
        unhex(RSA1024_SPKI)
    } else {
        key("leaf").spki.clone()
    };
    let issuer_spki = if middle.is_some() {
        middle_key.spki.clone()
    } else {
        root_key.spki.clone()
    };
    let common = word(leaf, "cn").unwrap_or_else(|| "x".into());
    let leaf = sign(Cert {
        serial: 3,
        subject: &common,
        issuer: issuer.0,
        spki,
        issuer_key: issuer.1,
        issuer_spki: &issuer_spki,
        start,
        end: start + days * DAY,
        extensions,
    });
    let mut sent = vec![leaf];
    if let Some((middle, true)) = middle {
        sent.push(middle);
    }
    (sent, root)
}

fn verdict(ok: bool) -> &'static str {
    if ok { "accept" } else { "refuse" }
}

fn each_chain(
    check: impl Fn(&str, &[CertificateDer<'static>], &CertificateDer<'static>) -> bool,
    column: &str,
) {
    let fixture = load("macos-trust-chains.json");
    let mut wrong = Vec::new();
    for row in items(field(&fixture, "cases")) {
        let (sent, root) = build(row);
        let host = word(row, "host").unwrap();
        let got = verdict(check(&host, &sent, &root));
        let want = word(row, column).unwrap();
        if got != want {
            wrong.push(format!(
                "{}: got {got}, C# {want}",
                word(row, "name").unwrap()
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}

fn ders<'a>(certs: &'a [CertificateDer<'static>]) -> Vec<&'a [u8]> {
    certs.iter().map(|c| c.as_ref()).collect()
}

// C#'s MacOsCertificateTrust, measured on the fixture's chains.
#[test]
fn guarded_trusts_the_chains_c_sharp_trusts() {
    each_chain(
        |host, sent, root| crate::sectrust::guarded(&ders(sent), host, Some(&[root.as_ref()])),
        "guarded",
    );
}

// SslStream with HttpClient's defaults, measured on the same chains.
#[test]
fn operator_trusts_the_chains_c_sharp_trusts() {
    each_chain(
        |host, sent, root| crate::sectrust::operator(&ders(sent), host, Some(&[root.as_ref()])),
        "operator",
    );
}

/// What the fetcher's TLS verifier makes of a chain for `host`.
fn fetcher_verdict(
    host: &str,
    sent: &[CertificateDer<'static>],
    root: &CertificateDer<'static>,
) -> bool {
    let verifier = crate::sectrust::TrustdVerifier {
        provider: std::sync::Arc::new(rustls::crypto::ring::default_provider()),
        anchors: Some(std::sync::Arc::new(vec![root.clone()])),
        check: Check::Guarded,
    };
    let name = match host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
    {
        Ok(ip) => ServerName::IpAddress(ip.into()),
        Err(_) => match ServerName::try_from(host.to_owned()) {
            Ok(name) => name,
            Err(_) => return false,
        },
    };
    verifier
        .verify_server_cert(&sent[0], &sent[1..], &name, &[], UnixTime::now())
        .is_ok()
}

// The fetcher's TLS check, with the root as the only anchor.
#[test]
fn the_fetcher_trusts_the_chains_c_sharp_trusts() {
    each_chain(fetcher_verdict, "guarded");
}
