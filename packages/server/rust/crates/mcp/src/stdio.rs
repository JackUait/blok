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
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
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

/// A client line as rmcp will take it.
enum Read {
    /// A request rmcp runs; `call` holds a tools/call's arguments.
    Request {
        id: String,
        call: Option<Value>,
    },
    Cancelled {
        id: String,
    },
    Other,
}

/// The JSON text of an id as rmcp holds it: `3.0` is `3`.
fn id_text(id: &rmcp::model::RequestId) -> String {
    serde_json::to_value(id).map_or_else(|_| String::new(), |id| id.to_string())
}

/// Parses `line` with rmcp's own message type (its stdio reader strips a
/// BOM first), so only a request rmcp will run is counted, under its id.
fn rmcp_reads(line: &str) -> Read {
    use rmcp::model::{ClientNotification, ClientRequest, JsonRpcMessage};
    let line = line.strip_prefix('\u{feff}').unwrap_or(line);
    let Ok(message) =
        serde_json::from_str::<rmcp::service::RxJsonRpcMessage<rmcp::RoleServer>>(line)
    else {
        return Read::Other;
    };
    match message {
        JsonRpcMessage::Request(request) => Read::Request {
            id: id_text(&request.id),
            call: match request.request {
                ClientRequest::CallToolRequest(call) => Some(
                    call.params
                        .arguments
                        .map_or_else(|| json!({}), Value::Object),
                ),
                _ => None,
            },
        },
        JsonRpcMessage::Notification(note) => match note.notification {
            ClientNotification::CancelledNotification(cancelled) => {
                match cancelled.params.request_id {
                    Some(id) => Read::Cancelled { id: id_text(&id) },
                    None => Read::Other,
                }
            }
            _ => Read::Other,
        },
        _ => Read::Other,
    }
}

/// rmcp's answer to a line it could not take as a message: Node's SDK
/// writes nothing for those.
fn is_id_less_error(line: &str) -> bool {
    serde_json::from_str::<Value>(line).is_ok_and(|m| {
        m.get("error").is_some()
            && m.get("method").is_none()
            && m.get("id").is_none_or(Value::is_null)
    })
}

/// Node's STOP_DRAIN_MS: shutdown waits this long for work in flight.
pub const DRAIN_LIMIT: Duration = Duration::from_secs(45);

/// Sees each tools/call as it is read, in order, and each request's end.
/// `id` is the JSON text of rmcp's request id.
pub trait Requests: Send + Sync {
    /// `arguments` as the call's handler gets them.
    fn read(&self, id: &str, arguments: &Value);
    /// Answered or cancelled.
    fn ended(&self, id: &str);
}

/// The client requests sent to the server and not answered yet.
#[derive(Default)]
pub struct Pending {
    state: std::sync::Mutex<Sent>,
    requests: Option<Arc<dyn Requests>>,
}

#[derive(Default)]
struct Sent {
    /// By the JSON text of the id rmcp sees.
    ids: HashSet<String>,
    /// A request whose id was already in flight runs under its own id
    /// (rmcp keys calls by id): that id's text, and the id the client sent.
    aliases: Vec<(String, Value)>,
    next_alias: u64,
}

/// Puts `id` in place of the message's id, or of a cancel's requestId.
fn with_id(line: &str, pointer: &str, id: Value) -> String {
    let Ok(mut message) = serde_json::from_str::<Value>(line) else {
        return line.to_owned();
    };
    if let Some(slot) = message.pointer_mut(pointer) {
        *slot = id;
    }
    message.to_string()
}

