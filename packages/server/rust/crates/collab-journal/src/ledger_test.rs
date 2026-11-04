use std::cell::RefCell;

use blok_dotnet::time_from_ticks;

use crate::fixture::*;
use crate::*;

#[test]
fn encodes_every_ledger_entry_to_the_bytes_c_sharp_writes() {
    let fixture = load("collab-disk/codecs.json");
    let cases = items(at(&fixture, "ledger"), "encode");
    assert!(!cases.is_empty(), "no ledger cases");
    for c in cases {
        let entry = LineageEntry {
            kind: LineageEntryKind(number(c, "kind") as u8),
            generation: u64_text(c, "generation"),
            generation_fence: u64_text(c, "generationFence"),
            lineage: text(c, "lineage"),
            epoch: i64_text(c, "epoch"),
            format: number(c, "format") as i32,
            created_at: opt_text(c, "ticks").map(|t| time_from_ticks(t.parse().unwrap())),
        };
        let generation = text(c, "generation");
        assert_eq!(
            hex(&encode_lineage_entry(&entry)),
            text(c, "hex"),
            "generation {generation}"
        );
        let decoded = decode_lineage_entry(&unhex(&text(c, "hex")))
            .unwrap_or_else(|| panic!("generation {generation}: not decoded"));
        assert_eq!(decoded, entry, "generation {generation}");
    }
}

#[test]
fn refuses_every_bad_ledger_entry_like_c_sharp() {
    let fixture = load("collab-disk/codecs.json");
    for c in items(at(&fixture, "ledger"), "refused") {
        assert_eq!(
            decode_lineage_entry(&unhex(&text(c, "hex"))),
            None,
            "{}",
            text(c, "name")
        );
    }
}

#[test]
fn reads_a_ledger_file_like_c_sharp() {
    let fixture = load("collab-disk/codecs.json");
    let file = at(at(&fixture, "ledger"), "file");
    let dir = TempDir::new();
    let path = dir.path().join(LEDGER_FILE_NAME);
    std::fs::write(&path, unhex(&text(file, "hex"))).unwrap();
    let warnings = RefCell::new(Vec::new());
    let shown = path.display().to_string();
    let warn = |message: &str| {
        warnings
            .borrow_mut()
            .push(message.replace(&shown, "{path}"))
    };
    let entries = read_ledger(&path, Some(&warn)).unwrap();
    let generations: Vec<String> = entries.iter().map(|e| e.generation.to_string()).collect();
    let want: Vec<String> = items(file, "generations")
        .iter()
        .map(|g| g.text().unwrap().to_string())
        .collect();
    let want_warnings: Vec<String> = items(file, "warnings")
        .iter()
        .map(|g| g.text().unwrap().to_string())
        .collect();
    assert_eq!(generations, want);
    assert_eq!(warnings.into_inner(), want_warnings);
}

#[test]
fn a_missing_ledger_is_empty() {
    let dir = TempDir::new();
    let entries = read_ledger(&dir.path().join("nope").join(LEDGER_FILE_NAME), None).unwrap();
    assert!(entries.is_empty());
}
