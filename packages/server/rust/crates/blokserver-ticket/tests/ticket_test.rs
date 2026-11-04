mod support;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use blok_blokserver_ticket::{Claims, DEFAULT_TTL_SECONDS, MINIMUM_SECRET_LENGTH, MintError, mint};
use blok_ticket::{HEADER_SEGMENT, verify};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use support::{at, flag, get, int, load, opt_text, text};

const SECRET: &str = "s3cret-value-at-least-32-chars-long!";

fn sign(secret: &str, input: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(input.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

#[derive(Debug, Default, PartialEq)]
struct Answer {
    valid: bool,
    user: String,
    doc: String,
    write: bool,
    exp: i64,
}

fn want(node: &blok_jsjson::Node) -> Answer {
    assert!(get(node, "throws").is_none(), "C# threw");
    Answer {
        valid: flag(node, "valid"),
        user: opt_text(node, "user").unwrap_or_default(),
        doc: opt_text(node, "doc").unwrap_or_default(),
        write: flag(node, "write"),
        exp: int(node, "exp"),
    }
}

fn got(claims: Option<blok_ticket::Claims>) -> Answer {
    claims.map_or_else(Answer::default, |c| Answer {
        valid: true,
        user: c.user,
        doc: c.doc,
        write: c.write,
        exp: c.exp,
    })
}

#[test]
fn verify_matches_the_c_sharp_fixture() {
    let f = load("tickets-extended.json");
    let secret = text(&f, "secret");
    let now = at(int(&f, "now"));
    for c in &get(&f, "payloads").unwrap().items {
        let payload = text(c, "payload");
        let input = format!("{HEADER_SEGMENT}.{}", URL_SAFE_NO_PAD.encode(&payload));
        let token = format!("{input}.{}", URL_SAFE_NO_PAD.encode(sign(&secret, &input)));
        let answer = get(c, "answer").unwrap();
        assert_eq!(got(verify(&secret, &token, now)), want(answer), "{payload}");
    }
    for c in &get(&f, "tokens").unwrap().items {
        let token = text(c, "token");
        let answer = get(c, "answer").unwrap();
        assert_eq!(got(verify(&secret, &token, now)), want(answer), "{token:?}");
    }
    assert_eq!(
        got(verify("", &text(&f, "emptySecret"), now)),
        want(get(&f, "emptySecretAnswer").unwrap())
    );
}

#[test]
fn mint_matches_the_c_sharp_fixture() {
    let f = load("tickets-extended.json");
    let now = at(int(&f, "now"));
    for c in &get(&f, "mints").unwrap().items {
        let claims = Claims {
            user: text(c, "user"),
            doc: opt_text(c, "doc"),
            write: flag(c, "write"),
            ttl_seconds: Some(int(c, "ttl")),
        };
        let answer = get(c, "answer").unwrap();
        let result = mint(&text(c, "secret"), &claims, now);
        match get(answer, "throws") {
            Some(_) => {
                let thrown = text(answer, "throws");
                let error = result.expect_err(&claims.user);
                let kind = match error {
                    MintError::ShortSecret => "ArgumentException",
                    MintError::Lifetime => "ArgumentOutOfRangeException",
                    MintError::Overflow => "OverflowException",
                };
                assert_eq!(kind, thrown, "{:?}", claims.user);
            }
            None => assert_eq!(result.unwrap(), text(answer, "token"), "{:?}", claims.user),
        }
    }
}

#[test]
fn mint_zero_ttl_uses_the_default() {
    let now = at(1_700_000_000);
    let claims = Claims {
        user: "u".into(),
        ..Claims::default()
    };
    let token = mint(SECRET, &claims, now).unwrap();
    let verified = verify(SECRET, &token, now).unwrap();
    assert_eq!(verified.exp, 1_700_000_000 + DEFAULT_TTL_SECONDS);
}

#[test]
#[ignore = "a Rust String cannot hold invalid UTF-8 or a lone surrogate, so mint takes no such input"]
fn mint_refuses_invalid_utf8() {}

#[test]
fn a_pass_for_a_non_ascii_user_is_read_back_by_the_verifier() {
    let now = at(1_800_000_000);
    let claims = Claims {
        user: "ü😀<".into(),
        doc: Some("doc-ü".into()),
        write: true,
        ttl_seconds: Some(60),
    };
    let verified = verify(SECRET, &mint(SECRET, &claims, now).unwrap(), now).unwrap();
    assert_eq!(verified.user, "ü😀<");
    assert_eq!(verified.doc, "doc-ü");
    assert!(verified.write);
    assert_eq!(verified.exp, 1_800_000_060);
}

#[test]
fn a_null_doc_leaves_the_claim_out_and_defaults_to_a_read_pass() {
    let now = at(1_800_000_000);
    let claims = Claims {
        user: "u1".into(),
        ..Claims::default()
    };
    let verified = verify(SECRET, &mint(SECRET, &claims, now).unwrap(), now).unwrap();
    assert_eq!(verified.doc, "");
    assert!(!verified.write);
    assert_eq!(verified.exp, 1_800_000_000 + DEFAULT_TTL_SECONDS);
}

#[test]
#[ignore = "a Rust String cannot hold a lone surrogate, so mint takes no such input"]
fn rejects_a_lone_surrogate_in_the_user_or_the_doc() {}

#[test]
fn rejects_a_secret_shorter_than_the_server_floor() {
    let claims = Claims {
        user: "u1".into(),
        ..Claims::default()
    };
    let now = at(1_800_000_000);
    assert_eq!(
        mint(&"s".repeat(31), &claims, now),
        Err(MintError::ShortSecret)
    );
    assert!(
        !mint(&"s".repeat(MINIMUM_SECRET_LENGTH), &claims, now)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn rejects_a_ttl_that_is_not_positive() {
    let claims = Claims {
        user: "u1".into(),
        ttl_seconds: Some(0),
        ..Claims::default()
    };
    assert_eq!(mint(SECRET, &claims, at(0)), Err(MintError::Lifetime));
}

#[test]
fn rejects_a_ttl_that_overflows_exp() {
    let claims = Claims {
        user: "u1".into(),
        ttl_seconds: Some(i64::MAX),
        ..Claims::default()
    };
    assert_eq!(
        mint(SECRET, &claims, at(1_800_000_000)),
        Err(MintError::Overflow)
    );
}

#[test]
fn a_pass_verifies_until_the_second_before_exp() {
    let minted_at = 1_800_000_000;
    let claims = Claims {
        user: "u1".into(),
        doc: Some("doc-42".into()),
        ..Claims::default()
    };
    let token = mint(SECRET, &claims, at(minted_at)).unwrap();
    let exp = minted_at + DEFAULT_TTL_SECONDS;
    assert!(verify(SECRET, &token, at(exp - 1)).is_some());
    assert!(verify(SECRET, &token, at(exp)).is_none());
}

#[test]
#[ignore = "Rust claims and users cannot be null"]
fn rejects_null_claims_or_a_null_user() {}
