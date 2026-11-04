use std::path::Path;
use std::time::Duration;

use blok_dotnet::parse_http_date;
use blok_http::wire::http_date;

use crate::testutil::{Answer, Running, send, start, temp_dir};
use crate::{Options, Server};

// Twins of C#'s LocalFileServingTests.

const STORED_KEY: &str = "0123456789abcdef0123456789abcdef.html";
const RANGE_KEY: &str = "0123456789abcdef0123456789abcdef.png";
const PUBLIC_URL: &str = "https://uploads.example.com/files";

async fn app(directory: &Path, public_url: &str, prefix: &str) -> Running {
    let server = Server::new(Options {
        storage_directory: directory.display().to_string(),
        public_url: public_url.into(),
        ..Options::default()
    })
    .unwrap();
    start(server.handler(prefix)).await
}

/// StartRangeApplicationAsync: "0123456789" at RANGE_KEY.
async fn range_app() -> Running {
    let directory = temp_dir();
    std::fs::write(directory.join(RANGE_KEY), "0123456789").unwrap();
    app(&directory, PUBLIC_URL, "").await
}

async fn ask(running: &Running, method: &str, path: &str, headers: &[(&str, &str)]) -> Answer {
    let mut head = format!("{method} {path} HTTP/1.1");
    for (name, value) in headers {
        head.push_str(&format!("\r\n{name}: {value}"));
    }
    send(running.address, &head, b"").await
}

async fn ask_range(running: &Running, method: &str, headers: &[(&str, &str)]) -> Answer {
    ask(running, method, &format!("/files/{RANGE_KEY}"), headers).await
}

fn successful_body(method: &str) -> &'static str {
    if method == "HEAD" { "" } else { "0123456789" }
}

async fn last_modified(running: &Running) -> String {
    let complete = ask_range(running, "GET", &[]).await;
    let value = complete.header("Last-Modified").to_owned();
    assert!(!value.is_empty(), "no Last-Modified");
    value
}

fn day_before(date: &str) -> String {
    http_date(parse_http_date(date).unwrap() - Duration::from_secs(86_400))
}

#[tokio::test]
async fn rejects_a_zero_length_suffix_range_for_a_nonempty_file() {
    for (method, body) in [("GET", "invalid range: failed to overlap\n"), ("HEAD", "")] {
        let running = range_app().await;
        let got = ask_range(&running, method, &[("Range", "bytes=-0")]).await;
        assert_eq!(
            (
                got.status,
                got.header("Content-Range"),
                got.header("Content-Length"),
                got.text().as_str()
            ),
            (416, "bytes */10", "33", body),
            "{method}"
        );
    }
}

#[tokio::test]
async fn ignores_a_zero_length_suffix_range_for_an_empty_file() {
    for method in ["GET", "HEAD"] {
        let directory = temp_dir();
        std::fs::write(directory.join(RANGE_KEY), b"").unwrap();
        let running = app(&directory, PUBLIC_URL, "").await;
        let got = ask_range(&running, method, &[("Range", "bytes=-0")]).await;
        assert_eq!(
            (
                got.status,
                got.headers_all("Content-Range").is_empty(),
                got.header("Content-Length"),
                got.text().as_str()
            ),
            (200, true, "0", ""),
            "{method}"
        );
    }
}

#[tokio::test]
async fn honors_date_representation_preconditions() {
    for method in ["GET", "HEAD"] {
        let running = range_app().await;
        let modified = last_modified(&running).await;
        let earlier = day_before(&modified);

        let got = ask_range(&running, method, &[("If-Modified-Since", &modified)]).await;
        assert_eq!(
            (
                got.status,
                got.headers_all("Content-Type").is_empty(),
                got.header("Last-Modified"),
                got.text().as_str()
            ),
            (304, true, modified.as_str(), ""),
            "{method} If-Modified-Since L"
        );

        let got = ask_range(&running, method, &[("If-Modified-Since", &earlier)]).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, successful_body(method)),
            "{method} If-Modified-Since L-1d"
        );

        let got = ask_range(&running, method, &[("If-Unmodified-Since", &earlier)]).await;
        assert_eq!(
            (
                got.status,
                got.headers_all("Content-Type").is_empty(),
                got.text().as_str()
            ),
            (412, true, ""),
            "{method} If-Unmodified-Since L-1d"
        );

        let got = ask_range(&running, method, &[("If-Unmodified-Since", &modified)]).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, successful_body(method)),
            "{method} If-Unmodified-Since L"
        );
    }
}

#[tokio::test]
async fn honors_wildcard_and_mismatched_entity_tag_preconditions() {
    for method in ["GET", "HEAD"] {
        let running = range_app().await;

        let got = ask_range(&running, method, &[("If-Match", "\"stale\"")]).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (412, ""),
            "{method} If-Match stale"
        );

        let got = ask_range(
            &running,
            method,
            &[
                ("If-Match", "*"),
                ("If-Unmodified-Since", "Thu, 01 Jan 1970 00:00:00 GMT"),
            ],
        )
        .await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, successful_body(method)),
            "{method} If-Match *"
        );

        let got = ask_range(&running, method, &[("If-None-Match", "*")]).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (304, ""),
            "{method} If-None-Match *"
        );

        let modified = last_modified(&running).await;
        let got = ask_range(
            &running,
            method,
            &[
                ("If-None-Match", "\"stale\""),
                ("If-Modified-Since", &modified),
            ],
        )
        .await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (200, successful_body(method)),
            "{method} If-None-Match stale"
        );
    }
}

