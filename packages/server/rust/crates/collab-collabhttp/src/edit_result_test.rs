use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab_room::{EditResult, EditStatus, Error, Receipt};
use blok_collab_workingset::Tag;
use blok_http::{Request, ResponseWriter};

use crate::test_support::{send, start};
use crate::write_edit_result;

type Case = (EditStatus, bool, Option<&'static str>);

// E7: every edit result as C# EditEndpoint.WriteResultAsync answers it
// (EditEndpoint.cs:137-228), texts copied from there.
#[tokio::test(flavor = "multi_thread")]
async fn every_edit_result_is_answered_as_c_sharp_answers_it() {
    let cases: Vec<(Case, u16, &str, &str, &str)> = vec![
        ((EditStatus::Applied, true, None), 204, "", "7", ""),
        (
            (EditStatus::PreconditionFailed, true, None),
            412,
            "the document is no longer at the If-Match head\n",
            "7",
            "",
        ),
        (
            (EditStatus::PreconditionRequired, false, None),
            428,
            "If-Match needs the operation journal, and this server keeps none\n",
            "",
            "",
        ),
        (
            (EditStatus::Conflict, false, None),
            409,
            "the idempotency key was already used for a different edit\n",
            "",
            "",
        ),
        (
            (EditStatus::Invalid, false, Some("collab: bad op.")),
            422,
            "collab: bad op.\n",
            "",
            "",
        ),
        (
            (EditStatus::Invalid, false, None),
            422,
            "collab: the edit was refused.\n",
            "",
            "",
        ),
        (
            (EditStatus::Overloaded, false, None),
            503,
            "the server ran past its limits reading this edit's rich text, retry\n",
            "",
            "3",
        ),
        (
            (EditStatus::TooLarge, false, None),
            413,
            "collab: the edit's rich text is too large to read.\n",
            "",
            "",
        ),
        (
            (EditStatus::Purged, false, None),
            403,
            "forbidden\n",
            "",
            "",
        ),
        (
            (EditStatus::Unavailable, false, None),
            503,
            "the document is unavailable, retry\n",
            "",
            "",
        ),
        (
            (EditStatus::Draining, false, None),
            503,
            "the document could not be loaded\n",
            "",
            "",
        ),
        (
            (EditStatus::SeedFailed, false, None),
            503,
            "the document could not be loaded\n",
            "",
            "",
        ),
    ];
    let current: Arc<Mutex<Option<Case>>> = Arc::new(Mutex::new(None));
    let shared = current.clone();
    let running = start(move |_request: Request, mut response: ResponseWriter| {
        let (status, head, err) = shared.lock().unwrap().unwrap();
        async move {
            let result = EditResult {
                status,
                err: err.map(Error::message),
                receipt: head.then(|| Receipt {
                    tag: Tag {
                        format: 0,
                        epoch: 0,
                        lineage: "0123456789abcdef0123456789abcdef".to_owned(),
                    },
                    server_sequence: 7,
                }),
            };
            write_edit_result(&mut response, &result, Duration::from_millis(2500)).await;
        }
    })
    .await;
    for (case, status, body, sequence, retry) in cases {
        *current.lock().unwrap() = Some(case);
        let answer = send(running.address, "GET / HTTP/1.1", b"").await;
        assert!(
            answer.status == status
                && answer.text() == body
                && answer.header("Blok-Doc-Sequence") == sequence
                && answer.header("Retry-After") == retry,
            "{:?}: {} {:?}, sequence {:?}, retry {:?}; want {status} {body:?} {sequence:?} {retry:?}",
            case.0,
            answer.status,
            answer.text(),
            answer.header("Blok-Doc-Sequence"),
            answer.header("Retry-After"),
        );
    }
}
