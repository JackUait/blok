use blok_dotnet::parse_absolute_uri;

// Measured with .NET 10 (dotnet fsi, Uri.IdnHost) on macOS; Go's idna profile
// agrees. Neither applies the RFC 5893 bidi rule.
#[test]
fn idn_hosts_skip_the_bidi_rule_like_dotnet() {
    for (input, want) in [
        ("http://1\u{5d0}.com/p", "xn--1-0hc.com"),
        ("http://exam\u{5d0}ple.com:0/", "xn--example-84i.com"),
        ("http://\u{644}ample.com:8080", "xn--ample-bih.com"),
        (
            "http://cdn.x\u{661}ample.net/x.png",
            "cdn.xn--xample-bvi.net",
        ),
        ("http://bücher.example/", "xn--bcher-kva.example"),
    ] {
        let uri = parse_absolute_uri(input).unwrap_or_else(|| panic!("{input:?} refused"));
        assert_eq!(uri.idn_host, want, "{input:?}");
    }
}
