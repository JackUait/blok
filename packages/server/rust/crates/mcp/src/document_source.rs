//! The host's own document store (`Hooks::source`), as Node's
//! `source: { kind: 'custom', source }` takes it (src/mcp/sources/custom.ts),
//! and the adapter that puts Blok's checks and words around it.

use serde_json::Value;

use crate::errors::{Fault, HostError};
use crate::options::AgentActor;
use crate::sources::{Listing, Loaded};
use crate::uploads::BoxFuture;

/// Who a source call runs for: the caller that opened the handle (a list
/// runs for the current caller). Node's BlokDocumentCaller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentCaller {
    pub principal: String,
    /// The client's name as Blok shows it (safe for a header).
    pub client_name: String,
    /// None when the caller came without scopes.
    pub scopes: Option<Vec<String>>,
    pub actor: AgentActor,
}

/// A stored document, as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDocument {
    /// The document as JSON text. Blok parses it as the endpoint source
    /// does: a repeated key keeps its last value, a lone surrogate escape
    /// reads as U+FFFD, and more than 48 levels is refused.
    pub document_text: String,
    /// Must be a non-empty version; None or "" is a host bug.
    pub version: Option<String>,
}

/// A list request: `{ limit, query?, cursor? }`.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceList {
    pub limit: f64,
    pub query: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedDocument {
    pub id: String,
    pub title: Option<String>,
}

/// One page of a listing. Blok still runs authorize on every id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceListing {
    pub documents: Vec<ListedDocument>,
    pub next_cursor: Option<String>,
}

/// Node's BlokMcpSourceErrorKind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceErrorKind {
    /// The version did not match: DOCUMENT_CHANGED.
    Changed,
    /// SOURCE_UNAVAILABLE.
    Unavailable,
    /// FORBIDDEN.
    Forbidden,
    /// The store takes no such id: INVALID_ARGS.
    InvalidId,
}

/// Why a source call failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceError {
    /// A refusal with a code. The agent sees `agent_message` (no paths,
    /// hosts or secrets); a blank one gets Blok's own words.
    Refused {
        kind: SourceErrorKind,
        agent_message: String,
    },
    /// The host's own error. It goes to stderr in full; the agent sees
    /// SOURCE_UNAVAILABLE in Blok's words.
    Failed(String),
}

impl SourceError {
    pub fn changed(agent_message: impl Into<String>) -> SourceError {
        SourceError::refused(SourceErrorKind::Changed, agent_message)
    }

    pub fn unavailable(agent_message: impl Into<String>) -> SourceError {
        SourceError::refused(SourceErrorKind::Unavailable, agent_message)
    }

    pub fn forbidden(agent_message: impl Into<String>) -> SourceError {
        SourceError::refused(SourceErrorKind::Forbidden, agent_message)
    }

    pub fn invalid_id(agent_message: impl Into<String>) -> SourceError {
        SourceError::refused(SourceErrorKind::InvalidId, agent_message)
    }

    pub fn refused(kind: SourceErrorKind, agent_message: impl Into<String>) -> SourceError {
        SourceError::Refused {
            kind,
            agent_message: agent_message.into(),
        }
    }

    pub fn failed(error: impl std::fmt::Display) -> SourceError {
        SourceError::Failed(error.to_string())
    }
}

/// The host's document store. Each call gets the caller it runs for.
pub trait DocumentSource: Send + Sync {
    /// None: never saved.
    fn load(
        &self,
        caller: DocumentCaller,
        document_id: String,
    ) -> BoxFuture<'_, Result<Option<StoredDocument>, SourceError>>;

    /// `document_text` is compact JSON. `if_version` None means "must not
    /// exist yet"; any other value must equal the stored version, else
    /// refuse with `SourceError::changed`. Answer the new non-empty version.
    fn save(
        &self,
        caller: DocumentCaller,
        document_id: String,
        document_text: String,
        if_version: Option<String>,
    ) -> BoxFuture<'_, Result<Option<String>, SourceError>>;

