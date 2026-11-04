use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::s3_test::{DOC_ID, DOC_KEY_HEX, Logs, section_of, store_tag};
use crate::*;

/// A fresh directory removed on drop; `dir` is a child that does not exist yet.
pub(crate) struct Harness {
    root: PathBuf,
    pub dir: PathBuf,
    pub logs: Logs,
}

impl Harness {
    pub fn new() -> Self {
        let mut suffix = [0u8; 8];
        getrandom::fill(&mut suffix).unwrap();
        let root = std::env::temp_dir().join(format!(
            "blok-workingset-{}",
            crate::codec::lower_hex(&suffix)
        ));
        fs::create_dir(&root).unwrap();
        Harness {
            dir: root.join("collab"),
            root,
            logs: Arc::default(),
        }
    }

    fn log(&self) -> Option<Log> {
        let sink = self.logs.clone();
        Some(Arc::new(move |message: &str| {
            sink.lock().unwrap().push(message.to_owned())
        }))
    }

    pub fn store(&self) -> LocalStore {
        LocalStore::new(&self.dir, self.log())
    }

    pub fn store_at(&self, now: fn() -> SystemTime) -> LocalStore {
        LocalStore::with_clock(&self.dir, self.log(), now)
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn logged(&self, needle: &str) -> bool {
        self.logs
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains(needle))
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(crate) fn files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| !entry.file_type().unwrap().is_dir())
        .map(|entry| entry.file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

pub(crate) fn exists(path: &Path) -> bool {
    fs::metadata(path).is_ok()
}

fn with_epoch(epoch: i64) -> Tag {
    Tag {
        epoch,
        ..store_tag()
    }
}

#[tokio::test]
async fn reads_absent_as_null() {
    let h = Harness::new();
    assert_eq!(h.store().read(DOC_ID).await.unwrap(), None);
    assert!(h.logs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn writes_then_reads_back_the_working_set() {
    let h = Harness::new();
    let s = h.store();
    let updates = section_of(&[&[1, 2], &[3]]);
    s.write(DOC_ID, &updates, &store_tag()).await.unwrap();
    let stored = s.read(DOC_ID).await.unwrap().unwrap();
    assert_eq!(stored.updates, updates);
    assert_eq!(stored.tag, store_tag());
    assert_eq!(files(&h.dir), [DOC_KEY_HEX]);
    assert_eq!(
        fs::read(h.path(DOC_KEY_HEX)).unwrap(),
        encode_document(&store_tag(), &updates).unwrap()
    );
}

#[tokio::test]
async fn overwrites_the_previous_working_set() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let replacement = section_of(&[&[10], &[11]]);
    s.write(DOC_ID, &replacement, &store_tag()).await.unwrap();
    assert_eq!(s.read(DOC_ID).await.unwrap().unwrap().updates, replacement);
    assert_eq!(files(&h.dir).len(), 1);
}

#[tokio::test]
async fn reset_rewrites_to_an_empty_log_with_the_new_tag() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let bumped = with_epoch(store_tag().epoch + 1);
    s.reset(DOC_ID, &bumped).await.unwrap();
    let stored = s.read(DOC_ID).await.unwrap().unwrap();
    assert!(stored.updates.is_empty());
    assert_eq!(stored.tag, bumped);
}

#[tokio::test]
async fn write_refuses_to_lower_the_epoch() {
    let h = Harness::new();
    let s = h.store();
    let updates = section_of(&[&[1]]);
    s.write(DOC_ID, &updates, &store_tag()).await.unwrap();
    let refused = s
        .write(
            DOC_ID,
            &section_of(&[&[2]]),
            &with_epoch(store_tag().epoch - 1),
        )
        .await
        .unwrap_err();
    assert!(
        refused.to_string().contains("refusing to lower"),
        "{refused}"
    );
    let stored = s.read(DOC_ID).await.unwrap().unwrap();
    assert_eq!(stored.updates, updates);
    assert_eq!(stored.tag, store_tag());
}

#[tokio::test]
async fn write_keeps_the_epoch_for_ordinary_appends() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let appended = section_of(&[&[1], &[2]]);
    s.write(DOC_ID, &appended, &store_tag()).await.unwrap();
    assert_eq!(s.read(DOC_ID).await.unwrap().unwrap().updates, appended);
}

#[tokio::test]
async fn reset_requires_a_strictly_higher_epoch() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let refused = s.reset(DOC_ID, &store_tag()).await.unwrap_err();
    assert!(refused.to_string().contains("must raise"), "{refused}");
}

