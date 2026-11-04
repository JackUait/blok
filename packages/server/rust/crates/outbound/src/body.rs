use crate::decode::{DecodeError, Output, decoder};
use crate::policy::{Error, Failure, fail};
use crate::wire::{Source, is_token_char, trim_space_tab};

/// Reads a response body under the cap. Without `truncate`, more than
/// `max` raw or decoded bytes fail as TooLarge; with it, the first `max` raw
/// bytes are decoded as a cut-short stream, which every decoder accepts,
/// and the output is cut at `max` too. Content-Length is not checked then.
pub(crate) async fn read_bounded<R: Source>(
    mut raw: R,
    content_length: Option<u64>,
    encoding_lines: &[&[u8]],
    max: u64,
    truncate: bool,
) -> Result<Vec<u8>, Error> {
    if !truncate && content_length.is_some_and(|length| length > max) {
        return Err(fail(Failure::TooLarge));
    }
    let encodings: Vec<&[u8]> = encoding_lines
        .iter()
        .flat_map(|line| encoding_tokens(line))
        .collect();
    if encodings.len() > 1 {
        return Err(fail(Failure::UnsupportedContentEncoding));
    }
    let mut decoder = match encodings.first() {
        None => None,
        Some(token) if token.eq_ignore_ascii_case(b"identity") => None,
        Some(token) => Some(
            decoder(&String::from_utf8_lossy(token).to_ascii_lowercase())
                .ok_or(fail(Failure::UnsupportedContentEncoding))?,
        ),
    };
    let max = usize::try_from(max).unwrap_or(usize::MAX);
    let mut out = Output::new(max, truncate);
    let mut chunk = vec![0u8; 16 << 10];
    let mut total = 0usize;
    loop {
        let n = raw
            .read(&mut chunk)
            .await
            .map_err(|_| fail(Failure::Blocked))?;
        if n == 0 {
            break;
        }
        let room = max - total.min(max);
        let take = n.min(room);
        total += take;
        if let Some(decoder) = decoder.as_mut() {
            decoder
                .feed(&chunk[..take], &mut out)
                .map_err(decode_failure)?;
        } else {
            out.bytes.extend_from_slice(&chunk[..take]);
        }
        if take < n {
            if truncate {
                break;
            }
            return Err(fail(Failure::TooLarge));
        }
    }
    if let Some(decoder) = decoder.as_mut() {
        decoder.finish(&mut out).map_err(decode_failure)?;
    }
    Ok(out.bytes)
}

fn decode_failure(err: DecodeError) -> Error {
    match err {
        DecodeError::TooLarge => fail(Failure::TooLarge),
        DecodeError::Bad => fail(Failure::Blocked),
    }
}

/// .NET's typed ContentEncoding for one header line: the comma-separated
/// tokens, or none when any item is not a token. C# then reads the body as
/// identity.
fn encoding_tokens(line: &[u8]) -> Vec<&[u8]> {
    let mut tokens = Vec::new();
    for item in line.split(|&c| c == b',') {
        let item = trim_space_tab(item);
        if item.is_empty() {
            continue;
        }
        if !item.iter().all(|&c| is_token_char(c)) {
            return Vec::new();
        }
        tokens.push(item);
    }
    tokens
}
