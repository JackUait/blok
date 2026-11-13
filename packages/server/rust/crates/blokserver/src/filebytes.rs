//! GET /file-bytes?url=: a PDF's bytes for the editor's preview, one Range
//! at a time, and the opt-in CORS on stored local files.

use std::io::SeekFrom;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_dotnet::query_first;
use blok_http::{Request, ResponseWriter};
use blok_outbound::wire::Headers as FetchedHeaders;
use blok_outbound::{ByteRange, Failure, Limits, is_failure};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::options::Clock;
use crate::outbound::{fetch, fetch_caller, hop_budget, query};
use crate::server::{Inner, first_value, lock, write_text};

/// The PDF check: "%PDF-" within a file's first PDF_CHECK_BYTES bytes, on
/// every request. A final URL that passed is trusted for PDF_CHECK_TTL.
const PDF_CHECK_BYTES: u64 = 1024;
const PDF_CHECK_ENTRIES: usize = 256;
const PDF_CHECK_TTL: Duration = Duration::from_secs(10 * 60);

/// Caps one answer, which is read whole before it is written. A larger
/// answer is refused 413: ask for a Range. The editor reads in chunks of at
/// most this size.
const ANSWER_BYTES: u64 = 1 << 20;

const PDF_MAGIC: &[u8] = b"%PDF-";

const EXPOSED: &str = "Accept-Ranges, Content-Length, Content-Range";

/// Final URLs (after redirects) that passed the check, least recently used
/// first out. Keyed by the final URL, so a redirect that later points
/// somewhere else is checked again.
pub(crate) struct PdfCheckCache {
    now: Clock,
    /// Most recently used last.
    entries: Mutex<Vec<(String, std::time::SystemTime)>>,
}

