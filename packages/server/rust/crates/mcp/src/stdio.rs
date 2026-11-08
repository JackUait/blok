//! stdio framing in front of rmcp. rmcp drops a ping's params, so it cannot
//! see that a 2026-07-28 ping (which Node answers -32601) is one; this proxy
//! answers that ping itself and passes every other line through. It also
//! holds rmcp's input open after stdin ends until the calls in flight are
//! done: rmcp drops a running call when its input ends, and Node lets the
//! work finish first. Their answers are not written, as Node's SDK aborts
//! a request in flight when stdin ends.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

const MODERN: &str = "2026-07-28";
/// The per-request envelope keys the SDK lifts off _meta (RESERVED_ENVELOPE_META_KEYS).
const ENVELOPE_KEYS: [&str; 4] = [
    "io.modelcontextprotocol/protocolVersion",
    "io.modelcontextprotocol/clientInfo",
    "io.modelcontextprotocol/clientCapabilities",
    "io.modelcontextprotocol/logLevel",
];
const RMCP_ENVELOPE: &str = "request _meta is missing or has malformed required fields";
const NODE_ENVELOPE: &str = "Request is missing the required _meta envelope for protocol revision 2026-07-28 (io.modelcontextprotocol/protocolVersion, io.modelcontextprotocol/clientCapabilities)";
/// The id of the initialize the proxy sends for a client that sent none.
const STAND_IN_INITIALIZE: &str = "blok-mcp stand-in initialize";

/// The era the first request set, as Node's SDK locks it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Era {
    Unknown,
    Legacy,
    Modern,
}

/// `line` as the session's era reads it: in a 2025 session, a request's
/// 2026 claim is dropped, so rmcp answers it as 2025, as Node's SDK does.
fn in_era(line: &str, era: &mut Era) -> String {
    if *era != Era::Legacy || !line.contains("io.modelcontextprotocol/protocolVersion") {
        return line.to_owned();
    }
    let Ok(mut message) = serde_json::from_str::<Value>(line) else {
        return line.to_owned();
    };
    let dropped = message
        .pointer_mut("/params/_meta")
        .and_then(Value::as_object_mut)
        .and_then(|meta| meta.shift_remove("io.modelcontextprotocol/protocolVersion"));
    match dropped {
        Some(_) => message.to_string(),
        None => line.to_owned(),
    }
}

/// The initialize and initialized lines for a client that skipped them, if
/// `line` is its first request and a 2025 one. Node serves it as one.
fn stand_in_initialize(line: &str, era: &mut Era) -> Option<String> {
    if *era != Era::Unknown {
        return None;
    }
    let message: Value = serde_json::from_str(line).ok()?;
    let method = message.get("method").and_then(Value::as_str)?;
    message.get("id")?;
    let claim = message
        .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
        .and_then(Value::as_str);
    if claim.is_some_and(|v| v >= MODERN) {
        *era = Era::Modern;
        return None;
    }
    *era = Era::Legacy;
    if method == "initialize" {
        return None;
    }
    // No clientInfo in Node: an empty name reads the same (safeClientName).
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": STAND_IN_INITIALIZE,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": { "name": "", "version": "" },
        },
    });
    Some(format!(
        "{initialize}\n{}\n",
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
    ))
}

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