#[tokio::test]
async fn applies_representation_preconditions_before_range() {
    for method in ["GET", "HEAD"] {
        let running = range_app().await;
        for (header, value, status) in [("If-Match", "\"stale\"", 412), ("If-None-Match", "*", 304)]
        {
            let got = ask_range(&running, method, &[("Range", "bytes=2-5"), (header, value)]).await;
            assert_eq!(
                (
                    got.status,
                    got.headers_all("Content-Range").is_empty(),
                    got.text().as_str()
                ),
                (status, true, ""),
                "{method} {header}"
            );
        }
    }
}

#[tokio::test]
async fn serves_direct_files_from_a_root_relative_public_url() {
    let directory = temp_dir();
    std::fs::write(directory.join(STORED_KEY), "root file").unwrap();
    let running = app(&directory, "/", "/blok").await;
    let got = ask(&running, "GET", &format!("/{STORED_KEY}"), &[]).await;
    assert_eq!((got.status, got.text().as_str()), (200, "root file"));
}

#[tokio::test]
async fn does_not_sniff_an_extensionless_file_as_html() {
    let key = "abcdef0123456789abcdef0123456789";
    let directory = temp_dir();
    std::fs::write(directory.join(key), "<h1>uploaded html</h1>").unwrap();
    let running = app(&directory, PUBLIC_URL, "").await;
    let got = ask(&running, "GET", &format!("/files/{key}"), &[]).await;
    assert_eq!(
        (
            got.status,
            got.header("Content-Disposition"),
            got.headers_all("X-Content-Type-Options"),
            got.header("Content-Type")
        ),
        (
            200,
            "attachment",
            vec!["nosniff"],
            "application/octet-stream"
        )
    );
}

#[tokio::test]
async fn refuses_directory_listings_and_nested_paths() {
    let directory = temp_dir();
    std::fs::write(directory.join(STORED_KEY), "secret file").unwrap();
    let running = app(&directory, PUBLIC_URL, "").await;
    for path in ["/files/".to_owned(), format!("/files/sub/{STORED_KEY}")] {
        let got = ask(&running, "GET", &path, &[]).await;
        assert_eq!(
            (got.status, got.text().as_str()),
            (404, "404 page not found\n"),
            "{path}"
        );
        assert!(!got.text().contains(STORED_KEY), "{path}");
    }
}

#[tokio::test]
async fn refuses_traversal_instead_of_serving_outside_the_storage_directory() {
    for path in [
        "/files/%2e%2e%2foutside.txt",
        "/files/..%5coutside.txt",
        "/files/%2fetc%2fpasswd",
    ] {
        let directory = temp_dir();
        let storage = directory.join("storage");
        std::fs::create_dir_all(&storage).unwrap();
        std::fs::write(directory.join("outside.txt"), "outside").unwrap();
        let running = app(&storage, PUBLIC_URL, "").await;
        let got = ask(&running, "GET", path, &[]).await;
        assert_eq!(got.status, 404, "{path}");
        assert_ne!(got.text(), "outside", "{path}");
    }
}

#[tokio::test]
async fn does_not_map_files_when_local_storage_is_disabled() {
    let directory = temp_dir();
    std::fs::write(directory.join(STORED_KEY), "bystander").unwrap();
    let server = Server::new(Options {
        storage_directory: String::new(),
        public_url: "https://uploads.example.com/%zz".into(),
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let got = ask(&running, "GET", &format!("/files/{STORED_KEY}"), &[]).await;
    assert_eq!(got.status, 404);
}

#[tokio::test]
async fn does_not_map_the_local_directory_when_s3_takes_precedence() {
    let directory = temp_dir();
    std::fs::write(directory.join(STORED_KEY), "bystander").unwrap();
    let server = Server::new(Options {
        storage_directory: directory.display().to_string(),
        public_url: "https://uploads.example.com/%zz".into(),
        s3_endpoint: "https://s3.example.com".into(),
        s3_region: "eu-test-1".into(),
        s3_bucket: "media".into(),
        s3_bucket_url: "https://cdn.example.com/media".into(),
        s3_access_key: "access".into(),
        s3_secret_key: "secret".into(),
        ..Options::default()
    })
    .unwrap();
    let running = start(server.handler("")).await;
    let got = ask(&running, "GET", &format!("/files/{STORED_KEY}"), &[]).await;
    assert_eq!(got.status, 404);
}

#[tokio::test]
async fn does_not_map_a_host_only_public_url_over_api_routes() {
    let directory = temp_dir();
    std::fs::write(directory.join(STORED_KEY), "bystander").unwrap();
    let running = app(&directory, "https://uploads.example.com", "").await;
    let file = ask(&running, "GET", &format!("/{STORED_KEY}"), &[]).await;
    let health = ask(&running, "GET", "/health", &[]).await;
    assert_eq!((file.status, health.status), (404, 200));
}
