use crate::host_fixture_test::read_fixture;
use crate::looks_like_a_document;
use crate::test_json::Json;

// Read by C# LooksLikeADocumentFixtureTests too.
#[test]
fn looks_like_a_document_matches_the_shared_fixture() {
    let cases = read_fixture("looks-like-a-document.json");
    assert!(!cases.array().is_empty(), "no cases");
    let mut failures = Vec::new();
    for case in cases.array() {
        let input = match case.get("input") {
            Json::Null => "",
            input => input.str(),
        };
        let want = case.get("expected").bool();
        if looks_like_a_document(input) != want {
            failures.push(format!(
                "{}: {input:?}, want {want}",
                case.get("name").str()
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Validation never fails, so it inherits the shape check's answer.
#[tokio::test]
async fn validation_agrees_with_the_shared_fixture() {
    let converter = crate::converter_test::real_converter();
    let cases = read_fixture("looks-like-a-document.json");
    let mut failures = Vec::new();
    for case in cases.array() {
        let input = match case.get("input") {
            Json::Null => "",
            input => input.str(),
        };
        let want = case.get("expected").bool();
        match converter.validate(input).await {
            Ok(validation) if validation.is_document == want => {}
            other => failures.push(format!(
                "{}: {input:?}, want {want}, got {other:?}",
                case.get("name").str()
            )),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
