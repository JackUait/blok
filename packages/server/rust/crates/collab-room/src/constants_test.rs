use std::time::Duration;

use blok_jsjson::{Str, Value};

use crate::options::*;
use crate::{MAX_CHANGE_BYTES, MAX_CHANGE_RECORDS, TIMELINE_IDLE_GAP, TIMELINE_MAX_SPAN};

// Twin of C# CollabRoomConstantsCaptureTests: the room's timers and limits
// as C# holds them.
#[test]
fn the_room_constants_match_csharp() {
    let Value::Object(fixture) = blok_collab_collabtest::read("collab-room-constants.json") else {
        panic!("the fixture is not an object");
    };
    let member = |key: &str| {
        fixture
            .get(&Str::from(key))
            .unwrap_or_else(|| panic!("no {key:?}"))
            .clone()
    };
    let want = |key: &str| match member(key) {
        Value::Number(n) => n as i64,
        other => panic!("{key:?} is not a number: {other:?}"),
    };
    let ms = |d: Duration| d.as_millis() as i64;
    let o = Options::default().with_defaults();
    let wide = Options {
        retry_backoff_cap: Duration::from_secs(10 * 24 * 3600),
        ..Options::default()
    }
    .with_defaults();
    let got = [
        ("exportDebounce", ms(o.export_debounce)),
        ("exportMaxDelay", ms(o.export_max_delay)),
        ("evictionLinger", ms(o.eviction_linger)),
        (
            "compactionFrameThreshold",
            o.compaction_frame_threshold as i64,
        ),
        ("compactionByteThreshold", o.compaction_byte_threshold),
        (
            "checkpointOperationThreshold",
            o.checkpoint_operation_threshold,
        ),
        ("checkpointByteThreshold", o.checkpoint_byte_threshold),
        ("maxAwarenessClients", o.max_awareness_clients as i64),
        ("retryBackoff", ms(o.retry_backoff)),
        ("retryBackoffCap", ms(o.retry_backoff_cap)),
        ("commitTimeout", ms(o.commit_timeout)),
        ("malformedAwarenessLimit", MALFORMED_AWARENESS_LIMIT),
        ("checkpointFailureLimit", CHECKPOINT_FAILURE_LIMIT),
        (
            "transientExportFailureLimit",
            TRANSIENT_EXPORT_FAILURE_LIMIT,
        ),
        ("activityWindow", ms(ACTIVITY_WINDOW)),
        ("activityQueueLimit", ACTIVITY_QUEUE_LIMIT as i64),
        ("activityStampLimit", ACTIVITY_STAMP_LIMIT as i64),
        ("maxJoinAttempts", MAX_JOIN_ATTEMPTS),
        ("maxChangeRecords", MAX_CHANGE_RECORDS as i64),
        ("maxChangeBytes", MAX_CHANGE_BYTES),
        ("timelineIdleGap", ms(TIMELINE_IDLE_GAP)),
        ("timelineMaxSpan", ms(TIMELINE_MAX_SPAN)),
    ];
    for (key, value) in got {
        assert_eq!(value, want(key), "{key}: C# holds another value");
    }
    for (key, options) in [("backoff", &o), ("backoffUnderATenDayCap", &wide)] {
        let Value::Array(series) = member(key) else {
            panic!("{key} is not an array");
        };
        assert_eq!(series.len(), 21, "{key} entries");
        for (failures, value) in series.iter().enumerate() {
            let Value::Number(n) = value else {
                panic!("{key}[{failures}] is not a number");
            };
            assert_eq!(
                ms(options.backoff(failures as i64)),
                *n as i64,
                "{key}({failures})"
            );
        }
    }
    // $comment, 22 values and 2 series.
    assert_eq!(
        fixture.len(),
        25,
        "the fixture holds new keys; compare them here"
    );
}
