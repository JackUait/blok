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
