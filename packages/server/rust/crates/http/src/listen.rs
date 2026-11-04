//! What Kestrel's UseUrls binds for --listen (Program.cs:74-77).

use std::fmt;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV6, TcpListener};

/// A bind that failed, with the text the host prints after
/// "blok-server refused to start: ".
#[derive(Debug)]
pub struct ListenError {
    message: String,
    in_use: bool,
}

impl ListenError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            in_use: false,
        }
    }

    pub fn is_address_in_use(&self) -> bool {
        self.in_use
    }
}

impl fmt::Display for ListenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ListenError {}

/// Binds what Kestrel makes of `address`:
///   - no host: IPv4 any only (the C# host rewrites ":P" to "0.0.0.0:P");
///   - an IP address: that address alone, IPv4 sockets for IPv4;
///   - "*" or "+": IPv6 any, dual-stack, else IPv4 any;
///   - localhost: 127.0.0.1 and [::1], one of them is enough.
///
/// `parse_ip` is .NET's IPAddress.TryParse (blok-dotnet), which takes forms
/// std refuses, such as "127.1". Options validation has already refused
/// every other host.
pub fn listen(
    address: &str,
    parse_ip: impl Fn(&str) -> Option<IpAddr>,
) -> Result<Vec<TcpListener>, ListenError> {
    let (host, port_text) = split_host_port(address)?;
    let port = parse_port(port_text).ok_or_else(|| {
        ListenError::new(format!("listen tcp: address {port_text}: invalid port"))
    })?;
    if host.is_empty() {
        return bind_one("tcp4", SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), port));
    }
    if host == "*" || host == "+" {
        // Kestrel sets DualMode and Go sets IPV6_V6ONLY=0 itself. std cannot
        // set it, so this socket is dual-stack only where the OS default is
        // (macOS; Linux unless net.ipv6.bindv6only=1).
        return match bind_one("tcp", SocketAddr::new(Ipv6Addr::UNSPECIFIED.into(), port)) {
            Err(error) if !error.in_use => {
                bind_one("tcp4", SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), port))
            }
            other => other,
        };
    }
    if host.eq_ignore_ascii_case("localhost") {
        return bind_localhost(port);
    }
    let Some(ip) = parse_ip(host) else {
        return Err(ListenError::new(format!(
            "listen tcp: address {address}: not an IP address"
        )));
    };
    match ip {
        IpAddr::V4(v4) => bind_one("tcp4", SocketAddr::new(v4.into(), port)),
        IpAddr::V6(v6) if v6.to_ipv4_mapped().is_some() => {
            // An IPv6 socket cannot bind a mapped address.
            Err(ListenError::new("Can't assign requested address"))
        }
        IpAddr::V6(v6) if v6.is_unspecified() => bind_one("tcp", SocketAddr::new(v6.into(), port)),
        IpAddr::V6(v6) => {
            // The parsed address drops the scope id; a link-local bind needs
            // it. Only a numeric zone is read: a named one needs
            // if_nametoindex, which std does not have.
            let scope = host
                .split_once('%')
                .and_then(|(_, zone)| zone.parse::<u32>().ok())
                .unwrap_or(0);
            bind_one(
                "tcp6",
                SocketAddr::V6(SocketAddrV6::new(v6, port, 0, scope)),
            )
        }
    }
}

fn bind_localhost(port: u16) -> Result<Vec<TcpListener>, ListenError> {
    if port == 0 {
        return Err(ListenError::new(
            "Dynamic port binding is not supported when binding to localhost. \
             You must either bind to 127.0.0.1:0 or [::1]:0, or both.",
        ));
    }
    let mut listeners = Vec::new();
    for (network, ip) in [
        ("tcp4", IpAddr::from(Ipv4Addr::LOCALHOST)),
        ("tcp6", IpAddr::from(Ipv6Addr::LOCALHOST)),
    ] {
        match bind_one(network, SocketAddr::new(ip, port)) {
            Ok(bound) => listeners.extend(bound),
            Err(error) if error.in_use => return Err(error),
            Err(_) => {}
        }
    }
    if listeners.is_empty() {
        return Err(ListenError::new(format!(
            "Failed to bind to address http://localhost:{port}."
        )));
    }
    Ok(listeners)
}

fn bind_one(network: &str, address: SocketAddr) -> Result<Vec<TcpListener>, ListenError> {
    match TcpListener::bind(address) {
        Ok(listener) => Ok(vec![listener]),
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => Err(ListenError {
            // Kestrel's AddressInUseException message.
            message: format!("Failed to bind to address http://{address}: address already in use."),
            in_use: true,
        }),
        Err(error) => Err(ListenError::new(format!(
            "listen {network} {address}: bind: {}",
            os_error_text(&error)
        ))),
    }
}

