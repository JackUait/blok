//! The collab server's client for the host's document endpoint (C#
//! DocEndpointClient): GET seeds a room, PUT exports it.

use std::fmt;
use std::future::Future;
use std::time::Duration;

use tokio::time::{Instant, timeout_at};

use blok_dotnet::{Uri, format_double, parse_absolute_uri};
use blok_jsjson::{Kind, Node, Options as JsonOptions, Str, Value, append_quoted, parse_node};
use blok_outbound::EnvironmentProxy;
use blok_outbound::operator::{OperatorClient, OperatorError, Request, RequestBody};
use blok_outbound::wire::Source;

/// Headers the endpoint reads and writes.
pub const VERSION_HEADER: &str = "Blok-Doc-Version";
pub const LINEAGE_HEADER: &str = "Blok-Doc-Lineage";
pub const SEQUENCE_HEADER: &str = "Blok-Doc-Sequence";

/// Caps an answer body.
pub const DEFAULT_MAX_RESPONSE_BYTES: u64 = 64 << 20;
const ERROR_BODY_PREFIX_BYTES: usize = 512;
/// YDocConverter.JsonMaxDepth, both ways.
pub const JSON_MAX_DEPTH: usize = 512;
/// SocketsHttpHandler.ConnectTimeout.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Options configure a Client. `endpoint` is the operator's URL, already parsed.
#[derive(Debug, Clone, Default)]
pub struct Options {
    pub endpoint: Uri,
    pub authorization: String,
    /// None means no timeout.
    pub request_timeout: Option<Duration>,
    /// 0 means DEFAULT_MAX_RESPONSE_BYTES.
    pub max_response_bytes: u64,
}

/// What a GET answered: the document (None for none) and its version.
#[derive(Debug, Clone, Default)]
pub struct Loaded {
    pub data: Option<Node>,
    pub version: Option<String>,
}

/// The lineage and committed sequence a PUT carries.
#[derive(Debug, Clone)]
pub struct Projection {
    pub lineage: String,
    pub server_sequence: u64,
}

#[derive(Debug)]
pub enum Error {
    /// C#'s DocEndpointException. `status_code` is 0 with no answer status.
    Endpoint { message: String, status_code: u16 },
    /// A doc id refused before sending (C# ArgumentException).
    Argument(String),
    /// The transport's own failure, passed through as C# lets
    /// HttpRequestException through.
    Transport(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Endpoint { message, .. }
            | Error::Argument(message)
            | Error::Transport(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for Error {}

fn endpoint_error(message: impl Into<String>) -> Error {
    Error::Endpoint {
        message: message.into(),
        status_code: 0,
    }
}

/// What a test transport sees of one request.
#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct Recorded {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[cfg(test)]
impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// How a test transport answers.
#[cfg(test)]
pub(crate) enum Fake {
    Answer {
        status: u16,
        body: Vec<u8>,
        /// Whether the answer declares its length.
        declared: bool,
    },
    Hang,
    ConnectTimeout,
}

#[cfg(test)]
pub(crate) type FakeTransport = std::sync::Arc<dyn Fn(&Recorded) -> Fake + Send + Sync>;

enum Transport {
    Operator(Box<OperatorClient>),
    #[cfg(test)]
    Fake(FakeTransport),
}

/// Reaches only the operator-configured endpoint, and follows no redirect.
/// C# also caps a pooled connection's life at 5 minutes so a DNS change is
/// picked up; this client pools nothing, so every request resolves afresh.
pub struct Client {
    options: Options,
    transport: Transport,
}

enum Answer {
    Wire(blok_outbound::wire::Body<tokio::io::BufReader<Box<dyn blok_outbound::operator::Stream>>>),
    #[cfg(test)]
    Canned(std::io::Cursor<Vec<u8>>),
}

impl Answer {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Answer::Wire(body) => body.read(buf).await,
            #[cfg(test)]
            Answer::Canned(cursor) => std::io::Read::read(cursor, buf),
        }
    }
}

impl Client {
    /// A client over a fresh transport with a 10 s connect timeout and the
    /// environment proxy, as SocketsHttpHandler's defaults give C#.
    pub fn new(options: Options) -> Client {
        Client::with_connect_timeout(options, CONNECT_TIMEOUT, EnvironmentProxy::from_env())
    }

