//! ConformanceArguments: two flags only the conformance build has. The
//! ordinary build passes args through, so the host parser refuses them.

use blok_blokserver::Server;

#[cfg(feature = "conformance")]
use crate::args::cs_quote;

#[cfg(feature = "conformance")]
const ORIGIN_PREFIX: &str = "http://127.0.0.1:";

#[cfg(feature = "conformance")]
const REQUIREMENT: &str = "must be exactly http://127.0.0.1:PORT with a port from 1 to 65535 and no userinfo, path, query, or fragment";

#[derive(Debug, Default)]
pub struct ConformanceArguments {
    pub origin: String,
    pub port: u16,
    pub journal: bool,
}

/// Takes the two flags out of args, at any place before "--", before the
/// host parses the rest.
#[cfg(feature = "conformance")]
pub fn parse_conformance_arguments(
    args: &[String],
) -> Result<(Vec<String>, ConformanceArguments), String> {
    let mut parsed = ConformanceArguments::default();
    let mut filtered = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let argument = &args[i];
        if argument == "--" {
            filtered.extend_from_slice(&args[i..]);
            break;
        }
        if argument == "--conformance-journal" || argument == "-conformance-journal" {
            parsed.journal = true;
            i += 1;
            continue;
        }
        let value = if argument == "--conformance-origin" || argument == "-conformance-origin" {
            if i + 1 >= args.len() {
                return Err("flag needs an argument: -conformance-origin".into());
            }
            i += 1;
            args[i].clone()
        } else if let Some(value) = argument
            .strip_prefix("--conformance-origin=")
            .or_else(|| argument.strip_prefix("-conformance-origin="))
        {
            value.to_owned()
        } else {
            filtered.push(argument.clone());
            i += 1;
            continue;
        };
        let port_text = value.strip_prefix(ORIGIN_PREFIX).unwrap_or("");
        let port = port_text
            .parse::<u32>()
            .ok()
            .filter(|_| !port_text.is_empty() && port_text.bytes().all(|b| b.is_ascii_digit()))
            .filter(|port| (1..=65535).contains(port));
        match port {
            Some(port) if value == format!("{ORIGIN_PREFIX}{port}") => {
                parsed.origin = value;
                parsed.port = port as u16;
            }
            _ => return Err(format!("{REQUIREMENT} (got {})", cs_quote(&value))),
        }
        i += 1;
    }
    Ok((filtered, parsed))
}

#[cfg(not(feature = "conformance"))]
pub fn parse_conformance_arguments(
    args: &[String],
) -> Result<(Vec<String>, ConformanceArguments), String> {
    Ok((args.to_vec(), ConformanceArguments::default()))
}

#[cfg(feature = "conformance")]
pub fn apply_conformance(server: &Server, parsed: &ConformanceArguments) {
    if !parsed.origin.is_empty() {
        server.use_conformance_origin(&parsed.origin, parsed.port);
    }
    if parsed.journal {
        server.use_conformance_journal();
    }
}

#[cfg(not(feature = "conformance"))]
pub fn apply_conformance(_server: &Server, _parsed: &ConformanceArguments) {}
