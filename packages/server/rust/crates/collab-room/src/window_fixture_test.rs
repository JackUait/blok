use std::collections::HashMap;

use blok_dotnet::{ticks, time_from_ticks};
use blok_jsjson::{Str, Value};

use crate::changes_test::{array, member, object};
use crate::historytime_fixture_test::{at, fixture, lineages, number, optional_text, text};
use crate::{
    HistoryPoint, MAX_RANGE_LINEAGES, hides_point, history_cut, history_floors, resolve_at,
    select_range, visible_timeline, window_since,
};

// The twin of C# CollabHistoryWindowCaptureTests.

fn floor_text(floor: Option<u64>) -> String {
    floor.map_or_else(|| "null".to_owned(), |floor| floor.to_string())
}

#[test]
fn history_cut_matches_the_window_fixture() {
    let window = fixture("window.json");
    let cuts = array(member(&window, "cuts"));
    assert!(cuts.len() >= 4, "only {} cut cases", cuts.len());
    for c in cuts {
        let c = object(c);
        let span: i64 = text(c, "window").parse().unwrap();
        let got = history_cut(at(c, "now").unwrap(), span);
        assert_eq!(
            ticks(got).to_string(),
            text(c, "cut"),
            "{}",
            text(c, "name")
        );
    }
}

#[test]
fn history_window_matches_the_window_fixture() {
    let window = fixture("window.json");
    let cases = array(member(&window, "cases"));
    assert!(cases.len() >= 8, "only {} window cases", cases.len());
    for c in cases {
        let c = object(c);
        let name = text(c, "name");
        let timeline = lineages(c);
        let cut = at(c, "cut").unwrap();
        let floors: HashMap<String, Option<u64>> = history_floors(&timeline, cut);
        let want_floors = object(member(c, "floors"));
        for lineage in &timeline {
            let want = match want_floors.get(&Str::from_utf8(lineage.lineage.lineage.as_bytes())) {
                Some(Value::String(s)) => s.to_string(),
                _ => "null".to_owned(),
            };
            assert_eq!(
                floor_text(floors[&lineage.lineage.lineage]),
                want,
                "{name}: {} floor",
                lineage.lineage.lineage
            );
        }
        for p in array(member(c, "points")) {
            let p = object(p);
            let (lineage, sequence) = (text(p, "lineage"), number(p, "sequence"));
            let hidden = matches!(member(p, "hidden"), Value::Bool(true));
            assert_eq!(
                hides_point(&floors, &lineage, sequence),
                hidden,
                "{name}: {lineage}:{sequence}"
            );
        }
        for s in array(member(c, "since")) {
            let s = object(s);
            let lineage = text(s, "lineage");
            assert_eq!(
                window_since(floors[&lineage], number(s, "since")),
                number(s, "from"),
                "{name}: {lineage} since"
            );
        }
        for a in array(member(c, "at")) {
            let a = object(a);
            let time = at(a, "time").unwrap();
            let (got, reason) = match resolve_at(&timeline, time) {
                None => ("null".to_owned(), "not_found".to_owned()),
                Some(point) if hides_point(&floors, &point.lineage, point.sequence) => {
                    ("null".to_owned(), "retention".to_owned())
                }
                Some(point) => (
                    format!("{}:{}", point.lineage, point.sequence),
                    "null".to_owned(),
                ),
            };
            let want = match member(a, "point") {
                Value::Object(o) => format!("{}:{}", text(o, "lineage"), text(o, "sequence")),
                _ => "null".to_owned(),
            };
            let want_reason = optional_text(a, "reason").unwrap_or_else(|| "null".to_owned());
            assert_eq!(
                (got, reason),
                (want, want_reason),
                "{name}: at {}",
                ticks(time)
            );
        }
        let visible = visible_timeline(&timeline, cut);
        let (from, to) = (
            time_from_ticks(0),
            time_from_ticks(3_155_378_975_999_999_999),
        );
        for r in array(member(c, "range")) {
            let r = object(r);
            let before = match member(r, "before") {
                Value::Object(o) => Some(HistoryPoint {
                    lineage: text(o, "lineage"),
                    sequence: number(o, "sequence"),
                    committed_at: None,
                }),
                _ => None,
            };
            let hidden = before
                .as_ref()
                .is_some_and(|b| hides_point(&floors, &b.lineage, b.sequence));
            assert_eq!(
                optional_text(r, "reason").is_some(),
                hidden,
                "{name}: before {before:?}"
            );
            if hidden {
                continue;
            }
            let got: Vec<String> =
                select_range(&visible, from, to, before.as_ref(), 200, MAX_RANGE_LINEAGES)
                    .records
                    .iter()
                    .map(|p| format!("{}:{}", p.lineage, p.sequence))
                    .collect();
            let want: Vec<String> = array(member(r, "records"))
                .iter()
                .map(|p| {
                    let p = object(p);
                    format!("{}:{}", text(p, "lineage"), text(p, "sequence"))
                })
                .collect();
            assert_eq!(got, want, "{name}: before {before:?}");
        }
    }
}
