use std::fs;

use crate::local_test::Harness;
use crate::s3_test::{DOC_ID, DOC_KEY_HEX, section_of, store_tag};

// A symlink loop needs a privilege on Windows.
#[cfg(unix)]
#[tokio::test]
async fn a_header_read_failure_other_than_absent_fails_the_write() {
    let h = Harness::new();
    fs::create_dir_all(&h.dir).unwrap();
    let path = h.path(DOC_KEY_HEX);
    std::os::unix::fs::symlink(&path, &path).unwrap();
    assert!(
        h.store()
            .write(DOC_ID, &section_of(&[&[1]]), &store_tag())
            .await
            .is_err()
    );
    assert!(
        fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[tokio::test]
async fn delete_refuses_a_legacy_unkeyed_temporary_file_and_keeps_its_bytes() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let legacy = h.path(".blok-collab-00000000000000000000000000000001");
    let legacy_bytes = crate::encode_document(&store_tag(), &section_of(&[&[3]])).unwrap();
    fs::write(&legacy, &legacy_bytes).unwrap();
    assert!(s.delete(DOC_ID).await.is_err());
    assert_eq!(fs::read(&legacy).unwrap(), legacy_bytes);
}

#[tokio::test]
async fn retire_keeps_the_bytes_of_a_moved_aside_file() {
    let h = Harness::new();
    let s = h.store();
    s.write(DOC_ID, &section_of(&[&[1]]), &store_tag())
        .await
        .unwrap();
    let unreadable = h.path(&format!("{DOC_KEY_HEX}.unreadable-old"));
    fs::write(&unreadable, [3]).unwrap();
    s.retire(DOC_ID).await.unwrap();
    s.retire(DOC_ID).await.unwrap();
    assert_eq!(fs::read(&unreadable).unwrap(), [3]);
}
