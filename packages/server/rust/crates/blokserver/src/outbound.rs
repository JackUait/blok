//! GET /unfurl, POST /upload-by-url and GET /frame-check: the routes that
//! fetch a URL the caller chose, through the guarded fetcher.

use std::sync::Arc;
use std::time::{Duration, Instant};

use blok_blob::{Body as BlobBody, Error as BlobError, extension, normalize_extension};
use blok_dotnet::{parse_absolute_uri, query_first, unescape_data_string};
use blok_http::{CancelToken, Request, ResponseWriter};
use blok_jsjson::append_quoted;
use blok_mediatype::{is_json, sanitize_wire};
use blok_outbound::{Error as FetchError, Limits, Response};

use crate::handlers::{body_of, read_envelope};
use crate::server::{Inner, RateKey, first_value, upload_response, write_json, write_text};
use crate::upload::sanitize_file_name;

const MAX_OEMBED_BYTES: u64 = 64 << 10;

const FRAMING_HEADERS: [&str; 2] = ["Content-Security-Policy", "X-Frame-Options"];

fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// Charges each outbound redirect hop to the caller's rate-limit key, the
/// one the guard charged for the request itself.
pub(crate) fn hop_budget(
    inner: &Arc<Inner>,
    request: &Request,
) -> Arc<dyn Fn() -> bool + Send + Sync> {
    let key = request
        .extensions
        .get::<RateKey>()
        .map(|key| key.0.clone())
        .unwrap_or_default();
    let inner = Arc::clone(inner);
    Arc::new(move || inner.limiter.allow(&key))
}

/// The key the fetcher's per-caller lanes share: the one the guard charged.
/// With the rate limit off there are no per-caller limits.
pub(crate) fn fetch_caller(inner: &Inner, request: &Request) -> String {
    if inner.options.rate_limit_per_minute <= 0 {
        return String::new();
    }
    request
        .extensions
        .get::<RateKey>()
        .map(|key| key.0.clone())
        .unwrap_or_default()
}

/// The fetch, or None when the request was cancelled first: then nothing is
/// answered, as the C# endpoints let the cancellation end the request.
pub(crate) async fn fetch(
    inner: &Inner,
    cancel: &CancelToken,
    url: &str,
    limits: &Limits,
) -> Option<Result<Response, FetchError>> {
    let fetcher = inner.fetcher();
    tokio::select! {
        result = fetcher.get(url, limits) => Some(result),
        () = cancel.cancelled() => None,
    }
}

pub(crate) fn query(request: &Request) -> &str {
    request.query().strip_prefix('?').unwrap_or(request.query())
}

/// UnfurlEndpoint: 400 {"success":0} without a url, 200 {"success":0} for
/// any fetch failure, else the metadata.
pub(crate) async fn unfurl(inner: Arc<Inner>, request: Request, mut response: ResponseWriter) {
    let target = query_first(query(&request), "url");
    if target.is_empty() {
        write_json(&mut response, 400, b"{\"success\":0}\n").await;
        return;
    }
    let mut limits = unfurl_limits(hop_budget(&inner, &request));
    limits.caller = fetch_caller(&inner, &request);
    let cancel = request.cancel_token();
    let Some(result) = fetch(&inner, &cancel, &target, &limits).await else {
        return;
    };
    let mut fetched = match result {
        Ok(fetched) if is_success(fetched.status_code) => fetched,
        _ => {
            if !cancel.is_cancelled() {
                write_json(&mut response, 200, b"{\"success\":0}\n").await;
            }
            return;
        }
    };
    let meta = blok_unfurl::parse(&fetched.body, &fetched.final_url);
    let final_url = std::mem::take(&mut fetched.final_url);
    drop(fetched);
    write_json(&mut response, 200, &unfurl_body(&final_url, &meta)).await;
}

fn unfurl_limits(hop: Arc<dyn Fn() -> bool + Send + Sync>) -> Limits {
    Limits {
        timeout: Duration::from_secs(10),
        max_bytes: 2 << 20,
        max_redirects: 5,
        hop: Some(hop),
        truncate: false,
        upload: false,
        caller: String::new(),
        range: None,
    }
}

fn is_success(status_code: u16) -> bool {
    (200..=299).contains(&status_code)
}

