use blok_dotnet::equals_ordinal_ignore_case;
use blok_jsjson::Value;

use crate::embedder::{Request, embedder};
use crate::test_json::{field, items, load, string, text};

#[test]
fn embedders_match_the_shared_fixture() {
    let fixture = load("frame-check-embedders.json");
    let cases = items(field(&fixture, "cases"));
    assert!(!cases.is_empty(), "no cases");
    for c in cases {
        let allowed_origins: Vec<String> = items(field(c, "allowedOrigins"))
            .iter()
            .filter_map(text)
            .collect();
        let allowed = |origin: &str| {
            allowed_origins.iter().any(|candidate| {
                !origin.is_empty()
                    && equals_ordinal_ignore_case(candidate.trim().as_bytes(), origin.as_bytes())
            })
        };
        let origin = text(field(c, "origin"));
        let request = Request {
            has_origin: origin.is_some(),
            origin: origin.unwrap_or_default(),
            sec_fetch_site: string(c, "secFetchSite"),
            embedder: string(c, "embedder"),
            self_origin: string(c, "self"),
        };
        let want = match field(c, "want") {
            Value::String(s) => s.to_string(),
            _ => String::new(),
        };
        assert_eq!(embedder(&request, allowed), want, "{}", string(c, "name"));
    }
}
