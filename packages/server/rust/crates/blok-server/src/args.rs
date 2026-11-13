//! The host's flags: a hand port of HostArguments.Parse.

use std::collections::BTreeMap;

use blok_blokserver::Options;
use blok_dotnet::{is_any, parse_ip};
use blok_jsjson::{Kind, Options as JsonOptions, parse_node, to_string_lossy};

/// A byte copy of HostArguments.Usage in the C# host.
pub const USAGE: &str = include_str!("usage.txt");

const DEFAULT_TICKET_RATE_LIMIT: i64 = 60;

/// HostParseResult in the C# host.
#[derive(Debug, Default)]
pub struct HostArguments {
    pub options: Options,
    pub help: bool,
    pub err: String,
    pub secret_from_flag: bool,
    pub doc_endpoint_auth_from_flag: bool,
}

fn failed(message: String) -> HostArguments {
    HostArguments {
        err: message,
        ..HostArguments::default()
    }
}

/// HostArguments.Parse. Not a general flag parser: the error texts, "---x",
/// and an explicit empty secret winning over BLOK_SECRET all follow C#.
pub fn parse_host_arguments(args: &[String], getenv: &dyn Fn(&str) -> String) -> HostArguments {
    let mut options = Options {
        collab_directory: "./blok-collab".into(),
        storage_directory: "./blok-uploads".into(),
        unfurl_enabled: true,
        ..Options::default()
    };
    let (mut origins, mut public_url) = (String::new(), String::new());
    let mut rate_limit: Option<i64> = None;
    let mut result = HostArguments::default();
    let (mut journal_from_flag, mut rich_text_from_flag) = (false, false);

    let mut index = 0;
    while index < args.len() {
        let argument = &args[index];
        if argument == "--" || argument.len() < 2 || !argument.starts_with('-') {
            break;
        }
        let name_and_value = argument.strip_prefix("--").unwrap_or(&argument[1..]);
        let (name, inline) = match name_and_value.split_once('=') {
            Some((name, value)) => (name, Some(value)),
            None => (name_and_value, None),
        };
        match name {
            "h" | "help" => {
                return HostArguments {
                    help: true,
                    ..HostArguments::default()
                };
            }
            "no-unfurl" | "collab" | "collab-journal" | "file-bytes" | "files-cors" => {
                let value = match inline {
                    Some(text) => match parse_bool(text) {
                        Some(value) => value,
                        None => {
                            return failed(format!(
                                "invalid value {} for flag -{name}: parse error",
                                cs_quote(text)
                            ));
                        }
                    },
                    None => true,
                };
                match name {
                    "no-unfurl" => options.unfurl_enabled = !value,
                    "collab" => options.collab_enabled = value,
                    "file-bytes" => options.file_bytes_enabled = value,
                    "files-cors" => options.files_cors = value,
                    _ => {
                        options.collab_journal = value;
                        journal_from_flag = true;
                    }
                }
                index += 1;
                continue;
            }
            _ => {}
        }
        if !is_value_flag(name) {
            return failed(format!("flag provided but not defined: -{name}"));
        }
        let value = match inline {
            Some(value) => value.to_owned(),
            None => {
                if index + 1 >= args.len() {
                    return failed(format!("flag needs an argument: -{name}"));
                }
                index += 1;
                args[index].clone()
            }
        };
        let invalid = || {
            failed(format!(
                "invalid value {} for flag -{name}: parse error",
                cs_quote(&value)
            ))
        };
        match name {
            "listen" => options.listen_address = value.clone(),
            "auth" => options.auth = value.clone(),
            "secret" => {
                options.secret = value.clone();
                result.secret_from_flag = true;
            }
            "allow-origin" => origins = value.clone(),
            "storage-dir" => options.storage_directory = value.clone(),
            "public-url" => public_url = value.clone(),
            "max-upload" => match parse_base_zero_int64(&value) {
                Some(parsed) => options.max_upload_bytes = parsed,
                None => return invalid(),
            },
            "rate-limit" => match parse_base_zero_int64(&value) {
                Some(parsed) => rate_limit = Some(parsed),
                None => return invalid(),
            },
            "file-bytes-max-bytes" => match parse_base_zero_int64(&value) {
                Some(parsed) => options.file_bytes_max_bytes = parsed,
                None => return invalid(),
            },
            "s3-endpoint" => options.s3_endpoint = value.clone(),
            "s3-region" => options.s3_region = value.clone(),
            "s3-bucket" => options.s3_bucket = value.clone(),
            "s3-bucket-url" => options.s3_bucket_url = value.clone(),
            "s3-addressing" => options.s3_addressing = value.clone(),
            "doc-endpoint" => options.doc_endpoint = value.clone(),
            "doc-endpoint-auth" => {
                options.doc_endpoint_auth = value.clone();
                result.doc_endpoint_auth_from_flag = true;
            }
            "collab-dir" => options.collab_directory = value.clone(),
            "collab-s3-prefix" => options.collab_s3_prefix = value.clone(),
            "rich-text-fields" => match parse_rich_text_fields(&value) {
                Some(fields) => {
                    options.rich_text_fields = fields;
                    rich_text_from_flag = true;
                }
                None => return invalid(),
            },
            _ => {}
        }
        index += 1;
    }

    options.allowed_origins = split_origins(&origins);
    options.public_url = if public_url.is_empty() {
        default_public_url(&options.listen_address)
    } else {
        public_url
    };
    match rate_limit {
        Some(limit) => options.rate_limit_per_minute = limit,
        None if options.auth == "ticket" => {
            options.rate_limit_per_minute = DEFAULT_TICKET_RATE_LIMIT
        }
        None => {}
    }
    if !result.secret_from_flag {
        options.secret = getenv("BLOK_SECRET");
    }
    if !result.doc_endpoint_auth_from_flag {
        options.doc_endpoint_auth = getenv("BLOK_DOC_ENDPOINT_AUTH");
    }
    let variable = getenv("BLOK_COLLAB_JOURNAL");
    if !journal_from_flag && !variable.is_empty() {
        match parse_bool(&variable) {
            Some(journal) => options.collab_journal = journal,
            None => {
                return failed(format!(
                    "invalid value {} for BLOK_COLLAB_JOURNAL: parse error",
                    cs_quote(&variable)
                ));
            }
        }
    }
    let variable = getenv("BLOK_RICH_TEXT_FIELDS");
    if !rich_text_from_flag && !variable.is_empty() {
        match parse_rich_text_fields(&variable) {
            Some(fields) => options.rich_text_fields = fields,
            None => {
                return failed(format!(
                    "invalid value {} for BLOK_RICH_TEXT_FIELDS: parse error",
                    cs_quote(&variable)
                ));
            }
        }
    }
    options.s3_access_key = getenv("BLOK_S3_ACCESS_KEY");
    options.s3_secret_key = getenv("BLOK_S3_SECRET_KEY");
    result.options = options;
    result
}

