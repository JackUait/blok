//! Where stored documents live: a folder of JSON files, or the host's doc
//! endpoint (src/mcp/sources).

use std::time::Duration;

use serde_json::{Value, json};

use crate::bundle::RawObject;
use crate::errors::{Fault, HostError};
use crate::files::FilesSource;
use crate::outbound::Outbound;

/// A loaded document, as stored JSON text.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub document: String,
    pub version: Option<String>,
    /// No document has this id yet: `document` is the empty one a first save creates.
    pub missing: bool,
}

impl Loaded {
    pub fn missing(version: Option<String>) -> Loaded {
        Loaded {
            document: r#"{"blocks":[]}"#.to_owned(),
            version,
            missing: true,
        }
    }
}

/// One page of a source listing: `{ documents: [{ id, title }], nextCursor }`.
#[derive(Debug, Clone)]
pub struct Listing {
    pub documents: Vec<(String, Value)>,
    pub next_cursor: Value,
}

impl Listing {
    pub fn from_page(page: &Value) -> Listing {
        let documents = page
            .get("documents")
            .and_then(Value::as_array)
            .map(|docs| {
                docs.iter()
                    .filter_map(|doc| {
                        let id = doc.get("id")?.as_str()?.to_owned();
                        let title = doc.get("title").cloned().unwrap_or(Value::Null);
                        Some((id, title))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Listing {
            documents,
            next_cursor: page.get("nextCursor").cloned().unwrap_or(Value::Null),
        }
    }
}

/// A list request: `{ limit, query?, cursor? }`.
#[derive(Debug, Clone)]
pub struct ListRequest {
    pub limit: f64,
    pub query: Option<String>,
    pub cursor: Option<String>,
}

impl ListRequest {
    pub fn from_value(value: &Value) -> ListRequest {
        ListRequest {
            limit: value.get("limit").and_then(Value::as_f64).unwrap_or(25.0),
            query: value
                .get("query")
                .and_then(Value::as_str)
                .map(str::to_owned),
            cursor: value
                .get("cursor")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
    }
}

pub enum Source {
    Files(FilesSource),
    Endpoint(Box<EndpointSource>),
}

impl Source {
    /// The saved form agentExecute should hand back for this source.
    pub fn document_text_form(&self) -> &'static str {
        match self {
            Source::Files(_) => "file",
            Source::Endpoint(_) => "compact",
        }
    }

    pub async fn load(&self, id: &str) -> Result<Loaded, Fault> {
        match self {
            Source::Files(files) => files.load(id).await,
            Source::Endpoint(endpoint) => endpoint.load(id).await,
        }
    }

    pub async fn save(
        &self,
        id: &str,
        text: &str,
        if_version: Option<&str>,
    ) -> Result<Option<String>, Fault> {
        match self {
            Source::Files(files) => files.save(id, text, if_version).await,
            Source::Endpoint(endpoint) => endpoint.save(id, text, if_version).await,
        }
    }

    /// Whether two ids are one document; only files have aliases.
    pub async fn same_document(&self, first: &str, second: &str) -> bool {
        match self {
            Source::Files(files) => files.same_document(first, second).await,
            Source::Endpoint(_) => false,
        }
    }

    /// None: this source cannot list.
    pub async fn list(&self, request: &ListRequest) -> Option<Result<Listing, Fault>> {
        match self {
            Source::Files(files) => Some(
                files
                    .list(
                        request.query.as_deref(),
                        request.cursor.as_deref(),
                        request.limit,
                    )
                    .await,
            ),
            Source::Endpoint(endpoint) => endpoint.list(request).await,
        }
    }
}

// No spec value; long enough for a slow host save.
const ENDPOINT_TIMEOUT: Duration = Duration::from_secs(30);

pub struct EndpointSource {
    url: String,
    auth: String,
    list: Option<String>,
    outbound: Outbound,
}

fn endpoint_unavailable(what: String) -> HostError {
    HostError::surface(
        "SOURCE_UNAVAILABLE",
        format!("The document endpoint {what}."),
    )
}

/// JS encodeURIComponent: every UTF-8 byte except A-Z a-z 0-9 - _ . ! ~ * ' ( ).
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::new();
    for &byte in text.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// URLSearchParams serialization (application/x-www-form-urlencoded): space
/// is `+`, and every UTF-8 byte except A-Z a-z 0-9 * - . _ is escaped.
pub fn form_encode(text: &str) -> String {
    let mut out = String::new();
    for &byte in text.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"*-._".contains(&byte) {
            out.push(byte as char);
        } else if byte == b' ' {
            out.push('+');
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn is_document(value: &Value) -> bool {
    value.get("blocks").is_some_and(Value::is_array)
}

fn not_a_document(id: &str) -> HostError {
    HostError::surface(
        "SOURCE_UNAVAILABLE",
        format!("{id} is not a Blok document: expected an object with a \"blocks\" array."),
    )
}

impl EndpointSource {
    pub fn new(
        url: String,
        auth: String,
        list: Option<String>,
        outbound: Outbound,
    ) -> EndpointSource {
        EndpointSource {
            url,
            auth,
            list,
            outbound,
        }
    }

    // encodeURIComponent keeps "." and "..", which a URL parser resolves as
    // path steps to other host routes.
    fn url_of(&self, id: &str) -> Result<String, HostError> {
        if id.is_empty() || id == "." || id == ".." {
            return Err(HostError::surface(
                "INVALID_ARGS",
                format!("\"{id}\" is not a document id."),
            ));
        }
        let base = self.url.strip_suffix('/').unwrap_or(&self.url);
        Ok(format!("{base}/{}", encode_uri_component(id)))
    }

    async fn send(
        &self,
        method: &str,
        url: &str,
        mut headers: Vec<(String, String)>,
        body: Option<&[u8]>,
    ) -> Result<crate::outbound::Answer, HostError> {
        headers.insert(0, ("Authorization".to_owned(), self.auth.clone()));
        self.outbound
            .send(method, url, headers, body, ENDPOINT_TIMEOUT)
            .await
            .map_err(|failed| {
                endpoint_unavailable(if failed.too_large {
                    format!(
                        "answered more than {} MiB, more than this server opens",
                        crate::outbound::MAX_ANSWER >> 20
                    )
                } else if failed.mid_body {
                    "dropped the connection while answering".to_owned()
                } else {
                    "could not be reached".to_owned()
                })
            })
    }

    pub async fn load(&self, id: &str) -> Result<Loaded, Fault> {
        let url = self.url_of(id)?;
        let answer = self.send("GET", &url, Vec::new(), None).await?;
        if answer.status != 200 {
            return Err(
                endpoint_unavailable(format!("answered {} for {id}", answer.status)).into(),
            );
        }
        let text = String::from_utf8_lossy(&answer.body);
        // fetch().text() drops a BOM; JSON.parse takes what lenient mends.
        let text =
            crate::lenient::as_json_parse_reads(text.strip_prefix('\u{feff}').unwrap_or(&text));
        if crate::depth::text_nests_deeper_than(&text, crate::depth::MAX_JSON_DEPTH) {
            return Err(endpoint_unavailable(format!(
                "answered JSON nested deeper than {} levels for {id}",
                crate::depth::MAX_JSON_DEPTH
            ))
            .into());
        }
        let body: Value = serde_json::from_str(&text)
            .map_err(|_| endpoint_unavailable(format!("answered non-JSON for {id}")))?;
        if body.is_null() {
            return Ok(Loaded::missing(None));
        }
        if body.is_object() && body.get("data").is_some() && body.get("blocks").is_none() {
            let version = body
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let data = &body["data"];
            if data.is_null() {
                return Ok(Loaded::missing(version));
            }
            if !is_document(data) {
                return Err(not_a_document(id).into());
            }
            let raw = RawObject::parse(&text)
                .map_err(|_| endpoint_unavailable(format!("answered non-JSON for {id}")))?;
            let data = raw.text("data").unwrap_or("null").to_owned();
            return Ok(Loaded {
                document: data,
                version,
                missing: false,
            });
        }
        if !is_document(&body) {
            return Err(not_a_document(id).into());
        }
        Ok(Loaded {
            document: text.trim().to_owned(),
            version: None,
            missing: false,
        })
    }

    /// `text` is the compact JSON body to PUT.
    pub async fn save(
        &self,
        id: &str,
        text: &str,
        if_version: Option<&str>,
    ) -> Result<Option<String>, Fault> {
        let url = self.url_of(id)?;
        let mut headers = vec![("Content-Type".to_owned(), "application/json".to_owned())];
        if let Some(version) = if_version {
            headers.push(("Blok-Doc-Version".to_owned(), version.to_owned()));
        }
        let answer = self
            .send("PUT", &url, headers, Some(text.as_bytes()))
            .await?;
        // A 409 is the stale PUT the README recommends; without it the host is last-writer-wins.
        if answer.status == 409 {
            return Err(HostError::surface(
                "DOCUMENT_CHANGED",
                "Someone saved this document since you opened it. Read it again, then retry.",
            )
            .into());
        }
        if !(200..=299).contains(&answer.status) {
            return Err(
                endpoint_unavailable(format!("refused the save with {}", answer.status)).into(),
            );
        }
        let fallback = if_version.map(str::to_owned);
        if answer.body.is_empty() {
            return Ok(fallback);
        }
        // Node reads a save answer of any depth; serde_json stops at 128.
        let reply = String::from_utf8_lossy(&answer.body);
        let parsed: Option<Value> =
            serde_json::from_str(&crate::depth::clamp(&reply, crate::depth::MESSAGE_LIMIT)).ok();
        Ok(parsed
            .as_ref()
            .and_then(|v| v.get("version"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or(fallback))
    }

    pub async fn list(&self, request: &ListRequest) -> Option<Result<Listing, Fault>> {
        let list = self.list.as_ref()?;
        Some(self.list_from(list, request).await)
    }

    async fn list_from(&self, list: &str, request: &ListRequest) -> Result<Listing, Fault> {
        let mut params = Vec::new();
        if let Some(query) = &request.query {
            params.push(format!("query={}", form_encode(query)));
        }
        if let Some(cursor) = &request.cursor {
            params.push(format!("cursor={}", form_encode(cursor)));
        }
        params.push(format!("limit={}", js_number(request.limit)));
        let url = format!("{list}?{}", params.join("&"));
        let answer = self.send("GET", &url, Vec::new(), None).await?;
        if answer.status != 200 {
            return Err(endpoint_unavailable(format!("list answered {}", answer.status)).into());
        }
        if crate::depth::text_nests_deeper_than(
            &String::from_utf8_lossy(&answer.body),
            crate::depth::MAX_JSON_DEPTH,
        ) {
            return Err(endpoint_unavailable(format!(
                "answered JSON nested deeper than {} levels for the list",
                crate::depth::MAX_JSON_DEPTH
            ))
            .into());
        }
        let body: Value = serde_json::from_slice(&answer.body)
            .map_err(|_| endpoint_unavailable("answered non-JSON for the list".to_owned()))?;
        let Some(documents) = body
            .get("documents")
            .and_then(Value::as_array)
            .filter(|_| body.is_object())
        else {
            return Err(endpoint_unavailable(
                "list answered without a \"documents\" array".to_owned(),
            )
            .into());
        };
        let page = json!({
            "documents": documents
                .iter()
                .filter(|doc| doc.get("id").is_some_and(Value::is_string))
                .map(|doc| json!({
                    "id": doc["id"],
                    "title": doc.get("title").filter(|t| t.is_string()).cloned().unwrap_or(Value::Null),
                }))
                .collect::<Vec<_>>(),
            "nextCursor": body.get("nextCursor").filter(|c| c.is_string()).cloned().unwrap_or(Value::Null),
        });
        Ok(Listing::from_page(&page))
    }
}

/// String(n) for the numbers a list limit can hold.
pub fn js_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One raw answer per connection; returns the endpoint and the heads seen.
    async fn raw_endpoint(
        head: &'static str,
        body: Vec<u8>,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let heads = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = heads.clone();
        tokio::spawn(async move {
            while let Ok((mut tcp, _)) = listener.accept().await {
                let mut buf = vec![0u8; 8192];
                let n = tcp.read(&mut buf).await.unwrap_or(0);
                seen.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buf[..n]).into_owned());
                let answer = format!(
                    "{head}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = tcp.write_all(answer.as_bytes()).await;
                let _ = tcp.write_all(&body).await;
            }
        });
        (format!("http://{address}/docs"), heads)
    }

    async fn load(head: &'static str, body: Vec<u8>) -> Result<Loaded, Fault> {
        let (url, _) = raw_endpoint(head, body).await;
        EndpointSource::new(url, "Bearer t".to_owned(), None, Outbound::new())
            .load("a")
            .await
    }

    fn message(fault: Fault) -> String {
        match fault {
            Fault::Host(error) => error.error["message"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            Fault::Internal(message) => message,
        }
    }

    // Node's fetch().text() drops a leading BOM, asks for gzip and deflate
    // and decodes them, and JSON.parse takes a lone surrogate and 1e400.
    #[tokio::test]
    async fn an_endpoint_answer_is_read_as_node_reads_it() {
        let bom = load("HTTP/1.1 200 OK", "\u{feff}{\"blocks\":[]}".into()).await;
        assert!(bom.is_ok(), "{:?}", bom.err().map(message));
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gzip, br#"{"blocks":[]}"#).unwrap();
        let zipped = load(
            "HTTP/1.1 200 OK\r\nContent-Encoding: gzip",
            gzip.finish().unwrap(),
        )
        .await;
        assert!(zipped.is_ok(), "{:?}", zipped.err().map(message));
        let odd = load(
            "HTTP/1.1 200 OK",
            br#"{"blocks":[],"s":"\ud800","n":1e400}"#.to_vec(),
        )
        .await;
        assert!(odd.is_ok(), "{:?}", odd.err().map(message));
        let (url, heads) = raw_endpoint("HTTP/1.1 200 OK", br#"{"blocks":[]}"#.to_vec()).await;
        EndpointSource::new(url, "Bearer t".to_owned(), None, Outbound::new())
            .load("a")
            .await
            .unwrap();
        let head = heads.lock().unwrap()[0].to_ascii_lowercase();
        assert!(
            head.contains("\r\naccept-encoding: gzip, deflate\r\n"),
            "{head}"
        );
    }

    // fetch() resolves at the head; a socket that closes before the body
    // ends rejects text(), which Node words apart from an unreachable host.
    #[tokio::test]
    async fn a_connection_dropped_mid_body_says_so() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut tcp, _)) = listener.accept().await {
                let mut buf = vec![0u8; 8192];
                let _ = tcp.read(&mut buf).await;
                let _ = tcp
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"data\":{\"blocks\":[",
                    )
                    .await;
            }
        });
        let source = EndpointSource::new(
            format!("http://{address}/docs"),
            "Bearer t".to_owned(),
            None,
            Outbound::new(),
        );
        let dropped = message(source.load("a").await.err().unwrap());
        assert_eq!(
            dropped,
            "The document endpoint dropped the connection while answering."
        );
    }

    // The answer is read whole, and a document past 64 MiB is past the
    // memory budget anyway: it is refused with words that say so.
    #[tokio::test]
    async fn an_answer_past_the_cap_says_it_is_too_large() {
        let mut body = br#"{"blocks":[],"x":""#.to_vec();
        body.resize(body.len() + (64 << 20), b'a');
        body.extend_from_slice(br#""}"#);
        let refused = message(load("HTTP/1.1 200 OK", body).await.err().unwrap());
        assert_eq!(
            refused,
            "The document endpoint answered more than 64 MiB, more than this server opens."
        );
    }

    /// A document nesting `total` levels: object 1, blocks 2, block 3, data 4.
    fn deep_doc(total: usize, tail: &str) -> Vec<u8> {
        format!(
            r#"{{"title":"T","blocks":[{{"id":"p","type":"paragraph","data":{{"text":"a","x":{}{tail}{}}}}}]}}"#,
            "[".repeat(total - 4),
            "]".repeat(total - 4)
        )
        .into_bytes()
    }

    // Node checks an endpoint answer's depth before it parses it.
    #[tokio::test]
    async fn an_answer_nested_past_48_is_refused_as_node_refuses_it() {
        assert!(load("HTTP/1.1 200 OK", deep_doc(48, "")).await.is_ok());
        let deep = "The document endpoint answered JSON nested deeper than 48 levels for a.";
        for body in [deep_doc(49, ""), deep_doc(20_000, ""), deep_doc(60, "1,")] {
            assert_eq!(
                message(load("HTTP/1.1 200 OK", body).await.err().unwrap()),
                deep
            );
        }
        let (url, _) = raw_endpoint(
            "HTTP/1.1 200 OK",
            format!(
                r#"{{"documents":[],"x":{}{}}}"#,
                "[".repeat(48),
                "]".repeat(48)
            )
            .into_bytes(),
        )
        .await;
        let listed = EndpointSource::new(
            url.clone(),
            "Bearer t".to_owned(),
            Some(url),
            Outbound::new(),
        )
        .list(&ListRequest {
            query: None,
            cursor: None,
            limit: 10.0,
        })
        .await
        .unwrap();
        assert_eq!(
            message(listed.err().unwrap()),
            "The document endpoint answered JSON nested deeper than 48 levels for the list."
        );
    }

    // Node reads a save answer of any depth; its version still counts.
    #[tokio::test]
    async fn a_deep_save_answer_still_gives_its_version() {
        let body = format!(
            r#"{{"version":"v2","x":{}{}}}"#,
            "[".repeat(20_000),
            "]".repeat(20_000)
        );
        let (url, _) = raw_endpoint("HTTP/1.1 200 OK", body.into_bytes()).await;
        let saved = EndpointSource::new(url, "Bearer t".to_owned(), None, Outbound::new())
            .save("a", r#"{"blocks":[]}"#, Some("v1"))
            .await
            .unwrap();
        assert_eq!(saved.as_deref(), Some("v2"));
    }

    #[test]
    fn encodes_ids_as_encode_uri_component() {
        assert_eq!(encode_uri_component("a b/c?é"), "a%20b%2Fc%3F%C3%A9");
        assert_eq!(encode_uri_component("-_.!~*'()"), "-_.!~*'()");
    }

    #[test]
    fn encodes_queries_as_url_search_params() {
        assert_eq!(form_encode("a b/c?é~!'"), "a+b%2Fc%3F%C3%A9%7E%21%27");
        assert_eq!(form_encode("*-._"), "*-._");
    }

    #[test]
    fn writes_limits_as_js_string() {
        assert_eq!(js_number(25.0), "25");
        assert_eq!(js_number(2.5), "2.5");
    }
}