impl Pending {
    pub fn with_requests(requests: Arc<dyn Requests>) -> Pending {
        Pending {
            state: std::sync::Mutex::default(),
            requests: Some(requests),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, Sent> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Notes a line going to the server, if it is a request rmcp will run,
    /// and gives the line to send. A cancelled request is never answered,
    /// so it stops counting.
    fn sent(&self, line: &str) -> String {
        match rmcp_reads(line) {
            Read::Request { id, call } => {
                let (id, line) = {
                    let mut state = self.state();
                    if state.ids.contains(&id) {
                        state.next_alias += 1;
                        let alias =
                            Value::String(format!("blok-mcp reused id {}", state.next_alias));
                        let original = serde_json::from_str(&id).unwrap_or(Value::Null);
                        let alias_text = alias.to_string();
                        state.aliases.push((alias_text.clone(), original));
                        state.ids.insert(alias_text.clone());
                        (alias_text, with_id(line, "/id", alias))
                    } else {
                        state.ids.insert(id.clone());
                        (id, line.to_owned())
                    }
                };
                if let (Some(requests), Some(arguments)) = (&self.requests, call) {
                    requests.read(&id, &arguments);
                }
                line
            }
            Read::Cancelled { id } => {
                let (id, line) = {
                    let mut state = self.state();
                    let latest = state
                        .aliases
                        .iter()
                        .rposition(|(_, original)| original.to_string() == id);
                    match latest {
                        Some(at) => {
                            let (alias, _) = state.aliases.remove(at);
                            let value = serde_json::from_str(&alias).unwrap_or(Value::Null);
                            state.ids.remove(&alias);
                            let line = with_id(line, "/params/requestId", value);
                            (alias, line)
                        }
                        None => {
                            state.ids.remove(&id);
                            (id, line.to_owned())
                        }
                    }
                };
                if let Some(requests) = &self.requests {
                    requests.ended(&id);
                }
                line
            }
            Read::Other => line.to_owned(),
        }
    }

    /// A server line as the client must see it: an answer under an alias
    /// carries the id the client sent.
    fn outgoing(&self, line: &str) -> String {
        if !line.contains("blok-mcp reused id ") {
            return line.to_owned();
        }
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return line.to_owned();
        };
        let Some(id) = message
            .get("id")
            .filter(|_| message.get("method").is_none())
        else {
            return line.to_owned();
        };
        let id = id.to_string();
        let original = self
            .state()
            .aliases
            .iter()
            .find(|(alias, _)| *alias == id)
            .map(|(_, original)| original.clone());
        match original {
            Some(original) => with_id(line, "/id", original),
            None => line.to_owned(),
        }
    }

    /// Notes a line from the server, if it is a response.
    fn answered(&self, line: &str) {
        if let Ok(message) = serde_json::from_str::<Value>(line)
            && message.get("method").is_none()
            && let Some(id) = message.get("id")
        {
            let id = id.to_string();
            {
                let mut state = self.state();
                state.ids.remove(&id);
                state.aliases.retain(|(alias, _)| *alias != id);
            }
            if let Some(requests) = &self.requests {
                requests.ended(&id);
            }
        }
    }

    /// Waits until every request is answered, or `limit` passes.
    pub async fn drained(&self, limit: Duration) {
        let _ = tokio::time::timeout(limit, async {
            while !self.state().ids.is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
    }
}

/// Node's SDK StdioServerTransport (STDIO_DEFAULT_MAX_BUFFER_SIZE): input
/// that grows past this without a newline closes the transport.
pub const MAX_MESSAGE: usize = 10 * 1024 * 1024;

/// The next line of input, without its line end. None at the end of input,
/// or for a message past MAX_MESSAGE: the input then counts as closed.
async fn next_message<R: tokio::io::AsyncBufRead + Unpin>(reader: &mut R) -> Option<String> {
    let mut line = Vec::new();
    let read = (&mut *reader)
        .take(MAX_MESSAGE as u64 + 1)
        .read_until(b'\n', &mut line)
        .await
        .ok()?;
    if read == 0 {
        return None;
    }
    if line.last() == Some(&b'\n') {
        line.pop();
        if line.last() == Some(&b'\r') {
            line.pop();
        }
    } else if line.len() > MAX_MESSAGE {
        return None;
    }
    Some(String::from_utf8_lossy(&line).into_owned())
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
            let mut reader = BufReader::new(input);
            while let Some(line) = next_message(&mut reader).await {
                let line = match crate::lenient::mend(&line) {
                    crate::lenient::Mended::Forward(line) => line,
                    crate::lenient::Mended::Answer(answer) => {
                        if write_line(&out, &answer).await.is_err() {
                            break;
                        }
                        continue;
                    }
                };
                let sent = match own_answer(&line) {
                    Some(answer) => write_line(&out, &answer).await,
                    None => {
                        let line = pending.sent(&line);
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
                if is_id_less_error(&line) {
                    continue;
                }
                let written = write_line(&out, &pending.outgoing(&line)).await;
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

    #[tokio::test]
    async fn a_message_past_10_mib_closes_the_input_as_nodes_sdk_does() {
        // Notifications: nothing waits for an answer to them.
        let note = |name: &str, pad: usize| {
            format!(
                "{{\"jsonrpc\":\"2.0\",\"method\":\"{name}\",\"params\":{{\"p\":\"{}\"}}}}\n",
                "x".repeat(pad)
            )
        };
        let input = format!(
            "{}{}{}",
            note("fits", 1 << 20),
            note("past", MAX_MESSAGE),
            note("after", 0)
        )
        .into_bytes();
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let got = seen.clone();
        let (out, _keep) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input),
            out,
            Arc::default(),
            move |read, _write| async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let method = serde_json::from_str::<Value>(&line).unwrap()["method"].clone();
                    got.lock().unwrap().push(method);
                }
            },
        )
        .await;
        assert_eq!(*seen.lock().unwrap(), vec![json!("fits")]);
    }

    #[tokio::test]
    async fn a_cancelled_request_does_not_hold_the_stop() {
        let pending = Pending::default();
        pending.sent(r#"{"jsonrpc":"2.0","id":77,"method":"tools/call"}"#);
        pending.sent(
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":77}}"#,
        );
        let started = std::time::Instant::now();
        pending.drained(DRAIN_LIMIT).await;
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[derive(Default)]
    struct Seen(std::sync::Mutex<Vec<String>>);

    impl Requests for Seen {
        fn read(&self, id: &str, _arguments: &Value) {
            self.0.lock().unwrap().push(format!("read {id}"));
        }
        fn ended(&self, id: &str) {
            self.0.lock().unwrap().push(format!("ended {id}"));
        }
    }

    // rmcp refuses these with an id-less -32600 and never runs them.
    #[tokio::test]
    async fn a_request_rmcp_refuses_books_nothing_and_holds_no_stop() {
        let seen = Arc::new(Seen::default());
        let pending = Pending::with_requests(seen.clone());
        pending.sent(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"blok_read","arguments":{"handle":"h"},"_meta":5}}"#);
        pending.sent(r#"{"jsonrpc":"2.0","id":9.5,"method":"ping"}"#);
        assert!(seen.0.lock().unwrap().is_empty());
        let started = std::time::Instant::now();
        pending.drained(DRAIN_LIMIT).await;
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    // rmcp reads id 3.0 as 3 and answers with 3.
    #[tokio::test]
    async fn a_float_id_is_keyed_as_rmcp_reads_it() {
        let seen = Arc::new(Seen::default());
        let pending = Pending::with_requests(seen.clone());
        pending.sent(r#"{"jsonrpc":"2.0","id":3.0,"method":"tools/call","params":{"name":"blok_read","arguments":{"handle":"h"}}}"#);
        pending.answered(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#);
        pending.sent(
            r#"{"jsonrpc":"2.0","id":4.0,"method":"tools/call","params":{"name":"blok_read"}}"#,
        );
        pending.sent(
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":4.0}}"#,
        );
        assert_eq!(
            *seen.0.lock().unwrap(),
            vec!["read 3", "ended 3", "read 4", "ended 4"]
        );
        let started = std::time::Instant::now();
        pending.drained(DRAIN_LIMIT).await;
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    // Node's SDK never answers a line its schema refuses; rmcp answers id-less.
    #[tokio::test]
    async fn an_id_less_error_from_rmcp_is_not_written() {
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(Vec::new()),
            out,
            Arc::default(),
            move |_read, mut write| async move {
                write
                    .write_all(b"{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32600,\"message\":\"Invalid request\"}}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n")
                    .await
                    .unwrap();
            },
        )
        .await;
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(written, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n");
    }

    // JSON.parse takes both; rmcp's serde_json drops them without a word.
    #[tokio::test]
    async fn a_lone_surrogate_is_mended_and_a_too_deep_request_answered() {
        let deep = format!("{}{}", "[".repeat(200), "]".repeat(200));
        let input = format!(
            "{}\n{}\n",
            // A notification: nothing waits for its answer.
            r#"{"jsonrpc":"2.0","method":"m","params":{"a":"\ud800"}}"#,
            format_args!(r#"{{"jsonrpc":"2.0","id":2,"method":"m","params":{{"x":{deep}}}}}"#),
        );
        let got = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = got.clone();
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input.into_bytes()),
            out,
            Arc::default(),
            move |read, _write| async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    seen.lock().unwrap().push(line);
                }
            },
        )
        .await;
        assert_eq!(
            *got.lock().unwrap(),
            vec![r#"{"jsonrpc":"2.0","method":"m","params":{"a":"\ufffd"}}"#]
        );
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        let answer: Value = serde_json::from_str(written.trim()).unwrap();
        assert_eq!(answer["id"], 2);
        assert_eq!(answer["error"]["code"], -32600);
    }

    // Node runs and answers both requests with one id; rmcp keys calls by
    // id, so the first answer would cancel the second.
    #[tokio::test]
    async fn a_reused_id_runs_under_its_own_id_and_is_answered_as_sent() {
        let seen = Arc::new(Seen::default());
        let pending = Pending::with_requests(seen.clone());
        let first = r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"blok_read","arguments":{"handle":"h"}}}"#;
        assert_eq!(pending.sent(first), first);
        let inner = |line: &str| -> Value { serde_json::from_str(line).unwrap() };
        let second = inner(&pending.sent(first));
        assert_ne!(second["id"], json!(7));
        assert_eq!(
            second["params"],
            json!({"name":"blok_read","arguments":{"handle":"h"}})
        );
        let second_id = second["id"].to_string();
        let answer = format!(r#"{{"jsonrpc":"2.0","id":{second_id},"result":{{}}}}"#);
        assert_eq!(
            pending.outgoing(&answer),
            r#"{"jsonrpc":"2.0","id":7,"result":{}}"#
        );
        pending.answered(&answer);
        // A cancel names the latest request with the id, as Node's SDK keeps it.
        let third_id = inner(&pending.sent(first))["id"].to_string();
        let cancel = inner(&pending.sent(
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}"#,
        ));
        assert_eq!(cancel["params"]["requestId"].to_string(), third_id);
        pending.answered(r#"{"jsonrpc":"2.0","id":7,"result":{}}"#);
        assert_eq!(
            *seen.0.lock().unwrap(),
            vec![
                "read 7".to_owned(),
                format!("read {second_id}"),
                format!("ended {second_id}"),
                format!("read {third_id}"),
                format!("ended {third_id}"),
                "ended 7".to_owned(),
            ]
        );
        let started = std::time::Instant::now();
        pending.drained(DRAIN_LIMIT).await;
        assert!(started.elapsed() < Duration::from_secs(1));
        // The id is free again: it goes through as sent.
        assert_eq!(pending.sent(first), first);
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