/// The OS text without std's " (os error N)" tail, first letter lowered as
/// Go's syscall table spells it.
fn os_error_text(error: &io::Error) -> String {
    let text = error.to_string();
    let text = match text.rfind(" (os error ") {
        Some(at) => &text[..at],
        None => &text,
    };
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// strconv.ParseUint(text, 10, 16): ASCII digits only, no sign.
fn parse_port(text: &str) -> Option<u16> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse::<u16>().ok()
}

/// Go's net.SplitHostPort, with its error texts.
pub fn split_host_port(hostport: &str) -> Result<(&str, &str), ListenError> {
    let fail = |why: &str| Err(ListenError::new(format!("address {hostport}: {why}")));
    let bytes = hostport.as_bytes();
    let Some(i) = hostport.rfind(':') else {
        return fail("missing port in address");
    };
    let (host, j, k);
    if bytes[0] == b'[' {
        let Some(end) = hostport.find(']') else {
            return fail("missing ']' in address");
        };
        if end + 1 == hostport.len() {
            return fail("missing port in address");
        } else if end + 1 != i {
            if bytes[end + 1] == b':' {
                return fail("too many colons in address");
            }
            return fail("missing port in address");
        }
        host = &hostport[1..end];
        (j, k) = (1, end + 1);
    } else {
        host = &hostport[..i];
        if host.contains(':') {
            return fail("too many colons in address");
        }
        (j, k) = (0, 0);
    }
    if hostport[j..].contains('[') {
        return fail("unexpected '[' in address");
    }
    if hostport[k..].contains(']') {
        return fail("unexpected ']' in address");
    }
    Ok((host, &hostport[i + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn std_parse(text: &str) -> Option<IpAddr> {
        text.split('%').next()?.parse().ok()
    }

    #[test]
    fn listen_refuses_a_port_that_does_not_fit_sixteen_bits() {
        let free = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = u32::from(free.local_addr().unwrap().port());
        drop(free);
        for port_text in [(port + 65536).to_string(), "-1".to_string()] {
            let result = listen(&format!("127.0.0.1:{port_text}"), std_parse);
            let want = format!("listen tcp: address {port_text}: invalid port");
            match result {
                Err(error) => assert_eq!(error.to_string(), want),
                Ok(bound) => panic!("{port_text}: bound {bound:?}"),
            }
        }
    }

    #[test]
    fn split_host_port_keeps_gos_errors() {
        let cases = [
            ("a", Err("address a: missing port in address")),
            ("a:b:c", Err("address a:b:c: too many colons in address")),
            ("[::1", Err("address [::1: missing ']' in address")),
            ("[::1]x", Err("address [::1]x: missing port in address")),
            ("x]:1", Err("address x]:1: unexpected ']' in address")),
            ("a[:1", Err("address a[:1: unexpected '[' in address")),
            (":", Ok(("", ""))),
            ("[::1]:80", Ok(("::1", "80"))),
        ];
        for (input, want) in cases {
            let got = split_host_port(input).map_err(|e| e.to_string());
            assert_eq!(got, want.map_err(String::from), "{input}");
        }
    }

    #[test]
    fn an_address_in_use_gets_kestrels_text() {
        let holder = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = holder.local_addr().unwrap().port();
        for host in ["127.0.0.1", "localhost"] {
            let error = listen(&format!("{host}:{port}"), std_parse).unwrap_err();
            assert!(error.is_address_in_use());
            assert_eq!(
                error.to_string(),
                format!(
                    "Failed to bind to address http://127.0.0.1:{port}: address already in use."
                )
            );
        }
    }

    #[test]
    fn localhost_refuses_a_dynamic_port_and_a_mapped_address_refuses() {
        let error = listen("localhost:0", std_parse).unwrap_err();
        assert!(
            error
                .to_string()
                .starts_with("Dynamic port binding is not supported")
        );
        let error = listen("[::ffff:127.0.0.1]:0", std_parse).unwrap_err();
        assert_eq!(error.to_string(), "Can't assign requested address");
    }

    #[test]
    fn a_wildcard_takes_ipv4_too() {
        let bound = listen("*:0", std_parse).unwrap();
        let port = bound[0].local_addr().unwrap().port();
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn no_host_binds_ipv4_any_only() {
        let bound = listen(":0", std_parse).unwrap();
        assert_eq!(bound.len(), 1);
        assert_eq!(
            bound[0].local_addr().unwrap().ip(),
            IpAddr::from(Ipv4Addr::UNSPECIFIED)
        );
    }
}