    pub(crate) fn with_connect_timeout(
        mut options: Options,
        connect_timeout: Duration,
        proxy: Option<EnvironmentProxy>,
    ) -> Client {
        if options.max_response_bytes == 0 {
            options.max_response_bytes = DEFAULT_MAX_RESPONSE_BYTES;
        }
        let client = OperatorClient {
            connect_timeout,
            header_timeout: None,
            proxy,
            roots: None,
        };
        Client {
            options,
            transport: Transport::Operator(Box::new(client)),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_fake(mut options: Options, fake: FakeTransport) -> Client {
        if options.max_response_bytes == 0 {
            options.max_response_bytes = DEFAULT_MAX_RESPONSE_BYTES;
        }
        Client {
            options,
            transport: Transport::Fake(fake),
        }
    }

    /// GETs the document. The body may be bare OutputData, a {data,
    /// version} envelope (data may be null), or null.
    pub async fn load(&self, doc_id: &str) -> Result<Loaded, Error> {
        let url = self.url_for(doc_id)?;
        let headers = vec![("Accept".to_owned(), "application/json".to_owned())];
        let body = self.send("GET", &url, headers, None).await?;
        parse_loaded(&body)
    }

    /// PUTs the bare document and returns the version the endpoint answers
    /// with, if any.
    pub async fn save(
        &self,
        doc_id: &str,
        output_data: &Value,
        version: Option<&str>,
        projection: Option<&Projection>,
    ) -> Result<Option<String>, Error> {
        let url = self.url_for(doc_id)?;
        let body = serialize(output_data)?;
        let mut headers = vec![(
            "Content-Type".to_owned(),
            "application/json; charset=utf-8".to_owned(),
        )];
        if let Some(version) = version {
            // The endpoint's own answer: a CR or LF in it would start a header of its own.
            if !sendable(version) {
                return Err(endpoint_error(
                    "collab: the doc endpoint version cannot be sent as a header.",
                ));
            }
            headers.push((VERSION_HEADER.to_owned(), trimmed(version).to_owned()));
        }
        if let Some(projection) = projection {
            headers.push((LINEAGE_HEADER.to_owned(), projection.lineage.clone()));
            headers.push((
                SEQUENCE_HEADER.to_owned(),
                projection.server_sequence.to_string(),
            ));
        }
        let answer = self.send("PUT", &url, headers, Some(&body)).await?;
        Ok(parse_saved_version(&answer))
    }

    /// {endpoint}/{escaped id}, refused unless it is still exactly one
    /// segment after URI normalisation (which collapses "." and "..").
    fn url_for(&self, doc_id: &str) -> Result<Uri, Error> {
        if doc_id.is_empty() {
            return Err(Error::Argument(
                "The value cannot be an empty string. (Parameter 'docId')".to_owned(),
            ));
        }
        let raw = format!(
            "{}/{}",
            self.options.endpoint.absolute_uri.trim_end_matches('/'),
            escape_data_string(doc_id)
        );
        match parse_absolute_uri(&raw) {
            Some(parsed) if parsed.absolute_uri == raw => Ok(parsed),
            _ => Err(Error::Argument(format!(
                "collab: the document id \"{doc_id}\" does not address a single path segment. (Parameter 'docId')"
            ))),
        }
    }

    fn timed_out(&self, method: &str) -> Error {
        endpoint_error(format!(
            "collab: the doc endpoint {method} timed out after {}s.",
            seconds(self.options.request_timeout.unwrap_or_default())
        ))
    }

    async fn send(
        &self,
        method: &str,
        url: &Uri,
        mut headers: Vec<(String, String)>,
        body: Option<&[u8]>,
    ) -> Result<Vec<u8>, Error> {
        // Refused, not dropped: a stray newline from a shell-quoted secret
        // would otherwise send every request unauthenticated.
        let authorization = &self.options.authorization;
        if !authorization.is_empty() {
            if !sendable(authorization) {
                return Err(endpoint_error(
                    "collab: the doc endpoint Authorization value cannot be sent as a header (a stray newline?).",
                ));
            }
            headers.push((
                "Authorization".to_owned(),
                trimmed(authorization).to_owned(),
            ));
        }
        let deadline = match self.options.request_timeout {
            Some(limit) if !limit.is_zero() => Some(Instant::now() + limit),
            _ => None,
        };
        let (status, length, mut answer) = self
            .within(deadline, method, self.open(method, url, headers, body))
            .await?;
        // The status decides before any body is read: an error body is
        // never buffered, only its head goes into the message. Its read
        // shares the timeout, and running out ends only the prefix.
        if !(200..=299).contains(&status) {
            let prefix = read_error_prefix(&mut answer, deadline).await;
            return Err(Error::Endpoint {
                message: format!("collab: the doc endpoint {method} returned {status}{prefix}"),
                status_code: status,
            });
        }
        self.within(
            deadline,
            method,
            self.read_capped(&mut answer, length, method),
        )
        .await
    }

    async fn within<T>(
        &self,
        deadline: Option<Instant>,
        method: &str,
        work: impl Future<Output = Result<T, Error>>,
    ) -> Result<T, Error> {
        match deadline {
            Some(deadline) => timeout_at(deadline, work)
                .await
                .map_err(|_| self.timed_out(method))?,
            None => work.await,
        }
    }

    /// Sends the request and reads the head.
    async fn open(
        &self,
        method: &str,
        url: &Uri,
        headers: Vec<(String, String)>,
        body: Option<&[u8]>,
    ) -> Result<(u16, Option<u64>, Answer), Error> {
        match &self.transport {
            Transport::Operator(client) => {
                let request = Request {
                    method,
                    url,
                    host: &host_header(url),
                    headers,
                    body: body.map_or(RequestBody::None, RequestBody::Bytes),
                };
                match client.send(request).await {
                    Ok(response) => {
                        let length = response
                            .headers
                            .get("Content-Length")
                            .and_then(|v| std::str::from_utf8(v).ok()?.trim().parse::<u64>().ok());
                        Ok((response.status, length, Answer::Wire(response.body)))
                    }
                    // A connect or handshake timeout is an
                    // OperationCanceledException in C#, so it reads as
                    // timed out too.
                    Err(OperatorError::ConnectTimeout) => Err(self.timed_out(method)),
                    Err(err) => Err(Error::Transport(err.to_string())),
                }
            }
            #[cfg(test)]
            Transport::Fake(fake) => {
                let recorded = Recorded {
                    method: method.to_owned(),
                    url: url.absolute_uri.clone(),
                    headers,
                    body: body.unwrap_or_default().to_vec(),
                };
                match fake(&recorded) {
                    Fake::Answer {
                        status,
                        body,
                        declared,
                    } => {
                        let length = declared.then_some(body.len() as u64);
                        Ok((status, length, Answer::Canned(std::io::Cursor::new(body))))
                    }
                    Fake::Hang => std::future::pending().await,
                    Fake::ConnectTimeout => Err(self.timed_out(method)),
                }
            }
        }
    }

    async fn read_capped(
        &self,
        answer: &mut Answer,
        length: Option<u64>,
        method: &str,
    ) -> Result<Vec<u8>, Error> {
        let limit = self.options.max_response_bytes;
        let too_large = || {
            endpoint_error(format!(
                "collab: the doc endpoint {method} answer is too large (over {limit} bytes)."
            ))
        };
        if length.is_some_and(|l| l > limit) {
            return Err(too_large());
        }
        let mut buffer = Vec::new();
        let mut chunk = vec![0u8; 81920];
        loop {
            let n = answer
                .read(&mut chunk)
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            if n == 0 {
                return Ok(buffer);
            }
            if (buffer.len() + n) as u64 > limit {
                return Err(too_large());
            }
            buffer.extend_from_slice(&chunk[..n]);
        }
    }
}

fn host_header(url: &Uri) -> String {
    let default =
        url.scheme == "http" && url.port == 80 || url.scheme == "https" && url.port == 443;
    if default {
        url.host.clone()
    } else {
        format!("{}:{}", url.host, url.port)
    }
}

/// Uri.EscapeDataString: every UTF-8 byte outside the RFC 3986 unreserved
/// set as uppercase %XX.
fn escape_data_string(s: &str) -> String {
    let mut out = String::new();
    for &c in s.as_bytes() {
        if c.is_ascii_alphanumeric() || b"-._~".contains(&c) {
            out.push(char::from(c));
        } else {
            out.push_str(&format!("%{c:02X}"));
        }
    }
    out
}

/// TotalSeconds.ToString("0.###").
pub(crate) fn seconds(d: Duration) -> String {
    let text = format!("{:.3}", d.as_secs_f64());
    let text = text.trim_end_matches('0');
    text.trim_end_matches('.').to_owned()
}

/// The first 512 bytes, decoded, with whitespace runs folded to one space;
/// a read failure leaves what was read.
async fn read_error_prefix(answer: &mut Answer, deadline: Option<Instant>) -> String {
    let mut buffer = vec![0u8; ERROR_BODY_PREFIX_BYTES];
    let mut read = 0;
    while read < buffer.len() {
        let next = answer.read(&mut buffer[read..]);
        let next = match deadline {
            Some(deadline) => match timeout_at(deadline, next).await {
                Ok(next) => next,
                Err(_) => break,
            },
            None => next.await,
        };
        match next {
            Ok(0) | Err(_) => break,
            Ok(n) => read += n,
        }
    }
    let text = Str::from_utf8(&buffer[..read]).to_string();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        ".".to_owned()
    } else {
        format!(": {text}")
    }
}

fn read_json(body: &[u8]) -> Result<Node, blok_jsjson::Error> {
    parse_node(
        body,
        JsonOptions {
            max_depth: JSON_MAX_DEPTH,
            refuse_duplicates: true,
        },
    )
}

fn not_json() -> Error {
    endpoint_error("collab: the doc endpoint did not answer with JSON.")
}

fn member<'a>(object: &'a Node, key: &str) -> Result<Option<&'a Node>, Error> {
    let key = Str::from(key);
    for m in &object.members {
        if m.key().map_err(|_| not_json())? == key {
            return Ok(Some(&m.value));
        }
    }
    Ok(None)
}

