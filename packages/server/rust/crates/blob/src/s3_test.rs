use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::blob::{Body, Error, Store};
use crate::s3::{Recorded, S3, S3Options, Settings, sign, target};

// Hand ports of S3TargetResolverTests, S3RequestSignerTests and
// S3BlobStoreObjectMethodsTests; the expected values are the C# ones.

pub fn test_options(endpoint: &str, bucket: &str, addressing: &str) -> S3Options {
    S3Options {
        endpoint: endpoint.into(),
        region: "eu-central-1".into(),
        bucket: bucket.into(),
        access_key: "AKIAEXAMPLE".into(),
        secret_key: "wJalrXUtnFEMI/K7MDENG".into(),
        public_url: "https://cdn.example.com/media".into(),
        addressing: addressing.into(),
        max_spool_bytes: 1024,
        temp_dir: None,
    }
}

pub fn no_proxy() -> Settings {
    Settings {
        proxy: None,
        ..Settings::default()
    }
}

#[test]
fn resolves_the_frozen_addressing_contract() {
    for (endpoint, bucket, addressing, url, host) in [
        (
            "http://127.0.0.1:9000",
            "media",
            "",
            "http://127.0.0.1:9000/media/key.png",
            "127.0.0.1:9000",
        ),
        (
            "https://minio.internal:9000",
            "media",
            "",
            "https://minio.internal:9000/media/key.png",
            "minio.internal:9000",
        ),
        (
            "https://abc123.r2.cloudflarestorage.com",
            "media",
            "",
            "https://abc123.r2.cloudflarestorage.com/media/key.png",
            "abc123.r2.cloudflarestorage.com",
        ),
        (
            "https://s3.eu-central-1.amazonaws.com",
            "media",
            "",
            "https://media.s3.eu-central-1.amazonaws.com/key.png",
            "media.s3.eu-central-1.amazonaws.com",
        ),
        (
            "https://s3.eu-central-1.amazonaws.com",
            "my.media",
            "",
            "https://s3.eu-central-1.amazonaws.com/my.media/key.png",
            "s3.eu-central-1.amazonaws.com",
        ),
        (
            "https://s3.amazonaws.com",
            "Media",
            "",
            "https://s3.amazonaws.com/Media/key.png",
            "s3.amazonaws.com",
        ),
        (
            "https://s3.amazonaws.com",
            "media",
            "path",
            "https://s3.amazonaws.com/media/key.png",
            "s3.amazonaws.com",
        ),
        (
            "https://minio.internal:9000",
            "media",
            "virtual",
            "https://media.minio.internal:9000/key.png",
            "media.minio.internal:9000",
        ),
        (
            "https://minio.internal:9000",
            "team.assets",
            "virtual",
            "https://team.assets.minio.internal:9000/key.png",
            "team.assets.minio.internal:9000",
        ),
        (
            "https://s3.example.com:443",
            "media",
            "",
            "https://s3.example.com/media/key.png",
            "s3.example.com",
        ),
        (
            "https://s3.example.com/?debug=1",
            "media",
            "",
            "https://s3.example.com/media/key.png",
            "s3.example.com",
        ),
    ] {
        let (got_url, got_host) = target(&test_options(endpoint, bucket, addressing), "key.png")
            .unwrap_or_else(|e| panic!("{endpoint} {bucket} {addressing:?}: {e}"));
        assert_eq!(
            (got_url.absolute_uri.as_str(), got_host.as_str()),
            (url, host),
            "{endpoint} {bucket} {addressing:?}"
        );
    }
}

// An operator prefix with '?' or '#' must stay in the path.
#[test]
fn escapes_the_key_in_the_path() {
    for (key, path) in [
        ("a?b/c", "/bucket/a%3Fb/c"),
        ("a#b/c", "/bucket/a%23b/c"),
        ("a b/c", "/bucket/a%20b/c"),
        ("\u{e9}/c", "/bucket/%C3%A9/c"),
        ("a%2Fb/c", "/bucket/a%2Fb/c"),
        ("a%zz/c", "/bucket/a%25zz/c"),
        ("../c", "/c"),
        ("a\\b/c", "/bucket/a/b/c"),
        ("a?b#c/d", "/bucket/a%3Fb%23c/d"),
    ] {
        let (url, _) = target(&test_options("http://127.0.0.1:9000", "bucket", ""), key).unwrap();
        assert_eq!(url.absolute_path, path, "{key:?}");
        assert_eq!(url.query, "", "{key:?}");
    }
}

