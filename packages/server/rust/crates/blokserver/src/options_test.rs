use std::collections::BTreeMap;

use blok_jsjson::{Kind, Node, Options as JsonOptions, parse_node, to_string_lossy};

use super::*;

fn fixture(name: &str) -> Node {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    parse_node(&bytes, JsonOptions::default()).unwrap()
}

fn key(member: &blok_jsjson::NodeMember) -> String {
    to_string_lossy(member.key().unwrap().units())
}

fn text(node: &Node) -> String {
    assert_eq!(node.kind, Kind::String);
    to_string_lossy(node.text().unwrap().units())
}

fn int(node: &Node) -> i64 {
    std::str::from_utf8(node.raw()).unwrap().parse().unwrap()
}

fn boolean(node: &Node) -> bool {
    match node.kind {
        Kind::True => true,
        Kind::False => false,
        other => panic!("not a bool: {other:?}"),
    }
}

fn get<'a>(node: &'a Node, name: &str) -> &'a Node {
    node.members
        .iter()
        .find(|m| key(m) == name)
        .map(|m| &m.value)
        .unwrap_or_else(|| panic!("no {name}"))
}

/// Applies options named as the C# properties.
fn from_csharp(spec: &Node) -> Options {
    let mut o = Options::default();
    for member in &spec.members {
        let raw = &member.value;
        match key(member).as_str() {
            "ListenAddress" => o.listen_address = text(raw),
            "Auth" => o.auth = text(raw),
            "Secret" => o.secret = text(raw),
            "AllowedOrigins" => o.allowed_origins = raw.items.iter().map(text).collect(),
            "StorageDirectory" => o.storage_directory = text(raw),
            "PublicUrl" => o.public_url = text(raw),
            "MaxUploadBytes" => o.max_upload_bytes = int(raw),
            "RateLimitPerMinute" => o.rate_limit_per_minute = int(raw),
            "UnfurlDisabled" => o.unfurl_enabled = !boolean(raw),
            "S3Endpoint" => o.s3_endpoint = text(raw),
            "S3Region" => o.s3_region = text(raw),
            "S3Bucket" => o.s3_bucket = text(raw),
            "S3BucketUrl" => o.s3_bucket_url = text(raw),
            "S3Addressing" => o.s3_addressing = text(raw),
            "S3AccessKey" => o.s3_access_key = text(raw),
            "S3SecretKey" => o.s3_secret_key = text(raw),
            "CollabEnabled" => o.collab_enabled = boolean(raw),
            "DocEndpoint" => o.doc_endpoint = text(raw),
            "DocEndpointAuth" => o.doc_endpoint_auth = text(raw),
            "CollabDirectory" => o.collab_directory = text(raw),
            "CollabS3Prefix" => o.collab_s3_prefix = text(raw),
            "CollabJournal" => o.collab_journal = boolean(raw),
            "CollabMaxConnectionsPerUserPerDoc" => {
                o.collab_max_connections_per_user_per_doc = int(raw);
            }
            "CollabMaxConnections" => o.collab_max_connections = int(raw),
            "CollabMaxMessageBytes" => o.collab_max_message_bytes = int(raw),
            "CollabKeepAliveIntervalMs" => {
                o.collab_keep_alive_interval_nanos = int(raw) * 1_000_000;
            }
            "CollabInboundFramesPerSecond" => o.collab_inbound_frames_per_second = int(raw),
            "CollabInboundBurstFrames" => o.collab_inbound_burst_frames = int(raw),
            "CollabInboundResyncsPerMinute" => o.collab_inbound_resyncs_per_minute = int(raw),
            "CollabInboundAwarenessBytesPerSecond" => {
                o.collab_inbound_awareness_bytes_per_second = int(raw);
            }
            "RichTextFields" => {
                o.rich_text_fields = raw
                    .members
                    .iter()
                    .map(|m| (key(m), m.value.items.iter().map(text).collect()))
                    .collect::<BTreeMap<_, _>>();
            }
            "Version" => o.version = text(raw),
            other => panic!("no Rust mapping for option {other}"),
        }
    }
    o
}

#[test]
fn validate_matches_the_csharp_fixture() {
    let fixture = fixture("options-validate.json");
    let cases = &get(&fixture, "cases").items;
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in cases {
        let o = from_csharp(get(case, "options"));
        let (path, error) = match o.validate_path() {
            Ok(path) => (path, String::new()),
            Err(error) => (String::new(), error.to_string()),
        };
        let want = (text(get(case, "localPublicPath")), text(get(case, "error")));
        if (path.clone(), error.clone()) != want {
            failures.push(format!(
                "{}:\n got {error:?} {path:?}\nwant {:?} {:?}",
                text(get(case, "name")),
                want.1,
                want.0
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// C# UnfurlDisabled defaults to true; the Rust field is inverted so the
// default is the same closed state.
#[test]
fn zero_options_keep_outbound_routes_closed() {
    assert!(!Options::default().unfurl_enabled);
}

#[test]
fn format_time_span_matches_dotnet() {
    assert_eq!(format_time_span(-1_500_000_000), "-00:00:01.5000000");
    let long = format_time_span(-26 * 3_600_000_000_000);
    assert!(long.starts_with("-1.02:00:00"), "{long}");
}

// options-defaults.json is every settable BlokServerOptions property of a
// new instance.
#[test]
fn default_options_match_the_csharp_defaults() {
    let got = from_csharp(&fixture("options-defaults.json"));
    let want = Options::default();
    assert_eq!(format!("{got:?}"), format!("{want:?}"));
}

// AddBlokDocuments validates its constraints in the call, not at the first
// conversion. PoolSize is a usize here, so Go's -1 case cannot be built.
#[test]
fn new_refuses_document_limits_below_their_floor() {
    for (name, documents) in [
        (
            "timeout",
            blok_blokdocs::Options {
                timeout: std::time::Duration::from_millis(1),
                ..blok_blokdocs::Options::default()
            },
        ),
        (
            "memory budget",
            blok_blokdocs::Options {
                memory_budget: 1,
                ..blok_blokdocs::Options::default()
            },
        ),
    ] {
        let o = Options {
            documents,
            ..Options::default()
        };
        let error = o.validate().expect_err(name);
        assert!(error.constraint().is_some(), "{name}: {error}");
    }
    assert!(Options::default().validate().is_ok());
}
