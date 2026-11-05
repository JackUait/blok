//! Blok's own HTTP/1.1 server on tokio, with Kestrel's wire behaviour: the
//! C# host's limits, grammar, refusals, framing and timeouts, measured on
//! Kestrel 10 and pinned by the shared conformance fixtures.

mod body;
mod conn;
mod exchange;
mod head;
pub mod headers;
mod inbound;
pub mod listen;
mod request;
mod response;
mod server;
pub mod wire;

use std::time::Duration;

pub use body::{Body, BodyError, BodyRate};
pub use head::{TargetForm, Version};
pub use headers::{Headers, is_field_value};
pub use request::{CancelToken, Extensions, Request};
pub use response::{HijackError, ResponseWriter, Upgraded, WriteError};
pub use server::{BoxFuture, Handler, Server, shutdown_signal};

/// The host's limits. The defaults are Kestrel's (Program.cs sets none but
/// these) and the Go host's.
#[derive(Clone, Debug)]
pub struct Config {
    /// RequestHeadersTimeout: from a request's first byte until its handler
    /// runs. A miss gets a bare 408 and the close.
    pub header_timeout: Duration,
    /// KeepAliveTimeout: how long a connection may wait for a request's
    /// first byte, the first request too. A miss closes with no answer.
    pub keep_alive_timeout: Duration,
    /// The host's RequestTimeoutPolicy: at this deadline the request is
    /// cancelled and, if nothing was written, answered 504. None: no
    /// deadline.
    pub request_timeout: Option<Duration>,
    /// MaxRequestBodySize.
    pub max_request_body: u64,
    /// MinRequestBodyDataRate. None: no rate.
    pub min_body_rate: Option<BodyRate>,
    /// Kestrel's AddServerHeader default: "Server: Kestrel" on every
    /// answer.
    pub server_header: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            header_timeout: Duration::from_secs(10),
            keep_alive_timeout: Duration::from_secs(120),
            request_timeout: Some(Duration::from_secs(600)),
            max_request_body: 30_000_000,
            min_body_rate: Some(BodyRate {
                bytes_per_second: 240.0,
                grace: Duration::from_secs(5),
            }),
            server_header: Some("Kestrel".to_owned()),
        }
    }
}
