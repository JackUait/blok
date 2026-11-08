//! The host's page creator (`Hooks::page_creator`) and the `--create-page`
//! webhook (src/mcp/create-page.ts). With a creator, a page insert takes
//! the host's id; Blok never authorizes, loads or saves the new page.

use std::collections::HashSet;
use std::time::Duration;

use blok_blokagent::{Cancel, Error, HostFuture, PageCreateRequest, PageCreator};
use serde_json::{Value, json};

use crate::outbound::Outbound;

/// What the agent sees when the host could not make the first page of a batch.
pub const HOST_PAGE_FAILED: &str = "The host could not create the page.";
/// The cause of a batch a cancel stopped after the host made pages (blokagent's words).
pub(crate) const CANCELLED: &str = "The batch was cancelled. Nothing was written.";

// A hung host must not hold blok_execute open forever; the authorize webhook's limit.
const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(10);
// blok_open's documentId maxLength, which JSON Schema counts in code points.
const MAX_PAGE_ID: usize = 512;
// How much of a refused answer goes to stderr.
const BODY_SHOWN: usize = 500;

/// `--create-page <url>`, the wire every port copies:
///   POST <url>, header `Content-Type: application/json` only, 10 s timeout,
///   redirects not followed (the operator client follows none).
///   Body: {"parentDocumentId","principal","actor":{"id","name","onBehalfOf"},"suggestedPageId"},
///   onBehalfOf null when the actor has none.
///   200 {"pageId":"<id>"} -> the id (then checked as any creator's answer).
///   200 {"pageId":null}   -> the host refused (FORBIDDEN).
///   Any other status (3xx and 201 too), a timeout, a network error, a body
///   that is not a JSON object, or a pageId neither a string nor null -> a
///   host error, never a refusal. A repeated key keeps its last value, as
///   JSON.parse does. A lone surrogate escape fails the parse: a host error.
#[derive(Clone)]
pub struct CreatePageWebhook {
    url: String,
    outbound: Outbound,
}

impl CreatePageWebhook {
    pub fn new(url: String, outbound: Outbound) -> CreatePageWebhook {
        CreatePageWebhook { url, outbound }
    }

    async fn ask(&self, request: &PageCreateRequest) -> Result<Option<String>, String> {
        let body = json!({
            "parentDocumentId": request.parent_document_id,
            "principal": request.principal,
            "actor": {
                "id": request.actor.id,
                "name": request.actor.name,
                "onBehalfOf": request.actor.on_behalf_of,
            },
            "suggestedPageId": request.suggested_page_id,
        });
        let headers = vec![("Content-Type".to_owned(), "application/json".to_owned())];
        let answer = self
            .outbound
            .send(
                "POST",
                &self.url,
                headers,
                Some(body.to_string().as_bytes()),
                WEBHOOK_TIMEOUT,
            )
            .await
            .map_err(|failed| {
                format!(
                    "--create-page {} could not be reached{}",
                    self.url,
                    if failed.too_large {
                        " (the answer is too large)"
                    } else {
                        ""
                    }
                )
            })?;
        webhook_answer(&self.url, answer.status, &answer.body)
    }
}

/// The webhook's status and body as the creator's answer.
pub(crate) fn webhook_answer(
    url: &str,
    status: u16,
    body: &[u8],
) -> Result<Option<String>, String> {
    let text = String::from_utf8_lossy(body);
    let shown: String = text.chars().take(BODY_SHOWN).collect();
    if status != 200 {
        return Err(format!("--create-page {url} answered {status}: {shown}"));
    }
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|err| format!("--create-page {url} answered no JSON ({err}): {shown}"))?;
    match parsed.as_object().and_then(|body| body.get("pageId")) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(id)) => Ok(Some(id.clone())),
        _ => Err(format!(
            "--create-page {url} answered no \"pageId\" string or null: {shown}"
        )),
    }
}

