//! The request a handler gets.

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::fmt;
use std::net::SocketAddr;
use std::sync::Arc;

use tokio::sync::watch;

use crate::body::Body;
use crate::exchange::{Exchange, lock};
use crate::head::{TargetForm, Version};
use crate::headers::Headers;

/// Fires when the request is over for the server: its deadline passed, its
/// body was refused as too slow, or the peer went away.
#[derive(Clone, Debug)]
pub struct CancelToken {
    receiver: watch::Receiver<bool>,
    // Keeps a sender alive for a token no connection owns.
    _owner: Option<Arc<watch::Sender<bool>>>,
}

impl CancelToken {
    pub(crate) fn from_receiver(receiver: watch::Receiver<bool>) -> Self {
        Self {
            receiver,
            _owner: None,
        }
    }

    pub fn is_cancelled(&self) -> bool {
        *self.receiver.borrow()
    }

    pub async fn cancelled(&self) {
        let mut receiver = self.receiver.clone();
        // An error means the connection dropped the sender: over too.
        let _ = receiver.wait_for(|cancelled| *cancelled).await;
    }

    /// A token that never fires, for work no request owns.
    pub fn never() -> Self {
        let (sender, receiver) = watch::channel(false);
        Self {
            receiver,
            _owner: Some(Arc::new(sender)),
        }
    }
}

/// Values a router or middleware hangs on a request, by type.
#[derive(Default)]
pub struct Extensions(HashMap<TypeId, Box<dyn Any + Send + Sync>>);

impl Extensions {
    pub fn insert<T: Any + Send + Sync>(&mut self, value: T) -> Option<T> {
        self.0
            .insert(TypeId::of::<T>(), Box::new(value))
            .and_then(|old| old.downcast().ok().map(|boxed| *boxed))
    }

    pub fn get<T: Any + Send + Sync>(&self) -> Option<&T> {
        self.0.get(&TypeId::of::<T>())?.downcast_ref()
    }

    pub fn get_mut<T: Any + Send + Sync>(&mut self) -> Option<&mut T> {
        self.0.get_mut(&TypeId::of::<T>())?.downcast_mut()
    }

    pub fn remove<T: Any + Send + Sync>(&mut self) -> Option<T> {
        self.0
            .remove(&TypeId::of::<T>())
            .and_then(|old| old.downcast().ok().map(|boxed| *boxed))
    }
}

impl fmt::Debug for Extensions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Extensions")
    }
}

/// One parsed request. The head is as Kestrel accepted it: names keep their
/// case, values are trimmed UTF-8, and the target is exactly the bytes sent
/// (ASCII: Kestrel refuses NUL and bytes over 0x7F there).
#[derive(Debug)]
pub struct Request {
    pub(crate) method: String,
    pub(crate) target: String,
    pub(crate) form: TargetForm,
    pub(crate) path: String,
    pub(crate) query: String,
    pub(crate) version: Version,
    pub(crate) headers: Headers,
    pub(crate) remote_addr: SocketAddr,
    pub(crate) local_addr: SocketAddr,
    pub(crate) body: Option<Body>,
    pub(crate) cancel: CancelToken,
    pub(crate) exchange: Arc<Exchange>,
    pub extensions: Extensions,
}

impl fmt::Debug for Exchange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Exchange")
    }
}

impl Request {
    /// As sent; Kestrel compares methods case-sensitively.
    pub fn method(&self) -> &str {
        &self.method
    }

    /// The request-target as sent.
    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn target_form(&self) -> TargetForm {
        self.form
    }

    /// The path Kestrel routes on, still percent-encoded: the target before
    /// '?' for origin-form, the absolute target's path ("/" if empty), and
    /// "" for "*" and authority-form.
    pub fn path(&self) -> &str {
        &self.path
    }

    /// Replaces the routed path, for a mount under a prefix (PathBase in
    /// ASP.NET). The target and the query stay as sent.
    pub fn set_path(&mut self, path: String) {
        self.path = path;
    }

    /// The query with its '?', or "": Kestrel's QueryString.
    pub fn query(&self) -> &str {
        &self.query
    }

    pub fn version(&self) -> Version {
        self.version
    }

    pub fn headers(&self) -> &Headers {
        &self.headers
    }

    pub fn headers_mut(&mut self) -> &mut Headers {
        &mut self.headers
    }

    pub fn remote_addr(&self) -> SocketAddr {
        self.remote_addr
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// The Content-Length sent, if any. A chunked request has none.
    pub fn content_length(&self) -> Option<u64> {
        lock(&self.exchange.limits).length
    }

    /// Whether the body is chunked.
    pub fn is_chunked(&self) -> bool {
        crate::head::final_coding_is_chunked(&self.headers)
    }

    /// The body; a second call gets None.
    pub fn take_body(&mut self) -> Option<Body> {
        self.body.take()
    }

    pub fn body_mut(&mut self) -> Option<&mut Body> {
        self.body.as_mut()
    }

    pub fn cancel_token(&self) -> CancelToken {
        self.cancel.clone()
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
    }

    /// Takes the request out of the host's deadline, as GET /sync/{doc}
    /// does with DisableRequestTimeout: no 504 and no cancellation at the
    /// deadline. A request with a body keeps the deadline on its body reads
    /// and on the drain after the handler, so a trickled body cannot pin
    /// the connection. Returns false if the deadline already passed.
    pub fn lift_timeout(&self) -> bool {
        let mut deadline = lock(&self.exchange.deadline);
        if deadline.expired {
            return false;
        }
        deadline.lifted = true;
        let has_body = self.is_chunked() || self.content_length().unwrap_or(0) > 0;
        if !has_body {
            deadline.body = None;
        }
        drop(deadline);
        self.exchange.deadline_changed.notify_one();
        true
    }

    /// Sets the body cap for this request; see [`Body::set_limit`].
    pub fn set_body_limit(&self, limit: u64) {
        let mut limits = lock(&self.exchange.limits);
        if !limits.started {
            limits.limit = limit;
            limits.route_set = true;
        }
    }
}
