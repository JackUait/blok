//! SOCKS tunnels for the operator client, as SocketsHttpHandler's
//! SocksHelper opens them: SOCKS5 (RFC 1928) with username/password
//! (RFC 1929), SOCKS4 and SOCKS4a.

use std::io;
use std::net::{IpAddr, Ipv4Addr};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::proxy::ProxyUrl;

fn refused(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionRefused, format!("socks: {what}"))
}

/// Asks the proxy on `tcp` to connect to `host`:`port`. `host` is
/// System.Uri.Host, an IPv6 literal in brackets.
pub(crate) async fn tunnel(
    tcp: &mut TcpStream,
    proxy: &ProxyUrl,
    host: &str,
    port: u16,
) -> io::Result<()> {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let literal = host.parse::<IpAddr>().ok();
    match proxy.scheme.as_str() {
        "socks5" => socks5(tcp, proxy, host, literal, port).await,
        "socks4" | "socks4a" => socks4(tcp, proxy, host, literal, port).await,
        other => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("the {other} proxy scheme is not supported"),
        )),
    }
}

async fn socks5(
    tcp: &mut TcpStream,
    proxy: &ProxyUrl,
    host: &str,
    literal: Option<IpAddr>,
    port: u16,
) -> io::Result<()> {
    // Offer no authentication, plus username/password when the proxy URL
    // carries credentials.
    let greeting: &[u8] = if proxy.user.is_some() {
        &[5, 2, 0, 2]
    } else {
        &[5, 1, 0]
    };
    tcp.write_all(greeting).await?;
    let mut choice = [0u8; 2];
    tcp.read_exact(&mut choice).await?;
    if choice[0] != 5 {
        return Err(refused("not a SOCKS5 proxy"));
    }
    match (choice[1], &proxy.user) {
        (0, _) => {}
        (2, Some((user, password))) => {
            let password = password.as_deref().unwrap_or("");
            if user.len() > 255 || password.len() > 255 {
                return Err(refused("credentials longer than 255 bytes"));
            }
            let mut auth = vec![1, user.len() as u8];
            auth.extend_from_slice(user.as_bytes());
            auth.push(password.len() as u8);
            auth.extend_from_slice(password.as_bytes());
            tcp.write_all(&auth).await?;
            let mut status = [0u8; 2];
            tcp.read_exact(&mut status).await?;
            if status[1] != 0 {
                return Err(refused("the proxy refused the credentials"));
            }
        }
        _ => return Err(refused("no acceptable authentication method")),
    }
    let mut request = vec![5, 1, 0];
    match literal {
        Some(IpAddr::V4(v4)) => {
            request.push(1);
            request.extend_from_slice(&v4.octets());
        }
        Some(IpAddr::V6(v6)) => {
            request.push(4);
            request.extend_from_slice(&v6.octets());
        }
        None => {
            if host.len() > 255 {
                return Err(refused("a host name longer than 255 bytes"));
            }
            request.push(3);
            request.push(host.len() as u8);
            request.extend_from_slice(host.as_bytes());
        }
    }
    request.extend_from_slice(&port.to_be_bytes());
    tcp.write_all(&request).await?;
    let mut reply = [0u8; 4];
    tcp.read_exact(&mut reply).await?;
    if reply[0] != 5 {
        return Err(refused("not a SOCKS5 reply"));
    }
    if reply[1] != 0 {
        return Err(refused(&format!(
            "the proxy refused the connect ({})",
            reply[1]
        )));
    }
    let skip = match reply[3] {
        1 => 4,
        4 => 16,
        3 => {
            let mut length = [0u8; 1];
            tcp.read_exact(&mut length).await?;
            usize::from(length[0])
        }
        _ => return Err(refused("a bad bound address")),
    };
    let mut bound = vec![0u8; skip + 2];
    tcp.read_exact(&mut bound).await?;
    Ok(())
}

async fn socks4(
    tcp: &mut TcpStream,
    proxy: &ProxyUrl,
    host: &str,
    literal: Option<IpAddr>,
    port: u16,
) -> io::Result<()> {
    // SOCKS4 carries only an IPv4 address, so a name is looked up here;
    // SOCKS4a hands the name to the proxy behind the 0.0.0.255 marker, as
    // SocksHelper does.
    let address = match literal.map(|ip| ip.to_canonical()) {
        Some(IpAddr::V4(v4)) => Some(v4),
        Some(IpAddr::V6(_)) => return Err(refused("SOCKS4 cannot reach an IPv6 address")),
        None if proxy.scheme == "socks4a" => None,
        None => Some(
            tokio::net::lookup_host((host, port))
                .await?
                .find_map(|a| match a.ip() {
                    IpAddr::V4(v4) => Some(v4),
                    IpAddr::V6(_) => None,
                })
                .ok_or_else(|| refused("no IPv4 address for the host"))?,
        ),
    };
    let user = proxy.user.as_ref().map_or("", |(user, _)| user.as_str());
    let mut request = vec![4, 1];
    request.extend_from_slice(&port.to_be_bytes());
    request.extend_from_slice(&address.unwrap_or(Ipv4Addr::new(0, 0, 0, 255)).octets());
    request.extend_from_slice(user.as_bytes());
    request.push(0);
    if address.is_none() {
        request.extend_from_slice(host.as_bytes());
        request.push(0);
    }
    tcp.write_all(&request).await?;
    let mut reply = [0u8; 8];
    tcp.read_exact(&mut reply).await?;
    if reply[1] != 90 {
        return Err(refused(&format!(
            "the proxy refused the connect ({})",
            reply[1]
        )));
    }
    Ok(())
}