#[tokio::test]
async fn treats_a_corrupt_file_as_absent_and_logs_it() {
    let h = Harness::new();
    let s = h.store();
    fs::create_dir_all(&h.dir).unwrap();
    fs::write(h.path(DOC_KEY_HEX), b"not a working set").unwrap();
    assert_eq!(s.read(DOC_ID).await.unwrap(), None);
    assert!(h.logged(DOC_ID));
    s.write(DOC_ID, &section_of(&[&[1]]), &with_epoch(0))
        .await
        .unwrap();
    assert_eq!(s.read(DOC_ID).await.unwrap().unwrap().tag.epoch, 0);
}

fn fixed_clock() -> SystemTime {
    // 2026-11-02T03:04:05.678Z
    UNIX_EPOCH + Duration::from_millis(1_793_588_645_678)
}

#[tokio::test]
async fn moves_an_unreadable_file_aside_so_the_epoch_guard_sees_nothing() {
    let h = Harness::new();
    let s = h.store_at(fixed_clock);
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let path = h.path(DOC_KEY_HEX);
    let written = fs::read(&path).unwrap();
    let mut corrupt = written[..HEADER_LENGTH].to_vec();
    corrupt.extend_from_slice(&[0xff, 0xff, 0xff]);
    fs::write(&path, &corrupt).unwrap();
    assert_eq!(s.read(DOC_ID).await.unwrap(), None);
    assert!(!exists(&path), "not moved");
    let aside = format!("{DOC_KEY_HEX}.unreadable-20261102T030405678Z");
    assert_eq!(files(&h.dir), std::slice::from_ref(&aside));
    assert_eq!(fs::read(h.path(&aside)).unwrap(), corrupt);
    assert!(h.logged(&aside), "{:?}", h.logs.lock().unwrap());
    s.write(DOC_ID, &section_of(&[&[2]]), &with_epoch(0))
        .await
        .unwrap();
    assert_eq!(s.read(DOC_ID).await.unwrap().unwrap().tag.epoch, 0);
}

fn age(path: &Path, by: Duration) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() - by).unwrap();
}

#[test]
fn sweeps_stale_temporary_files_at_startup_and_keeps_the_rest() {
    let h = Harness::new();
    fs::create_dir_all(&h.dir).unwrap();
    for name in [".blok-collab-stale", ".blok-collab-fresh", DOC_KEY_HEX] {
        fs::write(h.path(name), [1]).unwrap();
    }
    age(&h.path(".blok-collab-stale"), Duration::from_secs(120));
    age(&h.path(DOC_KEY_HEX), Duration::from_secs(120));
    h.store();
    assert!(
        !exists(&h.path(".blok-collab-stale")),
        "{:?}",
        files(&h.dir)
    );
    assert!(exists(&h.path(".blok-collab-fresh")));
    assert!(exists(&h.path(DOC_KEY_HEX)));
}

#[tokio::test]
async fn cleans_up_the_temp_file_when_the_rename_fails() {
    let h = Harness::new();
    let s = h.store();
    fs::create_dir_all(h.path(DOC_KEY_HEX)).unwrap();
    assert!(
        s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
            .await
            .is_err(),
        "wrote onto a directory"
    );
    assert!(files(&h.dir).is_empty(), "{:?}", files(&h.dir));
    assert!(exists(&h.path(DOC_KEY_HEX)));
}

#[tokio::test]
async fn refuses_invalid_updates_before_touching_the_disk() {
    let h = Harness::new();
    let s = h.store();
    let updates = section_of(&[&[1]]);
    s.write(DOC_ID, &updates, &store_tag()).await.unwrap();
    assert!(
        s.write(DOC_ID, &[1, 2], &store_tag()).await.is_err(),
        "accepted"
    );
    assert_eq!(s.read(DOC_ID).await.unwrap().unwrap().updates, updates);
}