fn parse_loaded(body: &[u8]) -> Result<Loaded, Error> {
    let root = read_json(body).map_err(|_| not_json())?;
    match root.kind {
        Kind::Null => return Ok(Loaded::default()),
        Kind::Object => {}
        _ => {
            return Err(endpoint_error(
                "collab: the doc endpoint answered with JSON that is not an object.",
            ));
        }
    }
    let Some(data) = member(&root, "data")? else {
        return Ok(Loaded {
            data: Some(root),
            version: None,
        });
    };
    let data = match data.kind {
        Kind::Null => None,
        Kind::Object => Some(data.clone()),
        _ => {
            return Err(endpoint_error(
                "collab: the doc endpoint envelope carries data that is not an object.",
            ));
        }
    };
    Ok(Loaded {
        data,
        version: version_of(&root)?,
    })
}

fn parse_saved_version(body: &[u8]) -> Option<String> {
    if body.is_empty() {
        return None;
    }
    let root = read_json(body).ok()?;
    if root.kind != Kind::Object {
        return None;
    }
    version_of(&root).ok().flatten()
}

/// A string as is, or a number the way .NET formats a double.
fn version_of(envelope: &Node) -> Result<Option<String>, Error> {
    let not_a_version =
        || endpoint_error("collab: the doc endpoint version must be a string or a number.");
    let Some(value) = member(envelope, "version")? else {
        return Ok(None);
    };
    match value.kind {
        Kind::Null | Kind::Array | Kind::Object => Ok(None),
        Kind::String => Ok(Some(value.text().map_err(|_| not_a_version())?.to_string())),
        Kind::Number => {
            let number: f64 = std::str::from_utf8(value.raw())
                .ok()
                .and_then(|t| t.parse().ok())
                .ok_or_else(not_a_version)?;
            Ok(Some(format_double(number)))
        }
        Kind::True | Kind::False => Err(not_a_version()),
    }
}

