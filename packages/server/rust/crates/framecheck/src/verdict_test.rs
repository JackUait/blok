use crate::test_json::{field, items, load, string, text};
use crate::verdict::{Header, verdict};

#[test]
fn verdicts_match_the_shared_fixture() {
    let fixture = load("frame-check-verdicts.json");
    let cases = items(field(&fixture, "cases"));
    assert!(!cases.is_empty(), "no cases");
    for c in cases {
        let headers: Vec<Header> = items(field(c, "headers"))
            .iter()
            .map(|pair| {
                let pair = items(pair);
                Header {
                    name: text(&pair[0]).unwrap(),
                    value: text(&pair[1]).unwrap(),
                }
            })
            .collect();
        let embedder = text(field(c, "embedder")).unwrap_or_default();
        assert_eq!(
            verdict(&string(c, "url"), &embedder, &headers),
            string(c, "verdict"),
            "{}",
            string(c, "name")
        );
    }
}
