use std::sync::Arc;
use std::time::{Duration, Instant};

use blok_jsruntime::{Error as RuntimeError, Failure, InvokeError, Kind};
use tokio::sync::{Notify, mpsc};

use crate::{InvokeFuture, Options, Runtime, new, new_on_runtime};

struct Blocking {
    release: Arc<Notify>,
    seen: mpsc::UnboundedSender<(String, String)>,
    fail: bool,
}

impl Runtime for Blocking {
    fn invoke<'a>(&'a self, op: &'a str, input: &'a str, _: Option<Duration>) -> InvokeFuture<'a> {
        let _ = self.seen.send((op.to_owned(), input.to_owned()));
        let (release, fail) = (self.release.clone(), self.fail);
        Box::pin(async move {
            if !fail {
                release.notified().await;
            }
            Err(InvokeError::Failure(Failure {
                kind: Kind::Unknown,
                err: RuntimeError::Engine("slow host".to_owned()),
            }))
        })
    }
}

// Startup must not wait for the warm-up, and the warm-up must convert a real-sized article.
#[tokio::test]
async fn warms_up_off_the_startup_path_with_a_long_article() {
    let release = Arc::new(Notify::new());
    let (seen, mut calls) = mpsc::unbounded_channel();
    let converter = new_on_runtime(Blocking {
        release: release.clone(),
        seen,
        fail: false,
    });
    let start = Instant::now();
    let mut done = converter.warm_up_in_background();
    assert!(
        start.elapsed() <= Duration::from_millis(100),
        "took {:?}",
        start.elapsed()
    );
    let (op, input) = calls.recv().await.expect("a call");
    assert_eq!(op, "blocksToPlainText");
    assert_eq!(input.matches(r#""type":"#).count(), 220);
    release.notify_one();
    done.wait_for(|warmed| *warmed).await.expect("finished");
}

// A small warm-up runs the same code too few times to warm it, so the
// document the warm-up converts must be at least 30000 UTF-16 units.
#[tokio::test]
async fn converts_something_at_startup_rather_than_only_building_the_pool() {
    let release = Arc::new(Notify::new());
    let (seen, mut calls) = mpsc::unbounded_channel();
    let converter = new_on_runtime(Blocking {
        release: release.clone(),
        seen,
        fail: false,
    });
    let mut done = converter.warm_up_in_background();
    let (op, input) = calls.recv().await.expect("the warm-up ran no conversion");
    assert_eq!(op, "blocksToPlainText");
    for (name, text) in [
        ("document", crate::converter::warm_up_document()),
        ("request", input),
    ] {
        let length = text.encode_utf16().count();
        assert!(
            length >= 30_000,
            "the warm-up {name} is too small: {length}"
        );
    }
    release.notify_one();
    done.wait_for(|warmed| *warmed).await.expect("finished");
}

#[tokio::test]
async fn ignores_a_warm_up_that_fails() {
    let (seen, _calls) = mpsc::unbounded_channel();
    let converter = new_on_runtime(Blocking {
        release: Arc::new(Notify::new()),
        seen,
        fail: true,
    });
    let mut done = converter.warm_up_in_background();
    tokio::time::timeout(Duration::from_secs(5), done.wait_for(|warmed| *warmed))
        .await
        .expect("a failed warm-up never finished")
        .expect("finished");
}

#[tokio::test]
async fn warms_up_only_when_asked() {
    let cold = new(Options {
        pool_size: Some(1),
        ..Options::default()
    })
    .expect("new");
    assert!(cold.warmed().is_none(), "warmed without being asked");
    let warm = new(Options {
        pool_size: Some(1),
        warm_up: true,
        ..Options::default()
    })
    .expect("new");
    let mut done = warm.warmed().expect("a warm-up");
    tokio::time::timeout(Duration::from_secs(30), done.wait_for(|warmed| *warmed))
        .await
        .expect("the warm-up never finished")
        .expect("finished");
}
