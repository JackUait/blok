use blok_jsjson::Kind;

use crate::executor::has_command;
use crate::room::{head_of, history_command, parse_head_text, version_command};
use crate::wire::parse;

// Go's fuzz targets, run over their seed corpus and every prefix of each
// seed: cargo has no fuzzer here.

fn with_prefixes(seeds: &[&str]) -> Vec<String> {
    let mut inputs = Vec::new();
    for seed in seeds {
        for end in 0..=seed.len() {
            if seed.is_char_boundary(end) {
                inputs.push(seed[..end].to_owned());
            }
        }
    }
    inputs
}

/// ulong.TryParse with NumberStyles.None, written apart from
/// dotnet::parse_uint64_none: digits only, trailing NULs skipped.
fn reference_sequence(s: &str) -> Option<u64> {
    let s = s.trim_end_matches('\0');
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

// Seeds are the expectRevision texts of the room-expect-* scenarios.
#[test]
fn fuzz_parse_head() {
    let seeds = [
        "a:L:0",
        "L:00",
        "L:0\0",
        ":1",
        "",
        "h123",
        "L:-1",
        "L: 1",
        "L:7",
        "L:18446744073709551616",
        "é:1",
    ];
    for head in with_prefixes(&seeds) {
        let got = parse_head_text(&head);
        let Some(colon) = head.rfind(':').filter(|at| *at > 0) else {
            assert!(got.is_none(), "{head:?} parsed without a lineage");
            continue;
        };
        let Some(sequence) = reference_sequence(&head[colon + 1..]) else {
            assert!(got.is_none(), "{head:?} parsed a bad sequence");
            continue;
        };
        let got = got.unwrap_or_else(|| panic!("{head:?} did not parse"));
        assert!(
            got.lineage == head[..colon] && got.sequence == sequence,
            "{head:?} parsed as {got:?}"
        );
        assert_eq!(
            parse_head_text(&head_of(&got)).as_ref(),
            Some(&got),
            "{head:?} does not round trip"
        );
    }
}

// The batch readers must never panic on hostile JSON, and history and
// version commands never overlap.
#[test]
fn fuzz_batch_commands() {
    let seeds = [
        r#"{"commands":[{"name":"history.undo","args":{}}]}"#,
        r#"{"commands":[{"name":"history.redo","args":{},"ref":"r"}]}"#,
        r#"{"commands":[{"name":"history.undo","args":{"x":1}}]}"#,
        r#"{"commands":[{"name":"block.insert","args":{}},{"name":"history.versions","args":{}}]}"#,
        r#"{"commands":[{"name":"history.restore","args":{"version":"v:1"}}]}"#,
        r#"{"commands":[{"name":"history.read","args":null}]}"#,
        r#"{"commands":[{"name":"\ud800"}]}"#,
        r#"{"commands":[null,1,"x",{"name":5}]}"#,
        r#"{"commands":{}}"#,
        "[]",
        "null",
    ];
    for text in with_prefixes(&seeds) {
        let Ok(batch) = parse(&text) else {
            continue;
        };
        let history = history_command(&batch).ok().flatten();
        if let Some(history) = &history {
            assert!(
                history == "history.undo" || history == "history.redo",
                "history command {history:?}"
            );
        }
        let version = version_command(&batch).ok().flatten();
        if let Some((name, args)) = &version {
            assert!(
                matches!(
                    name.as_str(),
                    "history.versions" | "history.read" | "history.changes" | "history.restore"
                ),
                "version command {name:?}"
            );
            assert_eq!(args.kind, Kind::Object, "{name} args");
        }
        assert!(
            history.is_none() || version.is_none(),
            "{text:?} is both {history:?} and {version:?}"
        );
        let _ = has_command(&batch, &["block.insert"]);
        let _ = has_command(&batch, &["page.rename", "page.setIcon"]);
    }
}
