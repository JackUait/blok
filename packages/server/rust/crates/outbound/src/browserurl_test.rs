use blok_dotnet::parse_absolute_uri;

use crate::browserurl::browser_url;

// The ledger's G1 rows: .NET's IdnHost throws for these, so C# drops them.
#[test]
fn drops_a_host_whose_idn_form_holds_a_url_delimiter() {
    for raw in [
        "https://a\u{ff0f}b.example/x",
        "https://127.0.0.1\u{ff0f}x.example/a.png",
        "https://localhost\u{ff03}.example/a.png",
        "https://evil.example\u{ff20}bank.example/a.png",
        "https://a\u{ff1f}b.example/",
        "https://a\u{ff1a}b.example/",
        "https://a\u{ff3c}b.example/",
        "https://a\u{ff3b}b\u{ff3d}.example/",
    ] {
        assert_eq!(browser_url(None, raw), "", "{raw}");
    }
}

#[test]
fn keeps_a_public_https_url_with_a_punycode_host() {
    assert_eq!(
        browser_url(None, "https://b\u{fc}cher.example/a.png"),
        "https://xn--bcher-kva.example/a.png"
    );
    let base = parse_absolute_uri("https://site.example/a/b").unwrap();
    assert_eq!(
        browser_url(Some(&base), "../i.png"),
        "https://site.example/i.png"
    );
}

#[test]
fn drops_what_a_browser_must_not_load() {
    for raw in [
        "http://site.example/a.png",
        "https://user@site.example/a.png",
        "https://127.0.0.1/a.png",
        "https://[::1]/a.png",
        "https://[fe80::1%25en0]/a.png",
        "https://localhost/a.png",
        "https://a.localhost/a.png",
        "https://single/a.png",
        "https://site.example./a.png",
        "https://site.123/a.png",
        "https://-a.example/a.png",
        "https://site.example/a%00b",
        "https://site.example/a%C2%85b",
        "https://site.example/a\u{85}b",
    ] {
        assert_eq!(browser_url(None, raw), "", "{raw}");
    }
    let long = format!("https://site.example/{}", "a".repeat(2048));
    assert_eq!(browser_url(None, &long), "");
}
