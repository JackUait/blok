//! Options and their validation: BlokServerOptions.

use std::collections::BTreeMap;
use std::fmt;
use std::net::IpAddr;
use std::path::{MAIN_SEPARATOR, MAIN_SEPARATOR_STR};
use std::sync::Arc;
use std::time::SystemTime;

use blok_auth::Authorization;
use blok_dotnet::{equals_ordinal_ignore_case, is_any, is_loopback, parse_absolute_uri, parse_ip};

use crate::log::Logger;

/// The shortest ticket secret, in UTF-16 code units.
pub const MINIMUM_SECRET_LENGTH: usize = 32;

/// .NET's Array.MaxLength: the by-url path buffers the fetched body in one
/// array.
const MAX_REMOTE_UPLOAD: i64 = 2_147_483_591;

pub type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

/// Configures the server. Field meanings and refusals follow the C#
/// BlokServerOptions; `Default` gives its defaults. Counts are signed so a
/// negative value reaches validation, as in C#.
#[derive(Clone)]
pub struct Options {
    pub version: String,
    pub listen_address: String,
    pub auth: String,
    pub secret: String,
    pub allowed_origins: Vec<String>,

    pub storage_directory: String,
    pub public_url: String,
    pub max_upload_bytes: i64,
    /// Requests a minute per caller; 0 is off.
    pub rate_limit_per_minute: i64,

    /// Opens GET /unfurl, GET /frame-check and POST /upload-by-url. All
    /// three make the server fetch a URL the caller chose, so the default
    /// keeps them closed, like C#'s UnfurlDisabled = true.
    pub unfurl_enabled: bool,

    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_bucket_url: String,
    pub s3_addressing: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,

    pub collab_enabled: bool,
    pub doc_endpoint: String,
    pub doc_endpoint_auth: String,
    pub collab_directory: String,
    pub collab_s3_prefix: String,
    pub collab_journal: bool,

    pub collab_max_connections_per_user_per_doc: i64,
    pub collab_max_connections: i64,
    pub collab_max_message_bytes: i64,
    /// Nanoseconds; a TimeSpan may be negative, std's Duration may not.
    pub collab_keep_alive_interval_nanos: i64,
    pub collab_inbound_frames_per_second: i64,
    pub collab_inbound_burst_frames: i64,
    pub collab_inbound_resyncs_per_minute: i64,
    pub collab_inbound_awareness_bytes_per_second: i64,

    /// Custom tools' rich text fields by block type.
    pub rich_text_fields: BTreeMap<String, Vec<String>>,

    /// Narrows document access. None allows what the ticket allows.
    pub authorization: Option<Arc<dyn Authorization>>,

    /// The TimeProvider override: tickets and the rate limit window read
    /// it. None is the system clock.
    pub clock: Option<Clock>,

    /// Receives the server's warnings, each with a category
    /// ([`crate::COLLAB_LOG_CATEGORY`] for the rooms). None discards them.
    pub logger: Option<Arc<dyn Logger>>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            version: "dev".into(),
            listen_address: "127.0.0.1:4000".into(),
            auth: "none".into(),
            secret: String::new(),
            allowed_origins: Vec::new(),
            storage_directory: String::new(),
            public_url: String::new(),
            max_upload_bytes: 32 << 20,
            rate_limit_per_minute: 0,
            unfurl_enabled: false,
            s3_endpoint: String::new(),
            s3_region: String::new(),
            s3_bucket: String::new(),
            s3_bucket_url: String::new(),
            s3_addressing: String::new(),
            s3_access_key: String::new(),
            s3_secret_key: String::new(),
            collab_enabled: false,
            doc_endpoint: String::new(),
            doc_endpoint_auth: String::new(),
            collab_directory: String::new(),
            collab_s3_prefix: String::new(),
            collab_journal: false,
            collab_max_connections_per_user_per_doc: 8,
            collab_max_connections: 0,
            collab_max_message_bytes: 1 << 20,
            collab_keep_alive_interval_nanos: 15_000_000_000,
            collab_inbound_frames_per_second: 50,
            collab_inbound_burst_frames: 100,
            collab_inbound_resyncs_per_minute: 60,
            collab_inbound_awareness_bytes_per_second: 128 << 10,
            rich_text_fields: BTreeMap::new(),
            authorization: None,
            clock: None,
            logger: None,
        }
    }
}

