use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use blok_jsjson::{Kind, Node, Options, parse_node};
use blok_ticket::{Claims, HEADER_SEGMENT, verify};
use hmac::{Hmac, Mac};
use sha2::Sha256;

const FIXED_NOW: u64 = 1_700_000_000;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

fn fixtures() -> Node {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../test/unit/server-conformance/fixtures/tickets.json"
    );
    parse_node(&std::fs::read(path).unwrap(), Options::default()).unwrap()
}

fn field(node: &Node, key: &str) -> String {
    for member in &node.members {
        if member.key().unwrap().to_string() == key {
            assert_eq!(member.value.kind, Kind::String);
            return member.value.text().unwrap().to_string();
        }
    }
    panic!("no {key}");
}

fn sign_payload(secret: &str, payload: &str) -> String {
    let input = format!("{HEADER_SEGMENT}.{}", URL_SAFE_NO_PAD.encode(payload));
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(input.as_bytes());
    format!(
        "{input}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    )
}

#[test]
fn accepts_the_fixed_compatible_ticket() {
    let f = fixtures();
    let claims = verify(
        &field(&f, "secret"),
        &field(&f, "compatible"),
        at(FIXED_NOW),
    );
    assert_eq!(
        claims,
        Some(Claims {
            user: "u1".into(),
            doc: "doc-42".into(),
            write: true,
            exp: 4_102_444_800,
        })
    );
}

#[test]
fn rejects_tokens_without_exactly_three_nonempty_segments() {
    let f = fixtures();
    let secret = field(&f, "secret");
    for token in [
        "",
        "abc",
        "abc.def",
        "abc.def.ghi.jkl",
        "..",
        ".payload.signature",
        "header..signature",
        "header.payload.",
    ] {
        assert_eq!(verify(&secret, token, at(FIXED_NOW)), None, "{token}");
    }
}

#[test]
fn expires_at_the_named_unix_second() {
    let secret = field(&fixtures(), "secret");
    let at_boundary = sign_payload(&secret, &format!("{{\"user\":\"u1\",\"exp\":{FIXED_NOW}}}"));
    let later = sign_payload(
        &secret,
        &format!("{{\"user\":\"u1\",\"exp\":{}}}", FIXED_NOW + 1),
    );
    assert_eq!(verify(&secret, &at_boundary, at(FIXED_NOW)), None);
    assert!(verify(&secret, &later, at(FIXED_NOW)).is_some());
}

#[test]
fn reads_claim_keys_case_sensitively() {
    let secret = field(&fixtures(), "secret");
    let shouted = sign_payload(
        &secret,
        "{\"USER\":\"u1\",\"DOC\":\"doc-42\",\"write\":true,\"exp\":4102444800}",
    );
    let claims = verify(&secret, &shouted, at(FIXED_NOW)).unwrap();
    assert_eq!(claims.user, "");
    assert_eq!(claims.doc, "");
}

#[test]
fn rejects_the_standard_base64_alphabet_in_the_signature() {
    let f = fixtures();
    let compatible = field(&f, "compatible");
    let last_dot = compatible.rfind('.').unwrap();
    let signature = &compatible[last_dot + 1..];
    assert!(signature.contains('-') && signature.contains('_'));
    let standard = format!(
        "{}{}",
        &compatible[..last_dot + 1],
        signature.replace('-', "+").replace('_', "/")
    );
    assert_eq!(verify(&field(&f, "secret"), &standard, at(FIXED_NOW)), None);
}

#[test]
fn rejects_a_payload_without_exp() {
    let secret = field(&fixtures(), "secret");
    let eternal = sign_payload(
        &secret,
        "{\"user\":\"u1\",\"doc\":\"doc-42\",\"write\":true}",
    );
    assert_eq!(verify(&secret, &eternal, at(FIXED_NOW)), None);
}

#[test]
fn reads_a_time_before_the_epoch_as_a_floored_second() {
    let secret = field(&fixtures(), "secret");
    let token = sign_payload(&secret, "{\"user\":\"u1\",\"exp\":0}");
    assert!(verify(&secret, &token, UNIX_EPOCH - Duration::from_millis(1)).is_some());
    assert_eq!(verify(&secret, &token, UNIX_EPOCH), None);
}
