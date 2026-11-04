use std::process::Command;

use crate::host_fixture_test::read_repo_file;
use crate::test_support::{lookup, must_parse, pointer, shared_executor, stable, string_of};
use crate::{Actor, Cancel};

const ZONE: &str = "BLOK_FORMULA_DATES_ZONE";

// formula-dates.json holds Jint's answers to one agent read per host zone.
// QuickJS reads the host zone from TZ, which a test cannot change in its own
// process without unsafe code, so each zone runs this test binary again with
// TZ set and only `reads_formula_dates_in_one_host_zone` doing work.
#[test]
fn reads_formula_dates_in_the_host_zone_as_jint_does() {
    let fixture = must_parse(&read_repo_file(
        "test/unit/server-conformance/fixtures/agent/formula-dates.json",
    ));
    let zones = lookup(Some(&fixture), "zones").expect("zones");
    assert!(
        zones.members.len() >= 2,
        "the fixture needs at least two zones"
    );
    let mut ran = 0;
    for m in &zones.members {
        let zone = blok_jsjson::to_string_lossy(m.key().expect("key").units());
        // libc reads TZ from the zone files and silently falls back to UTC
        // when the file is missing (Ubuntu 24.04 ships Asia/Saigon only in
        // tzdata-legacy). Go embeds its own zone data, so Go has no such gap.
        if !zone_file_exists(&zone) {
            eprintln!("skipped {zone}: this machine has no zone file for it");
            continue;
        }
        ran += 1;
        let output = Command::new(std::env::current_exe().expect("the test binary"))
            .args([
                "--exact",
                "formula_dates_test::reads_formula_dates_in_one_host_zone",
                "--nocapture",
            ])
            .env("TZ", &zone)
            .env(ZONE, &zone)
            .output()
            .expect("run the test binary");
        assert!(
            output.status.success() && String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "{zone}:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(
        ran >= 2,
        "only {ran} zones have a zone file on this machine"
    );
}

fn zone_file_exists(zone: &str) -> bool {
    let directory = std::env::var("TZDIR").unwrap_or_else(|_| "/usr/share/zoneinfo".to_owned());
    std::path::Path::new(&directory).join(zone).is_file()
}

#[tokio::test]
async fn reads_formula_dates_in_one_host_zone() {
    let Ok(zone) = std::env::var(ZONE) else {
        return;
    };
    let fixture = must_parse(&read_repo_file(
        "test/unit/server-conformance/fixtures/agent/formula-dates.json",
    ));
    let document = string_of(lookup(Some(&fixture), "document")).expect("document");
    let batch = string_of(lookup(Some(&fixture), "batch")).expect("batch");
    let want = lookup(lookup(Some(&fixture), "zones"), &zone).expect("the zone");
    let execution = shared_executor()
        .execute(
            &Cancel::new(),
            &document,
            &batch,
            &Actor {
                id: "a".to_owned(),
                name: "A".to_owned(),
                on_behalf_of: None,
            },
            None,
        )
        .await
        .expect("execute");
    let result = must_parse(&execution.result_json);
    let computed = pointer(&result, "/results/0/blocks/0/computed");
    assert_eq!(stable(computed), stable(Some(want)), "{zone}");
}