impl fmt::Debug for Options {
    // Every field but the secrets and the trait objects, whose presence is
    // shown instead.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Options")
            .field("version", &self.version)
            .field("listen_address", &self.listen_address)
            .field("auth", &self.auth)
            .field("secret_set", &!self.secret.is_empty())
            .field("allowed_origins", &self.allowed_origins)
            .field("storage_directory", &self.storage_directory)
            .field("public_url", &self.public_url)
            .field("max_upload_bytes", &self.max_upload_bytes)
            .field("rate_limit_per_minute", &self.rate_limit_per_minute)
            .field("unfurl_enabled", &self.unfurl_enabled)
            .field("s3_endpoint", &self.s3_endpoint)
            .field("s3_region", &self.s3_region)
            .field("s3_bucket", &self.s3_bucket)
            .field("s3_bucket_url", &self.s3_bucket_url)
            .field("s3_addressing", &self.s3_addressing)
            .field(
                "s3_keys_set",
                &(
                    !self.s3_access_key.is_empty(),
                    !self.s3_secret_key.is_empty(),
                ),
            )
            .field("collab_enabled", &self.collab_enabled)
            .field("doc_endpoint", &self.doc_endpoint)
            .field("doc_endpoint_auth_set", &!self.doc_endpoint_auth.is_empty())
            .field("collab_directory", &self.collab_directory)
            .field("collab_s3_prefix", &self.collab_s3_prefix)
            .field("collab_journal", &self.collab_journal)
            .field(
                "collab_max_connections_per_user_per_doc",
                &self.collab_max_connections_per_user_per_doc,
            )
            .field("collab_max_connections", &self.collab_max_connections)
            .field("collab_max_message_bytes", &self.collab_max_message_bytes)
            .field(
                "collab_keep_alive_interval_nanos",
                &self.collab_keep_alive_interval_nanos,
            )
            .field(
                "collab_inbound_frames_per_second",
                &self.collab_inbound_frames_per_second,
            )
            .field(
                "collab_inbound_burst_frames",
                &self.collab_inbound_burst_frames,
            )
            .field(
                "collab_inbound_resyncs_per_minute",
                &self.collab_inbound_resyncs_per_minute,
            )
            .field(
                "collab_inbound_awareness_bytes_per_second",
                &self.collab_inbound_awareness_bytes_per_second,
            )
            .field("rich_text_fields", &self.rich_text_fields)
            .field("authorization", &self.authorization.is_some())
            .field("clock", &self.clock.is_some())
            .field("logger", &self.logger.is_some())
            .finish()
    }
}

/// A refusal, with BlokServerOptions.Validate's text byte for byte.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionsError(pub String);

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for OptionsError {}

type Checked<T> = Result<T, OptionsError>;

fn fail<T>(message: String) -> Checked<T> {
    Err(OptionsError(message))
}

impl Options {
    pub(crate) fn has_storage(&self) -> bool {
        !self.storage_directory.is_empty() || !self.s3_bucket.is_empty()
    }

    /// Refuses options that do not work together.
    pub fn validate(&self) -> Checked<()> {
        self.validate_path().map(|_| ())
    }

