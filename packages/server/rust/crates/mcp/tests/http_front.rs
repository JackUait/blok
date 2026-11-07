//! The CLI's HTTP front door answers malformed and edge requests with
//! Node's status, content type and JSON-RPC body (lane4 HTTP recordings).

use std::sync::Arc;

use blok_mcp::Embedded;
use blok_mcp::authorize::Webhook;
use blok_mcp::bundle::Bundle;
use blok_mcp::outbound::Outbound;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Reply {
    status: u16,
    content_type: String,
    body: String,
}

async fn front() -> String {
    let options = json!({
        "transport": { "kind": "http", "listen": "127.0.0.1:0" }, "auth": { "kind": "none" },
    });
    let authorize = Webhook::new("http://127.0.0.1:9/authorize".to_owned(), Outbound::new());
    let embedded = Embedded::new(
        Arc::new(Bundle::new(1).unwrap()),
        &options,
        Some(authorize),
        None,
    )
    .await
    .unwrap();
    let listening = blok_mcp::http::listen(
        "127.0.0.1:0",
        embedded.handler(true).unwrap(),
        None,
        "local".to_owned(),
        false,
    )
    .await
    .unwrap();
    tokio::spawn(listening.serve);
    // The server holds the engines; keep them for the test's life.
    std::mem::forget(embedded);
    listening.url
}

fn de_chunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let Some(end) = body.windows(2).position(|w| w == b"\r\n") else {
            return out;
        };
        let size = usize::from_str_radix(std::str::from_utf8(&body[..end]).unwrap().trim(), 16)
            .unwrap_or(0);
        if size == 0 {
            return out;
        }
        out.extend_from_slice(&body[end + 2..end + 2 + size]);
        body = &body[end + 2 + size + 2..];
    }
}

async fn post(url: &str, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    let address = url.trim_start_matches("http://");
    let mut tcp = tokio::net::TcpStream::connect(address).await.unwrap();
    let mut head = format!(
        "POST /mcp HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    tcp.write_all(head.as_bytes()).await.unwrap();
    tcp.write_all(body).await.unwrap();
    let mut raw = Vec::new();
    tcp.read_to_end(&mut raw).await.unwrap();
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let mut body = raw[split + 4..].to_vec();
    let header = |name: &str| {
        head.lines()
            .find_map(|l| {
                let (n, v) = l.split_once(':')?;
                n.eq_ignore_ascii_case(name).then(|| v.trim().to_owned())
            })
            .unwrap_or_default()
    };
    if header("transfer-encoding").eq_ignore_ascii_case("chunked") {
        body = de_chunk(&body);
    }
    Reply {
        status: head[9..12].parse().unwrap(),
        content_type: header("content-type"),
        body: String::from_utf8_lossy(&body).into_owned(),
    }
}

const JSON: (&str, &str) = ("Content-Type", "application/json");
const ACCEPT: (&str, &str) = ("Accept", "application/json, text/event-stream");
const LEGACY: (&str, &str) = ("MCP-Protocol-Version", "2025-11-25");

fn not_a_message(id: &str) -> String {
    format!(
        r#"{{"jsonrpc":"2.0","error":{{"code":-32600,"message":"Bad Request: the request body is not a valid JSON-RPC message"}},"id":{id}}}"#
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn shape_errors_are_400_json_as_in_node() {
    let url = front().await;
    for (body, id) in [
        (r#"{"id":9,"method":"ping"}"#, "9"),
        (r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#, "null"),
        (r#"{"jsonrpc":"2.0","id":1.5,"method":"ping"}"#, "1.5"),
        (r#"{"jsonrpc":"2.0","id":3,"method":5}"#, "null"),
        ("42", "null"),
        ("null", "null"),
    ] {
        let reply = post(&url, &[JSON, ACCEPT, LEGACY], body.as_bytes()).await;
        assert_eq!(
            (
                reply.status,
                reply.content_type.as_str(),
                reply.body.as_str()
            ),
            (400, "application/json", not_a_message(id).as_str()),
            "{body}"
        );
    }
    let empty = post(&url, &[JSON, ACCEPT], b"[]").await;
    assert_eq!(
        (empty.status, empty.body.as_str()),
        (
            400,
            r#"{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: empty JSON-RPC batch"},"id":null}"#
        )
    );
    let bad = post(
        &url,
        &[JSON, ACCEPT],
        br#"[{"jsonrpc":"2.0","id":7,"method":"ping"},42]"#,
    )
    .await;
    assert_eq!(
        (bad.status, bad.body.as_str()),
        (
            400,
            r#"{"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request: JSON-RPC batch contains an invalid message"},"id":null}"#
        )
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn batches_responses_and_odd_bytes_are_served_as_in_node() {
    let url = front().await;
    let batch = post(
        &url,
        &[JSON, ACCEPT],
        br#"[{"jsonrpc":"2.0","id":7,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":8,"method":"ping"}]"#,
    )
    .await;
    assert_eq!(
        (batch.status, batch.content_type.as_str()),
        (200, "text/event-stream")
    );
    assert_eq!(
        batch.body,
        "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{}}\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{}}\n\n"
    );
    let notes = post(
        &url,
        &[JSON, ACCEPT],
        br#"[{"jsonrpc":"2.0","method":"notifications/initialized"}]"#,
    )
    .await;
    assert_eq!((notes.status, notes.body.as_str()), (202, ""));
    let response = post(
        &url,
        &[JSON, ACCEPT, LEGACY],
        br#"{"jsonrpc":"2.0","id":5,"result":{}}"#,
    )
    .await;
    assert_eq!((response.status, response.body.as_str()), (202, ""));
    let odd = post(
        &url,
        &[JSON, ACCEPT, LEGACY],
        b"{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"ping\",\"params\":{\"x\":\"a\xffb\"}}",
    )
    .await;
    assert_eq!(odd.status, 200, "{}", odd.body);
}

#[tokio::test(flavor = "multi_thread")]
async fn edge_refusals_carry_nodes_json_body() {
    let url = front().await;
    let ping = br#"{"jsonrpc":"2.0","id":9,"method":"ping"}"#;
    for (version, shown) in [("", ""), ("1999-01-01", "1999-01-01")] {
        let reply = post(
            &url,
            &[JSON, ACCEPT, ("MCP-Protocol-Version", version)],
            ping,
        )
        .await;
        assert_eq!(
            (reply.status, reply.content_type.as_str(), reply.body),
            (
                400,
                "application/json",
                format!(
                    r#"{{"jsonrpc":"2.0","error":{{"code":-32000,"message":"Bad Request: Unsupported protocol version: {shown} (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)"}},"id":null}}"#
                )
            ),
            "{version:?}"
        );
    }
    let no_accept = post(&url, &[JSON], ping).await;
    assert_eq!(
        (
            no_accept.status,
            no_accept.content_type.as_str(),
            no_accept.body.as_str()
        ),
        (
            406,
            "application/json",
            r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}"#
        )
    );
    let no_type = post(&url, &[ACCEPT], ping).await;
    assert_eq!(
        (
            no_type.status,
            no_type.content_type.as_str(),
            no_type.body.as_str()
        ),
        (
            415,
            "application/json",
            r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unsupported Media Type: Content-Type must be application/json"},"id":null}"#
        )
    );
    // initialize names its version in the body: a header is not checked.
    let init = post(
        &url,
        &[JSON, ACCEPT, ("MCP-Protocol-Version", "1999-01-01")],
        br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}"#,
    )
    .await;
    assert_eq!(init.status, 200, "{}", init.body);
}
