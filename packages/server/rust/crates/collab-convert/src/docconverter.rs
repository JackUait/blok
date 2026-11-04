use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_jsjson::{Kind, Node, Object, Str, Value};
use blok_jsruntime::{Error as RuntimeError, Failure, InvokeError, Kind as FailureKind};
use blok_yjs::Doc;

use crate::apply::{apply_ops, collect_ops_html};
use crate::editops::{EditError, EditOp, member};
use crate::error::Error;
use crate::export::{DataError, RichTextHtml, RichTextHtmlSlot, export, export_page};
use crate::fields::RichTextFields;
use crate::htmlreader::{HtmlReader, MAX_EDIT_HTML_CHARS};
use crate::migrate::{collect_legacy_rich_text, migrate_rich_text};
use crate::richtextinput::RichTextInput;
use crate::seed::{SourceValue, collect_seed_html, seed, strict_value};

/// The one-time budget a seed and a migration read HTML with: they may read
/// a field far larger than any edit sends.
pub const MIGRATION_READ_TIMEOUT: Duration = Duration::from_secs(60);

/// C#'s CollabTransientException: a failure a retry may heal.
#[derive(Debug)]
pub struct TransientError {
    pub message: String,
    pub err: Box<Error>,
}

impl fmt::Display for TransientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TransientError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.err.as_ref())
    }
}

pub type Clock = Box<dyn Fn() -> SystemTime + Send + Sync>;
pub type Log = Box<dyn Fn(&str) + Send + Sync>;

/// The room's adapter to the converter (C# CollabDocConverter): it reads
/// rich text HTML through the runtime around the synchronous walks. A
/// caller cancels a call by dropping its future, which drops the read.
pub struct DocConverter<R> {
    pub now: Clock,
    pub html: R,
    /// None is the built-ins.
    pub fields: Option<RichTextFields>,
    pub log: Option<Log>,
}

fn built_in() -> &'static RichTextFields {
    static FIELDS: OnceLock<RichTextFields> = OnceLock::new();
    FIELDS.get_or_init(RichTextFields::built_in)
}

/// Go's Time.UnixMilli: whole milliseconds, rounded down.
fn unix_milli(at: SystemTime) -> i64 {
    match at.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_millis() as i64,
        Err(before) => {
            let before = before.duration();
            let millis = before.as_millis() as i64;
            if before.as_nanos() % 1_000_000 == 0 {
                -millis
            } else {
                -millis - 1
            }
        }
    }
}

impl<R: HtmlReader + Sync> DocConverter<R> {
    fn fields(&self) -> &RichTextFields {
        self.fields.as_ref().unwrap_or_else(|| built_in())
    }

    /// Writes an OutputData object's blocks, title and icon into doc.
    pub async fn seed(&self, doc: &Doc, output_data: &Node) -> Result<(), Error> {
        if output_data.kind != Kind::Object {
            return Err(DataError::new("collab: the document is not a JSON object.").into());
        }
        let blocks = match member(output_data, "blocks").map_err(Error::NotUnicode)? {
            Some(blocks) if blocks.kind == Kind::Array => blocks,
            _ => return Err(DataError::new("collab: the document has no blocks array.").into()),
        };
        let found = collect_seed_html(&blocks.items, self.fields())?;
        let read = self.read(&found, MIGRATION_READ_TIMEOUT).await?;
        let mut page = Object::new();
        for key in ["title", "icon"] {
            let value = match member(output_data, key).map_err(Error::NotUnicode)? {
                Some(node) => strict_value(node)?,
                None => SourceValue::Null,
            };
            page.set(Str::from(key), value);
        }
        seed(
            doc,
            &blocks.items,
            &mut RichTextInput::converting(self.fields(), read),
            Some(&page),
        )
    }

    /// Applies edit ops, reading their HTML first. Collecting plans the
    /// whole request, so a refusal comes before any read; apply_ops plans
    /// again against the doc as it is after the read.
    pub async fn apply_ops(&self, doc: &Doc, ops: &[EditOp]) -> Result<(), Error> {
        let found = collect_ops_html(doc, ops, self.fields())?;
        if let Some(huge) = found.iter().find(|h| h.html.len() > MAX_EDIT_HTML_CHARS) {
            // The room answers 413 only for this inner failure.
            return Err(EditError {
                message: format!(
                    "collab: rich text field \"{}.{}\" holds {} HTML characters; an edit may send at most {}.",
                    huge.kind,
                    huge.field,
                    huge.html.len(),
                    MAX_EDIT_HTML_CHARS
                ),
                err: Some(Box::new(Error::Runtime(InvokeError::Failure(Failure {
                    kind: FailureKind::DocumentTooLarge,
                    err: RuntimeError::Engine("the HTML is past the edit cap".to_owned()),
                })))),
            }
            .into());
        }
        let read = match self.read(&found, Duration::ZERO).await {
            Ok(read) => read,
            Err(err) if is_transient(&err) && !is_too_large(&err) => {
                // Nothing is written yet: the room retries this one request.
                return Err(Error::Transient(TransientError {
                    message: format!(
                        "collab: reading the rich text HTML in this edit ran past the runtime's limits: {err}"
                    ),
                    err: Box::new(err),
                }));
            }
            Err(err) => {
                // Any other error here would read as a half-written commit
                // and close the room, so it refuses this one request instead.
                return Err(EditError {
                    message: format!(
                        "collab: the rich text HTML in this edit could not be read: {err}"
                    ),
                    err: Some(Box::new(err)),
                }
                .into());
            }
        };
        apply_ops(
            doc,
            ops,
            &mut RichTextInput::converting(self.fields(), read),
        )
    }

