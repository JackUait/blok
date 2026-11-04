use blok_jsjson::Node;

use crate::fixture::*;
use crate::*;

fn manifest(m: &Node) -> Manifest {
    Manifest {
        write_counter: u64_text(m, "writeCounter"),
        fence: u64_text(m, "fence"),
        generation: u64_text(m, "generation"),
        seeded: flag(m, "seeded"),
        format: number(m, "format") as i32,
        epoch: i64_text(m, "epoch"),
        lineage: text(m, "lineage"),
        checkpoint_through: u64_text(m, "checkpointThrough"),
        generation_fence: u64_text(m, "generationFence"),
        checkpoint_fence: u64_text(m, "checkpointFence"),
    }
}

fn load_files() -> Node {
    let fixture = load("collab-disk/codecs.json");
    for (section, list) in [
        ("manifest", "encode"),
        ("manifest", "read"),
        ("sealed", "encode"),
        ("sealed", "read"),
    ] {
        assert!(
            !items(at(&fixture, section), list).is_empty(),
            "no {section} {list} cases"
        );
    }
    fixture
}

#[test]
fn encodes_every_manifest_slot_to_the_bytes_c_sharp_writes() {
    let fixture = load_files();
    for c in items(at(&fixture, "manifest"), "encode") {
        assert_eq!(
            hex(&encode_manifest_slot(&manifest(c))),
            text(c, "hex"),
            "counter {}",
            text(c, "writeCounter")
        );
    }
}

#[test]
fn reads_every_manifest_file_like_c_sharp() {
    let fixture = load_files();
    let dir = TempDir::new();
    let path = dir.path().join(MANIFEST_FILE_NAME);
    for c in items(at(&fixture, "manifest"), "read") {
        let name = text(c, "name");
        std::fs::write(&path, unhex(&text(c, "hex"))).unwrap();
        let got = read_manifest(&path, "doc-1");
        let want_error = text(c, "error");
        if !want_error.is_empty() {
            match got {
                Err(err @ Error::InvalidData { .. }) => {
                    assert_eq!(err.to_string(), want_error, "{name}")
                }
                other => panic!("{name}: {other:?}, want {want_error:?}"),
            }
            continue;
        }
        assert_eq!(got.unwrap(), get(c, "manifest").map(manifest), "{name}");
    }
}

#[test]
fn a_missing_manifest_is_none() {
    let dir = TempDir::new();
    let got = read_manifest(&dir.path().join("no").join(MANIFEST_FILE_NAME), "doc-1").unwrap();
    assert_eq!(got, None);
}

#[test]
fn writes_every_sealed_file_to_the_bytes_c_sharp_writes() {
    let fixture = load_files();
    let dir = TempDir::new();
    for (i, c) in items(at(&fixture, "sealed"), "encode").iter().enumerate() {
        let path = dir.path().join("sealed");
        write_sealed(
            &path,
            &text(c, "magic"),
            u64_text(c, "tag"),
            &unhex(&text(c, "content")),
        )
        .unwrap();
        assert_eq!(
            hex(&std::fs::read(&path).unwrap()),
            text(c, "hex"),
            "case {i}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "case {i}");
        }
    }
}

#[test]
fn reads_every_sealed_file_like_c_sharp() {
    let fixture = load_files();
    let dir = TempDir::new();
    for c in items(at(&fixture, "sealed"), "read") {
        let name = text(c, "name");
        let path = dir.path().join(text(c, "fileName"));
        let _ = std::fs::remove_file(&path);
        if let Some(content) = opt_text(c, "hex") {
            std::fs::write(&path, unhex(&content)).unwrap();
        }
        let got = read_sealed(&path, &text(c, "magic"), "doc-1");
        let want_error = text(c, "error");
        if !want_error.is_empty() {
            match got {
                Err(err @ Error::InvalidData { .. }) => {
                    assert_eq!(err.to_string(), want_error, "{name}")
                }
                other => panic!("{name}: {other:?}, want {want_error:?}"),
            }
            continue;
        }
        let (content, tag) = got.unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(
            (hex(&content), tag),
            (text(c, "content"), u64_text(c, "tag")),
            "{name}"
        );
    }
}
