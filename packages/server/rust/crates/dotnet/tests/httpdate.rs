mod common;

use std::time::{SystemTime, UNIX_EPOCH};

use blok_dotnet::parse_http_date;
use blok_jsjson::Value;
use common::{as_string, items, load};

fn unix(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_secs() as i64,
        Err(before) => -(before.duration().as_secs() as i64),
    }
}

// http-dates.json holds what HeaderUtilities.TryParseDate answers; the C#
// HttpDateFixtureTests recomputes it.
#[test]
fn parse_http_date_matches_header_utilities() {
    let fixture = load("http-dates.json");
    let (inputs, answers) = (items(&fixture, "inputs"), items(&fixture, "answers"));
    assert!(
        inputs.len() == answers.len() && !inputs.is_empty(),
        "fixture has {} inputs and {} answers",
        inputs.len(),
        answers.len()
    );
    let mut failures = Vec::new();
    for (input, answer) in inputs.iter().zip(answers) {
        let input = as_string(input);
        let got = parse_http_date(&input).map(unix);
        let want = match answer {
            Value::Number(n) => Some(*n as i64),
            _ => None,
        };
        if got != want {
            failures.push(format!("{input:?}: got {got:?}, want {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