impl PdfCheckCache {
    pub(crate) fn new(now: Clock) -> Self {
        Self {
            now,
            entries: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn has(&self, url: &str) -> bool {
        let mut entries = lock(&self.entries);
        let Some(at) = entries.iter().position(|(u, _)| u == url) else {
            return false;
        };
        let entry = entries.remove(at);
        // A clock that went back reads as not yet expired.
        if (self.now)()
            .duration_since(entry.1)
            .is_ok_and(|age| age >= PDF_CHECK_TTL)
        {
            return false;
        }
        entries.push(entry);
        true
    }

    pub(crate) fn add(&self, url: &str) {
        let now = (self.now)();
        let mut entries = lock(&self.entries);
        entries.retain(|(u, _)| u != url);
        entries.push((url.to_owned(), now));
        if entries.len() > PDF_CHECK_ENTRIES {
            entries.remove(0);
        }
    }
}

fn contains_magic(bytes: &[u8]) -> bool {
    bytes.windows(PDF_MAGIC.len()).any(|w| w == PDF_MAGIC)
}

pub(crate) async fn file_bytes(inner: Arc<Inner>, request: Request, mut response: ResponseWriter) {
    let target = query_first(query(&request), "url");
    if target.is_empty() {
        write_text(&mut response, 400, "expected ?url=...\n").await;
        return;
    }
    let range = requested_range(&request);
    let o = &inner.options;
    // The same match Local.delete makes: stored URLs are public_url + key.
    if !o.storage_directory.is_empty()
        && o.s3_bucket.is_empty()
        && let Some(key) = blok_blob::key_from_public_url(&o.public_url, &target)
    {
        serve_stored_pdf(&inner, &mut response, &key, range).await;
        return;
    }
    serve_remote_pdf(&inner, &request, &mut response, &target, range).await;
}

/// The one Range forwarded: "bytes=a-b" or "bytes=a-". Anything else is
/// ignored and the whole file is served.
fn requested_range(request: &Request) -> Option<ByteRange> {
    let mut values = request.headers().get_all("Range");
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start = parse_digits(start)?;
    if end.is_empty() {
        return Some(ByteRange { start, end: None });
    }
    let end = parse_digits(end).filter(|&end| end >= start)?;
    Some(ByteRange {
        start,
        end: Some(end),
    })
}

/// ASCII digits only: no sign, no space. Go's ParseInt range, so a value
/// past i64 is refused as there.
fn parse_digits(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse::<i64>().ok().map(|n| n as u64)
}

async fn serve_stored_pdf(
    inner: &Inner,
    response: &mut ResponseWriter,
    key: &str,
    range: Option<ByteRange>,
) {
    let path = std::path::Path::new(&inner.options.storage_directory).join(key);
    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        write_text(response, 404, "not found\n").await;
        return;
    };
    let size = match file.metadata().await {
        Ok(info) if !info.is_dir() => info.len(),
        _ => {
            write_text(response, 404, "not found\n").await;
            return;
        }
    };
    if size > u64::try_from(inner.options.file_bytes_max_bytes).unwrap_or(0) {
        write_text(response, 413, "file too large\n").await;
        return;
    }
    let mut head = Vec::new();
    if (&mut file)
        .take(PDF_CHECK_BYTES)
        .read_to_end(&mut head)
        .await
        .is_err()
        || !contains_magic(&head)
    {
        write_text(response, 415, "not a pdf\n").await;
        return;
    }
    let (mut status, mut start, mut length) = (200, 0, size);
    if let Some(range) = range {
        if range.start >= size {
            response
                .headers_mut()
                .set("Content-Range", format!("bytes */{size}"));
            write_text(response, 416, "range not satisfiable\n").await;
            return;
        }
        let end = range.end.map_or(size - 1, |end| end.min(size - 1));
        (status, start, length) = (206, range.start, end - range.start + 1);
    }
    // The same cap as a fetched answer, so both sources behave alike.
    if length > ANSWER_BYTES {
        write_text(response, 413, "range too large\n").await;
        return;
    }
    let mut body = Vec::new();
    if file.seek(SeekFrom::Start(start)).await.is_ok() {
        let _ = file.take(length).read_to_end(&mut body).await;
    }
    write_pdf(response, status, start, &body, length, Some(size)).await;
}

async fn serve_remote_pdf(
    inner: &Arc<Inner>,
    request: &Request,
    response: &mut ResponseWriter,
    target: &str,
    range: Option<ByteRange>,
) {
    let cancel = request.cancel_token();
    let limits = Limits {
        timeout: Duration::from_secs(120),
        max_bytes: ANSWER_BYTES,
        max_redirects: 5,
        hop: Some(hop_budget(inner, request)),
        truncate: false,
        upload: true,
        caller: fetch_caller(inner, request),
        range,
    };
    let Some(result) = fetch(inner, &cancel, target, &limits).await else {
        return;
    };
    if is_failure(&result, Failure::TooLarge) {
        write_text(response, 413, "range too large\n").await;
        return;
    }
    let failed = "the URL could not be fetched\n";
    let Ok(mut fetched) = result else {
        if !cancel.is_cancelled() {
            write_text(response, 502, failed).await;
        }
        return;
    };
    // Read whole first and freed before any write: a client that stops
    // reading must never hold a shared fetch slot.
    fetched.release();
    let extent = upstream_extent(fetched.status_code, &fetched.header, fetched.body.len());
    let Some((start, total)) =
        extent.filter(|_| (200..=299).contains(&fetched.status_code) && !encoded(&fetched.header))
    else {
        if !cancel.is_cancelled() {
            write_text(response, 502, failed).await;
        }
        return;
    };
    if total
        .is_some_and(|total| total > u64::try_from(inner.options.file_bytes_max_bytes).unwrap_or(0))
    {
        write_text(response, 413, "file too large\n").await;
        return;
    }
    if !inner.pdf_checks.has(&fetched.final_url) {
        let head = &fetched.body[..fetched.body.len().min(PDF_CHECK_BYTES as usize)];
        if start != 0 || !contains_magic(head) {
            // A second fetch, charged like a redirect hop.
            if !hop_budget(inner, request)() {
                write_text(response, 429, "rate limit exceeded\n").await;
                return;
            }
            let Some(probe) = probe_pdf(inner, request, &fetched.final_url).await else {
                return;
            };
            match probe {
                Err(()) => {
                    if !cancel.is_cancelled() {
                        write_text(response, 502, failed).await;
                    }
                    return;
                }
                Ok(false) => {
                    write_text(response, 415, "not a pdf\n").await;
                    return;
                }
                Ok(true) => {}
            }
        }
        inner.pdf_checks.add(&fetched.final_url);
    }
    let status = if fetched.status_code == 206 { 206 } else { 200 };
    let length = fetched.body.len() as u64;
    write_pdf(response, status, start, &fetched.body, length, total).await;
}

/// Reads the first PDF_CHECK_BYTES of url. None when the request was
/// cancelled first.
async fn probe_pdf(inner: &Arc<Inner>, request: &Request, url: &str) -> Option<Result<bool, ()>> {
    let limits = Limits {
        timeout: Duration::from_secs(10),
        max_bytes: PDF_CHECK_BYTES,
        max_redirects: 5,
        hop: Some(hop_budget(inner, request)),
        truncate: true,
        upload: false,
        caller: fetch_caller(inner, request),
        range: Some(ByteRange {
            start: 0,
            end: Some(PDF_CHECK_BYTES - 1),
        }),
    };
    let probe = fetch(inner, &request.cancel_token(), url, &limits).await?;
    Some(match probe {
        Ok(probe) if (200..=299).contains(&probe.status_code) && !encoded(&probe.header) => {
            Ok(contains_magic(&probe.body))
        }
        _ => Err(()),
    })
}

/// Any Content-Encoding but identity: decoding would move every byte offset
/// a Range names.
fn encoded(headers: &FetchedHeaders) -> bool {
    headers.values("Content-Encoding").any(|line| {
        line.split(|&c| c == b',').any(|token| {
            let token = token.trim_ascii();
            !token.is_empty() && !token.eq_ignore_ascii_case(b"identity")
        })
    })
}

/// Where the body sits in the file: a 206's Content-Range, which must match
/// the body, else the whole file. The total is None when unknown.
fn upstream_extent(
    status: u16,
    headers: &FetchedHeaders,
    length: usize,
) -> Option<(u64, Option<u64>)> {
    let length = length as u64;
    if status != 206 {
        return Some((0, Some(length)));
    }
    let spec = headers.get("Content-Range").unwrap_or_default();
    let spec = std::str::from_utf8(spec).ok()?.strip_prefix("bytes ")?;
    let (span, total) = spec.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let (start, end) = (parse_digits(start)?, parse_digits(end)?);
    if end < start || end - start + 1 != length {
        return None;
    }
    if total == "*" {
        return Some((start, None));
    }
    let total = parse_digits(total).filter(|&total| end < total)?;
    Some((start, Some(total)))
}

/// Writes a PDF answer with every header it carries. A total of None is an
/// unknown size.
async fn write_pdf(
    response: &mut ResponseWriter,
    status: u16,
    start: u64,
    body: &[u8],
    length: u64,
    total: Option<u64>,
) {
    let headers = response.headers_mut();
    headers.set("Content-Type", "application/pdf");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "sandbox");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Access-Control-Expose-Headers", EXPOSED);
    // Set, not add: one line over the guard's "Vary: Origin".
    headers.set("Vary", "Origin, Authorization");
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("Content-Length", length.to_string());
    if status == 206 {
        let size = total.map_or_else(|| "*".to_owned(), |total| total.to_string());
        headers.set(
            "Content-Range",
            format!("bytes {start}-{}/{size}", start + length - 1),
        );
    }
    if response.start(status).await.is_ok() {
        let _ = response.write(body).await;
    }
}

/// Lets an allowed origin read a stored file, when files_cors is on.
pub(crate) fn files_cors(inner: &Inner, request: &Request, response: &mut ResponseWriter) {
    if !inner.options.files_cors {
        return;
    }
    let origin = first_value(request, "Origin");
    let allowed = inner.origin_allowed(origin);
    let headers = response.headers_mut();
    headers.add("Vary", "Origin");
    if allowed {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Expose-Headers", EXPOSED);
    }
}

#[cfg(test)]
#[path = "filebytes_test.rs"]
mod tests;