    /// True when `list` is there; otherwise listing is not supported.
    fn lists(&self) -> bool {
        false
    }

    fn list(
        &self,
        caller: DocumentCaller,
        list: SourceList,
    ) -> BoxFuture<'_, Result<SourceListing, SourceError>> {
        let _ = (caller, list);
        Box::pin(async { Err(SourceError::failed("this source does not list")) })
    }
}

#[derive(Clone, Copy)]
enum Op {
    Load,
    Save,
    List,
}

impl Op {
    fn name(self) -> &'static str {
        match self {
            Op::Load => "load",
            Op::Save => "save",
            Op::List => "list",
        }
    }

    // Every port answers with these exact words (shared conformance: embed.json).
    fn failed(self) -> &'static str {
        match self {
            Op::Load => "The host could not load this document. Try again.",
            Op::Save => "The host could not save this document, so nothing was saved. Try again.",
            Op::List => "The host could not list documents. Try again.",
        }
    }
}

// The host may have written it: "nothing was saved" would make the agent repeat its batch.
const SAVED_WITHOUT_VERSION: &str = "The host may have saved this document but did not say which version. Read it before you retry.";

fn code_of(kind: SourceErrorKind) -> &'static str {
    match kind {
        SourceErrorKind::Changed => "DOCUMENT_CHANGED",
        SourceErrorKind::Unavailable => "SOURCE_UNAVAILABLE",
        SourceErrorKind::Forbidden => "FORBIDDEN",
        SourceErrorKind::InvalidId => "INVALID_ARGS",
    }
}

fn fallback(kind: SourceErrorKind, op: Op) -> &'static str {
    match kind {
        SourceErrorKind::Changed => {
            "Someone saved this document since you opened it. Read it again, then retry."
        }
        SourceErrorKind::Unavailable => op.failed(),
        SourceErrorKind::Forbidden => "The host does not allow this.",
        SourceErrorKind::InvalidId => "The host does not accept this document id.",
    }
}

/// A host bug or a plain failure: the whole of it goes to stderr, the
/// agent gets Blok's words.
fn host_failed(op: Op, id: Option<&str>, what: &str, message: &str) -> Fault {
    let named = id.map_or_else(String::new, |id| format!(" \"{id}\""));
    eprintln!(
        "blok-mcp: the host document source failed to {}{named}: {what}",
        op.name()
    );
    HostError::surface("SOURCE_UNAVAILABLE", message).into()
}

fn refusal(op: Op, id: Option<&str>, error: SourceError) -> Fault {
    match error {
        SourceError::Failed(what) => host_failed(op, id, &what, op.failed()),
        SourceError::Refused {
            kind,
            agent_message,
        } => {
            let message = if crate::uploads::js_trim(&agent_message).is_empty() {
                fallback(kind, op).to_owned()
            } else {
                agent_message
            };
            HostError::surface(code_of(kind), message).into()
        }
    }
}

// The endpoint source's rule, so every host gets the same ids.
fn checked_id(id: &str) -> Result<(), Fault> {
    if id.is_empty() || id == "." || id == ".." {
        return Err(
            HostError::surface("INVALID_ARGS", format!("\"{id}\" is not a document id.")).into(),
        );
    }
    Ok(())
}

fn is_version(version: Option<&str>) -> bool {
    version.is_some_and(|v| !v.is_empty())
}

