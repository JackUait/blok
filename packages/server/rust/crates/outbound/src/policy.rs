use std::fmt;
use std::net::{IpAddr, Ipv4Addr};

use blok_dotnet::{Uri, parse_absolute_uri, parse_ip, resolve_uri};

/// GuardedFetchFailure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Blocked,
    TooLarge,
    TimedOut,
    TooManyRedirects,
    UnsupportedContentEncoding,
    RateLimited,
    /// Not a GuardedFetchFailure: limits `get` cannot take, where C# throws
    /// ArgumentOutOfRangeException before it fetches.
    LimitOutOfRange,
}

/// GuardedFetchException. It carries no source: a resolver or transport
/// error can hold the host, the path or a secret query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Error {
    pub failure: Failure,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.failure {
            Failure::LimitOutOfRange => "The response byte limit is outside the supported range.",
            _ => "Outbound destination is not permitted.",
        })
    }
}

impl std::error::Error for Error {}

pub(crate) fn fail(failure: Failure) -> Error {
    Error { failure }
}

/// Whether `result` failed as `failure`.
pub fn is_failure<T>(result: &Result<T, Error>, failure: Failure) -> bool {
    matches!(result, Err(e) if e.failure == failure)
}

/// GuardedTarget: a URL that passed the policy.
#[derive(Debug, Clone)]
pub struct Target {
    pub url: Uri,
    pub host: String,
    pub port: u16,
    pub literal: Option<IpAddr>,
}

/// IGuardedOutboundPolicy.
pub trait Policy: Send + Sync {
    /// Parses `raw`, against `base` when there is one.
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error>;
    fn address_allowed(&self, address: IpAddr) -> bool;
}

pub(crate) fn resolve(raw: &str, base: Option<&Uri>) -> Option<Uri> {
    match base {
        None => parse_absolute_uri(raw),
        Some(base) => resolve_uri(base, raw),
    }
}

struct Prefix {
    address: IpAddr,
    bits: u32,
}

impl Prefix {
    fn contains(&self, address: IpAddr) -> bool {
        let (a, b, width) = match (self.address, address) {
            (IpAddr::V4(a), IpAddr::V4(b)) => (u32::from(a) as u128, u32::from(b) as u128, 32),
            (IpAddr::V6(a), IpAddr::V6(b)) => (u128::from(a), u128::from(b), 128),
            _ => return false,
        };
        if self.bits == 0 {
            return true;
        }
        let shift = width - self.bits;
        a >> shift == b >> shift
    }
}

/// The C# ForbiddenNetworks list, in the same order.
const FORBIDDEN: &[&str] = &[
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "0.0.0.0/8",
    "169.254.0.0/16",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "192.88.99.0/24",
    "198.18.0.0/15",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "255.255.255.255/32",
    "100.64.0.0/10",
    // Azure WireServer: every Azure VM reaches it.
    "168.63.129.16/32",
    "::/96",
    "::ffff:0:0:0/96",
    "100::/64",
    "2001::/23",
    "2001:2::/48",
    "2001:db8::/32",
    "2001::/32",
    "fc00::/7",
    "fec0::/10",
    "fe80::/10",
    "ff00::/8",
    "2002::/16",
    "64:ff9b::/96",
    "64:ff9b:1::/48",
    "5f00::/16",
    "2001:10::/28",
    "2001:20::/28",
    "3fff::/20",
    "100:0:0:1::/64",
];

fn forbidden() -> &'static [Prefix] {
    static PREFIXES: std::sync::OnceLock<Vec<Prefix>> = std::sync::OnceLock::new();
    PREFIXES.get_or_init(|| {
        FORBIDDEN
            .iter()
            .map(|text| {
                let (address, bits) = text.split_once('/').expect("a prefix");
                Prefix {
                    address: address.parse().expect("an address"),
                    bits: bits.parse().expect("a length"),
                }
            })
            .collect()
    })
}

/// GuardedOutboundPolicy.
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultPolicy;

/// Whether `s` holds a C0, DEL or C1 character. Go's parser trims them at
/// the ends and .NET's escapes them, so a URL with one is dropped before
/// parsing.
pub fn has_control(s: &str) -> bool {
    s.chars()
        .any(|c| c < '\u{20}' || ('\u{7f}'..='\u{9f}').contains(&c))
}

fn authority_has_at(url: &Uri) -> bool {
    let rest = &url.absolute_uri[url.scheme.len() + 3..];
    let rest = match rest.find(['/', '?', '#']) {
        Some(end) => &rest[..end],
        None => rest,
    };
    rest.contains('@')
}

impl Policy for DefaultPolicy {
    /// Allows http and https on port 80 or 443 with a host and no userinfo.
    /// An IP literal must parse.
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error> {
        let blocked = Err(fail(Failure::Blocked));
        if raw.trim().is_empty() || has_control(raw) {
            return blocked;
        }
        let Some(url) = resolve(raw, base) else {
            return blocked;
        };
        if !url.is_http()
            || url.host.is_empty()
            || !url.user_info.is_empty()
            || authority_has_at(&url)
        {
            return blocked;
        }
        if url.port != 80 && url.port != 443 {
            return blocked;
        }
        // .NET's IdnHost throws when the mapped name holds a URL delimiter,
        // as "a／b" mapping to "a/b"; C# refuses the URL then.
        if url.idn_host_throws {
            return blocked;
        }
        let mut literal = None;
        if url.host_type == "IPv4" || url.host_type == "IPv6" {
            literal = Some(parse_ip(&url.idn_host).ok_or(fail(Failure::Blocked))?);
        }
        Ok(Target {
            host: url.idn_host.clone(),
            port: url.port,
            literal,
            url,
        })
    }

    /// Refuses every forbidden range; a mapped IPv4 address is checked as
    /// IPv4. Only ::ffff:0:0/96 unmaps: `to_ipv4` would also turn the
    /// ::/96 compat range into public IPv4 addresses.
    fn address_allowed(&self, address: IpAddr) -> bool {
        let address = match address {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(address, IpAddr::V4),
            v4 => v4,
        };
        !forbidden().iter().any(|prefix| prefix.contains(address))
    }
}

/// The conformance build's ExactOriginOutboundPolicy: only
/// http://127.0.0.1:PORT, written exactly so, and only 127.0.0.1.
#[derive(Debug, Clone)]
pub struct ExactOriginPolicy {
    pub origin: String,
    pub port: u16,
}

const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

impl Policy for ExactOriginPolicy {
    fn validate(&self, raw: &str, base: Option<&Uri>) -> Result<Target, Error> {
        let blocked = Err(fail(Failure::Blocked));
        let Some(url) = resolve(raw, base) else {
            return blocked;
        };
        let original = match base {
            Some(base) => {
                blok_dotnet::resolve_uri_original(base, raw).map_or_else(String::new, |(_, o)| o)
            }
            None => raw.to_owned(),
        };
        let origin = self.origin.as_str();
        if url.scheme != "http"
            || url.host != "127.0.0.1"
            || url.port != self.port
            || !url.user_info.is_empty()
            || !original.starts_with(origin)
            || original.len() > origin.len() && !b"/?#".contains(&original.as_bytes()[origin.len()])
        {
            return blocked;
        }
        Ok(Target {
            url,
            host: "127.0.0.1".to_owned(),
            port: self.port,
            literal: Some(LOOPBACK),
        })
    }

    fn address_allowed(&self, address: IpAddr) -> bool {
        address == LOOPBACK
    }
}
