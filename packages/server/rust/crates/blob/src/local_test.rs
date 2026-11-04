use std::fs;
use std::path::Path;

use super::*;
use crate::is_generated;

// Hand ports of LocalBlobStoreTests. The key gate is the only thing that
// keeps a delete inside the storage directory.

const TEST_PUBLIC_URL: &str = "https://cdn.example.com/files/";

fn never() -> bool {
    false
}

fn temp_dir() -> std::path::PathBuf {
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).unwrap();
    let hex: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("blok-blob-test-{hex}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn entries(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

#[tokio::test]
async fn refuses_foreign_urls_without_touching_bystander_files() {
    let key = format!("{}.txt", "a".repeat(32));
    let hex = "0123456789abcdef0123456789abcdef";
    let a32 = "a".repeat(32);
    let urls = [
        format!("http://cdn.example.com/files/{key}"),
        format!("https://evil.example.com/files/{key}"),
        format!("https://cdn.example.com:444/files/{key}"),
        format!("https://cdn.example.com/other/{key}"),
        format!("https://cdn.example.com/files-confused/{key}"),
        format!("https://cdn.example.com/files/sub/{key}"),
        format!("https://cdn.example.com/files/../{key}"),
        format!("https://cdn.example.com/files/%2e%2e%2f{key}"),
        format!("https://cdn.example.com/files/{}.txt", "A".repeat(32)),
        format!("https://cdn.example.com/files/{}.txt", "g".repeat(32)),
        format!("https://cdn.example.com/files/{a32}.TXT"),
        format!("https://cdn.example.com/files/{a32}.tar-gz"),
        format!("https://cdn.example.com/files/{a32}.{}", "a".repeat(16)),
        format!("https://cdn.example.com/files/{key}/"),
        // A generated prefix followed by a path that climbs out of the store.
        format!("https://cdn.example.com/files/{hex}/../../victim.txt"),
        format!("https://cdn.example.com/files/{hex}/../{key}"),
    ];
    for url in urls {
        let root = temp_dir();
        let directory = root.join("store").join("files");
        fs::create_dir_all(&directory).unwrap();
        let bystander = directory.join(&key);
        let victim = root.join("store").join("victim.txt");
        for path in [&bystander, &victim] {
            fs::write(path, "bystander").unwrap();
        }
        let store = Local::new(&directory, TEST_PUBLIC_URL);
        let result = store.delete(&url, &never).await;
        assert!(matches!(result, Err(Error::Foreign)), "{url}: {result:?}");
        for path in [&bystander, &victim] {
            assert_eq!(fs::read_to_string(path).unwrap(), "bystander", "{url}");
        }
        fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn deletes_an_owned_url_and_treats_an_absent_owned_file_as_deleted() {
    let directory = temp_dir();
    let store = Local::new(&directory, TEST_PUBLIC_URL);
    let url = store
        .put(".txt", "text/plain", &mut &b"bytes"[..], &never)
        .await
        .unwrap();
    store
        .delete(&format!("{url}?download=1#file"), &never)
        .await
        .unwrap();
    store.delete(&url, &never).await.unwrap();
    assert!(
        entries(&directory).is_empty(),
        "left {:?}",
        entries(&directory)
    );
    fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn keeps_only_a_bounded_ascii_alphanumeric_extension() {
    let cases = [
        ("", ""),
        (".A", ".a"),
        (".AbC123", ".abc123"),
        (".123456789012345", ".123456789012345"),
        (".", ""),
        (".1234567890123456", ""),
        (".p ng", ""),
        (".tar-gz", ""),
        (".p/ng", ""),
        (".p\\ng", ""),
        (".p\0ng", ""),
        ("png", ""),
        ("../../evil.png", ""),
    ];
    for (supplied, want) in cases {
        let directory = temp_dir();
        let store = Local::new(&directory, TEST_PUBLIC_URL);
        store
            .put(supplied, "application/octet-stream", &mut &b""[..], &never)
            .await
            .unwrap();
        let names = entries(&directory);
        assert_eq!(names.len(), 1, "{supplied:?}: {names:?}");
        let name = &names[0];
        assert!(
            name.len() == 32 + want.len() && is_generated(name) && &name[32..] == want,
            "{supplied:?}: stored as {name:?}, want the extension {want:?}"
        );
        fs::remove_dir_all(directory).unwrap();
    }
}

// C#'s File.Move succeeds on a file system without hard links (measured on
// FAT32), so put must not depend on link(2).
#[tokio::test]
async fn put_stores_the_file_when_hard_links_fail() {
    let directory = temp_dir();
    let mut store = Local::new(&directory, TEST_PUBLIC_URL);
    store.link = |_, _| Err(io::Error::from(io::ErrorKind::Unsupported));
    let url = store
        .put(".txt", "text/plain", &mut &b"hello"[..], &never)
        .await
        .unwrap();
    let path = directory.join(url.strip_prefix(TEST_PUBLIC_URL).unwrap());
    assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o644
    );
    assert_eq!(entries(&directory).len(), 1, "want only the file");
    fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn put_never_overwrites_when_hard_links_fail() {
    let directory = temp_dir();
    let mut store = Local::new(&directory, TEST_PUBLIC_URL);
    // The key appears between the failed link and the fallback.
    store.link = |_, last| {
        fs::write(last, "first").unwrap();
        Err(io::Error::from(io::ErrorKind::Unsupported))
    };
    let result = store
        .put(".txt", "text/plain", &mut &b"second"[..], &never)
        .await;
    assert!(result.is_err(), "put wrote over an existing key");
    let names = entries(&directory);
    assert_eq!(names.len(), 1, "want only the first file: {names:?}");
    assert_eq!(
        fs::read_to_string(directory.join(&names[0])).unwrap(),
        "first"
    );
    fs::remove_dir_all(directory).unwrap();
}
