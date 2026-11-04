//! LocalFileEndpoint: generated names only, no guard and no CORS, served as
//! an attachment with nosniff.

use std::io::SeekFrom;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_blob::{extension, is_generated};
use blok_dotnet::parse_http_date;
use blok_http::wire::http_date;
use blok_http::{Request, ResponseWriter};
use blok_route::path_value;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::contenttypes::CONTENT_TYPES;
use crate::server::{Inner, write_text};

const MAX_RANGES: usize = 16;

/// Looks the extension up case-insensitively, as ASP.NET's provider does,
/// and falls back to application/octet-stream.
pub(crate) fn content_type_for(name: &str) -> &'static str {
    let wanted = extension(name);
    CONTENT_TYPES
        .iter()
        .find(|(ext, _)| ext.eq_ignore_ascii_case(wanted))
        .map_or("application/octet-stream", |(_, t)| t)
}

pub(crate) async fn serve_local_file(
    inner: Arc<Inner>,
    request: Request,
    mut response: ResponseWriter,
) {
    let name = path_value(&request, "fileName").to_owned();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\'])
        || !is_generated(&name)
    {
        write_text(&mut response, 404, "404 page not found\n").await;
        return;
    }
    let path = std::path::Path::new(&inner.options.storage_directory).join(&name);
    let Ok(file) = tokio::fs::File::open(&path).await else {
        write_text(&mut response, 404, "404 page not found\n").await;
        return;
    };
    let info = match file.metadata().await {
        Ok(info) if !info.is_dir() => info,
        _ => {
            write_text(&mut response, 404, "404 page not found\n").await;
            return;
        }
    };
    let modified = truncate_to_second(info.modified().unwrap_or(UNIX_EPOCH));
    serve_file(
        &request,
        &mut response,
        file,
        info.len(),
        modified,
        content_type_for(&name),
    )
    .await;
}

fn truncate_to_second(time: SystemTime) -> SystemTime {
    match time.duration_since(UNIX_EPOCH) {
        Ok(since) => UNIX_EPOCH + Duration::from_secs(since.as_secs()),
        Err(before) => {
            let back = before.duration();
            let secs = back.as_secs() + u64::from(back.subsec_nanos() > 0);
            UNIX_EPOCH - Duration::from_secs(secs)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    length: u64,
}

impl ByteRange {
    fn content_range(self, size: u64) -> String {
        format!(
            "bytes {}-{}/{size}",
            self.start,
            self.start + self.length - 1
        )
    }
}

/// Every line under name joined with ",", as StringValues.ToString.
fn joined(request: &Request, name: &str) -> String {
    request
        .headers()
        .get_all(name)
        .collect::<Vec<_>>()
        .join(",")
}

/// The C# LocalFileEndpoint's own port of Go's ServeContent rules: no
/// sniffing, no ETags, a 16-range cap.
async fn serve_file(
    request: &Request,
    response: &mut ResponseWriter,
    mut file: tokio::fs::File,
    size: u64,
    modified: SystemTime,
    content_type: &str,
) {
    let headers = response.headers_mut();
    headers.set("Content-Disposition", "attachment");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Last-Modified", http_date(modified));
    if let Some(status) = preconditions(request, modified) {
        response.set_status(status);
        return;
    }
    response.headers_mut().set("Content-Type", content_type);
    let mut range_header = joined(request, "Range");
    if !range_header.is_empty() && !if_range_matches(request, modified) {
        range_header.clear();
    }
    let head = request.method().eq_ignore_ascii_case("HEAD");
    if range_header.is_empty() {
        whole(response, &mut file, size, head).await;
        return;
    }
    let ranges = match parse_ranges(&range_header, size) {
        Ok(ranges) => ranges,
        Err(RangeError::NoOverlap) if size == 0 => {
            whole(response, &mut file, size, head).await;
            return;
        }
        Err(error) => {
            let body = format!("{}\n", error.text());
            let headers = response.headers_mut();
            headers.remove("Accept-Ranges");
            headers.remove("Last-Modified");
            headers.set("Content-Type", "text/plain; charset=utf-8");
            headers.set("Content-Length", body.len().to_string());
            if error == RangeError::NoOverlap {
                headers.set("Content-Range", format!("bytes */{size}"));
            }
            let _ = response.start(416).await;
            if !head {
                let _ = response.write(body.as_bytes()).await;
            }
            return;
        }
    };
    let mut selected: u64 = 0;
    let mut ranges = ranges;
    for range in &ranges {
        if range.length > size || selected > size - range.length {
            ranges.clear();
            break;
        }
        selected += range.length;
    }
    match ranges.len() {
        0 => whole(response, &mut file, size, head).await,
        1 => {
            let range = ranges[0];
            let headers = response.headers_mut();
            headers.set("Accept-Ranges", "bytes");
            headers.set("Content-Range", range.content_range(size));
            headers.set("Content-Length", range.length.to_string());
            let _ = response.start(206).await;
            if !head {
                copy_section(response, &mut file, range).await;
            }
        }
        _ => {
            let mut random = [0u8; 16];
            let _ = getrandom::fill(&mut random);
            let boundary: String = random.iter().map(|b| format!("{b:02x}")).collect();
            let parts: Vec<String> = ranges
                .iter()
                .map(|range| {
                    format!(
                        "--{boundary}\r\nContent-Range: {}\r\nContent-Type: {content_type}\r\n\r\n",
                        range.content_range(size)
                    )
                })
                .collect();
            let closing = format!("--{boundary}--\r\n");
            let length: u64 = parts
                .iter()
                .zip(&ranges)
                .map(|(part, range)| part.len() as u64 + range.length + 2)
                .sum::<u64>()
                + closing.len() as u64;
            let headers = response.headers_mut();
            headers.set(
                "Content-Type",
                format!("multipart/byteranges; boundary={boundary}"),
            );
            headers.set("Accept-Ranges", "bytes");
            headers.set("Content-Length", length.to_string());
            let _ = response.start(206).await;
            if head {
                return;
            }
            for (part, range) in parts.iter().zip(&ranges) {
                let _ = response.write(part.as_bytes()).await;
                copy_section(response, &mut file, *range).await;
                let _ = response.write(b"\r\n").await;
            }
            let _ = response.write(closing.as_bytes()).await;
        }
    }
}

async fn whole(response: &mut ResponseWriter, file: &mut tokio::fs::File, size: u64, head: bool) {
    let headers = response.headers_mut();
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Length", size.to_string());
    let _ = response.start(200).await;
    if !head {
        copy_section(
            response,
            file,
            ByteRange {
                start: 0,
                length: size,
            },
        )
        .await;
    }
}

async fn copy_section(response: &mut ResponseWriter, file: &mut tokio::fs::File, range: ByteRange) {
    if file.seek(SeekFrom::Start(range.start)).await.is_err() {
        return;
    }
    let mut remaining = range.length;
    let mut buffer = vec![0u8; 32 << 10];
    while remaining > 0 {
        let want = buffer
            .len()
            .min(usize::try_from(remaining).unwrap_or(usize::MAX));
        match file.read(&mut buffer[..want]).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                if response.write(&buffer[..n]).await.is_err() {
                    return;
                }
                remaining -= n as u64;
            }
        }
    }
}

