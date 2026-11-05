//! The accept loop, graceful shutdown, and the Handler trait.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::Notify;

use crate::Config;
use crate::request::Request;
use crate::response::ResponseWriter;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// Serves one request. The response ends when the returned future does: a
/// handler that never wrote gets `Content-Length: 0`, and a panic before
/// the head went out gets an empty 500.
pub trait Handler: Send + Sync + 'static {
    fn serve(&self, request: Request, response: ResponseWriter) -> BoxFuture<()>;
}

impl<F, Fut> Handler for F
where
    F: Fn(Request, ResponseWriter) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    fn serve(&self, request: Request, response: ResponseWriter) -> BoxFuture<()> {
        Box::pin(self(request, response))
    }
}

pub(crate) struct Shared {
    pub config: Arc<Config>,
    pub handler: Arc<dyn Handler>,
    pub stopping: Arc<AtomicBool>,
    stop: Notify,
    active: AtomicUsize,
    idle: Notify,
}

/// Counts a connection that is still HTTP. A hijacked one drops it, so
/// shutdown does not wait for upgraded sockets (net/http's Shutdown does
/// not either; the host drains those itself).
pub(crate) struct ActiveGuard(Arc<Shared>);

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if self.0.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.0.idle.notify_waiters();
        }
    }
}

impl Shared {
    pub(crate) async fn stopped(&self) {
        loop {
            let notified = self.stop.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.stopping.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

/// An HTTP/1.1 server with Kestrel's wire behaviour.
#[derive(Clone)]
pub struct Server {
    shared: Arc<Shared>,
}

impl Server {
    pub fn new(handler: impl Handler, config: Config) -> Self {
        Self {
            shared: Arc::new(Shared {
                config: Arc::new(config),
                handler: Arc::new(handler),
                stopping: Arc::new(AtomicBool::new(false)),
                stop: Notify::new(),
                active: AtomicUsize::new(0),
                idle: Notify::new(),
            }),
        }
    }

    pub fn config(&self) -> &Config {
        &self.shared.config
    }

    /// Accepts on listener until shutdown starts. Accept errors (such as
    /// running out of descriptors) back off and retry, as net/http does.
    pub async fn serve(&self, listener: TcpListener) -> io::Result<()> {
        let mut backoff = Duration::ZERO;
        loop {
            let accepted = tokio::select! {
                accepted = listener.accept() => accepted,
                () = self.shared.stopped() => return Ok(()),
            };
            match accepted {
                Ok((stream, remote)) => {
                    backoff = Duration::ZERO;
                    self.shared.active.fetch_add(1, Ordering::AcqRel);
                    let guard = ActiveGuard(Arc::clone(&self.shared));
                    let shared = Arc::clone(&self.shared);
                    tokio::spawn(crate::conn::serve(shared, stream, remote, guard));
                }
                Err(_) => {
                    backoff = (backoff * 2).clamp(Duration::from_millis(5), Duration::from_secs(1));
                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }

    /// Serves a std listener (as `listen` returns them).
    pub async fn serve_std(&self, listener: std::net::TcpListener) -> io::Result<()> {
        listener.set_nonblocking(true)?;
        self.serve(TcpListener::from_std(listener)?).await
    }

    /// Stops accepting, closes idle connections, and waits up to grace for
    /// the ones mid-request to finish. Returns whether they all did.
    /// Hijacked connections are not waited for.
    pub async fn shutdown(&self, grace: Duration) -> bool {
        self.shared.stopping.store(true, Ordering::Release);
        self.shared.stop.notify_waiters();
        let drained = async {
            loop {
                let notified = self.shared.idle.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                if self.shared.active.load(Ordering::Acquire) == 0 {
                    return;
                }
                notified.await;
            }
        };
        tokio::time::timeout(grace, drained).await.is_ok()
    }
}

/// Installs the handlers now, then resolves on SIGTERM, SIGINT or SIGQUIT:
/// .NET stops gracefully on each. Must be called inside a tokio runtime.
#[cfg(unix)]
pub fn shutdown_signal() -> io::Result<impl Future<Output = ()>> {
    use tokio::signal::unix::{SignalKind, signal};
    let mut term = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut quit = signal(SignalKind::quit())?;
    Ok(async move {
        tokio::select! {
            _ = term.recv() => {}
            _ = interrupt.recv() => {}
            _ = quit.recv() => {}
        }
    })
}

/// Resolves on what Go's signal.Notify reports on Windows for the same
/// signals: Ctrl+C or Ctrl+Break (os.Interrupt), and a console close,
/// logoff or shutdown (syscall.SIGTERM).
#[cfg(windows)]
pub fn shutdown_signal() -> io::Result<impl Future<Output = ()>> {
    use tokio::signal::windows;
    let mut c = windows::ctrl_c()?;
    let mut brk = windows::ctrl_break()?;
    let mut close = windows::ctrl_close()?;
    let mut logoff = windows::ctrl_logoff()?;
    let mut shutdown = windows::ctrl_shutdown()?;
    Ok(async move {
        tokio::select! {
            _ = c.recv() => {}
            _ = brk.recv() => {}
            _ = close.recv() => {}
            _ = logoff.recv() => {}
            _ = shutdown.recv() => {}
        }
    })
}
