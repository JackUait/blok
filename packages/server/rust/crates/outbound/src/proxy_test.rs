use std::collections::HashMap;

use crate::proxy::EnvironmentProxy;

fn env(pairs: &[(&str, &str)]) -> Option<EnvironmentProxy> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    EnvironmentProxy::from_lookup(|name| map.get(name).cloned())
}

fn authority(pairs: &[(&str, &str)], scheme: &str, host: &str) -> Option<String> {
    env(pairs)?
        .for_target(scheme, host)
        .map(|p| p.authority.clone())
}

#[test]
fn reads_dotnets_environment_proxy_rules() {
    assert_eq!(env(&[]), None);
    assert_eq!(
        authority(
            &[("HTTPS_PROXY", "proxy.example:3128")],
            "https",
            "s3.example"
        ),
        Some("proxy.example:3128".into())
    );
    assert_eq!(
        authority(&[("ALL_PROXY", "http://p:1")], "http", "s3.example"),
        Some("p:1".into())
    );
    assert_eq!(
        authority(
            &[
                ("HTTP_PROXY", "http://p:1"),
                ("GATEWAY_INTERFACE", "CGI/1.1")
            ],
            "http",
            "h"
        ),
        None
    );
    assert_eq!(
        authority(
            &[
                ("http_proxy", "http://p:1"),
                ("GATEWAY_INTERFACE", "CGI/1.1")
            ],
            "http",
            "h"
        ),
        Some("p:1".into())
    );
    assert_eq!(
        authority(
            &[("HTTPS_PROXY", "http://p:1"), ("NO_PROXY", "*")],
            "https",
            "h"
        ),
        Some("p:1".into())
    );
    assert_eq!(
        authority(
            &[
                ("HTTPS_PROXY", "http://p:1"),
                ("no_proxy", ""),
                ("NO_PROXY", "h")
            ],
            "https",
            "h"
        ),
        Some("p:1".into())
    );
    assert_eq!(
        authority(
            &[("HTTPS_PROXY", "http://p:1"), ("NO_PROXY", ".example")],
            "https",
            "a.example"
        ),
        None
    );
    assert_eq!(
        authority(&[("HTTPS_PROXY", "http://[::1]:8080/x")], "https", "h"),
        Some("[::1]:8080".into())
    );
    let proxy = env(&[("HTTPS_PROXY", "http://us%40er:p%3Ass@p:1")]).unwrap();
    let url = proxy.for_target("https", "h").unwrap();
    assert_eq!(url.user, Some(("us@er".into(), Some("p:ss".into()))));
}