/// Writes JS values the way JsonSerializer writes a JsonNode with the
/// default encoder: escapes as Utf8JsonWriter, numbers as .NET formats
/// them, and refused past depth 512.
pub fn serialize(value: &Value) -> Result<Vec<u8>, Error> {
    let mut out = Vec::new();
    append_net(&mut out, value, 0).map_err(|too_deep| {
        if too_deep {
            endpoint_error(format!(
                "collab: the document is nested too deeply to send (over {JSON_MAX_DEPTH} levels)."
            ))
        } else {
            endpoint_error("collab: the document holds a value with no JSON form.")
        }
    })?;
    Ok(out)
}

/// Err(true) past the depth, Err(false) for a value JSON cannot write.
fn append_net(dst: &mut Vec<u8>, value: &Value, depth: usize) -> Result<(), bool> {
    match value {
        Value::Null => dst.extend_from_slice(b"null"),
        Value::Bool(b) => dst.extend_from_slice(if *b { b"true" } else { b"false" }),
        Value::Number(n) if !n.is_finite() => dst.extend_from_slice(b"null"),
        Value::Number(n) => dst.extend_from_slice(format_double(*n).as_bytes()),
        Value::BigInt(n) => dst.extend_from_slice(n.to_string().as_bytes()),
        Value::String(s) => append_quoted(dst, s),
        Value::Array(items) => {
            if depth >= JSON_MAX_DEPTH {
                return Err(true);
            }
            dst.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    dst.push(b',');
                }
                append_net(dst, item, depth + 1)?;
            }
            dst.push(b']');
        }
        Value::Object(object) => {
            if depth >= JSON_MAX_DEPTH {
                return Err(true);
            }
            dst.push(b'{');
            for (i, m) in object.members().iter().enumerate() {
                if i > 0 {
                    dst.push(b',');
                }
                append_quoted(dst, &m.key);
                dst.push(b':');
                append_net(dst, &m.value, depth + 1)?;
            }
            dst.push(b'}');
        }
        Value::Undefined | Value::Bytes(_) => return Err(false),
    }
    Ok(())
}

/// A header value undici would send: tab, printable ASCII and
/// U+0080..U+00FF, which the outbound writer sends as one Latin-1 byte
/// each. Any other char could end the line or has no byte.
fn sendable(value: &str) -> bool {
    value
        .chars()
        .all(|c| c == '\t' || (' '..='\u{7e}').contains(&c) || ('\u{80}'..='\u{ff}').contains(&c))
}

/// Spaces and tabs around a value are not part of it (RFC 9110 5.5); undici
/// and Go's net/http drop them.
fn trimmed(value: &str) -> &str {
    value.trim_matches([' ', '\t'])
}