/// 412 or 304 when the request's validators say so.
fn preconditions(request: &Request, modified: SystemTime) -> Option<u16> {
    let if_match = joined(request, "If-Match");
    if !if_match.is_empty() {
        if !has_wildcard_tag(&if_match) {
            return Some(412);
        }
    } else if let Some(since) = header_date(request, "If-Unmodified-Since")
        && modified > since
    {
        return Some(412);
    }
    let if_none_match = joined(request, "If-None-Match");
    if !if_none_match.is_empty() {
        return has_wildcard_tag(&if_none_match).then_some(304);
    }
    if let Some(since) = header_date(request, "If-Modified-Since")
        && modified <= since
    {
        return Some(304);
    }
    None
}

fn has_wildcard_tag(value: &str) -> bool {
    value.split(',').any(|candidate| candidate.trim() == "*")
}

fn if_range_matches(request: &Request, modified: SystemTime) -> bool {
    let value = joined(request, "If-Range");
    value.is_empty() || parse_http_date(&value) == Some(modified)
}

/// A date header the way C# reads it: every line joined with ","
/// (StringValues.ToString), then HeaderUtilities.TryParseDate.
fn header_date(request: &Request, name: &str) -> Option<SystemTime> {
    parse_http_date(&joined(request, name))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RangeError {
    Invalid,
    TooMany,
    NoOverlap,
}

impl RangeError {
    fn text(self) -> &'static str {
        match self {
            Self::Invalid => "invalid range",
            Self::TooMany => "too many ranges",
            Self::NoOverlap => "invalid range: failed to overlap",
        }
    }
}

fn parse_ranges(header: &str, size: u64) -> Result<Vec<ByteRange>, RangeError> {
    let Some(specs) = header.strip_prefix("bytes=") else {
        return Err(RangeError::Invalid);
    };
    if specs.matches(',').count() + 1 > MAX_RANGES {
        return Err(RangeError::TooMany);
    }
    let mut ranges = Vec::new();
    let mut no_overlap = false;
    for value in specs.split(',') {
        let spec = value.trim();
        if spec.is_empty() {
            continue;
        }
        let Some((start_text, end_text)) = spec.split_once('-') else {
            return Err(RangeError::Invalid);
        };
        let (start_text, end_text) = (start_text.trim(), end_text.trim());
        if start_text.is_empty() {
            let suffix = parse_range_number(end_text);
            let Some(mut suffix) = suffix.filter(|_| !end_text.starts_with('-')) else {
                return Err(RangeError::Invalid);
            };
            suffix = suffix.min(size);
            if suffix == 0 {
                no_overlap = true;
                continue;
            }
            ranges.push(ByteRange {
                start: size - suffix,
                length: suffix,
            });
            continue;
        }
        let start = parse_range_number(start_text).ok_or(RangeError::Invalid)?;
        if start >= size {
            no_overlap = true;
            continue;
        }
        if end_text.is_empty() {
            ranges.push(ByteRange {
                start,
                length: size - start,
            });
            continue;
        }
        let end = parse_range_number(end_text)
            .filter(|end| start <= *end)
            .ok_or(RangeError::Invalid)?;
        let end = end.min(size - 1);
        ranges.push(ByteRange {
            start,
            length: end - start + 1,
        });
    }
    if no_overlap && ranges.is_empty() {
        return Err(RangeError::NoOverlap);
    }
    Ok(ranges)
}

/// strconv.ParseInt(value, 10, 64) then >= 0: an optional sign, ASCII
/// digits, no overflow.
fn parse_range_number(value: &str) -> Option<u64> {
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: i64 = value.parse().ok()?;
    u64::try_from(n).ok()
}

#[cfg(test)]
#[path = "contenttypes_test.rs"]
mod tests;
