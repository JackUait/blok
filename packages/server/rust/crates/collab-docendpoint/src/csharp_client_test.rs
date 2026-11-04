use crate::client::Fake;
use crate::client_test::{LINEAGE, Recorder, Setup, answer, client, endpoint_error, node};
use crate::{Projection, SEQUENCE_HEADER};

// Twins of the DocEndpointClientTests cases with no Go twin.

// The sequence header is the consumer's handle on ordering: a projection
// naming a sequence its record has passed is refused, and the client
// reports that refusal rather than counting it as a save.
#[tokio::test]
async fn older_projection_cannot_overwrite_a_newer_sequence_when_consumer_uses_headers() {
    let consumer = client(&Recorder::default(), Setup::default(), |request| {
        let sequence: Option<u64> = request.header(SEQUENCE_HEADER).and_then(|s| s.parse().ok());
        if sequence.is_some_and(|s| s > 5) {
            answer(200, r#"{"version":"v9"}"#, true)
        } else {
            Fake::Answer {
                status: 409,
                body: Vec::new(),
                declared: true,
            }
        }
    });
    let document = node(r#"{"blocks":[]}"#);
    let stale = Projection {
        lineage: LINEAGE.into(),
        server_sequence: 3,
    };
    let err = consumer
        .save("doc", &document, Some("v5"), Some(&stale))
        .await
        .unwrap_err();
    assert_eq!(endpoint_error(err).1, 409);
    let fresh = Projection {
        lineage: LINEAGE.into(),
        server_sequence: 7,
    };
    assert_eq!(
        consumer
            .save("doc", &document, Some("v5"), Some(&fresh))
            .await
            .unwrap()
            .as_deref(),
        Some("v9")
    );
}

#[tokio::test]
async fn load_refuses_an_overlong_response_that_declares_no_length() {
    let body: &'static str =
        Box::leak(format!(r#"{{"blocks":[],"pad":"{}"}}"#, "x".repeat(4096)).into_boxed_str());
    let setup = Setup {
        max_response_bytes: 1024,
        ..Setup::default()
    };
    let err = client(&Recorder::default(), setup, move |_| {
        answer(200, body, false)
    })
    .load("doc")
    .await
    .unwrap_err();
    assert!(endpoint_error(err).0.contains("too large"));
}

// The framework default depth is 64; the client reads and writes 512.
#[tokio::test]
async fn load_reads_a_document_nested_past_the_framework_default_depth() {
    let body: &'static str =
        Box::leak(format!("{}1{}", r#"{"a":"#.repeat(65), "}".repeat(65)).into_boxed_str());
    let loaded = client(&Recorder::default(), Setup::default(), move |_| {
        answer(200, body, true)
    })
    .load("doc")
    .await
    .unwrap();
    assert!(loaded.data.is_some());
}

// A declared length over the cap is refused before the body is read, so a
// stalled body cannot hold the request until its timeout.
#[tokio::test]
async fn a_declared_length_over_the_cap_is_refused_before_the_body() {
    let (endpoint, _) = crate::client_test::raw_endpoint(
        b"HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n{\"blocks\":",
    )
    .await;
    let c = crate::Client::with_connect_timeout(
        crate::Options {
            endpoint: blok_dotnet::parse_absolute_uri(&endpoint).unwrap(),
            request_timeout: Some(std::time::Duration::from_secs(5)),
            max_response_bytes: 1024,
            ..crate::Options::default()
        },
        std::time::Duration::from_secs(10),
        None,
    );
    let start = std::time::Instant::now();
    let err = c.load("a").await.unwrap_err();
    assert!(endpoint_error(err).0.contains("too large"));
    assert!(start.elapsed() < std::time::Duration::from_secs(2));
}
