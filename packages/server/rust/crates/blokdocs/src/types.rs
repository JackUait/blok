/// Degradation actions the runtime reports. The field stays an open string:
/// a later runtime may add one.
pub const ACTION_DROPPED: &str = "dropped";
pub const ACTION_DEGRADED: &str = "degraded";

/// One construct a conversion could not carry.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Degradation {
    pub construct: String,
    pub action: String,
    pub detail: String,
}

/// Markdown plus what did not survive it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarkdownConversion {
    pub markdown: String,
    pub warnings: Vec<Degradation>,
}

/// Plain text plus what the reader made nothing of.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PlainTextConversion {
    pub text: String,
    pub warnings: Vec<Degradation>,
}

/// An imported document, ready to store, and what the source could not
/// carry. The warnings are not part of the document.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ImportConversion {
    pub document_json: String,
    pub warnings: Vec<Degradation>,
}

/// Whether Blok can read a document and whether it holds anything.
/// `failure` is set when the runtime could not answer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Validation {
    pub is_document: bool,
    pub is_empty: bool,
    pub block_count: i32,
    pub malformed_block_count: i32,
    pub unrecognized_block_types: Vec<String>,
    pub failure: Option<crate::Reason>,
}

impl Validation {
    /// A document with no malformed or unknown block.
    pub fn is_fully_understood(&self) -> bool {
        self.is_document
            && self.malformed_block_count == 0
            && self.unrecognized_block_types.is_empty()
    }
}

/// What a page document owns, references and says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageIndex {
    pub owners: Vec<PageOwnerEdge>,
    pub text: Vec<PageTextEntry>,
    pub references: Vec<PageReference>,
}

/// A page block that owns a sub-page.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageOwnerEdge {
    pub page_id: String,
    pub source_block_id: String,
    pub order: i32,
}

/// One block's text. `block_id` is None for a block with no id.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageTextEntry {
    pub block_id: Option<String>,
    pub order: i32,
    pub text: String,
}

/// A link to a page. `source_block_id` is None when no block id is known.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageReference {
    pub page_id: String,
    pub source_block_id: Option<String>,
    pub order: i32,
}

/// What a host knows about one linked page. In a pages map, a `None` value
/// means the page is missing; an id left out means unresolved.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageInfo {
    /// Sent only when set; an empty title is still sent.
    pub title: Option<String>,
    pub icon: Option<PageIcon>,
    /// Sends nothing else, and the page's href is never built.
    pub no_access: bool,
}

/// An emoji or an image URL. The HTML writes an image as `<img alt="">`;
/// Markdown drops it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PageIcon {
    Emoji(String),
    Image(String),
}