    /// Reads a format-1 room's legacy HTML with the one-time budget, then
    /// migrates it to formatted text; it returns the field count.
    pub async fn migrate_rich_text(&self, doc: &Doc) -> Result<usize, Error> {
        let found = collect_legacy_rich_text(doc, self.fields())?;
        let read = self.read(&found, MIGRATION_READ_TIMEOUT).await?;
        migrate_rich_text(doc, &mut RichTextInput::converting(self.fields(), read))
    }

    /// {time, blocks, title?, icon?}, the legacy HTML slots read to segments.
    /// `time` is a BigInt: Go's int64, written as a plain integer.
    pub async fn export(&self, doc: &Doc) -> Result<Object, Error> {
        let now = unix_milli((self.now)());
        let (mut blocks, slots) = match &self.log {
            Some(log) => {
                let mut warn = |message: &str| log(message);
                export(doc, self.fields(), Some(&mut warn))?
            }
            None => export(doc, self.fields(), None)?,
        };
        // Read with the blocks, before any wait, so both come from one state.
        let page = export_page(doc)?;
        self.resolve(&mut blocks, &slots).await?;
        let mut output = Object::new();
        output.set(Str::from("time"), Value::BigInt(now));
        output.set(Str::from("blocks"), Value::Array(blocks));
        for m in page.members() {
            output.set(m.key.clone(), m.value.clone());
        }
        Ok(output)
    }

    /// Exports with each distinct warning logged once per warned set.
    pub fn export_blocks(
        &self,
        doc: &Doc,
        warned: &mut HashSet<String>,
    ) -> Result<(Vec<Value>, Vec<RichTextHtmlSlot>), Error> {
        let Some(log) = &self.log else {
            return export(doc, self.fields(), None);
        };
        let mut warn = |message: &str| {
            if warned.insert(message.to_owned()) {
                log(message);
            }
        };
        export(doc, self.fields(), Some(&mut warn))
    }

    /// Reads each slot's HTML and writes the segments into `blocks`, the
    /// array the slots were exported with.
    pub async fn resolve(
        &self,
        blocks: &mut [Value],
        slots: &[RichTextHtmlSlot],
    ) -> Result<(), Error> {
        if slots.is_empty() {
            return Ok(());
        }
        let found: Vec<RichTextHtml> = slots.iter().map(|slot| slot.html.clone()).collect();
        let read = match self.read(&found, Duration::ZERO).await {
            Ok(read) => read,
            // A JavaScript error or a malformed answer repeats on every
            // attempt and keeps the refusal path, or a journal room would
            // retry forever.
            Err(err) if is_transient(&err) => {
                return Err(Error::Transient(TransientError {
                    message: format!(
                        "collab: the rich text HTML in this document could not be read: {err}"
                    ),
                    err: Box::new(err),
                }));
            }
            Err(err) => return Err(err),
        };
        for slot in slots {
            // A Go map miss is nil.
            let segments = read
                .get(&slot.html.html)
                .map_or(Value::Null, |segments| Value::Array(segments.clone()));
            if let Some(target) = slot.target_mut(blocks) {
                target.set(slot.key.clone(), segments);
            }
        }
        Ok(())
    }

    /// Each distinct non-empty HTML string's segments; "" is an empty text.
    async fn read(
        &self,
        found: &[RichTextHtml],
        timeout: Duration,
    ) -> Result<HashMap<Str, Vec<Value>>, Error> {
        let mut distinct = Vec::new();
        let mut seen = HashSet::new();
        for field in found {
            if !field.html.is_empty() && seen.insert(field.html.clone()) {
                distinct.push(field.clone());
            }
        }
        let mut read = HashMap::from([(Str::from(""), Vec::new())]);
        if distinct.is_empty() {
            return Ok(read);
        }
        let segments = self.html.read(&distinct, timeout).await?;
        for (field, segments) in distinct.into_iter().zip(segments) {
            read.insert(field.html, segments);
        }
        Ok(read)
    }
}

fn runtime_failure(err: &Error) -> Option<&Failure> {
    match err {
        Error::Runtime(InvokeError::Failure(failure)) => Some(failure),
        _ => None,
    }
}

/// The runtime's timeout or memory budget. Go's other case, a wait
/// cancelled by someone other than the caller, has no Rust form: a call is
/// cancelled only by dropping its future.
pub fn is_transient(err: &Error) -> bool {
    runtime_failure(err).is_some_and(|failure| {
        matches!(
            failure.kind,
            FailureKind::TimedOut | FailureKind::DocumentTooLarge
        )
    })
}

/// The runtime's memory budget, which a retry of the same body cannot heal.
pub fn is_too_large(err: &Error) -> bool {
    runtime_failure(err).is_some_and(|failure| failure.kind == FailureKind::DocumentTooLarge)
}
