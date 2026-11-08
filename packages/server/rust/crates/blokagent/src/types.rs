use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::{Cancel, Error};

/// The future a host callback returns.
pub type HostFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send + 'a>>;

/// The agent a batch runs as.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Actor {
    /// Used for attribution (lastEditedBy).
    pub id: String,
    /// The display name.
    pub name: String,
    /// The person the agent acts for, if any.
    pub on_behalf_of: Option<String>,
}

/// The answer to one batch.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Execution {
    /// The AgentResult.
    pub result_json: String,
    /// The document to save; None unless the batch succeeded.
    pub document_json: Option<String>,
    /// The stored content hash, or "" when the result has none.
    pub revision: String,
}

/// The host's agent options. The default is C#'s `new BlokAgentOptions()`,
/// and passing None is the same.
#[derive(Clone, Default)]
pub struct Options {
    /// Opts in to writing target page titles and icons.
    pub page_titles: bool,
    /// Resolves target pages when `page_titles` is set. A target that is
    /// also a creator lets agents insert page blocks.
    pub page_target: Option<Arc<dyn PageTarget>>,
    /// A BlokCustomToolsFile.
    pub custom_tools_json: Option<String>,
    /// ManifestOverrides.
    pub overrides_json: Option<String>,
    /// Turns the comment commands off, for hosts whose editors keep comments
    /// in their own system. C#'s BuiltInComments is true by default; this is
    /// its inverse, so the default matches.
    pub disable_built_in_comments: bool,
    /// blok-mcp's handle input (its start flags with `mode` and `write`).
    /// When set, the bundle builds blok-mcp's contract from it and skips
    /// customTools, overrides and services.
    pub mcp_json: Option<String>,
    /// blok-mcp's approval input ({capabilities, clientName, replies?}). A
    /// batch that needs a person's yes then answers `{"ask": …}`.
    pub approval_json: Option<String>,
}

/// Finds the document behind a page id, for an agent that renames a page or
/// sets its icon.
pub trait PageTarget: Send + Sync {
    /// None when the page is not found or this actor may not write it.
    fn resolve<'a>(
        &'a self,
        cancel: &'a Cancel,
        page_id: &'a str,
        actor: &'a Actor,
    ) -> HostFuture<'a, Option<PageLocation>>;

    /// Some when this target also creates the documents of new sub-pages.
    fn as_creator(&self) -> Option<&dyn PageCreator> {
        None
    }
}

/// What the host gets when an agent inserts a page block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageCreateRequest {
    /// The document the page block goes into; None when the caller has no
    /// id for it (a stored run).
    pub parent_document_id: Option<String>,
    /// Who the agent acts for, when the caller knows (blok-mcp does).
    pub principal: Option<String>,
    pub actor: Actor,
    /// A fresh id the host may take for the page, or ignore.
    pub suggested_page_id: String,
}

/// A target that also creates the document for a new sub-page. Deleting a
/// page block, undo and redo never call the host. blok-mcp takes the same
/// trait (`Hooks::page_creator`).
pub trait PageCreator: Send + Sync {
    /// The new page id, or None when this actor may not create a page; the
    /// batch then fails with FORBIDDEN. An Err is a host failure, not a
    /// refusal.
    fn create<'a>(
        &'a self,
        cancel: &'a Cancel,
        request: &'a PageCreateRequest,
    ) -> HostFuture<'a, Option<String>>;
}

/// A page document the host loads and saves.
pub trait StoredPage: Send + Sync {
    fn load<'a>(&'a self, cancel: &'a Cancel) -> HostFuture<'a, String>;
    fn save<'a>(&'a self, cancel: &'a Cancel, document_json: &'a str) -> HostFuture<'a, ()>;
}

/// Where a page's document lives.
pub enum PageLocation {
    Stored(Box<dyn StoredPage>),
    /// A page document in a live room.
    Room {
        doc_id: String,
    },
}
