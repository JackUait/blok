use blok_jsjson::{Kind, Options, parse_node, to_string_lossy};

use crate::testutil::fixture_path;
use crate::upload::file_name_from_disposition;

// content-disposition-filenames.json holds the file name UploadEndpoint
// keeps for each Content-Disposition; the C# ContentDispositionFixtureTests
// recomputes it.
#[test]
fn file_name_from_disposition_matches_upload_endpoint() {
    let raw = std::fs::read(fixture_path("content-disposition-filenames.json")).unwrap();
    let node = parse_node(&raw, Options::default()).unwrap();
    let field = |name: &str| {
        &node
            .members
            .iter()
            .find(|m| to_string_lossy(m.key().unwrap().units()) == name)
            .unwrap()
            .value
            .items
    };
    let (inputs, answers) = (field("inputs"), field("answers"));
    assert!(inputs.len() == answers.len() && !inputs.is_empty());
    let mut failures = Vec::new();
    for (input, answer) in inputs.iter().zip(answers) {
        let input = to_string_lossy(input.text().unwrap().units());
        let want =
            (answer.kind != Kind::Null).then(|| to_string_lossy(answer.text().unwrap().units()));
        let got = file_name_from_disposition(&input);
        if got != want {
            failures.push(format!("{input:?}: got {got:?}, want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Go and Rust have no code-pages provider, so a code-page charset is never
// a file name, whatever ran first in the process.
#[test]
fn ignores_a_code_page_charset_once_the_provider_is_registered() {
    for charset in ["windows-1252", "shift_jis", "koi8-r", "ibm437", "gb2312"] {
        assert_eq!(
            file_name_from_disposition(&format!(
                "form-data; name=\"file\"; filename*={charset}''a.txt; filename=\"b.txt\""
            ))
            .as_deref(),
            Some("b.txt"),
            "{charset}"
        );
        assert_eq!(
            file_name_from_disposition(&format!(
                "form-data; name=\"file\"; filename*={charset}''a.txt"
            )),
            None,
            "{charset}"
        );
    }
}

#[test]
fn keeps_a_built_in_charset_once_the_provider_is_registered() {
    for (value, expected) in [
        ("utf-8''caf%C3%A9.txt", "café.txt"),
        ("iso-8859-1''caf%E9.txt", "café.txt"),
        ("utf-16be''a%41%E9.txt", "a\u{41E9}.txt"),
    ] {
        assert_eq!(
            file_name_from_disposition(&format!(
                "form-data; name=\"file\"; filename*={value}; filename=\"b.txt\""
            ))
            .as_deref(),
            Some(expected),
            "{value}"
        );
    }
}
