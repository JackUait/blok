//! The Host check for --auth none and proxy, which bind loopback only.

use std::net::Ipv6Addr;

use blok_dotnet::equals_ordinal_ignore_case;

/// The names a loopback server answers on besides its own: the host of
/// every allowed origin and of the public URL. Ports are dropped.
pub(crate) fn host_names(allowed_origins: &[String], public_url: &str) -> Vec<String> {
    let mut names = Vec::new();
    for raw in allowed_origins
        .iter()
        .map(String::as_str)
        .chain([public_url])
    {
        let raw = raw.trim();
        let Some(scheme) = raw.find("://") else {
            continue;
        };
        let authority = &raw[scheme + 3..];
        let authority = &authority[..authority.find(['/', '?', '#']).unwrap_or(authority.len())];
        if let Some(name) = host_name(authority).filter(|name| !name.is_empty()) {
            names.push(name.to_owned());
        }
    }
    names
}

/// A DNS-rebinding page sends its own name, so only loopback names and the
/// configured names pass. The port is not checked: a page can never make
/// its Host a loopback name. No Host passes, since browsers always send one.
pub(crate) fn host_allowed(host: &str, names: &[String]) -> bool {
    if host.is_empty() {
        return true;
    }
    let Some(name) = host_name(host) else {
        return false;
    };
    if equals_ordinal_ignore_case(name.as_bytes(), b"localhost") || is_loopback_ipv4(name) {
        return true;
    }
    if name.starts_with('[')
        && name[1..name.len() - 1].parse::<Ipv6Addr>() == Ok(Ipv6Addr::LOCALHOST)
    {
        return true;
    }
    names
        .iter()
        .any(|allowed| equals_ordinal_ignore_case(allowed.as_bytes(), name.as_bytes()))
}

/// Splits "name[:digits]" or "[v6][:digits]"; the name keeps its brackets.
fn host_name(host: &str) -> Option<&str> {
    let (name, port) = if host.starts_with('[') {
        let end = host.find(']')?;
        let rest = &host[end + 1..];
        if !rest.is_empty() && !rest.starts_with(':') {
            return None;
        }
        (&host[..=end], rest.strip_prefix(':').unwrap_or(rest))
    } else {
        match host.find(':') {
            Some(colon) => (&host[..colon], &host[colon + 1..]),
            None => (host, ""),
        }
    };
    port.bytes().all(|b| b.is_ascii_digit()).then_some(name)
}

/// Four dotted decimal parts in 127.0.0.0/8, not the short or numeric forms.
fn is_loopback_ipv4(name: &str) -> bool {
    let parts: Vec<&str> = name.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|part| {
            (1..=3).contains(&part.len())
                && part.bytes().all(|b| b.is_ascii_digit())
                && part.parse::<u16>().is_ok_and(|value| value <= 255)
        })
        && parts[0] == "127"
}
