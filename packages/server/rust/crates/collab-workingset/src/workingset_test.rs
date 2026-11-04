use crate::test_json::{self, Json};
use crate::*;

fn load() -> Json {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../../test/unit/server-conformance/fixtures/collab-disk/codecs.json"
    );
    test_json::parse(&std::fs::read_to_string(path).unwrap())
}

pub(crate) fn hex(text: &str) -> Vec<u8> {
    assert!(text.len().is_multiple_of(2), "odd hex {text}");
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn epoch(text: &str) -> i64 {
    text.parse().unwrap()
}

fn tag_of(case: &Json) -> Tag {
    Tag {
        format: case.get("format").number() as i32,
        epoch: epoch(case.get("epoch").str()),
        lineage: case.get("lineage").str().to_owned(),
    }
}

fn frames(case: &Json) -> Vec<Vec<u8>> {
    case.get("frames")
        .array()
        .iter()
        .map(|frame| hex(frame.str()))
        .collect()
}

#[test]
fn doc_keys_match_csharp() {
    let fixture = load();
    let keys = fixture.get("docKeys").array();
    assert!(!keys.is_empty(), "no doc keys");
    for case in keys {
        assert_eq!(
            doc_key(case.get("docId").str()),
            case.get("sha256").str(),
            "{:?}",
            case.get("docId")
        );
    }
}

#[test]
fn encodes_every_working_set_to_the_bytes_csharp_writes() {
    let fixture = load();
    let cases = fixture.get("workingSet").get("encode").array();
    assert!(!cases.is_empty());
    for case in cases {
        let tag = tag_of(case);
        let section = encode_frames(&frames(case)).unwrap();
        let document = encode_document(&tag, &section).unwrap();
        assert_eq!(to_hex(&document), case.get("hex").str(), "{tag}");
        let (decoded_tag, decoded_section) = decode_document(&document).unwrap();
        assert_eq!(decoded_tag, tag);
        let updates = decode_frames(&decoded_section).unwrap();
        assert_eq!(updates, frames(case), "{tag}");
    }
}

#[test]
fn refuses_every_broken_working_set_like_csharp() {
    let fixture = load();
    let cases = fixture.get("workingSet").get("refused").array();
    assert!(!cases.is_empty());
    for case in cases {
        let name = case.get("name").str();
        let document = hex(case.get("hex").str());
        assert_eq!(
            decode_document(&document).err().as_deref(),
            Some(case.get("error").str()),
            "{name}"
        );
        let logged = std::sync::Mutex::new(String::new());
        let set = decode_or_absent(
            "doc-1",
            &document,
            Some(&|message: &str| {
                *logged.lock().unwrap() = message.to_owned();
            }),
        );
        assert!(set.is_none(), "{name}");
        assert_eq!(*logged.lock().unwrap(), case.get("log").str(), "{name}");
    }
}

#[test]
fn refuses_to_encode_what_csharp_refuses() {
    let fixture = load();
    let cases = fixture.get("workingSet").get("encodeRefusals").array();
    assert!(!cases.is_empty());
    for case in cases {
        let tag = tag_of(case);
        let result =
            encode_frames(&frames(case)).and_then(|section| encode_document(&tag, &section));
        assert!(
            result.is_err(),
            "{tag} frames {:?}: encoded",
            case.get("frames")
        );
    }
    let tag = Tag {
        format: 2,
        epoch: 0,
        lineage: new_lineage(),
    };
    assert!(
        encode_document(&tag, &[0, 0, 0, 0]).is_err(),
        "an invalid frame section encoded"
    );
}

#[test]
fn the_epoch_law_matches_csharp() {
    let fixture = load();
    let cases = fixture.get("workingSet").get("law").array();
    assert!(!cases.is_empty(), "no law cases");
    for case in cases {
        let lineage = "fedcba9876543210fedcba9876543210".to_owned();
        let stored = Set {
            updates: Vec::new(),
            tag: Tag {
                format: 2,
                epoch: epoch(case.get("stored").str()),
                lineage: lineage.clone(),
            },
        };
        let next = Tag {
            format: 2,
            epoch: epoch(case.get("next").str()),
            lineage,
        };
        let check = |name: &str, result: Result<(), Error>, want: Option<&str>| {
            assert_eq!(
                result.err().map(|err| err.to_string()).as_deref(),
                want,
                "{name} {:?}",
                case
            );
        };
        check(
            "write",
            ensure_write_does_not_lower_epoch("doc \"1\"", Some(&stored), &next),
            case.get("write").opt_str(),
        );
        check(
            "reset",
            ensure_reset_raises_epoch("doc \"1\"", Some(&stored), &next),
            case.get("reset").opt_str(),
        );
        assert!(ensure_write_does_not_lower_epoch("d", None, &next).is_ok());
        assert!(ensure_reset_raises_epoch("d", None, &next).is_ok());
    }
}

#[test]
fn guard_turns_a_foreign_cancellation_into_a_store_error() {
    let foreign = guard::<()>(false, "doc-1", "read", Err(Error::DeadlineExceeded));
    match foreign {
        Err(Error::Store(store)) => {
            assert_eq!(store.doc_id, "doc-1");
            assert_eq!(store.what, "read");
            assert!(matches!(*store.source, Error::DeadlineExceeded));
        }
        other => panic!("foreign timeout: {other:?}"),
    }
    let own = guard::<()>(true, "doc-1", "read", Err(Error::Canceled));
    assert!(
        matches!(own, Err(Error::Canceled)),
        "own cancellation must pass through: {own:?}"
    );
    let plain = guard::<()>(false, "doc-1", "read", Err(Error::Refused("disk".into())));
    assert!(
        matches!(plain, Err(Error::Refused(ref m)) if m == "disk"),
        "other errors pass through: {plain:?}"
    );
}