#[test]
fn refuses_an_unusable_target() {
    for (endpoint, bucket, addressing) in [
        ("", "media", ""),
        ("/just/a/path", "media", ""),
        ("https://s3.example.com", "", ""),
        ("https://s3.example.com/%zz", "media", ""),
        ("https://s3.example.com", "media/../secrets", ""),
        ("https://\u{fc}n\u{ef}code.example.com", "media", ""),
        ("https://s3.example.com", "media", "dns"),
        ("https://s3.example.com", "my_bucket", "virtual"),
        ("https://gateway.example.com/s3", "media", ""),
        ("https://s3.example.com/s3/..", "media", ""),
        ("https://s3.example.com/s3/%2e%2e", "media", ""),
        ("https://s3.example.com/%2e", "media", ""),
        ("https://s3.example.com/%2E%2E", "media", ""),
        ("https://s3.example.com/./", "media", ""),
    ] {
        assert!(
            S3::build(test_options(endpoint, bucket, addressing), no_proxy()).is_err(),
            "{endpoint:?} {bucket:?} {addressing:?}: accepted"
        );
    }
}

pub fn frozen_time() -> SystemTime {
    // 2025-01-02T03:04:05Z
    UNIX_EPOCH + Duration::from_secs(1_735_787_045)
}

#[test]
fn matches_the_frozen_sig_v4_vector() {
    let o = test_options("https://s3.example.com", "media", "path");
    let (url, host) = target(&o, "key.png").unwrap();
    let hash = "277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9";
    let headers: HashMap<String, String> = sign(
        "PUT",
        &url.absolute_path,
        &host,
        &o,
        "image/png",
        hash,
        frozen_time(),
    )
    .into_iter()
    .collect();
    assert_eq!(host, "s3.example.com");
    assert_eq!(headers["X-Amz-Content-Sha256"], hash);
    assert_eq!(headers["X-Amz-Date"], "20250102T030405Z");
    assert_eq!(
        headers["Authorization"],
        "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20250102/eu-central-1/s3/aws4_request, \
         SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, \
         Signature=2d50477b639388426c272609afac34d42f0f92aac413acf8afc4deee4278ec0c"
    );
}

/// The C# FakeS3Bucket.
#[derive(Default)]
pub struct FakeBucket {
    pub objects: Mutex<HashMap<String, Vec<u8>>>,
    pub requests: Mutex<Vec<Recorded>>,
    pub status: u16,
}

pub const COLLAB_KEY: &str = "collab/working-set-key";
pub const OBJECT_PATH: &str = "/media/collab/working-set-key";

pub fn bucket_store(bucket: &Arc<FakeBucket>) -> S3 {
    let mut s = S3::build(
        test_options("https://s3.example.com", "media", ""),
        no_proxy(),
    )
    .unwrap();
    s.now = frozen_time;
    let bucket = bucket.clone();
    s.with_fake(Arc::new(move |request: Recorded| {
        bucket.requests.lock().unwrap().push(request.clone());
        if bucket.status != 0 {
            return (bucket.status, Vec::new());
        }
        let mut objects = bucket.objects.lock().unwrap();
        match request.method.as_str() {
            "GET" => match objects.get(&request.path) {
                Some(content) => (200, content.clone()),
                None => (404, Vec::new()),
            },
            "PUT" => {
                objects.insert(request.path.clone(), request.body.clone());
                (200, Vec::new())
            }
            _ => {
                objects.remove(&request.path);
                (200, Vec::new())
            }
        }
    }))
}

pub fn first(bucket: &FakeBucket) -> Recorded {
    bucket.requests.lock().unwrap()[0].clone()
}

#[tokio::test]
async fn gets_an_object_by_its_key() {
    let bucket = Arc::new(FakeBucket::default());
    bucket
        .objects
        .lock()
        .unwrap()
        .insert(OBJECT_PATH.into(), b"stored bytes".to_vec());
    let got = bucket_store(&bucket).get_object(COLLAB_KEY).await.unwrap();
    assert_eq!(got.as_deref(), Some(b"stored bytes".as_slice()));
    let r = first(&bucket);
    assert_eq!(bucket.requests.lock().unwrap().len(), 1);
    assert_eq!(r.path, OBJECT_PATH);
    assert_eq!(r.host, "s3.example.com");
    assert_eq!(r.header("X-Amz-Date"), Some("20250102T030405Z"));
    assert!(
        r.header("Authorization")
            .unwrap()
            .contains("SignedHeaders=host;x-amz-content-sha256;x-amz-date")
    );
}

#[tokio::test]
async fn get_treats_only_not_found_as_absent() {
    let bucket = Arc::new(FakeBucket::default());
    assert_eq!(
        bucket_store(&bucket).get_object(COLLAB_KEY).await.unwrap(),
        None
    );
}

#[tokio::test]
async fn get_fails_on_forbidden() {
    let bucket = Arc::new(FakeBucket {
        status: 403,
        ..FakeBucket::default()
    });
    let err = bucket_store(&bucket)
        .get_object(COLLAB_KEY)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("returned 403"), "{err}");
}

