use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use blok_jsjson::{
    Kind, Node, Options, Str, append_quoted, new_object, parse_node, to_string_lossy,
};
use tokio::sync::watch;

use crate::Reason;
use crate::Runtime;
use crate::answer::{
    member, parse_answer, read_array, read_bool, read_degradations, read_int, read_object,
    read_optional_string, read_report, read_string, read_strings,
};
use crate::errors::{
    Error, from_runtime, invalid_document, invalid_operation, no_answer, no_version,
};
use crate::types::{
    ImportConversion, MarkdownConversion, PageIcon, PageIndex, PageInfo, PageOwnerEdge,
    PageReference, PageTextEntry, PlainTextConversion, Validation,
};

/// A host's page metadata, sent in this order: `None` is a missing page. A
/// repeated id keeps its first place and its last value.
pub type Pages = Vec<(String, Option<PageInfo>)>;

/// Old id to new id, sent in this order. A repeated old id keeps its first
/// place and its last new id.
pub type IdMap = Vec<(String, String)>;

/// Builds each allowed page's link; an empty answer sends no href.
pub type PageHref<'a> = &'a (dyn Fn(&str) -> String + Sync);

/// Converts saved Blok documents. Cheap to clone; clones share the runtime
/// and the caches. At most the pool's size of conversions run at once.
///
/// Every method takes the document as JSON text. Envelope operations (all
/// but the bare `to_html` and `to_markdown`) parse it on the host first, the
/// way C# JsonNode.Parse does: nesting past 64 levels or a lone-surrogate
/// escape is an InvalidDocument before any engine is used.
#[derive(Clone)]
pub struct Converter {
    inner: Arc<Inner>,
}

struct Inner {
    runtime: Box<dyn Runtime>,
    version: Mutex<Option<String>>,
    schema: Mutex<Option<String>>,
    // Turns true when the warm-up New started has finished.
    warmed: Mutex<Option<watch::Receiver<bool>>>,
}

impl Converter {
    pub(crate) fn with_runtime(runtime: Box<dyn Runtime>) -> Converter {
        Converter {
            inner: Arc::new(Inner {
                runtime,
                version: Mutex::new(None),
                schema: Mutex::new(None),
                warmed: Mutex::new(None),
            }),
        }
    }

    async fn invoke(&self, op: &str, input: &str) -> Result<String, Error> {
        self.inner
            .runtime
            .invoke(op, input, None)
            .await
            .map_err(from_runtime)
    }

    /// The document version the editor stamps, cached once known. A bundle
    /// built without the VERSION define answers "dev", which is never cached
    /// and fails every time.
    pub async fn version(&self) -> Result<String, Error> {
        if let Some(cached) = lock(&self.inner.version).clone() {
            return Ok(cached);
        }
        let reported = self.invoke("version", "{}").await?;
        if reported == "dev" || reported.is_empty() {
            return Err(no_version());
        }
        *lock(&self.inner.version) = Some(reported.clone());
        Ok(reported)
    }

    /// The saved format as a JSON Schema document, fetched once.
    pub async fn schema(&self) -> Result<String, Error> {
        if let Some(cached) = lock(&self.inner.schema).clone() {
            return Ok(cached);
        }
        let schema = self.invoke("schema", "{}").await?;
        *lock(&self.inner.schema) = Some(schema.clone());
        Ok(schema)
    }

    async fn markdown(&self, op: &str, input: &str) -> Result<MarkdownConversion, Error> {
        let output = self.invoke(op, input).await?;
        let (markdown, warnings) =
            read_report(&output, "markdown")?.ok_or_else(|| no_answer("Markdown conversion"))?;
        Ok(MarkdownConversion { markdown, warnings })
    }

    /// Converts a document to Markdown. The document is sent as it is.
    pub async fn to_markdown(&self, document_json: &str) -> Result<MarkdownConversion, Error> {
        self.markdown("blocksToMarkdown", document_json).await
    }

