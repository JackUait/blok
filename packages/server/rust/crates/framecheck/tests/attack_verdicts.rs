//! frame-check verdict edge cases, run against Go and Rust
//! with the same table (Go twin: go/internal/framecheck/attack_verdicts_test.go).

use blok_framecheck::{Header, verdict};

const PAGE: &str = "https://page.example/x";
const EDITOR: &str = "https://editor.example";

fn h(name: &str, value: &str) -> Header {
    Header {
        name: name.to_owned(),
        value: value.to_owned(),
    }
}

#[test]
fn verdict_edge_cases_match_go() {
    let cases: Vec<(&str, &str, &str, Vec<Header>, &str)> = vec![
        (
            "idn-throwing embedder is unknown",
            PAGE,
            "https://a\u{ff0f}b.example",
            vec![h("X-Frame-Options", "DENY")],
            "unknown",
        ),
        (
            "xfo deny + allowall blocks",
            PAGE,
            EDITOR,
            vec![h("X-Frame-Options", "DENY, ALLOWALL")],
            "blocked",
        ),
        (
            "xfo two lines conflict blocks",
            PAGE,
            EDITOR,
            vec![
                h("X-Frame-Options", "sameorigin"),
                h("X-Frame-Options", "deny"),
            ],
            "blocked",
        ),
        (
            "xfo quoted deny is invalid",
            PAGE,
            EDITOR,
            vec![h("X-Frame-Options", "\"deny\"")],
            "allowed",
        ),
        (
            "xfo sameorigin same origin",
            PAGE,
            "https://page.example",
            vec![h("X-Frame-Options", "SAMEORIGIN")],
            "allowed",
        ),
        (
            "xfo sameorigin other origin",
            PAGE,
            EDITOR,
            vec![h("X-Frame-Options", "SAMEORIGIN")],
            "blocked",
        ),
        (
            "csp none",
            PAGE,
            EDITOR,
            vec![h("Content-Security-Policy", "frame-ancestors 'none'")],
            "blocked",
        ),
        (
            "csp upper case",
            PAGE,
            EDITOR,
            vec![h("Content-Security-Policy", "FRAME-ANCESTORS 'NONE'")],
            "blocked",
        ),
        (
            "csp second policy in one line",
            PAGE,
            EDITOR,
            vec![h(
                "Content-Security-Policy",
                "frame-ancestors *, frame-ancestors 'none'",
            )],
            "blocked",
        ),
        (
            "csp wildcard sub does not match apex",
            PAGE,
            "https://example.com",
            vec![h(
                "Content-Security-Policy",
                "frame-ancestors https://*.example.com",
            )],
            "blocked",
        ),
        (
            "csp default-src does not govern framing",
            PAGE,
            EDITOR,
            vec![h("Content-Security-Policy", "default-src 'none'")],
            "allowed",
        ),
        (
            "csp non-ascii directive skipped, xfo decides",
            PAGE,
            EDITOR,
            vec![
                h("Content-Security-Policy", "frame-ancestors 'none'\u{e9}"),
                h("X-Frame-Options", "DENY"),
            ],
            "blocked",
        ),
        (
            "csp port mismatch",
            PAGE,
            "https://editor.example:8443",
            vec![h(
                "Content-Security-Policy",
                "frame-ancestors https://editor.example",
            )],
            "blocked",
        ),
        (
            "csp overrides xfo",
            PAGE,
            EDITOR,
            vec![
                h(
                    "Content-Security-Policy",
                    "frame-ancestors https://editor.example",
                ),
                h("X-Frame-Options", "DENY"),
            ],
            "allowed",
        ),
        (
            "http page with deny still blocked first",
            "http://page.example/",
            EDITOR,
            vec![h("X-Frame-Options", "DENY")],
            "blocked",
        ),
        ("no embedder", PAGE, "", vec![], "unknown"),
    ];
    let mut wrong = Vec::new();
    for (name, url, embedder, headers, want) in &cases {
        let got = verdict(url, embedder, headers);
        if got != *want {
            wrong.push(format!("{name}: got {got}, want {want}"));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}
