use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_http::{Request, ResponseWriter};

use crate::refuse_retry_later;
use crate::test_support::{send, start};

// R9: whole seconds, rounded up, at least 1.
#[tokio::test(flavor = "multi_thread")]
async fn retry_after_is_whole_seconds_rounded_up_and_at_least_one() {
    let wait = Arc::new(Mutex::new(Duration::ZERO));
    let shared = wait.clone();
    let running = start(move |_request: Request, mut response: ResponseWriter| {
        let wait = *shared.lock().unwrap();
        async move { refuse_retry_later(&mut response, wait, "retry\n").await }
    })
    .await;
    for (given, want) in [
        (Duration::from_secs(2), "2"),
        (Duration::from_millis(2100), "3"),
        (Duration::ZERO, "1"),
        (Duration::from_millis(1), "1"),
    ] {
        *wait.lock().unwrap() = given;
        let answer = send(running.address, "GET / HTTP/1.1", b"").await;
        assert!(
            answer.header("Retry-After") == want
                && answer.status == 503
                && answer.text() == "retry\n",
            "{given:?}: Retry-After {:?}, {} {:?}; want {want:?}",
            answer.header("Retry-After"),
            answer.status,
            answer.text(),
        );
    }
}
