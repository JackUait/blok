use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::handle_store::tests::record;
use crate::handle_store::{Acquired, HandleLease, HandleStore};
use crate::handle_store_files::FilesHandleStore;

const IDLE: Duration = Duration::from_secs(60);

fn root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "blok-mcp-hs-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn mode(path: &Path) -> u32 {
    std::fs::symlink_metadata(path)
        .unwrap()
        .permissions()
        .mode()
        & 0o777
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

async fn lease(store: &FilesHandleStore, handle: &str) -> Box<dyn HandleLease> {
    match store
        .acquire(handle.to_owned(), IDLE, Duration::from_secs(5))
        .await
        .unwrap()
    {
        Acquired::Lease(lease) => lease,
        Acquired::Unknown => panic!("unknown"),
        Acquired::Busy => panic!("busy"),
    }
}

#[tokio::test]
async fn the_directory_is_made_private_and_every_file_is_0600() {
    let base = root("private");
    let dir = base.join("a/b");
    let store = FilesHandleStore::open(&dir.to_string_lossy()).unwrap();
    assert_eq!(mode(&dir), 0o700);
    assert!(
        store
            .try_add("h1".into(), record("a"), 8, IDLE)
            .await
            .unwrap()
    );
    let held = lease(&store, "h1").await;
    for name in names(&dir) {
        assert_eq!(mode(&dir.join(&name)), 0o600, "{name}");
    }
    held.release().await.unwrap();
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn an_unsafe_directory_is_refused() {
    let base = root("unsafe");
    let open = base.join("open");
    std::fs::create_dir(&open).unwrap();
    std::fs::set_permissions(&open, std::fs::Permissions::from_mode(0o770)).unwrap();
    let refused = FilesHandleStore::open(&open.to_string_lossy())
        .err()
        .unwrap();
    assert_eq!(
        refused,
        format!(
            "--handle-store directory {} must be a directory (not a link) owned by this user, with no group or world access (chmod 700)",
            open.display()
        )
    );
    let real = base.join("real");
    std::fs::create_dir(&real).unwrap();
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o700)).unwrap();
    let link = base.join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(FilesHandleStore::open(&link.to_string_lossy()).is_err());
    // A trailing slash must not follow the link.
    assert!(FilesHandleStore::open(&format!("{}/", link.display())).is_err());
    let file = base.join("file");
    std::fs::write(&file, "x").unwrap();
    assert!(FilesHandleStore::open(&file.to_string_lossy()).is_err());
    assert!(FilesHandleStore::open(&real.to_string_lossy()).is_ok());
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn a_directory_that_went_away_is_never_made_again() {
    let base = root("gone");
    let dir = base.join("hs");
    let store = FilesHandleStore::open(&dir.to_string_lossy()).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    assert!(
        store
            .try_add("h".into(), record("a"), 8, IDLE)
            .await
            .is_err()
    );
    assert!(!dir.exists());
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn a_handle_that_is_not_a_minted_shape_is_unknown_and_touches_no_file() {
    let base = root("names");
    let dir = base.join("hs");
    let store = FilesHandleStore::open(&dir.to_string_lossy()).unwrap();
    for bad in ["../escape", "a/b", ".", &"a".repeat(129)] {
        assert!(matches!(
            store
                .acquire(bad.to_owned(), IDLE, Duration::ZERO)
                .await
                .unwrap(),
            Acquired::Unknown
        ));
        assert!(
            store
                .try_add(bad.to_owned(), record("a"), 8, IDLE)
                .await
                .is_err()
        );
    }
    assert!(names(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&base);
}

// Two processes on one directory: count-and-add holds per principal.
#[tokio::test(flavor = "multi_thread")]
async fn the_cap_holds_under_concurrent_adds_from_two_stores() {
    let base = root("cap");
    let dir = base.join("hs").to_string_lossy().into_owned();
    let a = FilesHandleStore::open(&dir).unwrap();
    let b = FilesHandleStore::open(&dir).unwrap();
    let mut adds = tokio::task::JoinSet::new();
    for n in 0..12 {
        let store = if n % 2 == 0 { a.clone() } else { b.clone() };
        adds.spawn(async move { store.try_add(format!("h{n}"), record("a"), 3, IDLE).await });
    }
    let added = adds
        .join_all()
        .await
        .into_iter()
        .filter(|r| *r.as_ref().unwrap())
        .count();
    assert_eq!(added, 3);
    assert_eq!(a.count("a".into(), IDLE).await.unwrap(), 3);
    assert_eq!(b.count("b".into(), IDLE).await.unwrap(), 0);
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn a_lease_taken_over_cannot_save_renew_remove_or_release() {
    let base = root("lost");
    let dir = base.join("hs");
    let a = FilesHandleStore::open(&dir.to_string_lossy())
        .unwrap()
        .with_lease_stale(Duration::from_millis(200));
    let b = FilesHandleStore::open(&dir.to_string_lossy())
        .unwrap()
        .with_lease_stale(Duration::from_millis(200));
    assert!(a.try_add("h".into(), record("a"), 8, IDLE).await.unwrap());
    let first = lease(&a, "h").await;
    // A paused holder: its lease goes stale and b takes it over.
    let lock = dir.join("h.lease");
    let old = std::time::SystemTime::now() - Duration::from_secs(60);
    std::fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(old)
        .unwrap();
    let second = lease(&b, "h").await;
    assert!(first.save(record("a")).await.is_err());
    assert!(first.renew().await.is_err());
    assert!(first.remove().await.is_err());
    first.release().await.unwrap();
    // b still holds it, and the handle is still there.
    second.renew().await.unwrap();
    let mut changed = record("a");
    changed.client_name = "Other".to_owned();
    second.save(changed).await.unwrap();
    second.release().await.unwrap();
    assert_eq!(lease(&a, "h").await.record().client_name, "Other");
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn a_held_lease_makes_others_wait_and_release_lets_them_in() {
    let base = root("wait");
    let dir = base.join("hs");
    let store = FilesHandleStore::open(&dir.to_string_lossy()).unwrap();
    store
        .try_add("h".into(), record("a"), 8, IDLE)
        .await
        .unwrap();
    let held = lease(&store, "h").await;
    assert!(matches!(
        store
            .acquire("h".into(), IDLE, Duration::from_millis(100))
            .await
            .unwrap(),
        Acquired::Busy
    ));
    held.release().await.unwrap();
    let again = lease(&store, "h").await;
    again.remove().await.unwrap();
    assert!(matches!(
        store
            .acquire("h".into(), IDLE, Duration::ZERO)
            .await
            .unwrap(),
        Acquired::Unknown
    ));
    assert!(names(&dir).is_empty(), "{:?}", names(&dir));
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn an_idle_handle_expires_and_sweep_deletes_idle_records_only() {
    let base = root("sweep");
    let dir = base.join("hs");
    let store = FilesHandleStore::open(&dir.to_string_lossy()).unwrap();
    let idle = Duration::from_millis(300);
    for handle in ["idle", "held", "other"] {
        store
            .try_add(handle.into(), record("a"), 8, idle)
            .await
            .unwrap();
    }
    let held = lease(&store, "held").await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    store
        .try_add("fresh".into(), record("b"), 8, idle)
        .await
        .unwrap();
    // An expired handle is unknown to acquire, which deletes it.
    assert!(matches!(
        store
            .acquire("other".into(), idle, Duration::ZERO)
            .await
            .unwrap(),
        Acquired::Unknown
    ));
    store.sweep(idle).await.unwrap();
    assert_eq!(
        names(&dir),
        vec![
            "fresh.meta.json",
            "fresh.record.json",
            "held.lease",
            "held.meta.json",
            "held.record.json"
        ]
    );
    // Release restarts the idle time: the held handle lives on.
    held.release().await.unwrap();
    store.sweep(idle).await.unwrap();
    assert!(names(&dir).contains(&"held.meta.json".to_owned()));
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn a_lease_kept_by_renew_is_never_taken_over() {
    let base = root("renewed");
    let dir = base.join("hs").to_string_lossy().into_owned();
    let stale = Duration::from_millis(200);
    let a = FilesHandleStore::open(&dir)
        .unwrap()
        .with_lease_stale(stale);
    let b = FilesHandleStore::open(&dir)
        .unwrap()
        .with_lease_stale(stale);
    a.try_add("h".into(), record("a"), 8, IDLE).await.unwrap();
    let held = lease(&a, "h").await;
    let renewing = async {
        for _ in 0..12 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            held.renew().await.unwrap();
        }
    };
    let (taken, ()) = tokio::join!(
        b.acquire("h".into(), IDLE, Duration::from_millis(600)),
        renewing
    );
    assert!(matches!(taken.unwrap(), Acquired::Busy));
    held.save(record("a")).await.unwrap();
    held.release().await.unwrap();
    let _ = std::fs::remove_dir_all(&base);
}

// One breaker at a time, and only the lock it saw go stale: a lock taken
// since (new token) is never deleted.
#[tokio::test]
async fn a_breaker_deletes_only_the_stale_lock_it_saw() {
    let base = root("breaker");
    let dir = base.join("hs");
    let store = FilesHandleStore::open(&dir.to_string_lossy())
        .unwrap()
        .with_lease_stale(Duration::from_millis(100));
    let lock = dir.join("x.lease");
    std::fs::write(&lock, "theirs").unwrap();
    let old = std::time::SystemTime::now() - Duration::from_secs(60);
    let set_old = || {
        std::fs::File::options()
            .write(true)
            .open(&lock)
            .unwrap()
            .set_modified(old)
            .unwrap();
    };
    set_old();
    assert!(!store.break_stale(&lock, Some("someone-else")).unwrap());
    assert!(lock.exists());
    // Another breaker holds the guard: this one waits its turn.
    let guard = dir.join("x.lease.break");
    std::fs::write(&guard, "other").unwrap();
    assert!(!store.break_stale(&lock, Some("theirs")).unwrap());
    assert!(lock.exists());
    std::fs::remove_file(&guard).unwrap();
    assert!(store.break_stale(&lock, Some("theirs")).unwrap());
    assert!(!lock.exists());
    assert!(!guard.exists());
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn sweep_deletes_old_crash_leftovers_only() {
    let base = root("leftovers");
    let dir = base.join("hs");
    let store = FilesHandleStore::open(&dir.to_string_lossy())
        .unwrap()
        .with_lease_stale(Duration::from_millis(100));
    store
        .try_add("live".into(), record("a"), 8, IDLE)
        .await
        .unwrap();
    for name in [
        ".x.record.json.abc.tmp",
        "gone.lease.break",
        "gone.record.json",
        "gone.lease",
    ] {
        std::fs::write(dir.join(name), "x").unwrap();
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    std::fs::write(dir.join("new.record.json"), "x").unwrap();
    store.sweep(IDLE).await.unwrap();
    assert_eq!(
        names(&dir),
        vec!["live.meta.json", "live.record.json", "new.record.json"]
    );
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn windows_and_a_directory_another_user_owns_are_refused() {
    let base = root("owner");
    let dir = base.join("hs").to_string_lossy().into_owned();
    assert_eq!(
        FilesHandleStore::open_with(&dir, true, None).err().unwrap(),
        "--handle-store files: is not supported on Windows; use your own store"
    );
    let me = rustix::process::geteuid().as_raw();
    assert!(FilesHandleStore::open_with(&dir, false, Some(me)).is_ok());
    // Root (uid 0) must refuse a directory another user owns as well.
    let refused = FilesHandleStore::open_with(&dir, false, Some(me + 1))
        .err()
        .unwrap();
    assert!(refused.contains("owned by this user"), "{refused}");
    let _ = std::fs::remove_dir_all(&base);
}