/// The endpoint source's text path: depth on the text, JSON.parse's
/// reading, shape. The bundle parses the kept text again, so a repeated
/// key keeps its last value there.
fn checked_document(id: &str, text: &str) -> Result<String, Fault> {
    let place = format!("The host's document \"{id}\"");
    let unavailable =
        |what: String| -> Fault { HostError::surface("SOURCE_UNAVAILABLE", what).into() };
    if crate::depth::text_nests_deeper_than(text, crate::depth::MAX_JSON_DEPTH) {
        return Err(unavailable(format!(
            "{place} nests deeper than {} levels of objects and arrays.",
            crate::depth::MAX_JSON_DEPTH
        )));
    }
    let text = crate::lenient::as_json_parse_reads(text);
    let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
        return Err(unavailable(format!("{place} is not JSON.")));
    };
    if !parsed.get("blocks").is_some_and(Value::is_array) {
        return Err(unavailable(format!(
            "{place} is not a Blok document: expected an object with a \"blocks\" array."
        )));
    }
    Ok(text)
}

/// The host's source behind Blok's checks and error words.
#[derive(Clone)]
pub struct CustomSource {
    host: std::sync::Arc<dyn DocumentSource>,
}

impl CustomSource {
    pub(crate) fn new(host: std::sync::Arc<dyn DocumentSource>) -> CustomSource {
        CustomSource { host }
    }

    pub(crate) async fn load(&self, caller: &DocumentCaller, id: &str) -> Result<Loaded, Fault> {
        checked_id(id)?;
        let answer = self
            .host
            .load(caller.clone(), id.to_owned())
            .await
            .map_err(|error| refusal(Op::Load, Some(id), error))?;
        let Some(stored) = answer else {
            return Ok(Loaded::missing(None));
        };
        if !is_version(stored.version.as_deref()) {
            return Err(host_failed(
                Op::Load,
                Some(id),
                &format!("expected a non-empty version, got {:?}", stored.version),
                Op::Load.failed(),
            ));
        }
        Ok(Loaded {
            document: checked_document(id, &stored.document_text)?,
            version: stored.version,
            missing: false,
        })
    }

    pub(crate) async fn save(
        &self,
        caller: &DocumentCaller,
        id: &str,
        text: &str,
        if_version: Option<&str>,
    ) -> Result<Option<String>, Fault> {
        checked_id(id)?;
        let version = self
            .host
            .save(
                caller.clone(),
                id.to_owned(),
                text.to_owned(),
                if_version.map(str::to_owned),
            )
            .await
            .map_err(|error| refusal(Op::Save, Some(id), error))?;
        if !is_version(version.as_deref()) {
            return Err(host_failed(
                Op::Save,
                Some(id),
                &format!("expected a non-empty version, got {version:?}"),
                SAVED_WITHOUT_VERSION,
            ));
        }
        Ok(version)
    }

    /// None: the host's source does not list.
    pub(crate) async fn list(
        &self,
        caller: &DocumentCaller,
        request: &crate::sources::ListRequest,
    ) -> Option<Result<Listing, Fault>> {
        if !self.host.lists() {
            return None;
        }
        let list = SourceList {
            limit: request.limit,
            query: request.query.clone(),
            cursor: request.cursor.clone(),
        };
        let listed = match self.host.list(caller.clone(), list).await {
            Ok(listed) => listed,
            Err(error) => return Some(Err(refusal(Op::List, None, error))),
        };
        Some(Ok(Listing {
            documents: listed
                .documents
                .into_iter()
                .map(|doc| (doc.id, doc.title.map_or(Value::Null, Value::String)))
                .collect(),
            next_cursor: listed.next_cursor.map_or(Value::Null, Value::String),
        }))
    }
}

/// The caller a source call runs for: `actor` is the `{ id, name,
/// onBehalfOf?, color? }` the session uses.
pub(crate) fn document_caller(
    caller: &crate::server::Caller,
    actor: &Value,
    client_name: &str,
) -> DocumentCaller {
    let text = |key: &str| actor.get(key).and_then(Value::as_str).map(str::to_owned);
    DocumentCaller {
        principal: caller.principal.clone(),
        client_name: client_name.to_owned(),
        scopes: caller.scopes.clone(),
        actor: AgentActor {
            id: text("id").unwrap_or_default(),
            name: text("name").unwrap_or_default(),
            on_behalf_of: text("onBehalfOf"),
            color: text("color"),
        },
    }
}
