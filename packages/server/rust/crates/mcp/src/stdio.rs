//! stdio framing in front of rmcp. rmcp drops a ping's params, so it cannot
//! see that a 2026-07-28 ping (which Node answers -32601) is one; this proxy
//! answers that ping itself and passes every other line through. It also
//! holds rmcp's input open after stdin ends until the calls in flight are
//! answered: rmcp drops a running call when its input ends, and Node lets
//! the work finish first.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

const MODERN: &str = "2026-07-28";

/// The answer this proxy gives itself, if the line is one it owns.
pub fn own_answer(line: &str) -> Option<String> {
    let message: Value = serde_json::from_str(line).ok()?;
    if message.get("method").and_then(Value::as_str) != Some("ping") {
        return None;
    }
    let id = message.get("id")?;
    let version = message
        .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
        .and_then(Value::as_str)?;
    (version >= MODERN).then(|| {
        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } })
            .to_string()
    })
}

/// Node's STOP_DRAIN_MS: shutdown waits this long for work in flight.
pub const DRAIN_LIMIT: Duration = Duration::from_secs(45);

/// The client requests sent to the server and not answered yet.
#[derive(Default)]
pub struct Pending {
    ids: std::sync::Mutex<HashSet<String>>,
}

impl Pending {
    fn ids(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.ids.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Notes a line going to the server, if it is a request.
    fn sent(&self, line: &str) {
        if let Ok(message) = serde_json::from_str::<Value>(line)
            && message.get("method").is_some()
            && let Some(id) = message.get("id")
        {
            self.ids().insert(id.to_string());
        }
    }

    /// Notes a line from the server, if it is a response.
    fn answered(&self, line: &str) {
        if let Ok(message) = serde_json::from_str::<Value>(line)
            && message.get("method").is_none()
            && let Some(id) = message.get("id")
        {
            self.ids().remove(&id.to_string());
        }
    }

    /// Waits until every request is answered, or `limit` passes.
    pub async fn drained(&self, limit: Duration) {
        let _ = tokio::time::timeout(limit, async {
            while !self.ids().is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
    }
}

async fn write_line<W: AsyncWrite + Unpin>(out: &Mutex<W>, line: &str) -> std::io::Result<()> {
    let mut out = out.lock().await;
    out.write_all(line.as_bytes()).await?;
    out.write_all(b"\n").await?;
    out.flush().await
}

/// Runs `serve` on a pipe pair while copying lines between it and the real
/// stdin and stdout. Returns when `serve` does.
pub async fn proxy<I, O, F, Fut>(input: I, output: O, pending: Arc<Pending>, serve: F)
where
    I: AsyncRead + Unpin + Send + 'static,
    O: AsyncWrite + Unpin + Send + 'static,
    F: FnOnce(
        tokio::io::ReadHalf<tokio::io::DuplexStream>,
        tokio::io::WriteHalf<tokio::io::DuplexStream>,
    ) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let (ours, theirs) = tokio::io::duplex(1 << 20);
    let (from_server, mut to_server) = tokio::io::split(ours);
    let (server_read, server_write) = tokio::io::split(theirs);
    let out = Arc::new(Mutex::new(output));

    let inbound = {
        let out = out.clone();
        let pending = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(input).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let sent = match own_answer(&line) {
                    Some(answer) => write_line(&out, &answer).await,
                    None => {
                        pending.sent(&line);
                        async {
                            to_server.write_all(line.as_bytes()).await?;
                            to_server.write_all(b"\n").await
                        }
                        .await
                    }
                };
                if sent.is_err() {
                    break;
                }
            }
            pending.drained(DRAIN_LIMIT).await;
            let _ = to_server.shutdown().await;
        })
    };
    let outbound = {
        let out = out.clone();
        let pending = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(from_server).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let written = write_line(&out, &line).await;
                pending.answered(&line);
                if written.is_err() {
                    break;
                }
            }
        })
    };
    serve(server_read, server_write).await;
    inbound.abort();
    let _ = outbound.await;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server that answers each request late, and records when its input ended.
    async fn slow_server(
        read: tokio::io::ReadHalf<tokio::io::DuplexStream>,
        mut write: tokio::io::WriteHalf<tokio::io::DuplexStream>,
        log: Arc<std::sync::Mutex<Vec<String>>>,
    ) {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let reader = {
            let log = log.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let id = serde_json::from_str::<Value>(&line).unwrap()["id"].clone();
                    let tx = tx.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        let _ = tx
                            .send(json!({ "jsonrpc": "2.0", "id": id, "result": {} }).to_string());
                    });
                }
                log.lock().unwrap().push("input ended".to_owned());
            })
        };
        while let Some(answer) = rx.recv().await {
            log.lock().unwrap().push("answered".to_owned());
            write
                .write_all(format!("{answer}\n").as_bytes())
                .await
                .unwrap();
            if reader.is_finished() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            if reader.is_finished() {
                break;
            }
        }
        let _ = reader.await;
    }

    #[tokio::test]
    async fn stdin_ending_waits_for_the_calls_in_flight() {
        let input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\"}\n".to_vec();
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = log.clone();
        let (out, _keep) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input),
            out,
            Arc::default(),
            move |read, write| slow_server(read, write, seen),
        )
        .await;
        assert_eq!(*log.lock().unwrap(), vec!["answered", "input ended"]);
    }

    #[test]
    fn answers_only_a_2026_ping() {
        let modern = r#"{"jsonrpc":"2.0","id":7,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#;
        assert_eq!(
            own_answer(modern).as_deref(),
            Some(
                r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"Method not found"}}"#
            )
        );
        assert_eq!(
            own_answer(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#),
            None
        );
        assert_eq!(
            own_answer(
                r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#
            ),
            None
        );
    }
}
