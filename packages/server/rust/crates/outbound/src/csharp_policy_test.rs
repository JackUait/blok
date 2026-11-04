use std::net::IpAddr;

use blok_dotnet::parse_absolute_uri;

use crate::policy::{DefaultPolicy, Failure, Policy};

// Twins of GuardedOutboundPolicyTests that the fixture does not name.

#[test]
fn accepts_only_http_destinations_on_the_restricted_ports() {
    for (raw, url, port) in [
        ("http://example.com/path", "http://example.com/path", 80),
        ("https://example.com/", "https://example.com/", 443),
        ("http://example.com:443/", "http://example.com:443/", 443),
        ("https://example.com:80/", "https://example.com:80/", 80),
    ] {
        let target = DefaultPolicy.validate(raw, None).unwrap();
        assert_eq!(target.url.absolute_uri, url);
        assert_eq!(target.host, "example.com");
        assert_eq!(target.port, port);
    }
}

#[test]
fn rejects_invalid_schemes_hosts_and_ports() {
    for raw in [
        "",
        "example.com/no-scheme",
        "file:///etc/passwd",
        "gopher://example.com/",
        "ftp://example.com/",
        "javascript:alert(1)",
        "data:text/plain,hello",
        "http:///missing-host",
        "http://example.com:0/",
        "http://example.com:22/",
        "https://example.com:444/",
        "http://example.com:65536/",
    ] {
        let error = DefaultPolicy.validate(raw, None).unwrap_err();
        assert_eq!(error.failure, Failure::Blocked, "{raw}");
        assert!(error.to_string().len() <= 128);
    }
}

#[test]
fn rejects_every_form_of_authority_credentials() {
    for raw in [
        "http://admin:secret@example.com/",
        "http://admin@example.com/",
        "http://:secret@example.com/",
        "http://@example.com/",
        "http:/\\@example.com/",
        "http:\\\\@example.com/",
        "https://user%40domain@example.com/",
    ] {
        assert!(DefaultPolicy.validate(raw, None).is_err(), "{raw}");
    }
}

#[test]
fn rejects_every_forbidden_ipv4_and_ipv6_class() {
    for raw in [
        "0.0.0.0",
        "0.1.2.3",
        "10.0.0.1",
        "100.64.0.1",
        "100.100.100.200",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.0.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "::2",
        "::127.0.0.1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::ffff:192.168.0.1",
        "64:ff9b::1",
        "64:ff9b:1::1",
        "100::1",
        "100:0:0:1::1",
        "2001::1",
        "2001:2::1",
        "2001:10::1",
        "2001:20::1",
        "2001:db8::1",
        "2002::1",
        "3fff::1",
        "5f00::1",
        "fc00::1",
        "fec0::1",
        "fe80::1",
        "ff00::1",
    ] {
        let address: IpAddr = raw.parse().unwrap();
        assert!(!DefaultPolicy.address_allowed(address), "{raw}");
    }
}

// ::8.8.8.8 is in ::/96; reading it as 8.8.8.8 would let it through.
#[test]
fn a_compat_address_is_not_read_as_ipv4() {
    assert!(DefaultPolicy.address_allowed("8.8.8.8".parse().unwrap()));
    assert!(DefaultPolicy.address_allowed("::ffff:8.8.8.8".parse().unwrap()));
    assert!(!DefaultPolicy.address_allowed("::8.8.8.8".parse().unwrap()));
}

#[test]
fn resolves_and_validates_a_relative_redirect() {
    let base = parse_absolute_uri("https://example.com/path/start").unwrap();
    let target = DefaultPolicy
        .validate("../next?from=redirect", Some(&base))
        .unwrap();
    assert_eq!(
        target.url.absolute_uri,
        "https://example.com/next?from=redirect"
    );
}

#[test]
fn accepts_a_relative_redirect_with_a_url_in_its_query() {
    let base = parse_absolute_uri("https://example.com/path/start").unwrap();
    let target = DefaultPolicy
        .validate("next?return=http://user@elsewhere", Some(&base))
        .unwrap();
    assert_eq!(
        target.url.absolute_uri,
        "https://example.com/path/next?return=http://user@elsewhere"
    );
}

#[test]
fn rejects_credentials_in_a_network_path_redirect() {
    let base = parse_absolute_uri("https://example.com/start").unwrap();
    for location in [
        "//@example.com/private",
        "//user@example.com/private",
        "//:secret@example.com/private",
        "//user:secret@example.com/private",
    ] {
        let error = DefaultPolicy.validate(location, Some(&base)).unwrap_err();
        assert_eq!(error.failure, Failure::Blocked, "{location}");
    }
}

#[test]
fn allows_ordinary_global_addresses() {
    for raw in [
        "1.1.1.1",
        "8.8.8.8",
        "2001:4860:4860::8888",
        "2606:4700:4700::1111",
    ] {
        assert!(DefaultPolicy.address_allowed(raw.parse().unwrap()), "{raw}");
    }
}

#[test]
fn canonicalizes_alternate_address_notation_before_classification() {
    for raw in [
        "http://127.1/",
        "http://0177.0.0.1/",
        "http://0x7f000001/",
        "http://2130706433/",
        "http://2852039166/latest/meta-data/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:169.254.169.254]/latest/meta-data/",
    ] {
        let target = DefaultPolicy.validate(raw, None).unwrap();
        let address = target.literal.expect("a literal");
        assert!(!DefaultPolicy.address_allowed(address), "{raw}");
    }
}