    /// Also returns the public path local files are served under.
    pub(crate) fn validate_path(&self) -> Checked<String> {
        let listen = &self.listen_address;
        if self.auth == "none" && !is_loopback_listen(listen) {
            return fail(format!(
                "--auth none serves anyone who can reach {}{}; it may only bind loopback — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service",
                quote(listen),
                bind_scope(listen)
            ));
        }
        if self.auth == "proxy" && !is_loopback_listen(listen) {
            return fail(format!(
                "--auth proxy trusts every caller, so it may only bind loopback, not {}{} — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service",
                quote(listen),
                bind_scope(listen)
            ));
        }
        if self.auth == "ticket" && utf16_length(&self.secret) < MINIMUM_SECRET_LENGTH {
            return fail(format!(
                "--secret must be at least {MINIMUM_SECRET_LENGTH} characters (got {})",
                utf16_length(&self.secret)
            ));
        }
        if self.auth == "ticket" && self.allowed_origins.is_empty() {
            return fail("a public service needs --allow-origin: without it anyone who finds this address can drive requests at third-party sites from your IP".into());
        }
        if self.auth != "none" && self.auth != "proxy" && self.auth != "ticket" {
            return fail(format!(
                "--auth must be none, proxy, or ticket (got {})",
                quote(&self.auth)
            ));
        }
        validate_listen(listen)?;
        if self.max_upload_bytes <= 0 {
            return fail(format!(
                "--max-upload must be a positive number of bytes (got {}): a zero cap refuses every upload",
                self.max_upload_bytes
            ));
        }
        if self.has_storage() && self.unfurl_enabled && self.max_upload_bytes > MAX_REMOTE_UPLOAD {
            return fail(format!(
                "--max-upload must be no greater than {MAX_REMOTE_UPLOAD} bytes when remote URL upload is enabled (got {})",
                self.max_upload_bytes
            ));
        }
        if self.rate_limit_per_minute < 0 {
            return fail(format!(
                "--rate-limit must be zero or greater (got {})",
                self.rate_limit_per_minute
            ));
        }
        self.validate_collab()?;
        let mut public_path = String::new();
        if !self.storage_directory.is_empty() && self.s3_bucket.is_empty() {
            public_path = self.local_public_path()?;
        }
        if self.s3_bucket.is_empty() {
            return Ok(public_path);
        }
        if self.s3_endpoint.is_empty() {
            return fail(
                "--s3-bucket needs --s3-endpoint, e.g. https://s3.eu-central-1.amazonaws.com"
                    .into(),
            );
        }
        let endpoint = parse_absolute_uri(&self.s3_endpoint);
        let Some(endpoint) = endpoint.filter(|e| {
            e.is_http()
                && !e.host.is_empty()
                && e.user_info.is_empty()
                && e.query.is_empty()
                && e.fragment.is_empty()
                && e.absolute_path.trim_matches('/').is_empty()
        }) else {
            return fail(format!(
                "--s3-endpoint must be a full HTTP(S) origin without credentials, a path, a query or a fragment (got {})",
                quote(&self.s3_endpoint)
            ));
        };
        if endpoint.scheme == "http" && !endpoint.loopback {
            return fail(format!(
                "--s3-endpoint must use HTTPS unless it targets loopback for local development (got {})",
                quote(&self.s3_endpoint)
            ));
        }
        if self.s3_region.is_empty() {
            return fail("--s3-bucket needs --s3-region: an empty region is signed into every request and fails only at the first upload".into());
        }
        if self.s3_bucket_url.is_empty() {
            return fail("--s3-bucket needs --s3-bucket-url: it is the prefix stored URLs are built from, and the only prefix a delete is recognised under".into());
        }
        if self.s3_bucket_url.contains(['?', '#']) {
            return fail(format!(
                "--s3-bucket-url must not contain a query or fragment (got {})",
                quote(&self.s3_bucket_url)
            ));
        }
        if has_malformed_percent_escape(&self.s3_bucket_url)
            || parse_http_url(&self.s3_bucket_url).is_none()
        {
            return fail(format!(
                "--s3-bucket-url must be a full HTTP(S) URL (got {})",
                quote(&self.s3_bucket_url)
            ));
        }
        if self.s3_access_key.is_empty() || self.s3_secret_key.is_empty() {
            return fail("--s3-bucket needs credentials in the BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY environment variables (they are deliberately not flags: a flag lands in this machine's process list)".into());
        }
        if !self.s3_addressing.is_empty()
            && self.s3_addressing != "path"
            && self.s3_addressing != "virtual"
        {
            return fail(format!(
                "--s3-addressing must be \"path\" or \"virtual\", or empty to choose automatically (got {})",
                quote(&self.s3_addressing)
            ));
        }
        Ok(public_path)
    }

