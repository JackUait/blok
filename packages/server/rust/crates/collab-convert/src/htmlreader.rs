use std::future::Future;
use std::time::Duration;

use blok_jsjson::{Object, Str, Value};
use blok_jsruntime::{InvokeError, Pool};

use crate::error::Error;
use crate::export::{DataError, RichTextHtml, to_json_array};

/// The HTML one edit field may carry, in UTF-16 units (C#
/// CollabDocConverter.MaxEditHtmlChars).
pub const MAX_EDIT_HTML_CHARS: usize = 32768;

/// The HTML one runtime call may carry. Equal to the edit cap, so two capped
/// fields never share a call; a larger field goes alone.
pub const MAX_CALL_CHARS: usize = MAX_EDIT_HTML_CHARS;

/// Runs one runtime op; `blok_jsruntime::Pool` is one. A zero timeout is the
/// runtime's default. Dropping the future cancels the call.
pub trait Invoker {
    fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Duration,
    ) -> impl Future<Output = Result<String, InvokeError>> + Send;
}

impl Invoker for Pool {
    fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Duration,
    ) -> impl Future<Output = Result<String, InvokeError>> + Send {
        Pool::invoke(self, op, input, timeout)
    }
}

/// Reads HTML rich text fields as segments, in the same order.
pub trait HtmlReader {
    fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> impl Future<Output = Result<Vec<Vec<Value>>, Error>> + Send;
}

/// The client's own reader, run in the embedded runtime through its
/// htmlFieldsToSegments op, one call per batch.
pub struct RuntimeHtmlReader<I> {
    pub runtime: I,
}

impl<I: Invoker + Sync> HtmlReader for RuntimeHtmlReader<I> {
    async fn read(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, Error> {
        let mut read = Vec::with_capacity(fields.len());
        let mut start = 0;
        while start < fields.len() {
            let mut end = start + 1;
            let mut chars = fields[start].html.len();
            while end < fields.len() && chars + fields[end].html.len() <= MAX_CALL_CHARS {
                chars += fields[end].html.len();
                end += 1;
            }
            read.extend(self.call(&fields[start..end], timeout).await?);
            start = end;
        }
        Ok(read)
    }
}

impl<I: Invoker + Sync> RuntimeHtmlReader<I> {
    async fn call(
        &self,
        fields: &[RichTextHtml],
        timeout: Duration,
    ) -> Result<Vec<Vec<Value>>, Error> {
        let request = fields
            .iter()
            .map(|field| {
                let mut entry = Object::new();
                entry.set(Str::from("type"), Value::String(field.kind.clone()));
                entry.set(Str::from("field"), Value::String(field.field.clone()));
                entry.set(Str::from("html"), Value::String(field.html.clone()));
                Value::Object(entry)
            })
            .collect();
        // JS JSON both ways: it carries a lone surrogate the way JS does.
        let input = blok_jsjson::stringify(&Value::Array(request))?;
        let answer = self
            .runtime
            .invoke("htmlFieldsToSegments", &input, timeout)
            .await?;
        let entries = match blok_jsjson::parse(answer.as_bytes()) {
            Ok(Value::Array(entries)) if entries.len() == fields.len() => entries,
            _ => {
                return Err(DataError::new(
                    "collab: the runtime answered htmlFieldsToSegments with the wrong shape.",
                )
                .into());
            }
        };
        entries
            .iter()
            .map(|item| {
                let segments = match item {
                    Value::Object(answered) => answered.get(&Str::from("segments")),
                    _ => None,
                };
                match segments {
                    Some(Value::Array(segments)) => Ok(to_json_array(segments)?),
                    _ => Err(DataError::new(
                        "collab: the runtime answered a field without segments.",
                    )
                    .into()),
                }
            })
            .collect()
    }
}
