//! Every outbound HTTP call the MCP makes: the doc endpoint, the authorize
//! webhook, the ticket URL, the JWKS and the room upgrade. They reach only
//! URLs the operator configured at start, never one a caller chose, so they
//! go through the operator client (see outbound/src/law_test.rs).

use std::time::Duration;

use blok_dotnet::{Uri, parse_absolute_uri};
use blok_outbound::operator::{OperatorClient, Request, RequestBody};
use blok_outbound::wire::Source;

/// What came back. The body is read whole; these answers are small.
#[derive(Debug, Clone)]
pub struct Answer {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The call failed before a full answer: refused, unreachable, timed out,
/// or the connection dropped mid-body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unreachable;

#[derive(Clone)]
pub struct Outbound {
    client: OperatorClient,
}

impl Default for Outbound {
    fn default() -> Self {
        Outbound::new()
    }
}

// Answers above this are refused, so a broken host cannot exhaust memory.
const MAX_ANSWER: usize = 64 << 20;

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
        let uri = parse_absolute_uri(url)
            .filter(Uri::is_http)
            .ok_or(Unreachable)?;
        tokio::time::timeout(timeout, self.exchange(method, &uri, headers, body))
            .await
            .map_err(|_| Unreachable)?
    }

    async fn exchange(
        &self,
        method: &str,
        uri: &Uri,
        headers: Vec<(String, String)>,
        body: Option<&[u8]>,
    ) -> Result<Answer, Unreachable> {
        let host = host_header(uri);
        let request = Request {
            method,
            url: uri,
            host: &host,
            headers,
            body: body.map_or(RequestBody::None, RequestBody::Bytes),
        };
        let mut response = self.client.send(request).await.map_err(|_| Unreachable)?;
        let mut out = Vec::new();
        let mut buf = vec![0u8; 16 << 10];
        loop {
            let n = response
                .body
                .read(&mut buf)
                .await
                .map_err(|_| Unreachable)?;
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
            if out.len() > MAX_ANSWER {
                return Err(Unreachable);
            }
        }
        Ok(Answer {
            status: response.status,
            body: out,
        })
    }
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