#[tokio::test]
async fn puts_an_object_with_its_hash_and_octet_stream_type() {
    let bucket = Arc::new(FakeBucket::default());
    let content = b"collab log bytes";
    bucket_store(&bucket)
        .put_object(COLLAB_KEY, content)
        .await
        .unwrap();
    let r = first(&bucket);
    assert_eq!(bucket.objects.lock().unwrap()[OBJECT_PATH], content);
    assert_eq!(r.method, "PUT");
    assert_eq!(r.header("Content-Type"), Some("application/octet-stream"));
    assert_eq!(
        r.header("Content-Length"),
        Some(content.len().to_string().as_str())
    );
    let hash: String = Sha256::digest(content)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(r.header("X-Amz-Content-Sha256"), Some(hash.as_str()));
    assert!(
        r.header("Authorization")
            .unwrap()
            .contains("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date")
    );
}

#[tokio::test]
async fn put_fails_on_an_error_status() {
    let bucket = Arc::new(FakeBucket {
        status: 500,
        ..FakeBucket::default()
    });
    let err = bucket_store(&bucket)
        .put_object(COLLAB_KEY, &[1])
        .await
        .unwrap_err();
    assert!(err.to_string().contains("returned 500"), "{err}");
}

#[tokio::test]
async fn deletes_an_object_by_its_key() {
    let bucket = Arc::new(FakeBucket::default());
    bucket
        .objects
        .lock()
        .unwrap()
        .insert(OBJECT_PATH.into(), vec![1]);
    bucket_store(&bucket)
        .delete_object(COLLAB_KEY)
        .await
        .unwrap();
    let r = first(&bucket);
    assert!(!bucket.objects.lock().unwrap().contains_key(OBJECT_PATH));
    assert_eq!(r.method, "DELETE");
    assert_eq!(r.path, OBJECT_PATH);
    assert!(r.header("Authorization").is_some());
}

#[tokio::test]
async fn refuses_an_empty_key() {
    let bucket = Arc::new(FakeBucket::default());
    let s = bucket_store(&bucket);
    assert!(s.get_object("").await.is_err());
    assert!(s.put_object("", &[1]).await.is_err());
    assert!(s.delete_object("").await.is_err());
    assert!(bucket.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn puts_an_upload_as_an_attachment_with_a_known_length() {
    let bucket = Arc::new(FakeBucket::default());
    let url = bucket_store(&bucket)
        .put(".png", "image/png", Body::bytes(b"bytes".to_vec()))
        .await
        .unwrap();
    let r = first(&bucket);
    assert_eq!(r.header("Content-Disposition"), Some("attachment"));
    assert_eq!(r.header("Content-Type"), Some("image/png"));
    assert_eq!(r.header("Content-Length"), Some("5"));
    assert!(
        !r.header("Authorization")
            .unwrap()
            .contains("content-disposition")
    );
    assert!(
        url.starts_with("https://cdn.example.com/media/") && url.ends_with(".png"),
        "{url}"
    );
}

struct NeverEnding;

impl tokio::io::AsyncRead for NeverEnding {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let n = buf.remaining();
        buf.put_slice(&vec![b'x'; n]);
        std::task::Poll::Ready(Ok(()))
    }
}

// BoundsANonSeekableSpool: the spool cap is MaxSpoolBytes, and over it
// nothing is sent.
#[tokio::test]
async fn bounds_the_spool() {
    let dir = crate::local_test::TempDir::new();
    let bucket = Arc::new(FakeBucket::default());
    let mut s = bucket_store(&bucket);
    s.options.temp_dir = Some(dir.0.clone());
    let body = Body::Stream(Box::new(tokio::io::AsyncReadExt::take(
        NeverEnding,
        s.options.max_spool_bytes + 1,
    )));
    assert!(s.put(".bin", "", body).await.is_err());
    assert!(bucket.requests.lock().unwrap().is_empty());
    assert!(crate::local_test::entries(&dir.0).is_empty());
}

// DropsAnInvalidMediaTypeBeforeSigning, SanitizesDuplicateMediaParametersLikeGo,
// plus the S3-only ASCII rule.
#[tokio::test]
async fn sanitizes_the_media_type_before_signing() {
    for (media_type, kept) in [
        ("definitely not a media type", false),
        ("text/plain; charset=utf-8; charset=us-ascii", false),
        ("text/plain; charset=utf-8; charset=utf-8", true),
        ("text/plain; charset=\"a\\z\"; charset=az", false),
        ("text/plain; charset=\"a\\/b\"; charset=\"a/b\"", true),
        ("text/plain; charset=\"a\\z\"; charset=\"a\\z\"", true),
        ("text/plain; name=\"caf\u{e9}\"", false),
    ] {
        let bucket = Arc::new(FakeBucket::default());
        bucket_store(&bucket)
            .put(".txt", media_type, Body::bytes(b"bytes".to_vec()))
            .await
            .unwrap();
        let r = first(&bucket);
        let signed = r.header("Authorization").unwrap().contains("content-type");
        assert_eq!(
            r.header("Content-Type") == Some(media_type),
            kept,
            "{media_type}"
        );
        assert_eq!(signed, kept, "{media_type}");
        assert_eq!(r.header("Content-Disposition"), Some("attachment"));
    }
}

pub fn deadline(err: &Error) -> bool {
    matches!(err, Error::DeadlineExceeded)
}
