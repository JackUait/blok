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

// Measured with .NET 10 (dotnet fsi, Uri.TryCreate) on macOS: a host longer
// than 256 UTF-16 units is refused unless every label of its IDN form fits
// 63 chars. That also bounds the punycode work a long host can ask for.
#[test]
fn long_hosts_are_refused_like_dotnet() {
    let repeat = |c: char, n: usize| c.to_string().repeat(n);
    let labels = |first: String, n: usize, c: char, len: usize| {
        let mut parts = vec![first];
        parts.extend(std::iter::repeat_n(repeat(c, len), n));
        parts.join(".")
    };
    let cjk: String = (0..20000u32)
        .map(|i| char::from_u32(0x4e00 + i).unwrap())
        .collect();
    let cases = [
        ("a256", repeat('a', 256), true),
        ("a257", repeat('a', 257), false),
        ("b.a255", format!("b.{}", repeat('a', 255)), false),
        ("5x a63", labels(repeat('a', 63), 4, 'a', 63), true),
        ("u256", repeat('ü', 256), true),
        ("u257", repeat('ü', 257), false),
        ("b.u255", format!("b.{}", repeat('ü', 255)), false),
        ("u60+4x a63", labels(repeat('ü', 60), 4, 'a', 63), false),
        ("u10+4x a63", labels(repeat('ü', 10), 4, 'a', 63), true),
        ("a64+4x a63", labels(repeat('a', 64), 4, 'a', 63), false),
        ("x3002", vec![repeat('a', 63); 5].join("\u{3002}"), true),
        ("3x cjk20000", vec![cjk; 3].join("."), false),
    ];
    for (name, host, ok) in cases {
        let got = parse_absolute_uri(&format!("http://{host}/p"));
        assert_eq!(got.is_some(), ok, "{name}");
    }
}
