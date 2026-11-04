use blok_dotnet::unescape_data_string;

/// A proxy to send a request through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyUrl {
    /// "http", "https", "socks4", "socks4a" or "socks5".
    pub scheme: String,
    /// The user and the password, unescaped.
    pub user: Option<(String, Option<String>)>,
    /// host:port, an IPv6 host in brackets.
    pub authority: String,
}

/// .NET's HttpEnvironmentProxy (System.Net.Http 10.0.11, decompiled), which
/// SocketsHttpHandler uses by default. Unlike Go's ProxyFromEnvironment it
/// reads ALL_PROXY, takes a lower-case variable even when it is empty for
/// no_proxy, matches NO_PROXY entries only exactly or as ".suffix", has no
/// "*" and no loopback bypass, and skips HTTP_PROXY only under
/// GATEWAY_INTERFACE. With no variable set .NET on macOS falls back to the
/// system proxy settings; this does not read those.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentProxy {
    http: Option<ProxyUrl>,
    https: Option<ProxyUrl>,
    bypass: Vec<String>,
}

impl EnvironmentProxy {
    /// Reads the variables through `lookup`; None when no proxy is set.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Option<EnvironmentProxy> {
        let get = |name: &str| lookup(name).unwrap_or_default();
        let mut http = proxy_url(&get("http_proxy"));
        if http.is_none() && lookup("GATEWAY_INTERFACE").is_none() {
            http = proxy_url(&get("HTTP_PROXY"));
        }
        let mut https = first_url(&get("https_proxy"), &get("HTTPS_PROXY"));
        if http.is_none() || https.is_none() {
            let all = first_url(&get("all_proxy"), &get("ALL_PROXY"));
            if http.is_none() {
                http = all.clone();
            }
            if https.is_none() {
                https = all;
            }
        }
        if http.is_none() && https.is_none() {
            return None;
        }
        let bypass = lookup("no_proxy").unwrap_or_else(|| get("NO_PROXY"));
        let bypass = bypass
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_owned)
            .collect();
        Some(EnvironmentProxy {
            http,
            https,
            bypass,
        })
    }

    /// The process environment.
    pub fn from_env() -> Option<EnvironmentProxy> {
        EnvironmentProxy::from_lookup(|name| std::env::var(name).ok())
    }

    /// The proxy for a request to `scheme`://`host`, where `host` is
    /// System.Uri.Host (IPv6 in brackets).
    pub fn for_target(&self, scheme: &str, host: &str) -> Option<&ProxyUrl> {
        let proxy = if scheme == "http" {
            self.http.as_ref()
        } else {
            self.https.as_ref()
        };
        proxy.filter(|_| !bypassed(&self.bypass, host))
    }
}

fn first_url(lower: &str, upper: &str) -> Option<ProxyUrl> {
    proxy_url(lower).or_else(|| proxy_url(upper))
}

/// GetUriFromString: an optional scheme, optional user info before the
/// last "@", and a port made of the digits after the last ":" (anything
/// after them is dropped).
fn proxy_url(value: &str) -> Option<ProxyUrl> {
    if value.is_empty() {
        return None;
    }
    let (mut scheme, mut port) = ("http", 80u16);
    let mut value = value;
    for (prefix, s, p) in [
        ("http://", "http", 80),
        ("https://", "https", 443),
        ("socks4://", "socks4", 80),
        ("socks5://", "socks5", 80),
        ("socks4a://", "socks4a", 80),
    ] {
        if value.len() >= prefix.len()
            && value.is_char_boundary(prefix.len())
            && value[..prefix.len()].eq_ignore_ascii_case(prefix)
        {
            (scheme, port) = (s, p);
            value = &value[prefix.len()..];
            break;
        }
    }
    let mut user = None;
    if let Some(at) = value.rfind('@') {
        let info = unescape_data_string(&value[..at]);
        value = &value[at + 1..];
        user = Some(match info.split_once(':') {
            Some((name, password)) => (name.to_owned(), Some(password.to_owned())),
            None => (info, None),
        });
    }
    let mut host = value;
    let bracket = value.find(']');
    if let Some(colon) = value.rfind(':')
        && bracket.is_none_or(|b| colon > b)
    {
        host = &value[..colon];
        let digits: String = value[colon + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        port = digits.parse().ok()?;
    }
    if host.is_empty() || host.contains(['/', '?', '#', '@', ' ']) {
        return None;
    }
    let host = match host.parse::<std::net::Ipv6Addr>() {
        Ok(_) => format!("[{host}]"),
        Err(_) => host.to_owned(),
    };
    Some(ProxyUrl {
        scheme: scheme.to_owned(),
        user,
        authority: format!("{host}:{port}"),
    })
}

/// IsMatchInBypassList.
fn bypassed(entries: &[String], host: &str) -> bool {
    entries.iter().any(|entry| match entry.strip_prefix('.') {
        Some(domain) => {
            domain.eq_ignore_ascii_case(host)
                || host.len() >= entry.len()
                    && host.is_char_boundary(host.len() - entry.len())
                    && host[host.len() - entry.len()..].eq_ignore_ascii_case(entry)
        }
        None => entry.eq_ignore_ascii_case(host),
    })
}
