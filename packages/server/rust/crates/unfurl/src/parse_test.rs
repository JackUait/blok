use base64::Engine;

use crate::parse::{Metadata, parse};
use crate::test_json::{field, items, load, string, text};

// unfurl-html.json is what C#'s UnfurlMetadataParser answers;
// UnfurlHtmlFixtureTests recomputes it.
#[test]
fn parse_matches_the_c_sharp_parser() {
    let fixture = load("unfurl-html.json");
    let cases = items(field(&fixture, "cases"));
    let answers = items(field(&fixture, "answers"));
    assert!(!cases.is_empty() && cases.len() == answers.len());
    let mut failures = Vec::new();
    for (c, want) in cases.iter().zip(answers) {
        let body = match text(field(c, "html")) {
            Some(html) => html.into_bytes(),
            None => base64::engine::general_purpose::STANDARD
                .decode(string(c, "htmlBase64"))
                .unwrap(),
        };
        let want = Metadata {
            title: string(want, "title"),
            description: string(want, "description"),
            image: string(want, "image"),
            favicon: string(want, "favicon"),
            domain: string(want, "domain"),
            oembed: string(want, "oembed"),
        };
        let got = parse(&body, &string(c, "url"));
        if got != want {
            failures.push(format!(
                "{}:\n got {got:?}\nwant {want:?}",
                string(c, "name")
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