    /// `to_markdown` with page metadata for page blocks and page links.
    pub async fn to_markdown_with_pages(
        &self,
        document_json: &str,
        pages: Option<&Pages>,
        page_href: Option<PageHref<'_>>,
    ) -> Result<MarkdownConversion, Error> {
        let input = pages_request(document_json, pages, page_href, false)?;
        self.markdown("blocksToMarkdownWithPages", &input).await
    }

    /// Writes the document's title as a heading. An image icon is dropped.
    pub async fn to_markdown_with_title(
        &self,
        document_json: &str,
    ) -> Result<MarkdownConversion, Error> {
        let input = title_request(document_json)?;
        self.markdown("blocksToMarkdown", &input).await
    }

    pub async fn to_markdown_with_title_and_pages(
        &self,
        document_json: &str,
        pages: Option<&Pages>,
        page_href: Option<PageHref<'_>>,
    ) -> Result<MarkdownConversion, Error> {
        let input = pages_request(document_json, pages, page_href, true)?;
        self.markdown("blocksToMarkdownWithPages", &input).await
    }

    /// Converts a document to HTML. The document is sent as it is.
    pub async fn to_html(&self, document_json: &str) -> Result<String, Error> {
        self.invoke("blocksToHtml", document_json).await
    }

    pub async fn to_html_with_pages(
        &self,
        document_json: &str,
        pages: Option<&Pages>,
        page_href: Option<PageHref<'_>>,
    ) -> Result<String, Error> {
        let input = pages_request(document_json, pages, page_href, false)?;
        self.invoke("blocksToHtmlWithPages", &input).await
    }

    /// Writes the document's title as an `<h1>`.
    pub async fn to_html_with_title(&self, document_json: &str) -> Result<String, Error> {
        let input = title_request(document_json)?;
        self.invoke("blocksToHtml", &input).await
    }

    pub async fn to_html_with_title_and_pages(
        &self,
        document_json: &str,
        pages: Option<&Pages>,
        page_href: Option<PageHref<'_>>,
    ) -> Result<String, Error> {
        let input = pages_request(document_json, pages, page_href, true)?;
        self.invoke("blocksToHtmlWithPages", &input).await
    }

    /// `include_hidden_text` adds text a reader does not see, such as image
    /// alt text.
    pub async fn to_plain_text(
        &self,
        document_json: &str,
        include_hidden_text: bool,
    ) -> Result<String, Error> {
        let input = plain_text_request(document_json, include_hidden_text, false)?;
        self.invoke("blocksToPlainText", &input).await
    }

    /// Puts the title on the first line.
    pub async fn to_plain_text_with_title(
        &self,
        document_json: &str,
        include_hidden_text: bool,
    ) -> Result<String, Error> {
        let input = plain_text_request(document_json, include_hidden_text, true)?;
        self.invoke("blocksToPlainText", &input).await
    }

    /// `to_plain_text` plus the blocks the reader made nothing of.
    pub async fn to_plain_text_with_report(
        &self,
        document_json: &str,
        include_hidden_text: bool,
    ) -> Result<PlainTextConversion, Error> {
        let input = plain_text_request(document_json, include_hidden_text, false)?;
        let output = self.invoke("blocksToPlainTextWithReport", &input).await?;
        let (text, warnings) =
            read_report(&output, "text")?.ok_or_else(|| no_answer("plain-text conversion"))?;
        Ok(PlainTextConversion { text, warnings })
    }

    /// The strings worth translating, in document order. Code only when
    /// `include_code` is set.
    pub async fn extract_texts(
        &self,
        document_json: &str,
        include_code: bool,
    ) -> Result<Vec<String>, Error> {
        let input = texts_request(document_json, None, include_code)?;
        let output = self.invoke("extractTexts", &input).await?;
        let node = parse_answer(&output)?;
        if node.kind == Kind::Null {
            return Err(no_answer("texts"));
        }
        read_strings(Some(&node))
    }

