use blok_http::{Request, ResponseWriter};

use crate::testutil::{Answer, Running, fixture_ticket, send, start, temp_dir};
use crate::{Options, Server};

// Twins of the C# HistoryEndpointTests that need the whole host.

const ALLOWED_ORIGIN: &str = "https://app.example.com";

pub(crate) struct HistoryApp {
    running: Running,
    _endpoint: Running,
    server: Server,
}

/// HistoryApp.StartAsync: the journal on, doc-42 held with one paragraph.
pub(crate) async fn history_app(auth: &str) -> HistoryApp {
    let endpoint = start(
        |request: Request, mut response: ResponseWriter| async move {
            if request.method() == "GET" {
                response
                    .headers_mut()
                    .set("Content-Type", "application/json; charset=utf-8");
                let _ = response
                    .write(br#"{"blocks":[{"id":"a","type":"paragraph","data":{"text":"one"}}]}"#)
                    .await;
                return;
            }
            response.set_status(204);
        },
    )
    .await;
    let server = Server::new(Options {
        auth: auth.into(),
        secret: if auth == "ticket" {
            fixture_ticket("secret")
        } else {
            String::new()
        },
        allowed_origins: vec![ALLOWED_ORIGIN.into()],
        collab_enabled: true,
        collab_journal: true,
        collab_directory: temp_dir().display().to_string(),
        doc_endpoint: format!("http://{}/docs", endpoint.address),
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    HistoryApp {
        running,
        _endpoint: endpoint,
        server,
    }
}

impl HistoryApp {
    pub(crate) async fn send(
        &self,
        method: &str,
        path: &str,
        ticket: Option<&str>,
        key: Option<&str>,
    ) -> Answer {
        let mut head = format!(
            "{method} /sync/doc-42{path} HTTP/1.1\r\nOrigin: {ALLOWED_ORIGIN}\r\nContent-Length: 0"
        );
        if let Some(ticket) = ticket {
            head.push_str(&format!("\r\nAuthorization: Bearer {ticket}"));
        }
        if let Some(key) = key {
            head.push_str(&format!("\r\nBlok-Idempotency-Key: {key}"));
        }
        send(self.running.address, &head, b"").await
    }

    /// OpenAsync: loads the room through /state, answers its lineage.
    async fn open(&self, ticket: Option<&str>) -> String {
        let state = self.send("GET", "/state", ticket, None).await;
        assert_eq!(state.status, 200, "state: {}", state.text());
        state.header("Blok-Doc-Lineage").to_owned()
    }

    pub(crate) async fn close(self) {
        let _ = self.server.drain(std::time::Duration::from_secs(30)).await;
    }
}

#[track_caller]
pub(crate) fn assert_error(got: &Answer, status: u16, body: &str) {
    assert_eq!(
        (got.status, got.header("Content-Type"), got.text().as_str()),
        (status, "text/plain; charset=utf-8", body)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cross_origin_page_can_read_the_history_headers() {
    let history = history_app("none").await;
    let lineage = history.open(None).await;
    let got = history
        .send("GET", &format!("/history/{lineage}/0"), None, None)
        .await;
    assert_eq!(
        got.headers_all("Access-Control-Allow-Origin"),
        [ALLOWED_ORIGIN]
    );
    let exposed = got.headers_all("Access-Control-Expose-Headers");
    assert_eq!(exposed.len(), 1, "{exposed:?}");
    let mut names: Vec<&str> = exposed[0].split(',').map(str::trim).collect();
    names.sort_unstable();
    assert_eq!(names, ["Blok-History-Lineage", "Blok-History-Sequence"]);
    history.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_delete_or_restore_needs_a_write_pass() {
    let history = history_app("ticket").await;
    let compatible = fixture_ticket("compatible");
    let read_only = fixture_ticket("readOnly");
    let old = history.open(Some(&compatible)).await;
    let reset = history
        .send("POST", "/reset", Some(&compatible), None)
        .await;
    assert_eq!(reset.status, 204, "reset: {}", reset.text());

    let delete = history
        .send("DELETE", &format!("/history/{old}"), Some(&read_only), None)
        .await;
    let restore = history
        .send(
            "POST",
            &format!("/history/{old}/0/restore"),
            Some(&read_only),
            Some("read-only"),
        )
        .await;
    let read = history
        .send("GET", &format!("/history/{old}/0"), Some(&read_only), None)
        .await;

    assert_error(&delete, 403, "write access required\n");
    assert_error(&restore, 403, "write access required\n");
    assert_eq!(read.status, 200, "read: {}", read.text());
    history.close().await;
}
