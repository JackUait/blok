//! ConformanceArguments: two flags only the conformance build has. The
//! ordinary build passes args through, so the host parser refuses them.

use blok_blokserver::{Options, Server};

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
    /// CollabKeepAliveInterval in milliseconds, when set.
    pub keep_alive_ms: Option<i64>,
    /// CollabEnforceRestoreGuards.
    pub restore_guards: bool,
    /// CollabRestoreTrashesPages.
    pub restore_trashes_pages: bool,
    /// Record notes kept in memory.
    pub record_notes: bool,
    /// CollabStampAuthority.
    pub stamp_authority: bool,
    /// FileBytesEnabled, and file_bytes_max FileBytesMaxBytes when set.
    pub file_bytes: bool,
    pub file_bytes_max: Option<i64>,
    /// FilesCors.
    pub files_cors: bool,
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
        if argument == "--conformance-restore-guards" {
            parsed.restore_guards = true;
            i += 1;
            continue;
        }
        if argument == "--conformance-restore-trashes-pages" {
            parsed.restore_trashes_pages = true;
            i += 1;
            continue;
        }
        if argument == "--conformance-record-notes" {
            parsed.record_notes = true;
            i += 1;
            continue;
        }
        if argument == "--conformance-stamp-authority" {
            parsed.stamp_authority = true;
            i += 1;
            continue;
        }
        if argument == "--conformance-file-bytes" {
            parsed.file_bytes = true;
            i += 1;
            continue;
        }
        if argument == "--conformance-files-cors" {
            parsed.files_cors = true;
            i += 1;
            continue;
        }
        if let Some(text) = argument.strip_prefix("--conformance-file-bytes-max-bytes=") {
            match text.parse::<i64>() {
                Ok(bytes) if !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()) => {
                    parsed.file_bytes_max = Some(bytes);
                }
                _ => {
                    return Err(format!(
                        "--conformance-file-bytes-max-bytes must be a whole number of bytes (got {})",
                        cs_quote(text)
                    ));
                }
            }
            i += 1;
            continue;
        }
        if let Some(text) = argument.strip_prefix("--conformance-keep-alive-ms=") {
            match text.parse::<i64>() {
                Ok(ms) if !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()) => {
                    parsed.keep_alive_ms = Some(ms);
                }
                _ => {
                    return Err(format!(
                        "--conformance-keep-alive-ms must be a whole number of milliseconds (got {})",
                        cs_quote(text)
                    ));
                }
            }
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

/// Sets what the flags change before the server is built.
#[cfg(feature = "conformance")]
pub fn apply_conformance_options(options: &mut Options, parsed: &ConformanceArguments) {
    if let Some(ms) = parsed.keep_alive_ms {
        options.collab_keep_alive_interval_nanos = ms * 1_000_000;
    }
    options.collab_enforce_restore_guards = parsed.restore_guards;
    options.collab_restore_trashes_pages = parsed.restore_trashes_pages;
    options.collab_stamp_authority = parsed.stamp_authority;
    // Only when given, so the host's own --file-bytes flags stand.
    if parsed.file_bytes {
        options.file_bytes_enabled = true;
    }
    if parsed.files_cors {
        options.files_cors = true;
    }
    if let Some(bytes) = parsed.file_bytes_max {
        options.file_bytes_max_bytes = bytes;
    }
    if parsed.record_notes {
        options.collab_record_notes = Some(std::sync::Arc::new(
            blok_blokserver::MemoryRecordNotes::default(),
        ));
    }
}

#[cfg(not(feature = "conformance"))]
pub fn apply_conformance_options(_options: &mut Options, _parsed: &ConformanceArguments) {}

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

#[cfg(all(test, feature = "conformance"))]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn conformance_flags_open_file_bytes_and_files_cors() {
        let (rest, parsed) = parse_conformance_arguments(&strings(&[
            "--conformance-file-bytes",
            "--conformance-file-bytes-max-bytes=2048",
            "--conformance-files-cors",
            "--listen",
            "x",
        ]))
        .unwrap();
        assert_eq!(rest, ["--listen", "x"]);
        let mut options = Options::default();
        apply_conformance_options(&mut options, &parsed);
        assert!(options.file_bytes_enabled && options.files_cors);
        assert_eq!(options.file_bytes_max_bytes, 2048);
    }

    #[test]
    fn conformance_file_bytes_cap_must_be_a_number() {
        let failure =
            parse_conformance_arguments(&strings(&["--conformance-file-bytes-max-bytes=lots"]))
                .unwrap_err();
        assert_eq!(
            failure,
            r#"--conformance-file-bytes-max-bytes must be a whole number of bytes (got "lots")"#
        );
    }

    // Without the conformance flags, the host's own file-bytes flags stand.
    #[test]
    fn conformance_options_keep_the_host_file_bytes_flags() {
        let (_, parsed) = parse_conformance_arguments(&[]).unwrap();
        let mut options = Options {
            file_bytes_enabled: true,
            files_cors: true,
            file_bytes_max_bytes: 7,
            ..Options::default()
        };
        apply_conformance_options(&mut options, &parsed);
        assert!(options.file_bytes_enabled && options.files_cors);
        assert_eq!(options.file_bytes_max_bytes, 7);
    }
}
