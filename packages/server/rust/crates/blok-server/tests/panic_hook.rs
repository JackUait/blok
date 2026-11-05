//! Its own test binary: it sets the process-wide panic hook.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

// The C# host clears Kestrel's loggers, so a handler's exception, or one a
// background task drops, writes nothing to stderr. A panic on a worker
// thread is silent; any other keeps Rust's report.
#[test]
fn a_panic_on_a_worker_thread_writes_nothing() {
    let reported = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&reported);
    std::panic::set_hook(blok_server::panic_hook(Box::new(move |_| {
        counted.fetch_add(1, Ordering::SeqCst);
    })));

    let runtime = blok_server::runtime();
    let handler = runtime.spawn(async { panic!("boom") });
    assert!(runtime.block_on(handler).is_err());
    assert_eq!(reported.load(Ordering::SeqCst), 0);

    let other = std::thread::Builder::new()
        .name("other".to_owned())
        .spawn(|| panic!("boom"))
        .unwrap();
    assert!(other.join().is_err());
    assert_eq!(reported.load(Ordering::SeqCst), 1);
}