/// A number id zod's int() refuses: not a safe integer. Node's SDK drops
/// the line; rmcp would run it (an id past 2^53 fits its u64).
fn has_unsafe_id(line: &str) -> bool {
    serde_json::from_str::<Value>(line).is_ok_and(|m| {
        m.get("id").and_then(Value::as_number).is_some_and(|n| {
            !n.as_f64()
                .is_some_and(|f| f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0)
        })
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
    /// The tools/call ones among `ids`.
    calls: HashSet<String>,
    /// Calls in flight when stdin ended: their answers are not written.
    abandoned: HashSet<String>,
    /// Requests in a 2026 session with no envelope key at all.
    bare: HashSet<String>,
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
                    let (id, line) = if state.ids.contains(&id) {
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
                    };
                    if call.is_some() {
                        state.calls.insert(id.clone());
                    }
                    (id, line)
                };
                if let (Some(requests), Some(arguments)) = (&self.requests, call) {
                    requests.read(&id, &arguments);
                }
                line
            }
            Read::Cancelled { id } => {
                let (id, line) = {
                    let mut state = self.state();
                    let latest = state.aliases.iter().rposition(|(_, original)| {
                        *original == serde_json::from_str::<Value>(&id).unwrap_or(Value::Null)
                    });
                    match latest {
                        Some(at) => {
                            let (alias, _) = state.aliases.remove(at);
                            let value = serde_json::from_str(&alias).unwrap_or(Value::Null);
                            state.ids.remove(&alias);
                            state.calls.remove(&alias);
                            let line = with_id(line, "/params/requestId", value);
                            (alias, line)
                        }
                        None => {
                            state.ids.remove(&id);
                            state.calls.remove(&id);
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

    /// Notes a request sent in a 2026 session with no envelope key: rmcp
    /// refuses it in its own words.
    fn note_bare(&self, line: &str, era: Era) {
        if era != Era::Modern {
            return;
        }
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let (Some(id), Some(_)) = (message.get("id"), message.get("method")) else {
            return;
        };
        let keyed = message
            .pointer("/params/_meta")
            .and_then(Value::as_object)
            .is_some_and(|meta| ENVELOPE_KEYS.iter().any(|key| meta.contains_key(*key)));
        if !keyed {
            self.state().bare.insert(id.to_string());
        }
    }

    /// rmcp's refusal of a bare request, in Node's checkInboundEnvelope words.
    fn node_words(&self, line: &str) -> String {
        if self.state().bare.is_empty() || !line.contains(RMCP_ENVELOPE) {
            return line.to_owned();
        }
        let Ok(mut message) = serde_json::from_str::<Value>(line) else {
            return line.to_owned();
        };
        let bare = message
            .get("id")
            .is_some_and(|id| self.state().bare.contains(&id.to_string()));
        match message.pointer_mut("/error/message") {
            Some(slot) if bare && slot.as_str().is_some_and(|m| m.starts_with(RMCP_ENVELOPE)) => {
                *slot = Value::String(NODE_ENVELOPE.to_owned());
                message.to_string()
            }
            _ => line.to_owned(),
        }
    }

    /// Stdin ended: the tool calls in flight still run, but go unanswered.
    /// Node's SDK aborts every request in flight then; only its tool calls
    /// do real async work, so the rest are already answered there.
    fn abandon_in_flight(&self) {
        let mut state = self.state();
        state.abandoned = state.calls.clone();
    }

    /// A server line as the client must see it: an answer under an alias
    /// carries the id the client sent. None for an abandoned request's answer.
    fn outgoing(&self, line: &str) -> Option<String> {
        // Most lines need neither: skip the parse.
        if self.state().abandoned.is_empty()
            && !line.contains("blok-mcp reused id ")
            && !line.contains(STAND_IN_INITIALIZE)
        {
            return Some(line.to_owned());
        }
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return Some(line.to_owned());
        };
        let Some(id) = message
            .get("id")
            .filter(|_| message.get("method").is_none())
        else {
            return Some(line.to_owned());
        };
        if id.as_str() == Some(STAND_IN_INITIALIZE) {
            return None;
        }
        let id = id.to_string();
        let state = self.state();
        if state.abandoned.contains(&id) {
            return None;
        }
        let original = state
            .aliases
            .iter()
            .find(|(alias, _)| *alias == id)
            .map(|(_, original)| original.clone());
        drop(state);
        Some(match original {
            Some(original) => with_id(line, "/id", original),
            None => line.to_owned(),
        })
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
                state.calls.remove(&id);
                state.abandoned.remove(&id);
                state.bare.remove(&id);
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
            let mut era = Era::Unknown;
            while let Some(line) = next_message(&mut reader).await {
                // JSON.parse fails on a BOM; Node's SDK drops the line.
                if line.starts_with('\u{feff}') {
                    continue;
                }
                let line =
                    crate::lenient::mend(&crate::depth::clamp(&line, crate::depth::MESSAGE_LIMIT));
                // Before shape: Node's schema drops it before any -32602.
                if has_unsafe_id(&line) {
                    continue;
                }
                let line = match crate::shape::shape(&line) {
                    crate::shape::Shaped::Forward(line) => line,
                    // Node's SDK drops it without an answer.
                    crate::shape::Shaped::NotAMessage(_) => continue,
                    crate::shape::Shaped::Refused(answer) => {
                        if write_line(&out, &answer).await.is_err() {
                            break;
                        }
                        continue;
                    }
                };
                let sent = match own_answer(&line) {
                    Some(answer) => write_line(&out, &answer).await,
                    None => {
                        let first = stand_in_initialize(&line, &mut era);
                        let line = pending.sent(&in_era(&line, &mut era));
                        pending.note_bare(&line, era);
                        async {
                            if let Some(first) = first {
                                to_server.write_all(first.as_bytes()).await?;
                            }
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
            pending.abandon_in_flight();
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
                let line = pending.node_words(&line);
                let written = match pending.outgoing(&line) {
                    Some(line) => write_line(&out, &line).await,
                    None => Ok(()),
                };
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
                    let message = serde_json::from_str::<Value>(&line).unwrap();
                    // Only requests are answered; the stand-in initialize is
                    // the proxy's own, and rmcp answers it at once.
                    if message.get("id").is_none() || message["method"] == "initialize" {
                        continue;
                    }
                    let id = message["id"].clone();
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

    // Node's SDK: a request in flight when stdin ends is not answered, and
    // stop still waits for its work.
    #[tokio::test]
    async fn stdin_ending_lets_the_calls_in_flight_finish_but_writes_no_answer() {
        let input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_read\"}}\n".to_vec();
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = log.clone();
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input),
            out,
            Arc::default(),
            move |read, write| slow_server(read, write, seen),
        )
        .await;
        assert_eq!(*log.lock().unwrap(), vec!["answered", "input ended"]);
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(
            written, "",
            "an answer to a call in flight at the end was written"
        );
    }

    // initialize, tools/list and the like answer at once in Node, so before its end.
    #[tokio::test]
    async fn stdin_ending_still_writes_answers_to_requests_that_are_not_calls() {
        let input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n".to_vec();
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = log.clone();
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input),
            out,
            Arc::default(),
            move |read, write| slow_server(read, write, seen),
        )
        .await;
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(written, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n");
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

    // JSON.parse takes both; rmcp's serde_json would drop them without a
    // word. A part past 51 levels reaches rmcp as [], so the bundle still
    // sees it too deep and answers as Node does.
    #[tokio::test]
    async fn a_lone_surrogate_is_mended_and_a_too_deep_request_clamped() {
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
        // The message and params take two levels, so 49 arrays fit and the 50th is [].
        let clamped = format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"m","params":{{"x":{}{}}}}}"#,
            "[".repeat(50),
            "]".repeat(50)
        );
        // Between them, the proxy's own initialize for a request sent before one.
        {
            let got = got.lock().unwrap();
            assert_eq!(
                got.first().map(String::as_str),
                Some(r#"{"jsonrpc":"2.0","method":"m","params":{"a":"\ufffd"}}"#)
            );
            assert_eq!(got.last(), Some(&clamped));
        }
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(written, "");
    }

    // JSON.parse fails on a BOM, and zod's int() refuses an id past 2^53:
    // Node's SDK drops both lines without an answer.
    #[tokio::test]
    async fn a_bom_line_and_an_unsafe_id_never_reach_the_server() {
        let input = concat!(
            "\u{feff}{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":9007199254740993,\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":-9007199254740993,\"method\":\"ping\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":9007199254740993,\"method\":\"tools/call\",\"params\":{\"name\":5}}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":9007199254740991,\"method\":\"ping\"}\n",
        );
        let got = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = got.clone();
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input.as_bytes().to_vec()),
            out,
            Arc::default(),
            move |read, _write| async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    // rmcp strips a BOM itself, so the raw line is kept.
                    let id = serde_json::from_str::<Value>(line.trim_start_matches('\u{feff}'))
                        .map_or(Value::Null, |m| m["id"].clone());
                    if line.contains("ping") {
                        seen.lock().unwrap().push(id.to_string());
                    }
                }
            },
        )
        .await;
        assert_eq!(*got.lock().unwrap(), vec!["9007199254740991"]);
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(written, "");
    }

    // Node serves a request that comes before any initialize, without the
    // 2026 envelope, as a 2025 one. rmcp would refuse it for its missing
    // _meta, so the proxy initializes rmcp first and hides that answer.
    #[tokio::test]
    async fn a_request_before_initialize_is_served_as_a_2025_one() {
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#,
            "\n",
        );
        let got = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = got.clone();
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input.as_bytes().to_vec()),
            out,
            Arc::default(),
            move |read, mut write| async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let message: Value = serde_json::from_str(&line).unwrap();
                    if let Some(id) = message.get("id") {
                        let answer = json!({ "jsonrpc": "2.0", "id": id, "result": {} });
                        write
                            .write_all(format!("{answer}\n").as_bytes())
                            .await
                            .unwrap();
                    }
                    seen.lock().unwrap().push(message["method"].clone());
                }
            },
        )
        .await;
        assert_eq!(
            *got.lock().unwrap(),
            vec![
                json!("initialize"),
                json!("notifications/initialized"),
                json!("tools/list"),
                json!("ping"),
            ]
        );
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(
            written,
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n"
        );
    }

    // The policy: an id with a lone surrogate reads as U+FFFD, and the
    // answer carries that id.
    #[tokio::test]
    async fn an_id_with_a_lone_surrogate_is_answered_as_the_replacement_character() {
        let input = concat!(r#"{"jsonrpc":"2.0","id":"x\udc00","method":"ping"}"#, "\n");
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input.as_bytes().to_vec()),
            out,
            Arc::default(),
            move |read, mut write| async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let message: Value = serde_json::from_str(&line).unwrap();
                    if message["method"] == "ping" {
                        let answer = json!({ "jsonrpc": "2.0", "id": message["id"], "result": {} });
                        write
                            .write_all(format!("{answer}\n").as_bytes())
                            .await
                            .unwrap();
                    }
                }
            },
        )
        .await;
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        assert_eq!(
            written,
            "{\"jsonrpc\":\"2.0\",\"id\":\"x\u{fffd}\",\"result\":{}}\n"
        );
    }

    // A 2026 session: a request with no envelope keys at all gets Node's
    // checkInboundEnvelope words, not rmcp's.
    #[tokio::test]
    async fn a_request_without_an_envelope_in_a_2026_session_is_refused_in_nodes_words() {
        let meta = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;
        let input = format!(
            "{}\n{}\n{}\n",
            format_args!(
                r#"{{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{{"_meta":{meta}}}}}"#
            ),
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"_meta":{"x":1}}}"#,
        );
        let (out, mut client) = tokio::io::duplex(1 << 16);
        proxy(
            std::io::Cursor::new(input.into_bytes()),
            out,
            Arc::default(),
            move |read, mut write| async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let message: Value = serde_json::from_str(&line).unwrap();
                    let answer = if message["id"] == 1 {
                        json!({ "jsonrpc": "2.0", "id": 1, "result": {} })
                    } else {
                        json!({ "jsonrpc": "2.0", "id": message["id"], "error": { "code": -32602, "message": "request _meta is missing or has malformed required fields: io.modelcontextprotocol/protocolVersion, io.modelcontextprotocol/clientCapabilities" } })
                    };
                    write
                        .write_all(format!("{answer}\n").as_bytes())
                        .await
                        .unwrap();
                }
            },
        )
        .await;
        let mut written = String::new();
        client.read_to_string(&mut written).await.unwrap();
        let node = "Request is missing the required _meta envelope for protocol revision 2026-07-28 (io.modelcontextprotocol/protocolVersion, io.modelcontextprotocol/clientCapabilities)";
        let messages: Vec<Value> = written
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(messages.len(), 3, "{written}");
        assert_eq!(messages[1]["error"]["message"], node, "{written}");
        assert_eq!(messages[2]["error"]["message"], node, "{written}");
    }

    // Node keeps the era its first request set: a 2026 claim in a 2025
    // session is answered as 2025.
    #[test]
    fn a_2026_claim_in_a_2025_session_is_dropped() {
        let modern = r#"{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","x":1}}}"#;
        let mut era = Era::Legacy;
        assert_eq!(
            in_era(modern, &mut era),
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"_meta":{"x":1}}}"#
        );
        let mut era = Era::Modern;
        assert_eq!(in_era(modern, &mut era), modern);
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
            pending.outgoing(&answer).as_deref(),
            Some(r#"{"jsonrpc":"2.0","id":7,"result":{}}"#)
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
