use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_dotnet::parse_absolute_uri;
use blok_jsjson::{Kind, Object, Str, Value};

use crate::client::{Client, Error, Fake, Options, Projection, Recorded, seconds, serialize};
use crate::{LINEAGE_HEADER, SEQUENCE_HEADER, VERSION_HEADER};

pub const LINEAGE: &str = "00112233445566778899aabbccddeeff";

/// RequestRecorder: it logs each request, then answers it.
#[derive(Clone, Default)]
pub struct Recorder {
    pub requests: Arc<Mutex<Vec<Recorded>>>,
}

impl Recorder {
    pub fn first(&self) -> Recorded {
        self.requests.lock().unwrap()[0].clone()
    }

    pub fn count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}

pub fn answer(status: u16, body: &str, declared: bool) -> Fake {
    Fake::Answer {
        status,
        body: body.as_bytes().to_vec(),
        declared,
    }
}

#[derive(Default)]
pub struct Setup {
    pub endpoint: &'static str,
    /// "" is the default "Bearer secret"; "-" is none.
    pub authorization: &'static str,
    pub timeout: Option<Duration>,
    pub max_response_bytes: u64,
}

pub fn client(
    recorder: &Recorder,
    setup: Setup,
    respond: impl Fn(&Recorded) -> Fake + Send + Sync + 'static,
) -> Client {
    let endpoint = if setup.endpoint.is_empty() {
        "https://app.example.com/api/docs"
    } else {
        setup.endpoint
    };
    let authorization = match setup.authorization {
        "" => "Bearer secret",
        "-" => "",
        other => other,
    };
    let requests = recorder.requests.clone();
    Client::with_fake(
        Options {
            endpoint: parse_absolute_uri(endpoint).unwrap(),
            authorization: authorization.to_owned(),
            request_timeout: Some(setup.timeout.unwrap_or(Duration::from_secs(30))),
            max_response_bytes: setup.max_response_bytes,
        },
        Arc::new(move |request: &Recorded| {
            requests.lock().unwrap().push(request.clone());
            respond(request)
        }),
    )
}

