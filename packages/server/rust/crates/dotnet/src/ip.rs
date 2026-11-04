use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// IPAddress.TryParse. IPv4 takes the inet_aton forms .NET takes ("127.1",
/// "0x7f.0.0.1", "2130706433", octal parts). IPv6 may be bracketed, with a
/// port after the bracket, and its scope id is dropped. An IPv4-mapped
/// IPv6 address stays IPv6.
pub fn parse_ip(s: &str) -> Option<IpAddr> {
    if s.contains(':') {
        return parse_ipv6(s).map(IpAddr::V6);
    }
    parse_ipv4(s).map(IpAddr::V4)
}

/// The IPv4 half of IPAddress.TryParse: one to four parts, each decimal,
/// octal (leading 0) or hex (0x), the last part filling the bytes that
/// remain.
pub fn parse_ipv4(s: &str) -> Option<Ipv4Addr> {
    if s.is_empty() {
        return None;
    }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() > 4 {
        return None;
    }
    let values = parts
        .iter()
        .map(|part| parse_ipv4_part(part))
        .collect::<Option<Vec<u64>>>()?;
    let last = values.len() - 1;
    if values[..last].iter().any(|&value| value > 0xff) {
        return None;
    }
    if values[last] > 0xffff_ffff_u64 >> (8 * last) {
        return None;
    }
    let mut address: u32 = 0;
    for (i, &value) in values[..last].iter().enumerate() {
        address |= (value as u32) << (24 - 8 * i);
    }
    address |= values[last] as u32;
    Some(Ipv4Addr::from(address))
}

fn parse_ipv4_part(part: &str) -> Option<u64> {
    let bytes = part.as_bytes();
    let (base, digits): (u64, &[u8]) = match bytes {
        [] => return None,
        [b'0', b'x' | b'X', rest @ ..] => (16, rest),
        [b'0', rest @ ..] if !rest.is_empty() => (8, rest),
        _ => (10, bytes),
    };
    if digits.is_empty() {
        return None;
    }
    let mut value: u64 = 0;
    for &c in digits {
        let digit = digit_value(c).filter(|&digit| digit < base)?;
        value = value * base + digit;
        if value > 0xffff_ffff {
            return None;
        }
    }
    Some(value)
}

pub(crate) fn digit_value(c: u8) -> Option<u64> {
    char::from(c).to_digit(16).map(u64::from)
}

fn parse_ipv6(s: &str) -> Option<Ipv6Addr> {
    let mut s = s;
    if let Some(inner) = s.strip_prefix('[') {
        let end = inner.find(']')?;
        let rest = &inner[end + 1..];
        if !rest.is_empty() {
            let port = rest.strip_prefix(':')?;
            if !all_digits(port) {
                return None;
            }
        }
        s = &inner[..end];
    }
    if let Some(zone) = s.find('%') {
        if zone == s.len() - 1 {
            return None;
        }
        s = &s[..zone];
    }
    if s.contains(['[', ']']) {
        return None;
    }
    parse_ipv6_text(s)
}

/// netip.ParseAddr for IPv6 text with no zone: eight groups of one to four
/// hex digits, one "::", and an optional dotted IPv4 tail whose fields have
/// no leading zeros.
pub(crate) fn parse_ipv6_text(s: &str) -> Option<Ipv6Addr> {
    let b = s.as_bytes();
    let mut groups = [0u16; 8];
    let mut i = 0;
    let mut at = 0;
    let mut ellipsis: Option<usize> = None;
    if b.len() >= 2 && b[0] == b':' && b[1] == b':' {
        ellipsis = Some(0);
        i = 2;
        if i == b.len() {
            return Some(Ipv6Addr::UNSPECIFIED);
        }
    }
    while at < 8 {
        let start = i;
        let mut value: u32 = 0;
        while i < b.len() {
            let Some(digit) = digit_value(b[i]) else {
                break;
            };
            value = value << 4 | digit as u32;
            i += 1;
            if i - start > 4 {
                return None;
            }
        }
        if i == start {
            return None;
        }
        if i < b.len() && b[i] == b'.' {
            if ellipsis.is_none() && at != 6 || at > 6 {
                return None;
            }
            let v4 = parse_ipv4_strict(&s[start..])?.octets();
            groups[at] = u16::from_be_bytes([v4[0], v4[1]]);
            groups[at + 1] = u16::from_be_bytes([v4[2], v4[3]]);
            at += 2;
            i = b.len();
            break;
        }
        groups[at] = value as u16;
        at += 1;
        if i == b.len() {
            break;
        }
        if b[i] != b':' {
            return None;
        }
        i += 1;
        if i == b.len() {
            return None;
        }
        if b[i] == b':' {
            if ellipsis.is_some() {
                return None;
            }
            ellipsis = Some(at);
            i += 1;
            if i == b.len() {
                break;
            }
        }
    }
    if i != b.len() {
        return None;
    }
    match ellipsis {
        Some(gap) => {
            if at == 8 {
                return None;
            }
            let moved = at - gap;
            groups.copy_within(gap..at, 8 - moved);
            groups[gap..8 - moved].fill(0);
        }
        None if at != 8 => return None,
        None => {}
    }
    Some(Ipv6Addr::from(groups))
}

/// Dotted IPv4 as netip reads it: four decimal fields, no leading zeros.
fn parse_ipv4_strict(s: &str) -> Option<Ipv4Addr> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (octet, part) in octets.iter_mut().zip(parts) {
        if part.is_empty() || part.len() > 3 || !all_digits(part) {
            return None;
        }
        if part.len() > 1 && part.starts_with('0') {
            return None;
        }
        *octet = part.parse().ok()?;
    }
    Some(Ipv4Addr::from(octets))
}

pub(crate) fn all_digits(s: &str) -> bool {
    s.bytes().all(|c| c.is_ascii_digit())
}

/// IPAddress.IsLoopback: 127/8, ::1, and only 127.0.0.1 mapped into IPv6
/// (::ffff:127.0.0.2 is not loopback in .NET).
pub fn is_loopback(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4 == Ipv4Addr::LOCALHOST,
            None => v6.is_loopback(),
        },
    }
}

/// Equality with IPAddress.Any or IPAddress.IPv6Any.
pub fn is_any(address: IpAddr) -> bool {
    address == IpAddr::V4(Ipv4Addr::UNSPECIFIED) || address == IpAddr::V6(Ipv6Addr::UNSPECIFIED)
}

/// netip's String for an IPv6 address that is not IPv4-mapped: lowercase
/// hex, the longest run of two or more zero groups (the first on a tie) as
/// "::".
pub(crate) fn format_ipv6_groups(address: Ipv6Addr) -> String {
    let groups = address.segments();
    let (mut zero_start, mut zero_end) = (usize::MAX, usize::MAX);
    for i in 0..8 {
        let mut j = i;
        while j < 8 && groups[j] == 0 {
            j += 1;
        }
        let run = j - i;
        if run >= 2 && (zero_start == usize::MAX || run > zero_end - zero_start) {
            (zero_start, zero_end) = (i, j);
        }
    }
    let mut out = String::new();
    let mut i = 0;
    while i < 8 {
        if i == zero_start {
            out.push_str("::");
            i = zero_end;
            if i >= 8 {
                break;
            }
        } else if i > 0 {
            out.push(':');
        }
        out.push_str(&format!("{:x}", groups[i]));
        i += 1;
    }
    out
}
