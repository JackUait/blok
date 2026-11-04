mod common;

use std::net::IpAddr;

use blok_dotnet::{
    Uri, is_any, is_loopback, parse_absolute_uri, parse_ip, resolve_uri, unescape_data_string,
};
use blok_jsjson::Value;
use common::{field, flag, items, load, number, string};

// primitives.json is captured from .NET by scripts/capture-dotnet-primitives.fsx.
fn fixture() -> Value {
    load("dotnet/primitives.json")
}

#[test]
fn parse_ip_matches_dotnet() {
    let fixture = fixture();
    let mut failures = Vec::new();
    for c in items(&fixture, "ip") {
        let input = string(c, "input");
        let got = parse_ip(&input);
        if got.is_some() != flag(c, "ok") {
            failures.push(format!(
                "{input:?}: ok {}, want {}",
                got.is_some(),
                flag(c, "ok")
            ));
            continue;
        }
        let Some(got) = got else { continue };
        let address = string(c, "address");
        let want: IpAddr = address
            .split('%')
            .next()
            .unwrap()
            .parse()
            .unwrap_or_else(|e| panic!("{input:?}: fixture address {address:?}: {e}"));
        let (loopback, any) = (flag(c, "loopback"), flag(c, "any"));
        if got != want || is_loopback(got) != loopback || is_any(got) != any {
            failures.push(format!(
                "{input:?}: {got} loopback {} any {}, want {want} {loopback} {any}",
                is_loopback(got),
                is_any(got)
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Only http and https are read field by field: they are the only schemes the
// server acts on. Every other scheme must still agree on whether it parses
// and what the scheme is, since that is what the callers refuse it by.
fn check_uri(failures: &mut Vec<String>, label: &str, got: Option<Uri>, c: &Value) {
    let ok = flag(c, "ok");
    if got.is_some() != ok {
        failures.push(format!("{label}: ok {}, want {ok}", got.is_some()));
        return;
    }
    let Some(got) = got else { return };
    let scheme = string(c, "scheme");
    if got.scheme != scheme {
        failures.push(format!("{label}: scheme {:?}, want {scheme:?}", got.scheme));
        return;
    }
    if scheme != "http" && scheme != "https" {
        return;
    }
    let got = (
        got.scheme.as_str(),
        got.host.as_str(),
        got.idn_host.as_str(),
        got.user_info.as_str(),
        u32::from(got.port),
        got.absolute_path.as_str(),
        got.query.as_str(),
        got.fragment.as_str(),
        got.absolute_uri.as_str(),
        got.loopback,
    );
    let (host, idn_host, user_info) = (
        string(c, "host"),
        string(c, "idnHost"),
        string(c, "userInfo"),
    );
    let (path, query, fragment, absolute) = (
        string(c, "absolutePath"),
        string(c, "query"),
        string(c, "fragment"),
        string(c, "absoluteUri"),
    );
    let want = (
        scheme.as_str(),
        host.as_str(),
        idn_host.as_str(),
        user_info.as_str(),
        number(c, "port") as u32,
        path.as_str(),
        query.as_str(),
        fragment.as_str(),
        absolute.as_str(),
        flag(c, "loopback"),
    );
    if got != want {
        failures.push(format!("{label}:\n got {got:?}\nwant {want:?}"));
    }
}

#[test]
fn parse_absolute_uri_matches_dotnet() {
    let fixture = fixture();
    let mut failures = Vec::new();
    for c in items(&fixture, "uri") {
        let input = string(c, "input");
        check_uri(&mut failures, &input, parse_absolute_uri(&input), c);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn resolve_uri_matches_dotnet() {
    let fixture = fixture();
    let mut failures = Vec::new();
    for c in items(&fixture, "relative") {
        let (base_text, input) = (string(c, "base"), string(c, "input"));
        let base = parse_absolute_uri(&base_text)
            .unwrap_or_else(|| panic!("base {base_text:?} does not parse"));
        let label = format!("{base_text} + {input}");
        check_uri(&mut failures, &label, resolve_uri(&base, &input), c);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn unescape_data_string_matches_dotnet() {
    let fixture = fixture();
    let mut failures = Vec::new();
    for c in items(&fixture, "unescape") {
        let Value::Array(pair) = c else { panic!() };
        let (input, want) = (common::as_string(&pair[0]), common::as_string(&pair[1]));
        let got = unescape_data_string(&input);
        if got != want {
            failures.push(format!("{input:?}: {got:?}, want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(!matches!(field(&fixture, "unescape"), Value::Undefined));
}