/// The success answer: empty scalars are left out, image stays an object.
fn unfurl_body(final_url: &str, meta: &blok_unfurl::Metadata) -> Vec<u8> {
    let mut body = br#"{"success":1,"link":"#.to_vec();
    append_quoted(&mut body, &units(final_url));
    body.extend_from_slice(br#","meta":{"#);
    let field = |body: &mut Vec<u8>, name: &str, value: &str, comma: bool| {
        if value.is_empty() {
            return;
        }
        if comma {
            body.push(b',');
        }
        body.extend_from_slice(format!("\"{name}\":").as_bytes());
        append_quoted(body, &units(value));
    };
    field(&mut body, "title", &meta.title, false);
    if !meta.title.is_empty() {
        body.push(b',');
    }
    field(&mut body, "description", &meta.description, false);
    if !meta.description.is_empty() {
        body.push(b',');
    }
    body.extend_from_slice(br#""image":{"#);
    field(&mut body, "url", &meta.image, false);
    body.push(b'}');
    field(&mut body, "favicon", &meta.favicon, true);
    field(&mut body, "domain", &meta.domain, true);
    body.extend_from_slice(b"}}\n");
    body
}

/// UploadByUrlEndpoint. The fetch slot is held until the store has the
/// bytes.
pub(crate) async fn upload_by_url(
    inner: Arc<Inner>,
    mut request: Request,
    mut response: ResponseWriter,
) {
    if !is_json(first_value(&request, "Content-Type")) {
        write_text(&mut response, 415, "expected application/json\n").await;
        return;
    }
    let mut body = body_of(&mut request);
    let Some(target) = read_envelope(body.as_mut()).await else {
        write_text(&mut response, 400, "expected {\"url\": \"...\"}\n").await;
        return;
    };
    let mut limits =
        upload_by_url_limits(inner.options.max_upload_bytes, hop_budget(&inner, &request));
    limits.caller = fetch_caller(&inner, &request);
    let cancel = request.cancel_token();
    let Some(result) = fetch(&inner, &cancel, &target, &limits).await else {
        return;
    };
    let mut fetched = match result {
        Ok(fetched) if is_success(fetched.status_code) => fetched,
        _ => {
            if !cancel.is_cancelled() {
                write_text(&mut response, 400, "the URL could not be fetched\n").await;
            }
            return;
        }
    };
    let file_name = name_from_url(&fetched.final_url);
    let mime_type = sanitize_wire(&fetched.content_type);
    let content = std::mem::take(&mut fetched.body);
    let size = content.len() as i64;
    let cancelled = move || cancel.is_cancelled();
    let stored = match inner.blob_store() {
        Ok(store) => {
            let extension = normalize_extension(extension(&file_name));
            store
                .put(&extension, &mime_type, BlobBody::bytes(content), &cancelled)
                .await
        }
        Err(error) => Err(BlobError::Io(std::io::Error::other(error))),
    };
    // The slot is held until here, as C#'s `await using` holds it.
    drop(fetched);
    match stored {
        Ok(url) => upload_response(&mut response, &url, &file_name, size, &mime_type).await,
        Err(_) if !cancelled() => write_text(&mut response, 502, "upload failed\n").await,
        Err(_) => {}
    }
}

fn upload_by_url_limits(max_upload_bytes: i64, hop: Arc<dyn Fn() -> bool + Send + Sync>) -> Limits {
    Limits {
        timeout: Duration::from_secs(120),
        max_bytes: u64::try_from(max_upload_bytes).unwrap_or(0),
        max_redirects: 5,
        hop: Some(hop),
        truncate: false,
        upload: true,
        caller: String::new(),
        range: None,
    }
}

fn name_from_url(raw: &str) -> String {
    match parse_absolute_uri(raw) {
        Some(url) if url.is_http() => sanitize_file_name(&unescape_data_string(&url.absolute_path)),
        _ => String::new(),
    }
}

/// FrameCheckEndpoint: GET /frame-check?url=, a UI hint for whether the
/// page would let the calling editor frame it. Never a security decision:
/// it cannot see cookies, the full ancestor chain or script frame-busting.
pub(crate) async fn frame_check(inner: Arc<Inner>, request: Request, mut response: ResponseWriter) {
    // The verdict depends on the caller's Origin, even when none was sent.
    if !header_has(response.headers(), "Vary", "Origin") {
        response.headers_mut().add("Vary", "Origin");
    }
    let target = query_first(query(&request), "url");
    if target.is_empty() {
        write_json(&mut response, 400, b"{\"verdict\":\"unknown\"}\n").await;
        return;
    }
    let started = Instant::now();
    let hop = hop_budget(&inner, &request);
    // 256 KiB of page is enough for the head. Truncated, never failed.
    let limits = Limits {
        timeout: Duration::from_secs(10),
        max_bytes: 256 << 10,
        max_redirects: 5,
        hop: Some(Arc::clone(&hop)),
        truncate: true,
        upload: false,
        caller: fetch_caller(&inner, &request),
        range: None,
    };
    let cancel = request.cancel_token();
    let Some(result) = fetch(&inner, &cancel, &target, &limits).await else {
        return;
    };
    let mut fetched = match result {
        Ok(fetched) if (200..=299).contains(&fetched.status_code) => fetched,
        _ => {
            if !cancel.is_cancelled() {
                write_json(&mut response, 200, b"{\"verdict\":\"unknown\"}\n").await;
            }
            return;
        }
    };
    let embedder = blok_framecheck::embedder(&frame_check_request(&request), |origin| {
        inner.origin_allowed(origin)
    });
    let mut headers = Vec::new();
    for name in FRAMING_HEADERS {
        for value in fetched.header.values(name) {
            headers.push(blok_framecheck::Header {
                name: name.to_owned(),
                value: String::from_utf8_lossy(value).into_owned(),
            });
        }
    }
    let verdict = blok_framecheck::verdict(&fetched.final_url, &embedder, &headers);
    let mut body = format!("{{\"verdict\":\"{verdict}\",\"link\":").into_bytes();
    append_quoted(&mut body, &units(&fetched.final_url));
    let oembed_url = blok_unfurl::parse(&fetched.body, &fetched.final_url).oembed;
    let redirects = fetched.redirects;
    // The page's slot is free again before the oEmbed fetch takes one.
    fetched.release();
    let remaining = limits.timeout.saturating_sub(started.elapsed());
    let oembed = fetch_oembed(
        &inner,
        &cancel,
        &oembed_url,
        remaining,
        limits.max_redirects.checked_sub(redirects),
        hop,
        limits.caller.clone(),
    )
    .await;
    if let Some(oembed) = oembed {
        body.extend_from_slice(b",\"oembed\":");
        body = oembed.append_json(body);
    }
    if cancel.is_cancelled() {
        return;
    }
    body.extend_from_slice(b"}\n");
    write_json(&mut response, 200, &body).await;
}

/// What the embedder choice reads. Self is the connection's own view, like
/// C#'s Request.Scheme and Request.Host without forwarded-header
/// middleware; this host serves plain HTTP only.
fn frame_check_request(request: &Request) -> blok_framecheck::Request {
    let host = first_value(request, "Host");
    blok_framecheck::Request {
        origin: first_value(request, "Origin").to_owned(),
        has_origin: request.headers().contains("Origin"),
        sec_fetch_site: first_value(request, "Sec-Fetch-Site").to_owned(),
        embedder: query_first(query(request), "embedder"),
        self_origin: if host.is_empty() {
            String::new()
        } else {
            format!("http://{host}")
        },
    }
}

/// Sends the discovered URL through the same guarded fetcher, on what is
/// left of the page's deadline and redirect budget, for one more hop.
async fn fetch_oembed(
    inner: &Inner,
    cancel: &CancelToken,
    url: &str,
    remaining: Duration,
    redirects: Option<usize>,
    hop: Arc<dyn Fn() -> bool + Send + Sync>,
    caller: String,
) -> Option<blok_framecheck::OEmbed> {
    let redirects = redirects?;
    if url.is_empty() || remaining.is_zero() || !hop() {
        return None;
    }
    let limits = Limits {
        timeout: remaining,
        max_bytes: MAX_OEMBED_BYTES,
        max_redirects: redirects,
        hop: Some(hop),
        truncate: false,
        upload: false,
        caller,
        range: None,
    };
    let fetched = fetch(inner, cancel, url, &limits).await?.ok()?;
    if !(200..=299).contains(&fetched.status_code) {
        return None;
    }
    let answer = blok_framecheck::parse_oembed(&fetched.body);
    (!answer.is_empty()).then_some(answer)
}

fn header_has(headers: &blok_http::Headers, name: &str, value: &str) -> bool {
    headers
        .get_all(name)
        .flat_map(|line| line.split(','))
        .any(|item| item.trim().eq_ignore_ascii_case(value))
}

#[cfg(test)]
#[path = "outbound_test.rs"]
mod tests;