    fn validate_collab(&self) -> Checked<()> {
        if self.collab_max_connections_per_user_per_doc <= 0 {
            return fail(format!(
                "CollabMaxConnectionsPerUserPerDoc must be a positive number (got {}): a zero cap refuses every sync connection",
                self.collab_max_connections_per_user_per_doc
            ));
        }
        if self.collab_max_connections < 0 {
            return fail(format!(
                "CollabMaxConnections must be zero (no ceiling) or greater (got {})",
                self.collab_max_connections
            ));
        }
        if self.collab_max_message_bytes <= 0 {
            return fail(format!(
                "CollabMaxMessageBytes must be a positive number of bytes (got {}): a zero cap closes every sync connection on its first frame",
                self.collab_max_message_bytes
            ));
        }
        if self.collab_keep_alive_interval_nanos < 0 {
            return fail(format!(
                "CollabKeepAliveInterval must be zero (off) or greater (got {})",
                format_time_span(self.collab_keep_alive_interval_nanos)
            ));
        }
        if self.collab_inbound_frames_per_second < 0 {
            return fail(format!(
                "CollabInboundFramesPerSecond must be zero (off) or greater (got {})",
                self.collab_inbound_frames_per_second
            ));
        }
        if self.collab_inbound_burst_frames <= 0 {
            return fail(format!(
                "CollabInboundBurstFrames must be a positive number of frames (got {}): a zero burst closes every connection on its first frame",
                self.collab_inbound_burst_frames
            ));
        }
        if let Err(message) = check_rich_text_fields(&self.rich_text_fields) {
            return fail(format!("RichTextFields: {message}"));
        }
        if self.collab_inbound_resyncs_per_minute < 0 {
            return fail(format!(
                "CollabInboundResyncsPerMinute must be zero (off) or greater (got {})",
                self.collab_inbound_resyncs_per_minute
            ));
        }
        if self.collab_inbound_awareness_bytes_per_second < 0 {
            return fail(format!(
                "CollabInboundAwarenessBytesPerSecond must be zero (off) or greater (got {})",
                self.collab_inbound_awareness_bytes_per_second
            ));
        }
        if !self.collab_enabled {
            if !self.doc_endpoint.is_empty() {
                return fail("--doc-endpoint needs --collab: without it no sync room ever runs and the endpoint would be silently ignored".into());
            }
            if !self.collab_s3_prefix.is_empty() {
                return fail("--collab-s3-prefix needs --collab: without it no working set is ever written and the prefix would be silently ignored".into());
            }
            if self.collab_journal {
                return fail("--collab-journal needs --collab: without it no sync room ever runs and the journal would be silently ignored".into());
            }
            return Ok(());
        }
        if self.collab_journal && !self.collab_s3_prefix.is_empty() {
            return fail("--collab-journal cannot be used with --collab-s3-prefix: the journal is kept on this machine's disk, so a second instance sharing the bucket would not see it and would accept edits the journal never holds".into());
        }
        if self.doc_endpoint.is_empty() {
            return fail("--collab needs --doc-endpoint: sync rooms seed documents from it and export them back to it, e.g. https://app.example.com/api/blok-docs".into());
        }
        let Some(endpoint) = parse_absolute_uri(&self.doc_endpoint).filter(|e| {
            e.is_http()
                && !e.host.is_empty()
                && e.user_info.is_empty()
                && e.query.is_empty()
                && e.fragment.is_empty()
        }) else {
            return fail(format!(
                "--doc-endpoint must be a full HTTP(S) URL without credentials, a query or a fragment (got {})",
                quote(&self.doc_endpoint)
            ));
        };
        if endpoint.scheme == "http" && !endpoint.loopback {
            return fail(format!(
                "--doc-endpoint must use HTTPS unless it targets loopback for local development (got {})",
                quote(&self.doc_endpoint)
            ));
        }
        if self.doc_endpoint_auth.contains(['\r', '\n']) {
            return fail("--doc-endpoint-auth must not contain a line break (a trailing newline from `echo` or a file is the usual cause): the header would be silently dropped from every doc-endpoint request".into());
        }
        if !self.collab_s3_prefix.is_empty() && self.s3_bucket.is_empty() {
            return fail("--collab-s3-prefix needs --s3-bucket: the collaboration working set can only live in the bucket this server is configured for".into());
        }
        if self.collab_directory.is_empty() || self.storage_directory.is_empty() {
            return Ok(());
        }
        let collab_path = trim_ending_separator(&full_path(&self.collab_directory));
        let storage_path = trim_ending_separator(&full_path(&self.storage_directory));
        // Lexical only, like C#: symlinks can still alias the two.
        if collab_path == storage_path
            || collab_path.starts_with(&format!("{storage_path}{MAIN_SEPARATOR}"))
        {
            return fail(format!(
                "--collab-dir must not resolve inside --storage-dir ({} is under {}): uploaded files are served publicly and the collaboration working set would be downloadable by anyone",
                quote(&self.collab_directory),
                quote(&self.storage_directory)
            ));
        }
        Ok(())
    }