impl PageCreator for CreatePageWebhook {
    fn create<'a>(
        &'a self,
        _: &'a Cancel,
        request: &'a PageCreateRequest,
    ) -> HostFuture<'a, Option<String>> {
        Box::pin(async move {
            self.ask(request)
                .await
                .map_err(|err| Error::Host(err.into()))
        })
    }
}

/// An id the agent can open: 1-512 code points, no Unicode Cc character,
/// not "." or ".." (they name a directory in every source). A Rust string
/// holds no lone surrogate, so that rule is met by the type.
pub(crate) fn is_page_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id.chars().count() <= MAX_PAGE_ID
        && !id.chars().any(char::is_control)
}

/// The page ids the parent links: `data.pageId` of each `type: "page"`
/// block. Blocks are one flat list, so nested pages are in it too; text
/// elsewhere never counts.
fn linked_page_ids(parent: &str) -> HashSet<String> {
    let Ok(parent) = serde_json::from_str::<Value>(parent) else {
        return HashSet::new();
    };
    parent
        .get("blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("page"))
        .filter_map(|block| block.pointer("/data/pageId").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

fn orphan_message(cause: &Value) -> String {
    format!(
        "The batch failed after the host did work for it ({}). Clean up the listed items.",
        cause
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default()
    )
}

/// A creator batch's result once the bundle answered. Pages the parent (as
/// saved, so the parent before the batch) already links are no orphans;
/// with none left the cause is the answer. A cancel after the host made
/// pages is wrapped as any stop after pages is (the bundle passes a plain
/// CANCELLED on). None: the result stands as it is.
pub(crate) fn report_orphaned(
    result: &str,
    parent: &str,
    created: &[String],
    cancelled: bool,
) -> Option<String> {
    let mut result: Value = serde_json::from_str(result).ok()?;
    let error = result.get_mut("error")?;
    let code = error.get("code").and_then(Value::as_str)?.to_owned();
    let linked = linked_page_ids(parent);
    let receipt = |page_id: &String| json!({ "command": "block.insert", "type": "page", "prepared": { "pageId": page_id } });
    if code == "CANCELLED" && cancelled {
        let orphaned: Vec<Value> = created
            .iter()
            .filter(|page_id| !linked.contains(*page_id))
            .map(receipt)
            .collect();
        if orphaned.is_empty() {
            return None;
        }
        // Exactly Blok.Server's cause (server-conformance fixtures/agent/host.json),
        // not the engine's failure(), which marks CANCELLED retryable.
        let cause = json!({ "code": "CANCELLED", "message": CANCELLED, "retryable": false });
        let mut wrapped = json!({
            "code": "ORPHANED_SIDE_EFFECT",
            "message": orphan_message(&cause),
            "retryable": false,
        });
        if let Some(index) = error.get("commandIndex") {
            wrapped["commandIndex"] = index.clone();
        }
        wrapped["details"] = json!({ "orphaned": orphaned, "cause": cause });
        *error = wrapped;
        return serde_json::to_string(&result).ok();
    }
    if code != "ORPHANED_SIDE_EFFECT" {
        return None;
    }
    let listed = error.pointer("/details/orphaned")?.as_array()?.clone();
    let cause = error.pointer("/details/cause")?.clone();
    let kept: Vec<Value> = listed
        .iter()
        .filter(|entry| {
            entry
                .pointer("/prepared/pageId")
                .and_then(Value::as_str)
                .is_none_or(|page_id| !linked.contains(page_id))
        })
        .cloned()
        .collect();
    if kept.len() == listed.len() {
        return None;
    }
    if kept.is_empty() {
        *error = cause;
    } else {
        error["details"]["orphaned"] = Value::Array(kept);
    }
    serde_json::to_string(&result).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_ids_count_code_points_and_refuse_control_characters_and_dots() {
        assert!(is_page_id("host-page-1"));
        assert!(is_page_id(&"\u{1F600}".repeat(512)));
        assert!(!is_page_id(&"\u{1F600}".repeat(513)));
        for bad in ["", ".", "..", "a\u{0}", "a\u{7f}", "a\u{85}", "a\u{9f}"] {
            assert!(!is_page_id(bad), "{bad:?}");
        }
        assert!(is_page_id("..."));
        assert!(is_page_id("a\u{a0}"));
    }

    #[test]
    fn only_a_200_with_a_string_or_null_page_id_is_an_answer() {
        let url = "http://h/pages";
        assert_eq!(
            webhook_answer(url, 200, br#"{"pageId":"p"}"#),
            Ok(Some("p".to_owned()))
        );
        assert_eq!(webhook_answer(url, 200, br#"{"pageId":null}"#), Ok(None));
        // A repeated key keeps its last value, as JSON.parse does.
        assert_eq!(
            webhook_answer(url, 200, br#"{"pageId":"a","pageId":null}"#),
            Ok(None)
        );
        assert_eq!(
            webhook_answer(url, 200, br#"{"pageId":""}"#),
            Ok(Some(String::new()))
        );
        let failed = |status: u16, body: &[u8]| webhook_answer(url, status, body).unwrap_err();
        assert!(failed(201, br#"{"pageId":"p"}"#).contains("answered 201"));
        assert!(failed(307, b"").contains("answered 307"));
        assert!(failed(500, br#"{"error":"down"}"#).contains("answered 500: {\"error\":\"down\"}"));
        assert!(failed(200, b"{}").contains("no \"pageId\""));
        assert!(failed(200, br#"{"pageId":7}"#).contains("no \"pageId\""));
        assert!(failed(200, b"[]").contains("no \"pageId\""));
        assert!(failed(200, b"nope").contains("no JSON"));
        // Never turned into U+FFFD: a lone surrogate is a host error.
        assert!(failed(200, br#"{"pageId":"page\ud800"}"#).contains("no JSON"));
        let long = format!("{{\"x\":\"{}\"}}", "y".repeat(900));
        assert_eq!(
            failed(500, long.as_bytes()),
            format!("--create-page {url} answered 500: {}", &long[..500])
        );
    }

    #[test]
    fn a_page_the_parent_links_by_a_page_block_is_dropped_and_text_never_counts() {
        let parent = r#"{"blocks":[{"id":"a","type":"page","data":{"pageId":"linked"}},{"id":"b","type":"paragraph","data":{"text":"named"}}]}"#;
        let orphaned = |ids: &[&str]| {
            let listed: Vec<Value> = ids
                .iter()
                .map(|id| json!({ "command": "block.insert", "type": "page", "prepared": { "pageId": id } }))
                .collect();
            json!({ "ok": false, "revision": "r", "error": {
                "code": "ORPHANED_SIDE_EFFECT", "message": "m", "commandIndex": 1, "retryable": false,
                "details": { "orphaned": listed, "cause": { "code": "APPLY_FAILED", "message": "c", "retryable": true, "commandIndex": 1 } },
            } })
            .to_string()
        };
        assert_eq!(
            report_orphaned(&orphaned(&["named"]), parent, &[], false),
            None
        );
        let alone: Value = serde_json::from_str(
            &report_orphaned(&orphaned(&["linked"]), parent, &[], false).unwrap(),
        )
        .unwrap();
        assert_eq!(
            alone["error"],
            json!({ "code": "APPLY_FAILED", "message": "c", "retryable": true, "commandIndex": 1 })
        );
        assert_eq!(alone["revision"], "r");
        let some: Value = serde_json::from_str(
            &report_orphaned(&orphaned(&["linked", "new"]), parent, &[], false).unwrap(),
        )
        .unwrap();
        assert_eq!(
            some["error"]["details"]["orphaned"],
            json!([{ "command": "block.insert", "type": "page", "prepared": { "pageId": "new" } }])
        );
    }
}
