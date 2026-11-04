//! Loopback helpers for the crate's tests: a real blok-http server, raw
//! requests, parsed answers.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use blok_http::{Config, Handler, Server};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub struct Running {
    pub address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start(handler: impl Handler) -> Running {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, Config::default());
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    Running { address, task }
}

/// Like [`start`], on `[::]` so both 127.0.0.1 and ::1 reach it: two
/// client addresses on one host.
pub async fn start_dual_stack(handler: impl Handler) -> Running {
    let listener = TcpListener::bind("[::]:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server::new(handler, Config::default());
    let task = tokio::spawn(async move {
        let _ = server.serve(listener).await;
    });
    Running { address, task }
}

/// tickets.json: the passes C#'s TicketFixture reads.
pub fn fixture_ticket(name: &str) -> String {
    let bytes = std::fs::read(fixture_path("tickets.json")).unwrap();
    let root = blok_jsjson::parse_node(&bytes, Default::default()).unwrap();
    let value = root
        .lookup(name)
        .unwrap()
        .unwrap_or_else(|| panic!("no ticket {name}"));
    blok_jsjson::to_string_lossy(value.text().unwrap().units())
}

#[derive(Debug)]
pub struct Answer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Answer {
    pub fn header(&self, name: &str) -> &str {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map_or("", |(_, v)| v.as_str())
    }

    /// Every value sent under name, in order.
    pub fn headers_all(&self, name: &str) -> Vec<&str> {
        self.headers
            .iter()
            .filter(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
            .collect()
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Sends head lines (no request line's CRLF, no blank line) and body on a
/// fresh connection, with Connection: close.
pub async fn send(address: SocketAddr, head: &str, body: &[u8]) -> Answer {
    let conn = TcpStream::connect(address).await.unwrap();
    let mut request = format!("{head}\r\nHost: x\r\nConnection: close\r\n\r\n").into_bytes();
    request.extend_from_slice(body);
    // Written beside the read: a server that answers early stops reading.
    let (mut read, mut write) = conn.into_split();
    let writer = tokio::spawn(async move {
        let _ = write.write_all(&request).await;
        write
    });
    let answer = read_answer(&mut read).await;
    writer.abort();
    answer
}

pub async fn read_answer(conn: &mut (impl AsyncReadExt + Unpin)) -> Answer {
    let mut bytes = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(10), conn.read_to_end(&mut bytes)).await;
    let end = find(&bytes, b"\r\n\r\n").expect("a response head");
    let head = String::from_utf8_lossy(&bytes[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap()[9..12].parse().unwrap();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(": "))
        .map(|(n, v)| (n.to_owned(), v.to_owned()))
        .collect();
    let mut rest = &bytes[end + 4..];
    let mut body = Vec::new();
    let chunked = headers
        .iter()
        .any(|(n, v)| n.eq_ignore_ascii_case("transfer-encoding") && v == "chunked");
    if chunked {
        while let Some(line_end) = find(rest, b"\r\n") {
            let size =
                usize::from_str_radix(&String::from_utf8_lossy(&rest[..line_end]), 16).unwrap();
            rest = &rest[line_end + 2..];
            if size == 0 {
                break;
            }
            body.extend_from_slice(&rest[..size]);
            rest = &rest[size + 2..];
        }
    } else {
        // Kept for HEAD too, so a body leaked after a HEAD head shows.
        body.extend_from_slice(rest);
    }
    Answer {
        status,
        headers,
        body,
    }
}

/// A fresh directory under the system temp dir.
pub fn temp_dir() -> PathBuf {
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).unwrap();
    let hex: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("blok-server-test-{hex}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn fixture_path(name: &str) -> String {
    format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    )
}

/// One put a [`Recording`] store saw.
#[derive(Debug, Clone)]
pub struct Put {
    pub extension: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub seekable: bool,
}

/// A store that records each put, like the C# tests' RecordingBlobStore.
pub struct Recording {
    pub url: String,
    /// Read at most this many bytes of the content.
    pub max_read: Option<usize>,
    /// Fail with this text after reading.
    pub failure: Option<String>,
    /// Wait in put until the request is cancelled.
    pub wait_for_cancel: bool,
    pub entered: std::sync::Arc<tokio::sync::Notify>,
    pub saw_cancel: std::sync::atomic::AtomicBool,
    pub put_calls: std::sync::atomic::AtomicUsize,
    pub puts: std::sync::Mutex<Vec<Put>>,
}

impl Recording {
    pub fn new(url: &str) -> Self {
        Self {
            url: url.to_owned(),
            max_read: None,
            failure: None,
            wait_for_cancel: false,
            entered: std::sync::Arc::new(tokio::sync::Notify::new()),
            saw_cancel: std::sync::atomic::AtomicBool::new(false),
            put_calls: std::sync::atomic::AtomicUsize::new(0),
            puts: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn calls(&self) -> usize {
        self.put_calls.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn puts(&self) -> Vec<Put> {
        self.puts.lock().unwrap().clone()
    }

    /// Installs it as server's store.
    pub fn install(self, server: &crate::server::Server) -> std::sync::Arc<Self> {
        let store = std::sync::Arc::new(self);
        let dyn_store: std::sync::Arc<dyn blok_blob::Store> = store.clone();
        assert!(server.inner.store.set(Ok(dyn_store)).is_ok());
        store
    }
}

impl blok_blob::Store for Recording {
    fn put<'a>(
        &'a self,
        extension: &'a str,
        mime_type: &'a str,
        content: blok_blob::Body<'a>,
        cancelled: blok_blob::Cancelled<'a>,
    ) -> blok_blob::BoxFuture<'a, Result<String, blok_blob::Error>> {
        Box::pin(async move {
            self.put_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.entered.notify_one();
            if self.wait_for_cancel {
                let waited = tokio::time::timeout(Duration::from_secs(6), async {
                    while !cancelled() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await;
                if waited.is_ok() {
                    self.saw_cancel
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                }
                return Err(blok_blob::Error::Cancelled);
            }
            let seekable = matches!(content, blok_blob::Body::Seekable(_));
            let mut reader: Box<dyn tokio::io::AsyncRead + Send + Unpin + 'a> = match content {
                blok_blob::Body::Seekable(body) => Box::new(body),
                blok_blob::Body::Stream(body) => body,
            };
            let mut bytes = Vec::new();
            match self.max_read {
                Some(max) => {
                    let mut chunk = vec![0u8; max];
                    let mut filled = 0;
                    while filled < max {
                        let n = reader
                            .read(&mut chunk[filled..])
                            .await
                            .map_err(blok_blob::Error::Io)?;
                        if n == 0 {
                            break;
                        }
                        filled += n;
                    }
                    bytes.extend_from_slice(&chunk[..filled]);
                }
                None => {
                    reader
                        .read_to_end(&mut bytes)
                        .await
                        .map_err(blok_blob::Error::Io)?;
                }
            }
            self.puts.lock().unwrap().push(Put {
                extension: extension.to_owned(),
                mime_type: mime_type.to_owned(),
                bytes,
                seekable,
            });
            match &self.failure {
                Some(text) => Err(blok_blob::Error::Io(std::io::Error::other(text.clone()))),
                None => Ok(self.url.clone()),
            }
        })
    }

    fn delete<'a>(
        &'a self,
        _url: &'a str,
        _cancelled: blok_blob::Cancelled<'a>,
    ) -> blok_blob::BoxFuture<'a, Result<(), blok_blob::Error>> {
        Box::pin(async { Ok(()) })
    }
}

/// The `.blok-upload-*` spools in the temp dir now.
pub fn upload_spools() -> std::collections::HashSet<PathBuf> {
    std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".blok-upload-")
        })
        .map(|entry| entry.path())
        .collect()
}

/// Waits up to 10 s for no spool beyond `existing`; returns what is left.
/// The temp dir is shared with every test, so a spool there may be
/// another test's, which goes away when its upload ends.
pub async fn wait_for_no_new_spools(existing: &std::collections::HashSet<PathBuf>) -> Vec<PathBuf> {
    let started = std::time::Instant::now();
    loop {
        let found: Vec<PathBuf> = upload_spools()
            .into_iter()
            .filter(|path| !existing.contains(path))
            .collect();
        if found.is_empty() || started.elapsed() > Duration::from_secs(10) {
            return found;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Sends a full request on a raw connection and returns it, so the test
/// can drop it to cancel the request.
pub async fn open(address: SocketAddr, head: &str, body: &[u8]) -> TcpStream {
    let mut conn = TcpStream::connect(address).await.unwrap();
    let mut request = format!("{head}\r\nHost: x\r\n\r\n").into_bytes();
    request.extend_from_slice(body);
    conn.write_all(&request).await.unwrap();
    conn
}
