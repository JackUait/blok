use blok_dotnet::{parse_absolute_uri, parse_ip};
use blok_jsjson::Value;

use crate::policy::{DefaultPolicy, Error, Policy, Target};
use crate::test_json::{field, items, load, string, text};

// Captured from GuardedOutboundPolicy by OutboundPolicyFixtureTests. The
// conformance build swaps the policy, so this is the only oracle for it.
#[derive(Debug, PartialEq)]
struct Verdict {
    allowed: bool,
    url: String,
    host: String,
    port: u16,
    literal: Option<std::net::IpAddr>,
}

fn want(value: &Value) -> Verdict {
    Verdict {
        allowed: matches!(field(value, "allowed"), Value::Bool(true)),
        url: string(value, "url"),
        host: string(value, "host"),
        port: match field(value, "port") {
            Value::Number(n) => *n as u16,
            _ => 0,
        },
        literal: text(field(value, "literal")).map(|t| parse_ip(&t).expect("a literal")),
    }
}

fn got(result: Result<Target, Error>) -> Verdict {
    match result {
        Ok(target) => Verdict {
            allowed: true,
            url: target.url.absolute_uri,
            host: target.host,
            port: target.port,
            literal: target.literal,
        },
        Err(_) => Verdict {
            allowed: false,
            url: String::new(),
            host: String::new(),
            port: 0,
            literal: None,
        },
    }
}

#[test]
fn policy_matches_the_c_sharp_fixture() {
    let fixture = load("outbound-policy.json");
    let answers = field(&fixture, "answers");
    let policy = DefaultPolicy;
    let ips = items(field(&fixture, "ips"));
    assert!(!ips.is_empty());
    for (ip, answer) in ips.iter().zip(items(field(answers, "ips"))) {
        let ip = text(ip).unwrap();
        let address = parse_ip(&ip).unwrap_or_else(|| panic!("{ip} does not parse"));
        assert_eq!(
            policy.address_allowed(address),
            matches!(answer, Value::Bool(true)),
            "{ip}"
        );
    }
    let urls = items(field(&fixture, "urls"));
    assert_eq!(urls.len(), items(field(answers, "urls")).len());
    for (url, answer) in urls.iter().zip(items(field(answers, "urls"))) {
        let url = text(url).unwrap();
        assert_eq!(got(policy.validate(&url, None)), want(answer), "{url:?}");
    }
    let relative = items(field(&fixture, "relative"));
    assert_eq!(relative.len(), items(field(answers, "relative")).len());
    for (pair, answer) in relative.iter().zip(items(field(answers, "relative"))) {
        let pair = items(pair);
        let (base, reference) = (text(&pair[0]).unwrap(), text(&pair[1]).unwrap());
        let base = parse_absolute_uri(&base).unwrap();
        assert_eq!(
            got(policy.validate(&reference, Some(&base))),
            want(answer),
            "{} + {reference:?}",
            base.absolute_uri
        );
    }
}
