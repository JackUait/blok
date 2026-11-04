use std::collections::{HashMap, HashSet};

use blok_jsjson::{Str, Value, to_string_lossy};

use crate::export::{DataError, RichTextHtml};
use crate::fields::RichTextFields;

/// What the seed and edit paths do with a rich field's HTML (C#
/// RichTextInput.cs). HTML needs the runtime, which the converter never
/// calls, so the caller walks twice: once `collecting` to learn the HTML,
/// then `converting` with the answers. Unanswered HTML is refused, so a path
/// that skipped the conversion fails instead of storing HTML as text.
pub struct RichTextInput<'a> {
    pub fields: &'a RichTextFields,
    converted: Option<HashMap<Str, Vec<Value>>>,
    collect: bool,
    found: Vec<RichTextHtml>,
    seen: HashSet<Str>,
}

impl<'a> RichTextInput<'a> {
    /// Refuses every non-empty HTML string.
    pub fn refusing(fields: &'a RichTextFields) -> RichTextInput<'a> {
        RichTextInput {
            fields,
            converted: None,
            collect: false,
            found: Vec::new(),
            seen: HashSet::new(),
        }
    }

    /// Records each HTML string once and reads it as empty.
    pub fn collecting(fields: &'a RichTextFields) -> RichTextInput<'a> {
        RichTextInput {
            collect: true,
            ..RichTextInput::refusing(fields)
        }
    }

    /// Answers each HTML string with the segments read from it, keyed by the
    /// exact string.
    pub fn converting(
        fields: &'a RichTextFields,
        converted: HashMap<Str, Vec<Value>>,
    ) -> RichTextInput<'a> {
        RichTextInput {
            converted: Some(converted),
            ..RichTextInput::refusing(fields)
        }
    }

    /// The HTML met so far, each string once, in the order met.
    pub fn found(&self) -> &[RichTextHtml] {
        &self.found
    }

    /// Segments for one HTML string, still to be screened and canonicalised.
    /// An empty string is an empty text and needs no runtime.
    pub fn segments(
        &mut self,
        kind: &[u16],
        field: &[u16],
        html: &[u16],
    ) -> Result<Vec<Value>, DataError> {
        if html.is_empty() {
            return Ok(Vec::new());
        }
        if let Some(segments) = self
            .converted
            .as_ref()
            .and_then(|c| c.get(&Str::from(html)))
        {
            return Ok(segments.clone());
        }
        if self.collect {
            if self.seen.insert(Str::from(html)) {
                self.found.push(RichTextHtml {
                    kind: Str::from(kind),
                    field: Str::from(field),
                    html: Str::from(html),
                });
            }
            return Ok(Vec::new());
        }
        Err(DataError::new(format!(
            "collab: rich text field \"{}.{}\" holds HTML that was not converted to segments.",
            to_string_lossy(kind),
            to_string_lossy(field)
        )))
    }
}
