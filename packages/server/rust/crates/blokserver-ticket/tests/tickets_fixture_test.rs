mod support;

use blok_blokserver_ticket::{Claims, mint};
use blok_ticket::verify;
use support::{at, load, text};

const FIXTURE_EXP: i64 = 4_102_444_800;
const FIXED_NOW: i64 = 1_700_000_000;

fn claims(user: &str, doc: &str, write: bool) -> blok_ticket::Claims {
    blok_ticket::Claims {
        user: user.into(),
        doc: doc.into(),
        write,
        exp: FIXTURE_EXP,
    }
}

#[test]
fn verifies_the_shared_ticket_passes() {
    let f = load("tickets.json");
    let secret = text(&f, "secret");
    for (name, want) in [
        ("compatible", claims("u1", "doc-42", true)),
        ("docMismatch", claims("u1", "other-doc", true)),
        ("readOnly", claims("u1", "doc-42", false)),
        ("userTwo", claims("u2", "doc-42", true)),
    ] {
        assert_eq!(
            verify(&secret, &text(&f, name), at(FIXED_NOW)),
            Some(want),
            "{name}"
        );
    }
}

#[test]
fn refuses_the_shared_invalid_ticket_passes() {
    let f = load("tickets.json");
    let secret = text(&f, "secret");
    let compatible = text(&f, "compatible");
    for (name, token) in [
        ("malformed", text(&f, "malformed")),
        ("expired", text(&f, "expired")),
        ("tampered", text(&f, "tampered")),
        (
            "noncanonicalHeaderTicket",
            text(&f, "noncanonicalHeaderTicket"),
        ),
        ("padded signature", format!("{compatible}=")),
        ("over-long signature", format!("{compatible}AAAA")),
    ] {
        assert_eq!(verify(&secret, &token, at(FIXED_NOW)), None, "{name}");
    }
    for secret in ["", "a-different-secret-with-at-least-32-characters"] {
        assert_eq!(verify(secret, &compatible, at(FIXED_NOW)), None, "{secret}");
    }
}

#[test]
fn mints_the_shared_ticket_passes_byte_for_byte() {
    let f = load("tickets.json");
    let secret = text(&f, "secret");
    for (name, user, doc, write) in [
        ("compatible", "u1", "doc-42", true),
        ("docMismatch", "u1", "other-doc", true),
        ("readOnly", "u1", "doc-42", false),
        ("userTwo", "u2", "doc-42", true),
    ] {
        let claims = Claims {
            user: Some(user.into()),
            doc: Some(doc.into()),
            write,
            ttl_seconds: Some(FIXTURE_EXP),
        };
        assert_eq!(
            mint(&secret, &claims, at(0)).unwrap(),
            text(&f, name),
            "{name}"
        );
    }
}