/// C#'s "\"{value}\"": no escaping inside.
pub fn cs_quote(s: &str) -> String {
    format!("\"{s}\"")
}

fn is_value_flag(name: &str) -> bool {
    matches!(
        name,
        "listen"
            | "auth"
            | "secret"
            | "allow-origin"
            | "storage-dir"
            | "public-url"
            | "max-upload"
            | "rate-limit"
            | "file-bytes-max-bytes"
            | "s3-endpoint"
            | "s3-region"
            | "s3-bucket"
            | "s3-bucket-url"
            | "s3-addressing"
            | "doc-endpoint"
            | "doc-endpoint-auth"
            | "collab-dir"
            | "collab-s3-prefix"
            | "rich-text-fields"
    )
}

/// Go's strconv.ParseBool set, which the C# host copies.
fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "1" | "t" | "T" | "TRUE" | "true" | "True" => Some(true),
        "0" | "f" | "F" | "FALSE" | "false" | "False" => Some(false),
        _ => None,
    }
}

/// TryParseBaseZeroInt64: strconv.ParseInt(s, 0, 64)'s grammar, written
/// out so its refusals match the C# host's.
pub fn parse_base_zero_int64(value: &str) -> Option<i64> {
    let b = value.as_bytes();
    if b.is_empty() {
        return None;
    }
    let mut index = 0;
    let mut negative = false;
    if b[0] == b'+' || b[0] == b'-' {
        negative = b[0] == b'-';
        index += 1;
        if index == b.len() {
            return None;
        }
    }
    let (mut base, mut explicit_prefix) = (10u64, false);
    if b[index] == b'0' {
        base = 8;
        if let Some(&next) = b.get(index + 1) {
            match next {
                b'b' | b'B' => (base, explicit_prefix) = (2, true),
                b'o' | b'O' => (base, explicit_prefix) = (8, true),
                b'x' | b'X' => (base, explicit_prefix) = (16, true),
                _ => {}
            }
            if explicit_prefix {
                index += 2;
            }
        }
    }
    let digits_start = index;
    let (mut digit_seen, mut previous_underscore) = (false, false);
    let limit: u64 = if negative { 1 << 63 } else { (1 << 63) - 1 };
    let mut magnitude: u64 = 0;
    while index < b.len() {
        let c = b[index];
        if c == b'_' {
            let follows_prefix = explicit_prefix && !digit_seen && index == digits_start;
            let next = b.get(index + 1).and_then(|&n| digit(n));
            if (!digit_seen && !follows_prefix)
                || previous_underscore
                || next.is_none_or(|n| n >= base)
            {
                return None;
            }
            previous_underscore = true;
            index += 1;
            continue;
        }
        let d = digit(c).filter(|&d| d < base)?;
        if magnitude > (limit - d) / base {
            return None;
        }
        magnitude = magnitude * base + d;
        digit_seen = true;
        previous_underscore = false;
        index += 1;
    }
    if !digit_seen {
        return None;
    }
    // 1 << 63 negated wraps to i64::MIN, which is the value meant.
    Some(if negative {
        (magnitude as i64).wrapping_neg()
    } else {
        magnitude as i64
    })
}

