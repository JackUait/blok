use blok_dotnet::{Uri, parse_ip};

use crate::policy::{DefaultPolicy, Policy, has_control, resolve};

/// In UTF-16 units, like every other cap in the server.
const MAX_BROWSER_URL_LENGTH: usize = 2048;

/// C#'s BrowserUrl.Secure: the filter for a URL Blok hands to a reader's
/// browser to load, such as an oEmbed thumbnail. It returns the https URL
/// with a punycode host, or "" when the URL should not load. With no base,
/// `reference` must be absolute.
pub fn browser_url(base: Option<&Uri>, reference: &str) -> String {
    if has_control(reference) {
        return String::new();
    }
    let Some(u) = resolve(reference, base) else {
        return String::new();
    };
    if u.scheme != "https" || u.host.is_empty() || !u.user_info.is_empty() {
        return String::new();
    }
    let prefix = format!("https://{}", u.host);
    let Some(host) = public_host(&u) else {
        return String::new();
    };
    let Some(rest) = u.absolute_uri.strip_prefix(&prefix) else {
        return String::new();
    };
    let url = format!("https://{host}{rest}");
    if has_encoded_control(&url) || url.encode_utf16().count() > MAX_BROWSER_URL_LENGTH {
        return String::new();
    }
    url
}

/// The host to write, punycode for a name, or None when the host is an
/// address the outbound policy refuses, a zoned IPv6 literal, localhost, a
/// single label, a trailing-dot name or a name ending in a number (a
/// browser reads "１２７.0.0.1" as 127.0.0.1). No DNS lookup.
fn public_host(u: &Uri) -> Option<String> {
    match u.host_type.as_str() {
        "IPv4" | "IPv6" => {
            let address = parse_ip(&u.idn_host)?;
            if u.idn_host.contains('%') || !DefaultPolicy.address_allowed(address) {
                return None;
            }
            Some(u.host.clone())
        }
        "Dns" => {
            let name = u.idn_host.as_str();
            let dot = name.rfind('.')?;
            if !plain_name(name)
                || dot == name.len() - 1
                || name.ends_with(".localhost")
                || name.as_bytes()[dot + 1].is_ascii_digit()
            {
                return None;
            }
            Some(name.to_owned())
        }
        _ => None,
    }
}

/// Only letters, digits, '-', '_' and '.', with no label starting with '-'
/// or '_'. A fullwidth character can map to a URL delimiter ("a／b" to
/// "a/b", where .NET's IdnHost throws) or to '%', and a browser
/// percent-decodes a host: "127.0.0.％31" loads 127.0.0.1. .NET reads a
/// label starting with '-' or '_' as a Basic host and drops it. C#'s
/// IsPlainName is the same rule.
fn plain_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.iter().enumerate().all(|(i, &c)| {
        let start = i == 0 || bytes[i - 1] == b'.';
        c.is_ascii_alphanumeric() || c == b'.' || (c == b'-' || c == b'_') && !start
    })
}

/// %00-%1F, %7F or a C1 control in UTF-8 (%C2%80-%C2%9F), in any hex case.
fn has_encoded_control(url: &str) -> bool {
    let b = url.as_bytes();
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b'%' {
            let (hi, lo) = (b[i + 1] | 0x20, b[i + 2] | 0x20);
            if hi == b'0' || hi == b'1' || hi == b'7' && lo == b'f' {
                return true;
            }
            if hi == b'c'
                && lo == b'2'
                && i + 5 < b.len()
                && b[i + 3] == b'%'
                && (b[i + 4] == b'8' || b[i + 4] == b'9')
            {
                return true;
            }
        }
        i += 1;
    }
    false
}