    fn local_public_path(&self) -> Checked<String> {
        let url = &self.public_url;
        if url.contains(['?', '#']) {
            return fail(format!(
                "PublicUrl must not contain a query or fragment (got {})",
                quote(url)
            ));
        }
        let malformed = || {
            fail(format!(
                "PublicUrl must be an HTTP(S) URL or a root-relative path (got {})",
                quote(url)
            ))
        };
        if url.is_empty() || has_malformed_percent_escape(url) {
            return malformed();
        }
        if let Some(absolute) = parse_http_url(url) {
            return Ok(absolute.absolute_path.trim_end_matches('/').to_owned());
        }
        if !url.starts_with('/') || url.starts_with("//") || url.contains('\\') {
            return malformed();
        }
        if url == "/" {
            return Ok("/".into());
        }
        Ok(url.trim_end_matches('/').to_owned())
    }
}

/// Path.GetFullPath: absolute and lexically cleaned, keeping a trailing
/// separator. Never canonicalize: C# does not resolve symlinks here.
fn full_path(path: &str) -> String {
    let trailing = path.ends_with(MAIN_SEPARATOR);
    let joined = if path.starts_with(MAIN_SEPARATOR) {
        path.to_owned()
    } else {
        let wd = std::env::current_dir().unwrap_or_default();
        format!("{}{MAIN_SEPARATOR}{path}", wd.display())
    };
    let mut cleaned = clean(&joined);
    if trailing && cleaned != MAIN_SEPARATOR_STR {
        cleaned.push(MAIN_SEPARATOR);
    }
    cleaned
}

/// filepath.Clean for an absolute path.
fn clean(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for part in path.split(MAIN_SEPARATOR) {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            _ => out.push(part),
        }
    }
    format!("{MAIN_SEPARATOR}{}", out.join(MAIN_SEPARATOR_STR))
}

fn trim_ending_separator(path: &str) -> String {
    if path.len() > 1 && path.ends_with(MAIN_SEPARATOR) {
        return path[..path.len() - 1].to_owned();
    }
    path.to_owned()
}

fn check_rich_text_fields(fields: &BTreeMap<String, Vec<String>>) -> Result<(), String> {
    let check = |name: &str, what: &str| {
        if name.is_empty() || name.contains('\0') {
            return Err(format!(
                "rich text fields: a {what} name is empty or holds a NUL."
            ));
        }
        Ok(())
    };
    // BTreeMap iterates in byte order, as Go's sort.Strings.
    for (block, names) in fields {
        check(block, "block type")?;
        for field in names {
            check(field, &format!("field of {}", quote(block)))?;
        }
    }
    Ok(())
}

fn parse_http_url(value: &str) -> Option<blok_dotnet::Uri> {
    parse_absolute_uri(value)
        .filter(|u| u.is_http() && !u.host.is_empty() && u.user_info.is_empty())
}

pub(crate) fn has_malformed_percent_escape(value: &str) -> bool {
    let b = value.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() || !b[i + 1].is_ascii_hexdigit() || !b[i + 2].is_ascii_hexdigit() {
                return true;
            }
            i += 2;
        }
        i += 1;
    }
    false
}