// File modes are Unix only.
#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[cfg(unix)]
#[tokio::test]
async fn keeps_the_working_set_private_on_unix() {
    let h = Harness::new();
    h.store()
        .write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    assert_eq!(mode(&h.path(DOC_KEY_HEX)), 0o600);
    assert_eq!(mode(&h.dir), 0o700);
}

#[cfg(unix)]
#[tokio::test]
async fn tightens_a_working_set_directory_that_already_existed() {
    let h = Harness::new();
    fs::create_dir_all(&h.dir).unwrap();
    fs::set_permissions(&h.dir, fs::Permissions::from_mode(0o755)).unwrap();
    h.store().write("doc-1", &[], &store_tag()).await.unwrap();
    assert_eq!(mode(&h.dir), 0o700);
}

#[tokio::test]
async fn delete_removes_only_one_documents_working_set_and_keyed_orphans() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    s.write("doc-2", &section_of(&[&[2]]), &store_tag())
        .await
        .unwrap();
    let other = doc_key("doc-2");
    let mut names = vec![
        (format!("{DOC_KEY_HEX}.unreadable-old"), false),
        (format!("{other}.unreadable-old"), true),
        (format!(".blok-collab-{DOC_KEY_HEX}-abandoned"), false),
        (format!(".blok-collab-{other}-abandoned"), true),
        (".blok-collab-unidentified".to_owned(), true),
    ];
    for (name, _) in &names {
        fs::write(h.path(name), [3]).unwrap();
    }
    s.delete(DOC_ID).await.unwrap();
    s.delete(DOC_ID).await.unwrap();
    names.push((DOC_KEY_HEX.to_owned(), false));
    names.push((other, true));
    for (name, kept) in names {
        assert_eq!(exists(&h.path(&name)), kept, "{name}");
    }
}

#[tokio::test]
async fn delete_refuses_a_legacy_unkeyed_temporary_file_until_it_is_removed() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    s.write("doc-2", &section_of(&[&[2]]), &store_tag())
        .await
        .unwrap();
    let legacy = h.path(".blok-collab-00000000000000000000000000000001");
    fs::write(&legacy, [3]).unwrap();
    let refused = s.delete(DOC_ID).await.unwrap_err();
    assert!(refused.to_string().contains("cannot purge"), "{refused}");
    assert!(exists(&h.path(DOC_KEY_HEX)) && exists(&legacy), "removed");
    fs::remove_file(&legacy).unwrap();
    s.delete(DOC_ID).await.unwrap();
    assert!(!exists(&h.path(DOC_KEY_HEX)));
    assert!(exists(&h.path(&doc_key("doc-2"))));
}

#[tokio::test]
async fn delete_propagates_an_occupied_working_set_path() {
    let h = Harness::new();
    let s = h.store();
    fs::create_dir_all(h.path(DOC_KEY_HEX)).unwrap();
    assert!(s.delete(DOC_ID).await.is_err());
    assert!(exists(&h.path(DOC_KEY_HEX)));
}

#[tokio::test]
async fn retire_removes_only_a_readable_working_set() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let unreadable = h.path(&format!("{DOC_KEY_HEX}.unreadable-old"));
    let scratch = h.path(".blok-collab-00000000000000000000000000000001");
    fs::write(&unreadable, [3]).unwrap();
    fs::write(&scratch, [4]).unwrap();
    s.retire(DOC_ID).await.unwrap();
    s.retire(DOC_ID).await.unwrap();
    assert!(!exists(&h.path(DOC_KEY_HEX)), "{:?}", files(&h.dir));
    assert!(exists(&unreadable) && exists(&scratch));
}

#[tokio::test]
async fn retire_leaves_an_unreadable_working_set_in_place() {
    let h = Harness::new();
    let s = h.store();
    fs::create_dir_all(&h.dir).unwrap();
    let path = h.path(DOC_KEY_HEX);
    fs::write(&path, [9, 9, 9]).unwrap();
    s.retire(DOC_ID).await.unwrap();
    assert_eq!(fs::read(&path).unwrap(), [9, 9, 9]);
}
