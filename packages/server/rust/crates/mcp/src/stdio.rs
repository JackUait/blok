//! stdio framing in front of rmcp. rmcp drops a ping's params, so it cannot
//! see that a 2026-07-28 ping (which Node answers -32601) is one; this proxy
//! answers that ping itself and passes every other line through.

use std::sync::Arc;

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

async fn write_line<W: AsyncWrite + Unpin>(out: &Mutex<W>, line: &str) -> std::io::Result<()> {
    let mut out = out.lock().await;
    out.write_all(line.as_bytes()).await?;
    out.write_all(b"\n").await?;
    out.flush().await
}

/// Runs `serve` on a pipe pair while copying lines between it and the real
/// stdin and stdout. Returns when `serve` does.
pub async fn proxy<I, O, F, Fut>(input: I, output: O, serve: F)
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
        tokio::spawn(async move {
            let mut lines = BufReader::new(input).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let sent = match own_answer(&line) {
                    Some(answer) => write_line(&out, &answer).await,
                    None => {
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
            let _ = to_server.shutdown().await;
        })
    };
    let outbound = {
        let out = out.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(from_server).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if write_line(&out, &line).await.is_err() {
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