fn validate_listen(listen: &str) -> Checked<()> {
    let missing_port = || {
        fail(format!(
            "listen tcp: address {listen}: missing port in address"
        ))
    };
    let port;
    if listen.starts_with('[') {
        match listen.find(']') {
            Some(bracket) if listen.as_bytes().get(bracket + 1) == Some(&b':') => {
                port = &listen[bracket + 2..];
            }
            _ => return missing_port(),
        }
    } else {
        let (Some(first), Some(last)) = (listen.find(':'), listen.rfind(':')) else {
            return missing_port();
        };
        if first != last {
            return fail(format!(
                "listen tcp: address {listen}: too many colons in address"
            ));
        }
        port = &listen[last + 1..];
    }
    if port.is_empty() {
        return missing_port();
    }
    if !is_port(port) {
        return fail(format!("listen tcp: address {port}: invalid port"));
    }
    let host = listen_host(listen);
    if !host.is_empty()
        && host != "*"
        && host != "+"
        && !equals_ordinal_ignore_case(host.as_bytes(), b"localhost")
        && parse_ip(&host).is_none()
    {
        return fail(format!(
            "listen tcp: DNS host {} would bind every network interface; use an IP address, localhost, or an explicit wildcard",
            quote(&host)
        ));
    }
    Ok(())
}

/// uint.TryParse with NumberStyles.None and a 65535 ceiling.
fn is_port(port: &str) -> bool {
    let mut value: u64 = 0;
    for c in port.bytes() {
        if !c.is_ascii_digit() {
            return false;
        }
        value = value * 10 + u64::from(c - b'0');
        if value > 65535 {
            return false;
        }
    }
    true
}

fn is_loopback_listen(listen: &str) -> bool {
    let host = listen_host(listen);
    if host.is_empty() {
        return false;
    }
    if equals_ordinal_ignore_case(host.as_bytes(), b"localhost") {
        return true;
    }
    match parse_ip(&host) {
        Some(address) => {
            is_loopback(address)
                || matches!(address, IpAddr::V6(v6) if v6.to_ipv4_mapped().is_some_and(|v4| is_loopback(IpAddr::V4(v4))))
        }
        None => false,
    }
}

fn bind_scope(listen: &str) -> &'static str {
    let host = listen_host(listen);
    if host.is_empty() {
        return " (an address with no host binds every network interface)";
    }
    if parse_ip(&host).is_some_and(is_any) {
        return " (which binds every network interface)";
    }
    ""
}

pub(crate) fn listen_host(listen: &str) -> String {
    if listen.starts_with('[')
        && let Some(bracket) = listen.find(']')
    {
        return listen[1..bracket].to_owned();
    }
    match (listen.find(':'), listen.rfind(':')) {
        (Some(first), Some(last)) if first == last => listen[..first].to_owned(),
        _ => listen.trim_matches(['[', ']']).to_lowercase(),
    }
}

fn utf16_length(s: &str) -> usize {
    s.encode_utf16().count()
}

/// C#'s "\"{value}\"": no escaping inside.
pub(crate) fn quote(s: &str) -> String {
    format!("\"{s}\"")
}

/// TimeSpan.ToString() for a span in nanoseconds:
/// [-][d.]hh:mm:ss[.fffffff].
pub fn format_time_span(nanos: i64) -> String {
    let (sign, magnitude) = if nanos < 0 {
        ("-", nanos.unsigned_abs())
    } else {
        ("", nanos.unsigned_abs())
    };
    let ticks = magnitude / 100;
    let days = ticks / 864_000_000_000;
    let rest = ticks % 864_000_000_000;
    let mut text = sign.to_owned();
    if days > 0 {
        text.push_str(&format!("{days}."));
    }
    text.push_str(&format!(
        "{:02}:{:02}:{:02}",
        rest / 36_000_000_000,
        rest / 600_000_000 % 60,
        rest / 10_000_000 % 60
    ));
    let fraction = rest % 10_000_000;
    if fraction != 0 {
        text.push_str(&format!(".{fraction:07}"));
    }
    text
}

#[cfg(test)]
#[path = "options_test.rs"]
mod tests;
