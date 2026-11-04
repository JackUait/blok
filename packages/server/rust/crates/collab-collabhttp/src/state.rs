use blok_collab_room::{ResetStatus, StateStatus};
use blok_collab_synchttp::refuse;
use blok_http::{Request, ResponseWriter};

use crate::edit::while_connected;
use crate::{Handlers, entity_tag, failed, refuse_retry_later, write_head};

impl Handlers {
    /// GET /sync/{doc}/state: the live document as the consumer export.
    /// With a journal it also names the head, as headers and an ETag an
    /// edit accepts as If-Match. Only the read gate is consulted.
    pub async fn state(&self, request: Request, mut response: ResponseWriter) {
        let Some(admitted) = self.admit(&request, &mut response, false).await else {
            return;
        };
        let Some(manager) = self.manager(&mut response).await else {
            return;
        };
        let result = match while_connected(&request, manager.state(&admitted.doc)).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        match result.status {
            StateStatus::Ready => {
                if let Some(head) = &result.head {
                    write_head(&mut response, &head.tag.lineage, head.server_sequence);
                    response
                        .headers_mut()
                        .set("ETag", entity_tag(&head.tag.lineage, head.server_sequence));
                }
                let headers = response.headers_mut();
                // Document content behind an access check: no shared cache
                // keeps it.
                headers.set("Cache-Control", "no-store");
                headers.set("Content-Type", "application/json");
                blok_route::start_stream(&mut response, 200).await;
                let _ = response.write(&result.json).await;
            }
            StateStatus::Purged => refuse(&mut response, 403, "forbidden\n").await,
            StateStatus::Unavailable => {
                refuse(&mut response, 503, "the document is unavailable, retry\n").await;
            }
            StateStatus::Overloaded => {
                refuse_retry_later(
                    &mut response,
                    manager.retry_after(),
                    "the server ran past its limits exporting this document, retry\n",
                )
                .await;
            }
            StateStatus::ExportFailed => {
                refuse(&mut response, 500, "the document could not be exported\n").await;
            }
            StateStatus::Draining | StateStatus::SeedFailed => {
                refuse(&mut response, 503, "the document could not be loaded\n").await;
            }
        }
    }

    /// POST /sync/{doc}/reset: read and write gates.
    pub async fn reset(&self, request: Request, mut response: ResponseWriter) {
        let Some(admitted) = self.admit(&request, &mut response, true).await else {
            return;
        };
        let Some(manager) = self.manager(&mut response).await else {
            return;
        };
        let result = match while_connected(&request, manager.reset(&admitted.doc)).await {
            Some(Ok(result)) => result,
            _ => {
                failed(&request, &mut response).await;
                return;
            }
        };
        match result.status {
            ResetStatus::Done => response.set_status(204),
            ResetStatus::Purged => refuse(&mut response, 403, "forbidden\n").await,
            ResetStatus::Unavailable => {
                refuse(&mut response, 503, "the document is unavailable, retry\n").await;
            }
            ResetStatus::SeedFailed => {
                refuse(&mut response, 503, "the document could not be loaded\n").await;
            }
        }
    }
}