fn digit(c: u8) -> Option<u64> {
    match c {
        b'0'..=b'9' => Some(u64::from(c - b'0')),
        b'a'..=b'z' => Some(u64::from(c - b'a') + 10),
        b'A'..=b'Z' => Some(u64::from(c - b'A') + 10),
        _ => None,
    }
}

/// TryParseRichTextFields: a JSON object of string lists. A repeated key is
/// refused, as JsonNode refuses it.
fn parse_rich_text_fields(value: &str) -> Option<BTreeMap<String, Vec<String>>> {
    let node = parse_node(
        value.as_bytes(),
        JsonOptions {
            refuse_duplicates: true,
            ..JsonOptions::default()
        },
    )
    .ok()?;
    if node.kind != Kind::Object {
        return None;
    }
    let mut fields = BTreeMap::new();
    for member in &node.members {
        let key = member.key().ok()?;
        if member.value.kind != Kind::Array {
            return None;
        }
        let mut list = Vec::new();
        for item in &member.value.items {
            if item.kind != Kind::String {
                return None;
            }
            list.push(to_string_lossy(item.text().ok()?.units()));
        }
        fields.insert(to_string_lossy(key.units()), list);
    }
    Some(fields)
}

fn split_origins(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_owned)
        .collect()
}

fn default_public_url(listen: &str) -> String {
    let (host, port) = split_listen_address(listen);
    let host =
        if host.is_empty() || host == "*" || host == "+" || parse_ip(host).is_some_and(is_any) {
            "127.0.0.1"
        } else {
            host
        };
    let mut authority = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_owned()
    };
    if !port.is_empty() {
        authority.push(':');
        authority.push_str(port);
    }
    format!("http://{authority}/files")
}

fn split_listen_address(listen: &str) -> (&str, &str) {
    if listen.starts_with('[')
        && let Some(bracket) = listen.find(']')
    {
        let port = if listen.as_bytes().get(bracket + 1) == Some(&b':') {
            &listen[bracket + 2..]
        } else {
            ""
        };
        return (&listen[1..bracket], port);
    }
    match (listen.find(':'), listen.rfind(':')) {
        (Some(first), Some(last)) if first == last => (&listen[..first], &listen[first + 1..]),
        _ => (listen.trim_matches(['[', ']']), ""),
    }
}
