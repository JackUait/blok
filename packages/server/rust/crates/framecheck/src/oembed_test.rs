use base64::Engine;
use blok_jsjson::Value;

use crate::oembed::parse_oembed;
use crate::test_json::{field, items, load, string, text};

#[test]
fn oembed_answers_match_the_c_sharp_fixture() {
    let fixture = load("frame-check-oembed.json");
    let cases = items(field(&fixture, "cases"));
    let answers = items(field(&fixture, "answers"));
    assert!(!cases.is_empty() && cases.len() == answers.len());
    for (c, want) in cases.iter().zip(answers) {
        let body = match text(field(c, "json")) {
            Some(json) => json.into_bytes(),
            None => base64::engine::general_purpose::STANDARD
                .decode(string(c, "jsonBase64"))
                .unwrap(),
        };
        let got = parse_oembed(&body);
        let number = |key: &str| match field(want, key) {
            Value::Number(n) => *n as i64,
            _ => 0,
        };
        let wire = if got.is_empty() {
            String::new()
        } else {
            String::from_utf8(got.append_json(Vec::new())).unwrap()
        };
        let name = string(c, "name");
        assert_eq!(got.title.to_string(), string(want, "title"), "{name}");
        assert_eq!(
            got.provider_name.to_string(),
            string(want, "provider_name"),
            "{name}"
        );
        assert_eq!(got.thumbnail_url, string(want, "thumbnail_url"), "{name}");
        assert_eq!(i64::from(got.width), number("width"), "{name}");
        assert_eq!(i64::from(got.height), number("height"), "{name}");
        assert_eq!(wire, string(want, "wire"), "{name}");
    }
}
