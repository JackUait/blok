use blok_jsjson::Value;

use crate::csharp_yrs_compat_test::block_on;
use crate::docconverter_test::{legacy_html_doc, runtime};
use crate::replay::build_replay;
use crate::replay_test::{background, records};
use crate::richtext_test::{field, items, json};

// C# CollabHistoryReplayTests.AFormatOneBaselineExportsAsSegments: the half
// Go leaves, the legacy slot read through the runtime.
#[test]
fn a_format_one_baseline_exports_as_segments() {
    let state = legacy_html_doc()
        .encode_state_as_update(&[])
        .unwrap_or_else(|err| panic!("{err}"));
    let replayed =
        build_replay(background, &[state], records(&[])).unwrap_or_else(|err| panic!("{err:?}"));
    let exported =
        Value::Object(block_on(runtime().export(&replayed)).unwrap_or_else(|err| panic!("{err}")));
    let blocks = items(field(&exported, "blocks"));
    assert_eq!(
        json(field(field(&blocks[0], "data"), "text")),
        r#"[{"text":"x","marks":{"bold":true}}]"#
    );
}
