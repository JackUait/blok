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
            "CollabEnforceRestoreGuards" => o.collab_enforce_restore_guards = boolean(raw),
            "CollabRestoreTrashesPages" => o.collab_restore_trashes_pages = boolean(raw),
            "CollabStampAuthority" => o.collab_stamp_authority = boolean(raw),
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
// conversion. PoolSize is a usize here, so Go's -1 case cannot be built;
// 0 is refused.
#[test]
fn new_refuses_document_limits_below_their_floor() {
    for (name, documents) in [
        (
            "timeout",
            blok_blokdocs::Options {
                timeout: Some(std::time::Duration::from_millis(1)),
                ..blok_blokdocs::Options::default()
            },
        ),
        (
            "zero timeout",
            blok_blokdocs::Options {
                timeout: Some(std::time::Duration::ZERO),
                ..blok_blokdocs::Options::default()
            },
        ),
        (
            "memory budget",
            blok_blokdocs::Options {
                memory_budget: Some(1),
                ..blok_blokdocs::Options::default()
            },
        ),
        (
            "zero budget",
            blok_blokdocs::Options {
                memory_budget: Some(0),
                ..blok_blokdocs::Options::default()
            },
        ),
        (
            "zero pool size",
            blok_blokdocs::Options {
                pool_size: Some(0),
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

// AddBlokServer validates in the call; validate() is its twin here.
fn refusal(o: Options) -> String {
    match o.validate() {
        Ok(()) => panic!("accepted"),
        Err(error) => error.to_string(),
    }
}

fn assert_refused(name: &str, o: Options, parts: &[&str]) {
    let message = refusal(o);
    for part in parts {
        assert!(message.contains(part), "{name}: {message:?} lacks {part:?}");
    }
}

fn s3_options(endpoint: &str, bucket_url: &str) -> Options {
    Options {
        s3_endpoint: endpoint.into(),
        s3_region: "eu-central-1".into(),
        s3_bucket: "media".into(),
        s3_bucket_url: bucket_url.into(),
        s3_access_key: "access-key".into(),
        s3_secret_key: "secret-key".into(),
        ..Options::default()
    }
}

fn local_storage(public_url: &str) -> Options {
    Options {
        storage_directory: "/local/storage".into(),
        public_url: public_url.into(),
        ..Options::default()
    }
}

#[test]
fn rejects_an_empty_or_nul_rich_text_field_name() {
    for (kind, field) in [("", "title"), ("callout", ""), ("callout", "ti\0tle")] {
        let o = Options {
            rich_text_fields: BTreeMap::from([(kind.to_owned(), vec![field.to_owned()])]),
            ..Options::default()
        };
        assert_refused(&format!("{kind:?} {field:?}"), o, &["RichTextFields"]);
    }
}

#[test]
fn rejects_unsafe_doc_endpoints() {
    for endpoint in [
        "app.example.com/api/blok-docs",
        "/api/blok-docs",
        "ftp://app.example.com/api/blok-docs",
        "https://user@app.example.com/api/blok-docs",
        "https://app.example.com/api/blok-docs?mode=test",
        "https://app.example.com/api/blok-docs#fragment",
    ] {
        let o = Options {
            collab_enabled: true,
            doc_endpoint: endpoint.into(),
            ..Options::default()
        };
        assert_refused(endpoint, o, &["--doc-endpoint", "credentials"]);
    }
}

#[test]
fn allows_full_doc_endpoints() {
    for endpoint in [
        "https://app.example.com/api/blok-docs",
        "https://app.example.com",
        "http://127.0.0.1:5100/api/blok-docs",
        "http://localhost:5100/api/blok-docs",
    ] {
        let o = Options {
            collab_enabled: true,
            doc_endpoint: endpoint.into(),
            ..Options::default()
        };
        if let Err(error) = o.validate() {
            panic!("{endpoint}: {error}");
        }
    }
}

#[test]
fn rejects_collab_directories_inside_the_storage_directory() {
    for collab_directory in [
        "/srv/blok/uploads",
        "/srv/blok/uploads/",
        "/srv/blok/uploads/working-set",
        "/srv/blok/collab/../uploads/working-set",
    ] {
        let o = Options {
            collab_enabled: true,
            doc_endpoint: "https://app.example.com/api/blok-docs".into(),
            storage_directory: "/srv/blok/uploads".into(),
            public_url: "/files".into(),
            collab_directory: collab_directory.into(),
            ..Options::default()
        };
        assert_refused(collab_directory, o, &["--collab-dir", "--storage-dir"]);
    }
}

#[test]
fn registers_no_collab_activity_observer_by_default() {
    assert!(Options::default().collab_activity_observer.is_none());
    let o = Options {
        collab_enabled: true,
        doc_endpoint: "https://app.example.com/api/blok-docs".into(),
        collab_directory: "/srv/blok/collab".into(),
        ..Options::default()
    };
    assert!(o.validate().is_ok());
    assert!(o.collab_activity_observer.is_none());
}

#[test]
fn requires_an_explicit_valid_public_url_for_local_storage() {
    assert_refused("missing", local_storage(""), &["PublicUrl"]);
    assert_refused(
        "malformed",
        local_storage("https://uploads.example/%zz"),
        &["PublicUrl"],
    );
}

#[test]
fn rejects_unsafe_local_public_urls() {
    for public_url in [
        "javascript:alert(1)",
        "data:text/plain,payload",
        "//evil.example/files",
        "/\\evil.example/files",
        "/files\\nested",
        "https://user@uploads.example.com/files",
        "files",
    ] {
        assert_refused(public_url, local_storage(public_url), &["PublicUrl"]);
    }
}

#[test]
fn rejects_unsafe_s3_bucket_urls() {
    for bucket_url in [
        "javascript:alert(1)",
        "data:text/plain,payload",
        "ftp://cdn.example.com/media",
        "//evil.example/media",
        "/media",
        "https://user@cdn.example.com/media",
        "https://cdn.example.com/%zz",
    ] {
        let o = s3_options("https://s3.example.com", bucket_url);
        assert_refused(bucket_url, o, &["--s3-bucket-url"]);
    }
}

#[test]
fn rejects_unsafe_s3_endpoints() {
    for endpoint in [
        "https://user@s3.example.com",
        "https://s3.example.com/path",
        "https://s3.example.com?mode=test",
        "https://s3.example.com#fragment",
    ] {
        let o = s3_options(endpoint, "https://cdn.example.com/media");
        assert_refused(endpoint, o, &["--s3-endpoint"]);
    }
}

#[test]
fn allows_loopback_http_s3_endpoints() {
    let o = Options {
        s3_region: "local".into(),
        ..s3_options("http://127.0.0.1:9000", "http://127.0.0.1:9000/media")
    };
    if let Err(error) = o.validate() {
        panic!("{error}");
    }
}

// Array.MaxLength + 1: only a remote upload buffers the whole file.
#[test]
fn allows_upload_limits_larger_than_managed_arrays_without_storage() {
    let o = Options {
        max_upload_bytes: 2_147_483_592,
        unfurl_enabled: true,
        ..Options::default()
    };
    if let Err(error) = o.validate() {
        panic!("{error}");
    }
}

#[test]
fn rejects_dns_listen_hosts_that_kestrel_would_treat_as_wildcards() {
    for listen_address in ["internal.example:4000", "example.test:0"] {
        let o = Options {
            allowed_origins: vec!["https://app.example.com".into()],
            auth: "ticket".into(),
            listen_address: listen_address.into(),
            secret: "s".repeat(32),
            ..Options::default()
        };
        assert_refused(listen_address, o, &["DNS host", "every network interface"]);
    }
}

#[test]
fn rejects_query_or_fragment_in_local_public_urls() {
    for public_url in [
        "https://uploads.example.com/files?download=1",
        "/files#latest",
    ] {
        assert_refused(
            public_url,
            local_storage(public_url),
            &["PublicUrl", "query or fragment"],
        );
    }
}

#[test]
fn rejects_query_or_fragment_in_s3_bucket_urls() {
    for bucket_url in [
        "https://cdn.example.com/media?download=1",
        "https://cdn.example.com/media#latest",
    ] {
        let o = s3_options("https://s3.example.com", bucket_url);
        assert_refused(bucket_url, o, &["--s3-bucket-url", "query or fragment"]);
    }
}

fn collab_on() -> Options {
    Options {
        collab_enabled: true,
        doc_endpoint: "https://app.example.com/api/blok-docs".into(),
        ..Options::default()
    }
}

// SyncEndpointTests: every row, with BlokServerOptions.ValidateCollab's text.
#[test]
fn rejects_non_positive_collab_limits() {
    type Set = fn(&mut Options, i64);
    let cases: [(Set, i64, &str); 11] = [
        (
            |o, v| o.collab_max_connections_per_user_per_doc = v,
            0,
            "CollabMaxConnectionsPerUserPerDoc must be a positive number (got 0): a zero cap refuses every sync connection",
        ),
        (
            |o, v| o.collab_max_connections_per_user_per_doc = v,
            -1,
            "CollabMaxConnectionsPerUserPerDoc must be a positive number (got -1): a zero cap refuses every sync connection",
        ),
        (
            |o, v| o.collab_max_message_bytes = v,
            0,
            "CollabMaxMessageBytes must be a positive number of bytes (got 0): a zero cap closes every sync connection on its first frame",
        ),
        (
            |o, v| o.collab_max_message_bytes = v,
            -1,
            "CollabMaxMessageBytes must be a positive number of bytes (got -1): a zero cap closes every sync connection on its first frame",
        ),
        (
            |o, v| o.collab_keep_alive_interval_nanos = v * 1_000_000_000,
            -1,
            "CollabKeepAliveInterval must be zero (off) or greater (got -00:00:01)",
        ),
        (
            |o, v| o.collab_inbound_frames_per_second = v,
            -1,
            "CollabInboundFramesPerSecond must be zero (off) or greater (got -1)",
        ),
        (
            |o, v| o.collab_inbound_burst_frames = v,
            0,
            "CollabInboundBurstFrames must be a positive number of frames (got 0): a zero burst closes every connection on its first frame",
        ),
        (
            |o, v| o.collab_inbound_burst_frames = v,
            -1,
            "CollabInboundBurstFrames must be a positive number of frames (got -1): a zero burst closes every connection on its first frame",
        ),
        (
            |o, v| o.collab_inbound_resyncs_per_minute = v,
            -1,
            "CollabInboundResyncsPerMinute must be zero (off) or greater (got -1)",
        ),
        (
            |o, v| o.collab_inbound_awareness_bytes_per_second = v,
            -1,
            "CollabInboundAwarenessBytesPerSecond must be zero (off) or greater (got -1)",
        ),
        (
            |o, v| o.collab_max_connections = v,
            -1,
            "CollabMaxConnections must be zero (no ceiling) or greater (got -1)",
        ),
    ];
    for (set, value, want) in cases {
        let mut o = collab_on();
        set(&mut o, value);
        assert_eq!(refusal(o), want);
    }
}

#[test]
fn rejects_a_doc_endpoint_auth_with_a_line_break() {
    for value in [
        "Bearer doc-secret\n",
        "Bearer doc-secret\r\n",
        "Bearer\rdoc-secret",
    ] {
        let o = Options {
            doc_endpoint_auth: value.into(),
            ..collab_on()
        };
        assert_eq!(
            refusal(o),
            "--doc-endpoint-auth must not contain a line break (a trailing newline from `echo` or a file is the usual cause): the header would be silently dropped from every doc-endpoint request",
            "{value:?}"
        );
    }
}