    /// Puts translations back, in `extract_texts` order, and returns the
    /// document to store. A list of the wrong length is a TextCount error.
    pub async fn inject_texts(
        &self,
        document_json: &str,
        texts: Option<&[String]>,
        include_code: bool,
    ) -> Result<String, Error> {
        let texts = texts.ok_or(Error::NullArgument { name: "texts" })?;
        let input = texts_request(document_json, Some(texts), include_code)?;
        let output = self.invoke("injectTexts", &input).await?;
        let result = answer_object(&output, "document")?;
        if let Some(mismatch) = member(&result, "mismatch")
            && mismatch.kind != Kind::Null
        {
            let object = as_object(mismatch)?;
            return Err(Error::TextCount {
                expected: node_text(member(object, "expected")),
                received: node_text(member(object, "received")),
            });
        }
        document_of(&result)
    }

    /// The sub-pages a page document owns, the pages it links to, and each
    /// block's text. The document is sent raw, so a malformed block keeps its
    /// order.
    pub async fn page_index(&self, document_json: &str) -> Result<PageIndex, Error> {
        let mut request = Envelope::new();
        request.document(document_json)?;
        let output = self.invoke("pageIndex", &request.close()).await?;
        let node = parse_answer(&output)?;
        let object = read_object(Some(&node))?.ok_or_else(|| no_answer("page index"))?;
        read_page_index(object)
    }

    /// Copies a page document under new block and page ids. Maps that do not
    /// cover the document are an UnmappedIds error.
    pub async fn remap_page_document(
        &self,
        document_json: &str,
        block_ids: Option<&IdMap>,
        page_ids: Option<&IdMap>,
    ) -> Result<String, Error> {
        let block_ids = block_ids.ok_or(Error::NullArgument { name: "blockIds" })?;
        let page_ids = page_ids.ok_or(Error::NullArgument { name: "pageIds" })?;
        let mut request = Envelope::new();
        request.document(document_json)?;
        request.id_map("blockIds", block_ids);
        request.id_map("pageIds", page_ids);
        let output = self.invoke("remapPageDocument", &request.close()).await?;
        let result = answer_object(&output, "document")?;
        if let Some(unmapped) = member(&result, "unmapped")
            && unmapped.kind != Kind::Null
        {
            return Err(read_unmapped(unmapped));
        }
        document_of(&result)
    }

    /// Whether Blok can read a document and whether it holds anything. A
    /// runtime failure is reported in `failure`, not as an error; only a
    /// constraint error fails it. A non-document is answered without an
    /// engine.
    pub async fn validate(&self, document_json: &str) -> Result<Validation, Error> {
        let failed = |reason| Validation {
            failure: Some(reason),
            ..Validation::default()
        };
        if !looks_like_a_document(document_json) {
            return Ok(failed(Reason::InvalidDocument));
        }
        let output = match self.invoke("inspect", document_json).await {
            Ok(output) => output,
            Err(Error::Conversion(err)) => return Ok(failed(err.reason)),
            Err(err) => return Err(err),
        };
        Ok(read_validation(&output).unwrap_or_else(|_| failed(Reason::Unknown)))
    }

    /// Imports Markdown as a document ready to store.
    pub async fn from_markdown(&self, markdown: &str) -> Result<ImportConversion, Error> {
        self.import_document(
            "markdownToBlocks",
            &single_string_request("markdown", markdown),
        )
        .await
    }

    /// Imports HTML as a document ready to store.
    pub async fn from_html(&self, html: &str) -> Result<ImportConversion, Error> {
        self.import_document("htmlToBlocks", &single_string_request("html", html))
            .await
    }

    // The report rides beside the document on the wire, but a caller storing
    // the document must not store it.
    async fn import_document(&self, op: &str, input: &str) -> Result<ImportConversion, Error> {
        let output = self.invoke(op, input).await?;
        let node = parse_answer(&output)?;
        if node.kind == Kind::Null {
            return Err(no_answer("document"));
        }
        let payload = as_object(&node)?;
        let warnings = read_degradations(member(payload, "warnings"))?;
        let kept = new_object(
            payload
                .members
                .iter()
                .filter(|m| {
                    !m.key()
                        .is_ok_and(|key| to_string_lossy(key.units()) == "warnings")
                })
                .cloned()
                .collect(),
        );
        Ok(ImportConversion {
            document_json: write_answer(&kept)?,
            warnings,
        })
    }

