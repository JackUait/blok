mod common;

use blok_dotnet::native_text;
use common::{items, load, string};

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
        .collect()
}

// native-text.json: what the C# host makes of argv and environment bytes.
#[test]
fn native_text_decodes_bytes_as_the_c_sharp_host_does() {
    let fixture = load("native-text.json");
    let cases = items(&fixture, "cases");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in cases {
        let bytes = string(case, "bytes");
        let want = string(case, "text");
        let got = native_text(&hex(&bytes));
        if got != want {
            failures.push(format!("{bytes}: got {got:?}, want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
