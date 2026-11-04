// Measured on the C# host through the origin check; see
// fixtures/origin-case-fold.json for the black-box half.
#[test]
fn equals_ordinal_ignore_case() {
    let cases: &[(&[u8], &[u8], bool)] = &[
        (b"http://k.example", b"HTTP://K.EXAMPLE", true),
        (
            b"http://k.example",
            "http://\u{212a}.example".as_bytes(),
            false,
        ),
        (b"http://s.example", "http://ſ.example".as_bytes(), false),
        (b"http://i.example", "http://ı.example".as_bytes(), false),
        (b"http://i.example", "http://İ.example".as_bytes(), false),
        (
            "http://é.example".as_bytes(),
            "http://É.example".as_bytes(),
            true,
        ),
        (
            "http://ß.example".as_bytes(),
            "http://ẞ.example".as_bytes(),
            false,
        ),
        (
            "http://σ.example".as_bytes(),
            "http://ς.example".as_bytes(),
            true,
        ),
        (
            "http://μ.example".as_bytes(),
            "http://µ.example".as_bytes(),
            true,
        ),
        (b"a\xe9", b"a\xe9", true),
        (b"a\xe9", b"a\xc9", false),
        (b"ab", b"a", false),
        // The pair differs in UTF-8 length; .NET compares UTF-16 chars.
        (
            "http://\u{0250}.example".as_bytes(),
            "http://\u{2c6f}.example".as_bytes(),
            true,
        ),
        (
            "http://\u{2c65}.example".as_bytes(),
            "http://\u{023a}.example".as_bytes(),
            true,
        ),
        (b"a\xe9", "a\u{00e9}".as_bytes(), false),
    ];
    for &(a, b, want) in cases {
        assert_eq!(
            blok_dotnet::equals_ordinal_ignore_case(a, b),
            want,
            "{:?} vs {:?}",
            String::from_utf8_lossy(a),
            String::from_utf8_lossy(b)
        );
    }
}
