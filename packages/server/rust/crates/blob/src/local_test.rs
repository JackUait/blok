use std::path::{Path, PathBuf};

fn never() -> bool {
    false
}

use crate::blob::{Body, Error, Store, is_generated};
use crate::local::Local;

// Hand ports of LocalBlobStoreTests. The key gate is the only thing that
// keeps a delete inside the storage directory.

pub const TEST_PUBLIC_URL: &str = "https://cdn.example.com/files/";

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new() -> TempDir {
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).unwrap();
        let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let path = std::env::temp_dir().join(format!("blok-blob-test-{name}"));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The file's mode on Unix. Windows has no mode: Go's chmod there only
/// clears the read-only attribute for a mode with the owner-write bit.
pub fn assert_mode(path: &Path, mode: u32) {
    let permissions = std::fs::metadata(path).unwrap().permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(permissions.mode() & 0o777, mode, "{}", path.display());
    }
    #[cfg(windows)]
    assert_eq!(
        permissions.readonly(),
        mode & 0o200 == 0,
        "{}",
        path.display()
    );
}

pub fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(directory)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

pub fn bytes(content: &str) -> Body<'static> {
    Body::bytes(content.as_bytes().to_vec())
}

#[tokio::test]
async fn refuses_foreign_urls_without_touching_bystander_files() {
    let key = format!("{}.txt", "a".repeat(32));
    let hex = "0123456789abcdef0123456789abcdef";
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
        format!("https://cdn.example.com/files/{}.TXT", "a".repeat(32)),
        format!("https://cdn.example.com/files/{}.tar-gz", "a".repeat(32)),
        format!(
            "https://cdn.example.com/files/{}.{}",
            "a".repeat(32),
            "a".repeat(16)
        ),
        format!("https://cdn.example.com/files/{key}/"),
        // A generated prefix followed by a path that climbs out of the store.
        format!("https://cdn.example.com/files/{hex}/../../victim.txt"),
        format!("https://cdn.example.com/files/{hex}/../{key}"),
    ];
    for url in urls {
        let root = TempDir::new();
        let directory = root.0.join("store").join("files");
        std::fs::create_dir_all(&directory).unwrap();
        let bystander = directory.join(&key);
        let victim = root.0.join("store").join("victim.txt");
        for path in [&bystander, &victim] {
            std::fs::write(path, "bystander").unwrap();
        }
        let store = Local::new(&directory, TEST_PUBLIC_URL);
        assert!(
            matches!(store.delete(&url, &never).await, Err(Error::Foreign)),
            "{url}"
        );
        for path in [&bystander, &victim] {
            assert_eq!(std::fs::read_to_string(path).unwrap(), "bystander", "{url}");
        }
    }
}

#[tokio::test]
async fn deletes_an_owned_url_and_treats_an_absent_owned_file_as_deleted() {
    let directory = TempDir::new();
    let store = Local::new(&directory.0, TEST_PUBLIC_URL);
    let url = store
        .put(".txt", "text/plain", bytes("bytes"), &never)
        .await
        .unwrap();
    store
        .delete(&format!("{url}?download=1#file"), &never)
        .await
        .unwrap();
    store.delete(&url, &never).await.unwrap();
    assert!(entries(&directory.0).is_empty());
}

#[tokio::test]
async fn keeps_only_a_bounded_ascii_alphanumeric_extension() {
    for (supplied, want) in [
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
    ] {
        let directory = TempDir::new();
        let store = Local::new(&directory.0, TEST_PUBLIC_URL);
        store
            .put(supplied, "application/octet-stream", bytes(""), &never)
            .await
            .unwrap();
        let names = entries(&directory.0);
        assert_eq!(names.len(), 1, "{supplied:?}");
        let name = &names[0];
        assert!(
            name.len() == 32 + want.len() && is_generated(name) && &name[32..] == want,
            "{supplied:?}: stored as {name}"
        );
    }
}

#[tokio::test]
async fn put_stores_the_file_when_hard_links_fail() {
    let directory = TempDir::new();
    let mut store = Local::new(&directory.0, TEST_PUBLIC_URL);
    store.link = |_, _| Err(std::io::Error::from(std::io::ErrorKind::Unsupported));
    let url = store
        .put(".txt", "text/plain", bytes("hello"), &never)
        .await
        .unwrap();
    let path = directory.0.join(url.strip_prefix(TEST_PUBLIC_URL).unwrap());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    assert_mode(&path, 0o644);
    assert_eq!(entries(&directory.0).len(), 1);
}

#[tokio::test]
async fn put_never_overwrites_when_hard_links_fail() {
    let directory = TempDir::new();
    let mut store = Local::new(&directory.0, TEST_PUBLIC_URL);
    // The key appears between the failed link and the fallback.
    store.link = |_, last| {
        std::fs::write(last, "first").unwrap();
        Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
    };
    assert!(
        store
            .put(".txt", "text/plain", bytes("second"), &never)
            .await
            .is_err(),
        "Put wrote over an existing key"
    );
    let names = entries(&directory.0);
    assert_eq!(names.len(), 1);
    assert_eq!(
        std::fs::read_to_string(directory.0.join(&names[0])).unwrap(),
        "first"
    );
}

// A multi-byte char straddling byte 32 is not a key, and must not panic.
#[test]
fn a_key_split_inside_a_character_is_not_generated() {
    let key = format!("{}\u{e9}.png", "a".repeat(31));
    assert!(!is_generated(&key));
    assert_eq!(
        crate::blob::key_from_public_url(TEST_PUBLIC_URL, &format!("{TEST_PUBLIC_URL}{key}")),
        None
    );
}

// The host's cancel signal: a set flag stops a put before it stores and a
// delete before it removes, and leaves no temporary file.
#[tokio::test]
async fn a_cancel_signal_stops_put_and_delete() {
    let directory = TempDir::new();
    let store = Local::new(&directory.0, TEST_PUBLIC_URL);
    let url = store
        .put(".txt", "text/plain", bytes("kept"), &never)
        .await
        .unwrap();
    let always = || true;
    let err = store
        .put(".txt", "text/plain", bytes("bytes"), &always)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled));
    let err = store.delete(&url, &always).await.unwrap_err();
    assert!(matches!(err, Error::Cancelled));
    assert_eq!(entries(&directory.0).len(), 1);
}
