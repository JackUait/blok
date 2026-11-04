//! POST /delete and the JSON envelope the C# JSON routes read.

use std::sync::Arc;

use blok_blob::Error as BlobError;
use blok_http::{BodyError, Request, ResponseWriter};
use blok_jsjson::{Kind, Options, parse_node, to_string_lossy};
use blok_mediatype::is_json;

use crate::server::{Inner, first_value, write_json, write_text};

pub(crate) type BoxFuture<'a, T> =
    std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

pub(crate) const MAX_ENVELOPE_BYTES: usize = 8 << 10;

/// A request body to read from: blok-http's Body, or a test's reader.
pub(crate) trait Source: Send {
    fn read<'a>(&'a mut self, buf: &'a mut [u8]) -> BoxFuture<'a, Result<usize, BodyError>>;
}

impl Source for blok_http::Body {
    fn read<'a>(&'a mut self, buf: &'a mut [u8]) -> BoxFuture<'a, Result<usize, BodyError>> {
        Box::pin(blok_http::Body::read(self, buf))
    }
}

/// No body at all reads as empty.
pub(crate) struct Empty;

impl Source for Empty {
    fn read<'a>(&'a mut self, _buf: &'a mut [u8]) -> BoxFuture<'a, Result<usize, BodyError>> {
        Box::pin(async { Ok(0) })
    }
}

pub(crate) fn body_of(request: &mut Request) -> Box<dyn Source> {
    match request.take_body() {
        Some(body) => Box::new(body),
        None => Box::new(Empty),
    }
}

/// Reads {"url": "..."} the way the C# JSON routes do: at most 8 KiB (read
/// no further than one byte past it), names in any case, the last repeat
/// winning, a non-empty string url, and nothing but space after the object.
pub(crate) async fn read_envelope(body: &mut dyn Source) -> Option<String> {
    let mut data = vec![0u8; MAX_ENVELOPE_BYTES + 1];
    let mut filled = 0;
    while filled < data.len() {
        match body.read(&mut data[filled..]).await {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => return None,
        }
    }
    if filled > MAX_ENVELOPE_BYTES {
        return None;
    }
    let node = parse_node(&data[..filled], Options::default()).ok()?;
    if node.kind != Kind::Object {
        return None;
    }
    let mut target = String::new();
    for member in &node.members {
        let Ok(key) = member.key() else { continue };
        if !to_string_lossy(key.units()).eq_ignore_ascii_case("url") {
            continue;
        }
        match member.value.kind {
            Kind::Null => {}
            Kind::String => target = to_string_lossy(member.value.text().ok()?.units()),
            _ => return None,
        }
    }
    (!target.is_empty()).then_some(target)
}

/// DeleteEndpoint.
pub(crate) async fn delete(inner: Arc<Inner>, mut request: Request, mut response: ResponseWriter) {
    if !is_json(first_value(&request, "Content-Type")) {
        write_text(&mut response, 415, "expected application/json\n").await;
        return;
    }
    let mut body = body_of(&mut request);
    let Some(target) = read_envelope(body.as_mut()).await else {
        write_text(&mut response, 400, "expected {\"url\": \"...\"}\n").await;
        return;
    };
    let cancel = request.cancel_token();
    let cancelled = move || cancel.is_cancelled();
    let result = match inner.blob_store() {
        Ok(store) => store.delete(&target, &cancelled).await,
        Err(error) => Err(BlobError::Io(std::io::Error::other(error))),
    };
    match result {
        // A URL never issued looks like one issued and forgotten, so a
        // caller cannot probe another store through this one.
        Err(BlobError::Foreign) => write_text(&mut response, 404, "not found\n").await,
        Err(_) => {
            if !request.is_cancelled() {
                write_text(&mut response, 502, "delete failed\n").await;
            }
        }
        Ok(()) => write_json(&mut response, 200, b"{\"success\":1}\n").await,
    }
}

#[cfg(test)]
#[path = "envelope_test.rs"]
mod tests;