pub fn json(body: &'static str) -> impl Fn(&Recorded) -> Fake + Send + Sync + 'static {
    move |_| answer(200, body, true)
}

pub fn node(text: &str) -> Value {
    blok_jsjson::parse(text.as_bytes()).unwrap()
}

pub fn endpoint_error(err: Error) -> (String, u16) {
    match err {
        Error::Endpoint {
            message,
            status_code,
        } => (message, status_code),
        other => panic!("not an endpoint error: {other:?}"),
    }
}

#[tokio::test]
async fn load_gets_the_document_url_with_the_authorization_verbatim() {
    let r = Recorder::default();
    let setup = Setup {
        endpoint: "https://app.example.com/api/docs/",
        authorization: "Bearer abc def",
        ..Setup::default()
    };
    client(&r, setup, json(r#"{"blocks":[]}"#))
        .load("doc 1/x")
        .await
        .unwrap();
    assert_eq!(r.count(), 1);
    let got = r.first();
    assert_eq!(got.method, "GET");
    assert_eq!(got.url, "https://app.example.com/api/docs/doc%201%2Fx");
    assert_eq!(got.header("Authorization"), Some("Bearer abc def"));
    assert_eq!(got.header("Accept"), Some("application/json"));
}

#[tokio::test]
async fn load_omits_the_authorization_header_when_none_is_configured() {
    let r = Recorder::default();
    let setup = Setup {
        authorization: "-",
        ..Setup::default()
    };
    client(&r, setup, json(r#"{"blocks":[]}"#))
        .load("doc")
        .await
        .unwrap();
    assert_eq!(r.first().header("Authorization"), None);
}

#[tokio::test]
async fn refuses_an_authorization_value_the_header_cannot_carry() {
    for auth in UNSENDABLE.map(|bad| format!("Bearer a{bad}")) {
        let r = Recorder::default();
        let setup = Setup {
            // Setup holds 'static text; a test may leak it.
            authorization: Box::leak(auth.clone().into_boxed_str()),
            ..Setup::default()
        };
        let err = client(&r, setup, json(r#"{"blocks":[]}"#))
            .load("doc")
            .await
            .unwrap_err();
        assert_eq!(
            endpoint_error(err).0,
            "collab: the doc endpoint Authorization value cannot be sent as a header (a stray newline?).",
            "{auth:?}"
        );
        assert_eq!(r.count(), 0);
    }
}

// Spaces and tabs around a value are not part of it (RFC 9110 5.5): undici
// and Go's net/http drop them.
#[tokio::test]
async fn sends_header_values_without_outer_spaces_and_tabs() {
    let r = Recorder::default();
    let setup = Setup {
        authorization: " Bearer  x\t",
        ..Setup::default()
    };
    client(&r, setup, json(r#"{"version":"v2"}"#))
        .save("doc", &node(r#"{"blocks":[]}"#), Some("\tv1 "), None)
        .await
        .unwrap();
    assert_eq!(r.first().header("Authorization"), Some("Bearer  x"));
    assert_eq!(r.first().header(VERSION_HEADER), Some("v1"));
}

// undici's rule: tab, printable ASCII and U+0080..U+00FF only.
const UNSENDABLE: [&str; 8] = [
    "\n",
    "\r\nX: 1",
    "\0",
    "\u{1}",
    "\u{1f}",
    "\u{7f}",
    "\u{100}",
    "\u{1F600}",
];

// The version comes from the endpoint's own answer.
#[tokio::test]
async fn refuses_a_save_version_the_header_cannot_carry() {
    for version in UNSENDABLE.map(|bad| format!("v1{bad}")) {
        let r = Recorder::default();
        let err = client(&r, Setup::default(), json(""))
            .save("doc", &node(r#"{"blocks":[]}"#), Some(&version), None)
            .await
            .unwrap_err();
        assert_eq!(
            endpoint_error(err).0,
            "collab: the doc endpoint version cannot be sent as a header.",
            "{version:?}"
        );
        assert_eq!(r.count(), 0);
    }
}

#[tokio::test]
async fn load_reads_a_bare_output_data_document() {
    let r = Recorder::default();
    let loaded = client(
        &r,
        Setup::default(),
        json(r#"{"time":1,"blocks":[{"id":"a"}],"version":"2.31.0"}"#),
    )
    .load("doc")
    .await
    .unwrap();
    assert_eq!(loaded.data.map(|d| d.kind), Some(Kind::Object));
    assert_eq!(loaded.version, None);
}

#[tokio::test]
async fn load_reads_a_persisted_document_envelope() {
    for (body, version) in [
        (
            r#"{"data":{"blocks":[{"id":"a"}]},"version":"v7"}"#,
            Some("v7"),
        ),
        (
            r#"{"data":{"blocks":[{"id":"a"}]},"version":42}"#,
            Some("42"),
        ),
        (
            r#"{"data":{"blocks":[{"id":"a"}]},"version":1e21}"#,
            Some("1E+21"),
        ),
        (r#"{"data":{"blocks":[{"id":"a"}]}}"#, None),
    ] {
        let loaded = client(&Recorder::default(), Setup::default(), json(body))
            .load("doc")
            .await
            .unwrap();
        assert!(loaded.data.is_some(), "{body}");
        assert_eq!(loaded.version.as_deref(), version, "{body}");
    }
}

#[tokio::test]
async fn load_reads_a_null_document_as_an_empty_seed() {
    for (body, version) in [
        (r#"{"data":null,"version":"v1"}"#, Some("v1")),
        ("null", None),
    ] {
        let loaded = client(&Recorder::default(), Setup::default(), json(body))
            .load("doc")
            .await
            .unwrap();
        assert!(loaded.data.is_none(), "{body}");
        assert_eq!(loaded.version.as_deref(), version, "{body}");
    }
}

#[tokio::test]
async fn load_rejects_a_non_success_status() {
    for status in [404, 401, 500, 302] {
        // No redirect is followed: the fake would answer the same anyway,
        // and one request is all it sees.
        let r = Recorder::default();
        let err = client(&r, Setup::default(), move |_| answer(status, "nope", true))
            .load("doc")
            .await
            .unwrap_err();
        let (message, code) = endpoint_error(err);
        assert_eq!(code, status);
        assert!(message.contains(&status.to_string()));
        assert_eq!(r.count(), 1);
    }
}

#[tokio::test]
async fn an_error_status_is_reported_with_a_prefix_of_its_body_without_buffering_it() {
    let body: &'static str = Box::leak(format!("{}\r\nEND", "x".repeat(600)).into_boxed_str());
    let setup = Setup {
        max_response_bytes: 128,
        ..Setup::default()
    };
    let err = client(&Recorder::default(), setup, move |_| {
        answer(500, body, true)
    })
    .load("doc")
    .await
    .unwrap_err();
    let (message, code) = endpoint_error(err);
    assert_eq!(code, 500);
    assert!(message.contains(&"x".repeat(512)));
    assert!(!message.contains(&"x".repeat(513)));
    assert!(!message.contains("END"));
}

#[tokio::test]
async fn an_error_body_is_flattened_to_one_line_in_the_message() {
    let err = client(&Recorder::default(), Setup::default(), |_| {
        answer(502, "upstream\r\n  down", true)
    })
    .load("doc")
    .await
    .unwrap_err();
    assert_eq!(
        endpoint_error(err).0,
        "collab: the doc endpoint GET returned 502: upstream down"
    );
    let err = client(&Recorder::default(), Setup::default(), |_| {
        answer(502, " \n", true)
    })
    .load("doc")
    .await
    .unwrap_err();
    assert_eq!(
        endpoint_error(err).0,
        "collab: the doc endpoint GET returned 502."
    );
}

#[tokio::test]
async fn load_rejects_a_malformed_body() {
    for body in [
        "",
        "{not json",
        "[]",
        "\"text\"",
        r#"{"data":"text"}"#,
        r#"{"data":{},"version":true}"#,
    ] {
        let err = client(&Recorder::default(), Setup::default(), json(body))
            .load("doc")
            .await
            .unwrap_err();
        assert_eq!(endpoint_error(err).1, 0, "{body}");
    }
}

// HostCollabTests.ASeedGetWithoutAJsonBodyCloses4503AndStateAnswers503, the
// client's half: a 204 is a 2xx, so it fails as an unreadable body, not as a
// status.
#[tokio::test]
async fn a_seed_get_without_a_json_body_closes4503_and_state_answers503() {
    let err = client(&Recorder::default(), Setup::default(), |_| {
        answer(204, "", true)
    })
    .load("doc")
    .await
    .unwrap_err();
    assert_eq!(endpoint_error(err).1, 0);
}

#[tokio::test]
async fn save_puts_the_bare_document_with_the_version_header() {
    let r = Recorder::default();
    let setup = Setup {
        authorization: "Token xyz",
        ..Setup::default()
    };
    let document = node(r#"{"time":5,"blocks":[{"id":"a","type":"paragraph","data":{}}]}"#);
    client(&r, setup, |_| answer(204, "", true))
        .save("doc-1", &document, Some("v7"), None)
        .await
        .unwrap();
    let got = r.first();
    assert_eq!(got.method, "PUT");
    assert_eq!(got.url, "https://app.example.com/api/docs/doc-1");
    assert_eq!(got.header("Authorization"), Some("Token xyz"));
    assert_eq!(got.header(VERSION_HEADER), Some("v7"));
    assert!(
        got.header("Content-Type")
            .unwrap()
            .starts_with("application/json")
    );
    assert_eq!(
        String::from_utf8(got.body).unwrap(),
        r#"{"time":5,"blocks":[{"id":"a","type":"paragraph","data":{}}]}"#
    );
}

#[tokio::test]
async fn save_omits_the_version_header_when_no_version_is_known() {
    let r = Recorder::default();
    client(&r, Setup::default(), |_| answer(200, "", true))
        .save("doc", &node(r#"{"blocks":[]}"#), None, None)
        .await
        .unwrap();
    assert_eq!(r.first().header(VERSION_HEADER), None);
}

#[tokio::test]
async fn projection_carries_lineage_and_server_sequence() {
    let r = Recorder::default();
    let c = client(&r, Setup::default(), |_| answer(204, "", true));
    let document = node(r#"{"blocks":[]}"#);
    let projection = Projection {
        lineage: LINEAGE.into(),
        server_sequence: u64::MAX,
    };
    c.save("doc", &document, Some("v7"), Some(&projection))
        .await
        .unwrap();
    c.save("doc", &document, Some("v7"), None).await.unwrap();
    let requests = r.requests.lock().unwrap().clone();
    let (stamped, unstamped) = (&requests[0], &requests[1]);
    assert_eq!(stamped.header(LINEAGE_HEADER), Some(LINEAGE));
    assert_eq!(
        stamped.header(SEQUENCE_HEADER),
        Some("18446744073709551615")
    );
    assert_eq!(stamped.header(VERSION_HEADER), Some("v7"));
    assert_eq!(unstamped.header(LINEAGE_HEADER), None);
    assert_eq!(unstamped.header(SEQUENCE_HEADER), None);
    assert_eq!(unstamped.header(VERSION_HEADER), Some("v7"));
}

#[tokio::test]
async fn save_returns_the_version_the_endpoint_answers_with_if_any() {
    for (body, want) in [
        (r#"{"version":"v8"}"#, Some("v8")),
        (r#"{"version":9}"#, Some("9")),
        (r#"{"ok":true}"#, None),
        ("", None),
        ("not json", None),
        (r#"{"version":true}"#, None),
    ] {
        let version = client(&Recorder::default(), Setup::default(), json(body))
            .save("doc", &node(r#"{"blocks":[]}"#), Some("v7"), None)
            .await
            .unwrap();
        assert_eq!(version.as_deref(), want, "{body:?}");
    }
}

#[tokio::test]
async fn save_rejects_a_non_success_status() {
    for status in [409, 502] {
        let err = client(&Recorder::default(), Setup::default(), move |_| {
            answer(status, "", true)
        })
        .save("doc", &node(r#"{"blocks":[]}"#), None, None)
        .await
        .unwrap_err();
        assert_eq!(endpoint_error(err).1, status);
    }
}

#[tokio::test]
async fn requests_give_up_after_the_configured_timeout() {
    let setup = Setup {
        timeout: Some(Duration::from_millis(200)),
        ..Setup::default()
    };
    let err = client(&Recorder::default(), setup, |_| Fake::Hang)
        .load("doc")
        .await
        .unwrap_err();
    let (message, code) = endpoint_error(err);
    assert_eq!(
        message,
        "collab: the doc endpoint GET timed out after 0.2s."
    );
    assert_eq!(code, 0);
}

// Cancelling is dropping the future; the request stops with it.
#[tokio::test]
async fn a_caller_cancellation_stops_the_request() {
    let r = Recorder::default();
    let c = client(&r, Setup::default(), |_| Fake::Hang);
    assert!(
        tokio::time::timeout(Duration::from_millis(50), c.load("doc"))
            .await
            .is_err()
    );
    assert_eq!(r.count(), 1);
}

#[tokio::test]
async fn load_rejects_a_doc_id_that_is_not_one_ordinary_segment() {
    for id in ["", ".", ".."] {
        let r = Recorder::default();
        let err = client(&r, Setup::default(), json(r#"{"blocks":[]}"#))
            .load(id)
            .await
            .unwrap_err();
        assert!(matches!(err, Error::Argument(_)), "{id:?}");
        assert_eq!(r.count(), 0);
    }
}

#[tokio::test]
async fn save_rejects_a_dot_segment_doc_id_before_sending() {
    let r = Recorder::default();
    let err = client(&r, Setup::default(), json("{}"))
        .save("..", &Value::Object(Object::new()), None, None)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Argument(_)));
    assert_eq!(r.count(), 0);
}

#[tokio::test]
async fn an_accepted_doc_id_stays_one_escaped_segment() {
    for (id, want) in [
        ("doc 1/x", "https://app.example.com/api/docs/doc%201%2Fx"),
        ("a.b", "https://app.example.com/api/docs/a.b"),
        ("...", "https://app.example.com/api/docs/..."),
        ("a?b#c", "https://app.example.com/api/docs/a%3Fb%23c"),
        ("../x", "https://app.example.com/api/docs/..%2Fx"),
        ("%2e", "https://app.example.com/api/docs/%252e"),
        ("%2E%2e", "https://app.example.com/api/docs/%252E%252e"),
        ("\u{e9}~", "https://app.example.com/api/docs/%C3%A9~"),
    ] {
        let r = Recorder::default();
        client(&r, Setup::default(), json(r#"{"blocks":[]}"#))
            .load(id)
            .await
            .unwrap();
        assert_eq!(r.first().url, want, "{id:?}");
    }
}

fn capped(limit: u64) -> Setup {
    Setup {
        max_response_bytes: limit,
        ..Setup::default()
    }
}

#[tokio::test]
async fn load_refuses_a_response_larger_than_the_cap() {
    let body: &'static str =
        Box::leak(format!(r#"{{"blocks":[],"pad":"{}"}}"#, "x".repeat(4096)).into_boxed_str());
    for declared in [true, false] {
        let err = client(&Recorder::default(), capped(1024), move |_| {
            answer(200, body, declared)
        })
        .load("doc")
        .await
        .unwrap_err();
        assert_eq!(
            endpoint_error(err).0,
            "collab: the doc endpoint GET answer is too large (over 1024 bytes)."
        );
    }
}

#[tokio::test]
async fn load_accepts_a_response_at_the_cap() {
    let body = r#"{"blocks":[]}"#;
    for declared in [true, false] {
        let loaded = client(&Recorder::default(), capped(body.len() as u64), move |_| {
            answer(200, body, declared)
        })
        .load("doc")
        .await
        .unwrap();
        assert!(loaded.data.is_some());
    }
}

#[tokio::test]
async fn load_refuses_a_response_one_byte_over_the_cap() {
    let body = r#"{"blocks":[]}"#;
    let limit = body.len() as u64 - 1;
    for declared in [true, false] {
        let err = client(&Recorder::default(), capped(limit), move |_| {
            answer(200, body, declared)
        })
        .load("doc")
        .await
        .unwrap_err();
        assert_eq!(
            endpoint_error(err).0,
            format!("collab: the doc endpoint GET answer is too large (over {limit} bytes).")
        );
    }
}

fn deep_json(depth: usize) -> &'static str {
    Box::leak(format!("{}1{}", r#"{"a":"#.repeat(depth), "}".repeat(depth)).into_boxed_str())
}

// 512 levels pass both ways and 513 do not (probed against .NET 10).
#[tokio::test]
async fn the_depth_limit_is512_both_ways() {
    for depth in [100, 512] {
        let loaded = client(
            &Recorder::default(),
            Setup::default(),
            json(deep_json(depth)),
        )
        .load("doc")
        .await
        .unwrap();
        assert!(loaded.data.is_some(), "load {depth}");
        let r = Recorder::default();
        client(&r, Setup::default(), json("{}"))
            .save("doc", &node(deep_json(depth)), None, None)
            .await
            .unwrap();
        assert!(
            String::from_utf8(r.first().body).unwrap().contains("\"a\""),
            "save {depth}"
        );
    }
    assert!(
        client(&Recorder::default(), Setup::default(), json(deep_json(513)))
            .load("doc")
            .await
            .is_err()
    );
    let mut value = Value::Number(1.0);
    for _ in 0..513 {
        let mut object = Object::new();
        object.set(Str::from("a"), value);
        value = Value::Object(object);
    }
    let r = Recorder::default();
    assert!(
        client(&r, Setup::default(), json("{}"))
            .save("doc", &value, None, None)
            .await
            .is_err()
    );
    assert_eq!(r.count(), 0);
}

#[tokio::test]
async fn load_rejects_an_answer_with_duplicate_json_keys() {
    let err = client(
        &Recorder::default(),
        Setup::default(),
        json(r#"{"data":{"a":1},"data":{"a":2}}"#),
    )
    .load("doc")
    .await
    .unwrap_err();
    endpoint_error(err);
}

// Utf8JsonWriter's default encoder and .NET number text (probed).
#[test]
fn serialize_writes_what_system_text_json_writes() {
    let mut object = Object::new();
    object.set(Str::from("x"), Value::Number(1e21));
    let (tenth, fifth) = (std::hint::black_box(0.1), std::hint::black_box(0.2));
    object.set(Str::from("y"), Value::Number(tenth + fifth));
    object.set(Str::from("z"), Value::BigInt(5));
    object.set(
        Str::from("s"),
        Value::String(Str::from("\u{e9}<>&'+`\u{2028}")),
    );
    let got = String::from_utf8(serialize(&Value::Object(object)).unwrap()).unwrap();
    assert_eq!(
        got,
        "{\"x\":1E+21,\"y\":0.30000000000000004,\"z\":5,\"s\":\"\\u00E9\\u003C\\u003E\\u0026\\u0027\\u002B\\u0060\\u2028\"}"
    );
}

#[test]
fn seconds_are_written_like_dotnet() {
    for (d, want) in [
        (Duration::from_millis(200), "0.2"),
        (Duration::from_secs(30), "30"),
        (Duration::from_micros(1_234_560), "1.235"),
        (Duration::from_micros(500), "0.001"),
    ] {
        assert_eq!(seconds(d), want, "{d:?}");
    }
}

/// One raw answer per connection; returns the endpoint and the heads seen.
pub async fn raw_endpoint(response: &'static [u8]) -> (String, Arc<Mutex<Vec<String>>>) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let heads = Arc::new(Mutex::new(Vec::new()));
    let heads2 = heads.clone();
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let heads = heads2.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(tcp);
                let mut head = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).await.unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    head.push_str(&line);
                }
                heads.lock().unwrap().push(head);
                let _ = reader.get_mut().write_all(response).await;
            });
        }
    });
    (format!("http://{address}/docs"), heads)
}

// C#'s HttpClient sends only Host and Accept on a GET (probed): no
// User-Agent and no Accept-Encoding, so the cap counts the raw body.
#[tokio::test]
async fn the_default_transport_sends_only_what_c_sharp_sends() {
    let (endpoint, heads) =
        raw_endpoint(b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\n{\"blocks\":[]}").await;
    let c = Client::with_connect_timeout(
        Options {
            endpoint: parse_absolute_uri(&endpoint).unwrap(),
            request_timeout: Some(Duration::from_secs(5)),
            ..Options::default()
        },
        Duration::from_secs(10),
        None,
    );
    c.load("a").await.unwrap();
    let head = heads.lock().unwrap()[0].to_ascii_lowercase();
    assert!(!head.contains("user-agent"), "{head}");
    assert!(!head.contains("accept-encoding"), "{head}");
    assert!(head.contains("\r\naccept: application/json\r\n"), "{head}");
    // Probed on the C# host: a GET carries no content, so no Content-Length.
    assert!(!head.contains("content-length"), "{head}");
}

// DocEndpointClient.cs reads the error prefix under the request timeout and
// swallows its cancellation: the status still makes the message.
#[tokio::test]
async fn an_error_body_that_stalls_past_the_timeout_still_reports_the_status() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut tcp, _) = listener.accept().await.unwrap();
        let mut head = [0u8; 1024];
        let _ = tcp.read(&mut head).await;
        tcp.write_all(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 100\r\n\r\npartial body",
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_secs(10)).await;
    });
    let c = Client::with_connect_timeout(
        Options {
            endpoint: parse_absolute_uri(&format!("http://{address}/docs")).unwrap(),
            request_timeout: Some(Duration::from_millis(300)),
            ..Options::default()
        },
        Duration::from_secs(10),
        None,
    );
    let (message, status) = endpoint_error(c.load("a").await.unwrap_err());
    assert_eq!(
        (message.as_str(), status),
        (
            "collab: the doc endpoint GET returned 500: partial body",
            500
        )
    );
}

// The host's own version comes back on the next PUT: a CR or LF in it
// must never become a second header on the wire.
#[tokio::test]
async fn a_version_with_a_line_break_is_never_sent() {
    let (endpoint, heads) = raw_endpoint(b"HTTP/1.1 204 No Content\r\n\r\n").await;
    let c = Client::with_connect_timeout(
        Options {
            endpoint: parse_absolute_uri(&endpoint).unwrap(),
            request_timeout: Some(Duration::from_secs(5)),
            ..Options::default()
        },
        Duration::from_secs(10),
        None,
    );
    let document = node(r#"{"blocks":[]}"#);
    let saved = c
        .save("a", &document, Some("v\r\nX-Injected: 2"), None)
        .await;
    assert!(saved.is_err(), "{saved:?}");
    let seen = heads.lock().unwrap().join("");
    assert!(!seen.contains("X-Injected"), "{seen}");
}
