//! The `--authorize` webhook (src/mcp/auth/authorize.ts). Fail closed: any
//! answer but `{ "allowed": true }` with status 200 denies.

use std::future::Future;
use std::time::Duration;

use serde_json::{Value, json};

use crate::outbound::Outbound;
use crate::uploads::BoxFuture;

/// Node's `authorize(principal, documentId, write)` option: may this
/// principal open this document, for writing when `write`?
pub trait Authorize: Send + Sync {
    fn allows(&self, principal: String, document_id: String, write: bool) -> BoxFuture<'_, bool>;
}

/// A host's own async function.
impl<F, Fut> Authorize for F
where
    F: Fn(String, String, bool) -> Fut + Send + Sync,
    Fut: Future<Output = bool> + Send + 'static,
{
    fn allows(&self, principal: String, document_id: String, write: bool) -> BoxFuture<'_, bool> {
        Box::pin(self(principal, document_id, write))
    }
}

impl Authorize for Webhook {
    fn allows(&self, principal: String, document_id: String, write: bool) -> BoxFuture<'_, bool> {
        Box::pin(async move { self.ask(&principal, &document_id, write).await })
    }
}

// Every open waits on the webhook; a hung host must not hold it forever.
const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct Webhook {
    url: String,
    outbound: Outbound,
}

impl Webhook {
    pub fn new(url: String, outbound: Outbound) -> Webhook {
        Webhook { url, outbound }
    }

    pub async fn ask(&self, principal: &str, document_id: &str, write: bool) -> bool {
        let body = json!({ "principal": principal, "documentId": document_id, "write": write });
        let headers = vec![("Content-Type".to_owned(), "application/json".to_owned())];
        let Ok(answer) = self
            .outbound
            .send(
                "POST",
                &self.url,
                headers,
                Some(body.to_string().as_bytes()),
                WEBHOOK_TIMEOUT,
            )
            .await
        else {
            return false;
        };
        answer.status == 200
            && serde_json::from_slice::<Value>(&answer.body)
                .ok()
                .is_some_and(|v| v.is_object() && v.get("allowed") == Some(&Value::Bool(true)))
    }
}
