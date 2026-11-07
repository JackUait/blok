//! Every outbound HTTP call the MCP makes: the doc endpoint, the authorize
//! webhook, the ticket URL, the JWKS and the room upgrade. They reach only
//! URLs the operator configured at start, never one a caller chose, so they
//! go through the operator client (see outbound/src/law_test.rs).

use std::time::Duration;

use blok_dotnet::{Uri, parse_absolute_uri};
use blok_outbound::operator::{OperatorClient, Request, RequestBody, Stream};
use blok_outbound::wire::{Headers, Source};
use tokio::io::BufReader;

/// What came back. The body is read whole; these answers are small.
#[derive(Debug, Clone)]
pub struct Answer {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The call failed before a full answer: refused, unreachable, timed out,
/// or the connection dropped mid-body; or the answer passed MAX_ANSWER.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unreachable {
    pub too_large: bool,
    /// The head came back, then the body failed: Node's text() rejects
    /// there, not fetch().
    pub mid_body: bool,
}

const FAILED: Unreachable = Unreachable {
    too_large: false,
    mid_body: false,
};
const TOO_LARGE: Unreachable = Unreachable {
    too_large: true,
    mid_body: true,
};
const DROPPED: Unreachable = Unreachable {
    too_large: false,
    mid_body: true,
};

#[derive(Clone)]
pub struct Outbound {
    client: OperatorClient,
}

impl Default for Outbound {
    fn default() -> Self {
        Outbound::new()
    }
}

/// Answers above this are refused, so a broken host cannot exhaust memory.
/// A document this big is past the engine's memory budget anyway.
pub const MAX_ANSWER: usize = 64 << 20;

impl Outbound {
    pub fn new() -> Outbound {
        Outbound {
            client: OperatorClient::new(Duration::from_secs(10), None),
        }
    }

    /// One request; `timeout` bounds the whole exchange, body included.
    pub async fn send(
        &self,
        method: &str,
        url: &str,
        headers: Vec<(String, String)>,
        body: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<Answer, Unreachable> {
        let uri = parse_absolute_uri(url).filter(Uri::is_http).ok_or(FAILED)?;
        // fetch trims spaces, tabs, CR and LF around a value before it checks it.
        let headers = headers
            .into_iter()
            .map(|(name, value)| {
                let value = value.trim_matches([' ', '\t', '\r', '\n']).to_owned();
                (name, value)
            })
            .collect();
        self.exchange(
            method,
            &uri,
            headers,
            body,
            tokio::time::Instant::now() + timeout,
        )
        .await
    }

    async fn exchange(
        &self,
        method: &str,
        uri: &Uri,
        headers: Vec<(String, String)>,
        body: Option<&[u8]>,
        deadline: tokio::time::Instant,
    ) -> Result<Answer, Unreachable> {
        let host = host_header(uri);
        let mut headers = headers;
        // Node's fetch asks for these and decodes them.
        headers.push(("Accept-Encoding".to_owned(), "gzip, deflate".to_owned()));
        let request = Request {
            method,
            url: uri,
            host: &host,
            headers,
            body: body.map_or(RequestBody::None, RequestBody::Bytes),
        };
        let mut response = tokio::time::timeout_at(deadline, self.client.send(request))
            .await
            .map_err(|_| FAILED)?
            .map_err(|_| FAILED)?;
        let read = async {
            let mut out = Vec::new();
            let mut buf = vec![0u8; 16 << 10];
            loop {
                let n = response.body.read(&mut buf).await.map_err(|_| DROPPED)?;
                if n == 0 {
                    return Ok(out);
                }
                out.extend_from_slice(&buf[..n]);
                if out.len() > MAX_ANSWER {
                    return Err(TOO_LARGE);
                }
            }
        };
        let out = tokio::time::timeout_at(deadline, read)
            .await
            .map_err(|_| DROPPED)??;
        let encoding = response
            .headers
            .get("Content-Encoding")
            .map(|v| String::from_utf8_lossy(v).to_ascii_lowercase());
        Ok(Answer {
            status: response.status,
            body: decoded(encoding.as_deref(), out)?,
        })
    }
}

/// An upgrade's answer: on 101 the stream carries the new protocol, with
/// whatever the server already sent after the head still in the buffer.
pub struct Upgraded {
    pub status: u16,
    pub headers: Headers,
    pub stream: BufReader<Box<dyn Stream>>,
}

impl Outbound {
    /// A GET carrying `headers` whose answer body is never read: a 101 hands
    /// the connection over, and any other status is all the caller needs.
    pub async fn upgrade(
        &self,
        url: &str,
        headers: Vec<(String, String)>,
        timeout: Duration,
    ) -> Result<Upgraded, Unreachable> {
        let uri = parse_absolute_uri(url).filter(Uri::is_http).ok_or(FAILED)?;
        let host = host_header(&uri);
        let request = Request {
            method: "GET",
            url: &uri,
            host: &host,
            headers,
            body: RequestBody::None,
        };
        let response = tokio::time::timeout(timeout, self.client.send(request))
            .await
            .map_err(|_| FAILED)?
            .map_err(|_| FAILED)?;
        Ok(Upgraded {
            status: response.status,
            headers: response.headers,
            stream: response.body.into_inner(),
        })
    }
}

/// The body with each Content-Encoding undone, last applied first, as
/// undici does; a coding it does not know leaves the body as sent.
fn decoded(encoding: Option<&str>, body: Vec<u8>) -> Result<Vec<u8>, Unreachable> {
    use std::io::Read;
    let Some(encoding) = encoding else {
        return Ok(body);
    };
    let mut body = body;
    for coding in encoding.split(',').map(str::trim).rev() {
        let reader: Box<dyn Read + '_> = match coding {
            "gzip" | "x-gzip" => Box::new(flate2::read::MultiGzDecoder::new(&body[..])),
            // undici reads zlib-wrapped and raw deflate alike.
            "deflate" if body.first().is_some_and(|b| b & 0x0f == 8) => {
                Box::new(flate2::read::ZlibDecoder::new(&body[..]))
            }
            "deflate" => Box::new(flate2::read::DeflateDecoder::new(&body[..])),
            _ => return Ok(body),
        };
        let mut out = Vec::new();
        reader
            .take(MAX_ANSWER as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| DROPPED)?;
        if out.len() > MAX_ANSWER {
            return Err(TOO_LARGE);
        }
        body = out;
    }
    Ok(body)
}

fn host_header(url: &Uri) -> String {
    let default =
        url.scheme == "http" && url.port == 80 || url.scheme == "https" && url.port == 443;
    if default {
        url.host.clone()
    } else {
        format!("{}:{}", url.host, url.port)
    }
}
