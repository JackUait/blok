use std::os::unix::fs::PermissionsExt;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWriteExt, ReadBuf};

use crate::blob::{Body, Store};
use crate::local::Local;
use crate::local_test::{TEST_PUBLIC_URL, TempDir, bytes, entries};

// Twins of the LocalBlobStoreTests cases with no Go twin.

fn is_key(name: &str, extension: &str) -> bool {
    name.len() == 32 + extension.len()
        && name[..32]
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && name.ends_with(extension)
}

#[tokio::test]
async fn stores_bytes_under_a_random_key_and_returns_the_public_url() {
    let directory = TempDir::new();
    let store = Local::new(&directory.0, TEST_PUBLIC_URL);
    let url = store
        .put(".txt", "text/plain", bytes("bytes"))
        .await
        .unwrap();
    let names = entries(&directory.0);
    assert_eq!(names.len(), 1);
    assert!(is_key(&names[0], ".txt"), "{}", names[0]);
    assert_eq!(url, format!("https://cdn.example.com/files/{}", names[0]));
    assert_eq!(
        std::fs::read(directory.0.join(&names[0])).unwrap(),
        b"bytes"
    );
}

#[tokio::test]
async fn creates_the_destination_directory_on_first_put() {
    let root = TempDir::new();
    let directory = root.0.join("not").join("yet");
    let store = Local::new(&directory, TEST_PUBLIC_URL);
    store
        .put(".txt", "text/plain", bytes("bytes"))
        .await
        .unwrap();
    assert_eq!(entries(&directory).len(), 1);
}

/// Sends part of the body, then holds until the test writes the rest.
async fn paused_put(
    directory: &std::path::Path,
) -> (
    tokio::task::JoinHandle<Result<String, crate::Error>>,
    tokio::io::DuplexStream,
) {
    let (mut writer, reader) = tokio::io::duplex(64);
    let store = Local::new(directory, TEST_PUBLIC_URL);
    let put = tokio::spawn(async move {
        store
            .put(".txt", "text/plain", Body::Stream(Box::new(reader)))
            .await
    });
    writer.write_all(b"partial ").await.unwrap();
    for _ in 0..200 {
        if std::fs::read_dir(directory).is_ok_and(|mut d| d.next().is_some()) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    (put, writer)
}

#[tokio::test]
async fn does_not_publish_the_final_name_before_the_copy_completes() {
    let directory = TempDir::new();
    let (put, mut writer) = paused_put(&directory.0).await;
    let names = entries(&directory.0);
    assert_eq!(names.len(), 1);
    assert!(names[0].starts_with(".blok-upload-"), "{}", names[0]);
    assert!(!is_key(&names[0], ".txt"));
    writer.write_all(b"bytes").await.unwrap();
    drop(writer);
    let url = put.await.unwrap().unwrap();
    let names = entries(&directory.0);
    assert_eq!(names.len(), 1);
    assert!(is_key(&names[0], ".txt"));
    assert!(url.ends_with(&format!("/{}", names[0])));
}

#[tokio::test]
async fn creates_the_temporary_file_owner_only_while_copying() {
    let directory = TempDir::new();
    let (put, writer) = paused_put(&directory.0).await;
    let names = entries(&directory.0);
    let mode = std::fs::metadata(directory.0.join(&names[0]))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    drop(writer);
    put.await.unwrap().unwrap();
}

struct Failing;

impl AsyncRead for Failing {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        _: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Poll::Ready(Err(std::io::Error::other("connection reset")))
    }
}

#[tokio::test]
async fn removes_the_temporary_file_when_the_input_fails() {
    let directory = TempDir::new();
    let store = Local::new(&directory.0, TEST_PUBLIC_URL);
    let error = store
        .put(".txt", "text/plain", Body::Stream(Box::new(Failing)))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "connection reset");
    assert!(entries(&directory.0).is_empty());
}

// Cancelling is dropping the put future.
#[tokio::test]
async fn removes_the_temporary_file_when_the_copy_is_cancelled() {
    let directory = TempDir::new();
    let (put, writer) = paused_put(&directory.0).await;
    assert_eq!(entries(&directory.0).len(), 1);
    put.abort();
    let _ = put.await;
    drop(writer);
    assert!(entries(&directory.0).is_empty());
}

#[tokio::test]
async fn stores_a_world_readable_file_where_unix_modes_are_supported() {
    let directory = TempDir::new();
    let store = Local::new(&directory.0, TEST_PUBLIC_URL);
    store
        .put(".txt", "text/plain", bytes("bytes"))
        .await
        .unwrap();
    let names = entries(&directory.0);
    let mode = std::fs::metadata(directory.0.join(&names[0]))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o644);
}

#[tokio::test]
async fn a_cancelled_delete_does_not_remove_the_file() {
    let directory = TempDir::new();
    let store = Local::new(&directory.0, TEST_PUBLIC_URL);
    let url = store
        .put(".txt", "text/plain", bytes("bytes"))
        .await
        .unwrap();
    drop(store.delete(&url));
    assert_eq!(entries(&directory.0).len(), 1);
}