    /// Converts a long article, so the first real request does not pay for
    /// cold paths. Its error is for the caller to ignore: warming must never
    /// stop a host from starting.
    pub async fn warm_up(&self) -> Result<(), Error> {
        self.to_plain_text(&warm_up_document(), false)
            .await
            .map(|_| ())
    }

    /// Never fails a start: a slow host can push the warm-up past its own
    /// timeout, and that is no reason to refuse to serve.
    pub(crate) fn warm_up_in_background(&self) -> watch::Receiver<bool> {
        let (done, warmed) = watch::channel(false);
        let converter = self.clone();
        let task = async move {
            let _ = converter.warm_up().await;
            let _ = done.send(true);
        };
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn(task);
            }
            Err(_) => {
                std::thread::spawn(move || {
                    if let Ok(runtime) = tokio::runtime::Builder::new_current_thread().build() {
                        runtime.block_on(task);
                    }
                });
            }
        }
        *lock(&self.inner.warmed) = Some(warmed.clone());
        warmed
    }

    #[cfg(test)]
    pub(crate) fn warmed(&self) -> Option<watch::Receiver<bool>> {
        lock(&self.inner.warmed).clone()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn warm_up_document() -> String {
    const PARAGRAPH: &str = r#"Warm up <b>the</b> reader with <a href=\"https://example.com\">a link</a> and enough plain prose after it to be worth reading, paragraph "#;
    let mut text = String::from(r#"{"blocks":["#);
    for i in 0..220 {
        if i > 0 {
            text.push(',');
        }
        text.push_str(&format!(r#"{{"id":"w{i}""#));
        if i % 7 == 0 {
            text.push_str(r#","type":"list","data":{"style":"unordered","text":"item &amp; more "#);
        } else {
            text.push_str(r#","type":"paragraph","data":{"text":""#);
            text.push_str(PARAGRAPH);
        }
        text.push_str(&format!(r#"{i}"}}}}"#));
    }
    text.push_str("]}");
    text
}

/// From the JSON alone, whether input is shaped like a saved document: an
/// object whose blocks member is an array, with no key repeated anywhere. It
/// never says whether the blocks are readable.
///
/// Repeats are refused on both servers, though the converters let the last
/// value win: a check of "is this a document" stays strict.
pub fn looks_like_a_document(document_json: &str) -> bool {
    if document_json.trim().is_empty() {
        return false;
    }
    let options = Options {
        refuse_duplicates: true,
        ..Options::default()
    };
    match parse_node(document_json.as_bytes(), options) {
        Ok(node) if node.kind == Kind::Object => {
            member(&node, "blocks").is_some_and(|blocks| blocks.kind == Kind::Array)
        }
        _ => false,
    }
}

/// Reads a {document | mismatch | unmapped} answer as C# JsonNode.Parse does.
fn answer_object(output: &str, what: &str) -> Result<Node, Error> {
    let node = parse_answer(output)?;
    if node.kind == Kind::Null {
        return Err(no_answer(what));
    }
    as_object(&node)?;
    Ok(node)
}

fn as_object(node: &Node) -> Result<&Node, Error> {
    if node.kind != Kind::Object {
        return Err(invalid_operation("The node must be of type 'JsonObject'."));
    }
    Ok(node)
}

fn document_of(result: &Node) -> Result<String, Error> {
    match member(result, "document") {
        Some(document) if document.kind != Kind::Null => write_answer(document),
        _ => Err(no_answer("document")),
    }
}

/// Re-serializes like JsonNode.ToJsonString: key order and number text kept,
/// non-ASCII and HTML-sensitive characters escaped.
fn write_answer(node: &Node) -> Result<String, Error> {
    let mut out = Vec::new();
    node.append_json(&mut out).map_err(|_| {
        invalid_operation(
            "Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.",
        )
    })?;
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// JsonNode.ToString(): a string's text, other values as JSON.
fn node_text(node: Option<&Node>) -> String {
    let Some(node) = node else {
        return String::new();
    };
    if node.kind == Kind::String
        && let Ok(text) = node.text()
    {
        return to_string_lossy(text.units());
    }
    let mut out = Vec::new();
    match node.append_json(&mut out) {
        Ok(()) => String::from_utf8_lossy(&out).into_owned(),
        Err(_) => String::new(),
    }
}

fn read_unmapped(node: &Node) -> Error {
    let read = || -> Result<Error, Error> {
        let object = read_object(Some(node))?.ok_or_else(|| no_answer("id problems"))?;
        Ok(Error::UnmappedIds {
            missing_block_ids: read_strings(member(object, "missingBlockIds"))?,
            duplicate_block_ids: read_strings(member(object, "duplicateBlockIds"))?,
            idless_blocks: read_int(member(object, "idlessBlocks"))?,
        })
    };
    read().unwrap_or_else(|err| err)
}

fn read_validation(output: &str) -> Result<Validation, Error> {
    let node = parse_answer(output)?;
    // Deserialize gave null: C# falls back to an Unknown failure but still
    // calls it a document.
    let Some(object) = read_object(Some(&node))? else {
        return Ok(Validation {
            is_document: true,
            failure: Some(Reason::Unknown),
            ..Validation::default()
        });
    };
    Ok(Validation {
        is_document: true,
        is_empty: read_bool(member(object, "isEmpty"))?,
        block_count: read_int(member(object, "blockCount"))?,
        malformed_block_count: read_int(member(object, "malformedBlockCount"))?,
        unrecognized_block_types: read_strings(member(object, "unrecognizedBlockTypes"))?,
        failure: None,
    })
}

fn read_rows<T: Default>(
    object: &Node,
    name: &str,
    mut row: impl FnMut(&Node) -> Result<T, Error>,
) -> Result<Vec<T>, Error> {
    Ok(read_array(member(object, name), |element| {
        match read_object(Some(element))? {
            Some(object) => row(object),
            None => Ok(T::default()),
        }
    })?
    .unwrap_or_default())
}

fn read_page_index(object: &Node) -> Result<PageIndex, Error> {
    Ok(PageIndex {
        owners: read_rows(object, "owners", |row| {
            Ok(PageOwnerEdge {
                page_id: read_string(member(row, "pageId"))?,
                source_block_id: read_string(member(row, "sourceBlockId"))?,
                order: read_int(member(row, "order"))?,
            })
        })?,
        text: read_rows(object, "text", |row| {
            Ok(PageTextEntry {
                block_id: read_optional_string(member(row, "blockId"))?,
                order: read_int(member(row, "order"))?,
                text: read_string(member(row, "text"))?,
            })
        })?,
        references: read_rows(object, "references", |row| {
            Ok(PageReference {
                page_id: read_string(member(row, "pageId"))?,
                source_block_id: read_optional_string(member(row, "sourceBlockId"))?,
                order: read_int(member(row, "order"))?,
            })
        })?,
    })
}

/// Writes a request object the way C# JsonObject.ToJsonString does.
struct Envelope {
    buf: Vec<u8>,
}

impl Envelope {
    fn new() -> Envelope {
        Envelope { buf: vec![b'{'] }
    }

    fn key(&mut self, name: &str) {
        if self.buf.len() > 1 {
            self.buf.push(b',');
        }
        append_quoted(&mut self.buf, Str::from_utf8(name.as_bytes()).units());
        self.buf.push(b':');
    }

    /// Parses the document like C# JsonNode.Parse (depth 64, repeats kept).
    /// Writing it back fails on a lone-surrogate escape, which C# also
    /// reports as InvalidDocument.
    fn document(&mut self, document_json: &str) -> Result<(), Error> {
        let node =
            parse_node(document_json.as_bytes(), Options::default()).map_err(invalid_document)?;
        self.key("document");
        node.append_json(&mut self.buf).map_err(invalid_document)
    }

    fn boolean(&mut self, name: &str, value: bool) {
        self.key(name);
        self.buf
            .extend_from_slice(if value { b"true" } else { b"false" });
    }

    fn str(&mut self, name: &str, value: &str) {
        self.key(name);
        append_quoted(&mut self.buf, Str::from_utf8(value.as_bytes()).units());
    }

    fn raw(&mut self, name: &str, value: &[u8]) {
        self.key(name);
        self.buf.extend_from_slice(value);
    }

    fn id_map(&mut self, name: &str, ids: &IdMap) {
        let mut inner = Envelope::new();
        for (old, new) in deduplicate(ids) {
            inner.str(old, new);
        }
        self.raw(name, &inner.close_bytes());
    }

    fn close_bytes(mut self) -> Vec<u8> {
        self.buf.push(b'}');
        self.buf
    }

    fn close(self) -> String {
        String::from_utf8_lossy(&self.close_bytes()).into_owned()
    }
}

/// Keeps the first place of a repeated key and its last value, as assigning
/// into a C# Dictionary does.
fn deduplicate<V>(entries: &[(String, V)]) -> Vec<(&String, &V)> {
    let mut out: Vec<(&String, &V)> = Vec::with_capacity(entries.len());
    let mut at: HashMap<&String, usize> = HashMap::with_capacity(entries.len());
    for (key, value) in entries {
        match at.get(key) {
            Some(&i) => out[i].1 = value,
            None => {
                at.insert(key, out.len());
                out.push((key, value));
            }
        }
    }
    out
}

fn single_string_request(name: &str, value: &str) -> String {
    let mut request = Envelope::new();
    request.str(name, value);
    request.close()
}

fn texts_request(
    document_json: &str,
    texts: Option<&[String]>,
    include_code: bool,
) -> Result<String, Error> {
    let mut request = Envelope::new();
    request.document(document_json)?;
    request.boolean("includeCode", include_code);
    if let Some(texts) = texts {
        let mut list = vec![b'['];
        for (i, text) in texts.iter().enumerate() {
            if i > 0 {
                list.push(b',');
            }
            append_quoted(&mut list, Str::from_utf8(text.as_bytes()).units());
        }
        list.push(b']');
        request.raw("texts", &list);
    }
    Ok(request.close())
}

fn plain_text_request(
    document_json: &str,
    include_hidden_text: bool,
    title: bool,
) -> Result<String, Error> {
    let mut request = Envelope::new();
    request.document(document_json)?;
    request.boolean("includeHiddenText", include_hidden_text);
    if title {
        request.boolean("title", true);
    }
    Ok(request.close())
}

// The runtime reads the title flag only from a wrapper: on a bare document,
// title is the title string itself.
fn title_request(document_json: &str) -> Result<String, Error> {
    let mut request = Envelope::new();
    request.document(document_json)?;
    request.boolean("title", true);
    Ok(request.close())
}

// The entries are built before the document is parsed, as C# does, so
// page_href runs even for a document that then fails to parse.
fn pages_request(
    document_json: &str,
    pages: Option<&Pages>,
    page_href: Option<PageHref<'_>>,
    title: bool,
) -> Result<String, Error> {
    let pages = pages.ok_or(Error::NullArgument { name: "pages" })?;
    let mut entries = Envelope::new();
    for (page_id, info) in deduplicate(pages) {
        let entry = page_entry(page_id, info.as_ref(), page_href);
        entries.raw(page_id, &entry);
    }
    let mut request = Envelope::new();
    request.document(document_json)?;
    request.raw("pages", &entries.close_bytes());
    if title {
        request.boolean("title", true);
    }
    Ok(request.close())
}

fn page_entry(page_id: &str, info: Option<&PageInfo>, page_href: Option<PageHref<'_>>) -> Vec<u8> {
    let Some(info) = info else {
        return b"null".to_vec();
    };
    let mut entry = Envelope::new();
    if info.no_access {
        entry.str("access", "none");
        return entry.close_bytes();
    }
    if let Some(title) = &info.title {
        entry.str("title", title);
    }
    if let Some(icon) = &info.icon {
        let mut written = Envelope::new();
        match icon {
            PageIcon::Image(url) => {
                written.str("type", "image");
                written.str("url", url);
            }
            PageIcon::Emoji(value) => {
                written.str("type", "emoji");
                written.str("value", value);
            }
        }
        entry.raw("icon", &written.close_bytes());
    }
    if let Some(page_href) = page_href {
        let href = page_href(page_id);
        if !href.is_empty() {
            entry.str("href", &href);
        }
    }
    entry.close_bytes()
}
