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
            .map_err(|_| endpoint_unavailable("could not be reached".to_owned()))
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
        let parsed: Option<Value> = serde_json::from_slice(&answer.body).ok();
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
