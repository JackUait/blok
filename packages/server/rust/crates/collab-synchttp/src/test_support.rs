//! What the ported tests share (Go keeps it in member_test.go and
//! endpoint_test.go).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use blok_collab::{BoxFuture, Error, Membership};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::net::{TcpListener, TcpStream};

use crate::CloseFrame;

/// Counts frames and records whether leave ran.
#[derive(Default)]
pub(crate) struct RecordingMembership {
    pub frames: Mutex<Vec<Vec<u8>>>,
    pub left: AtomicBool,
}

impl RecordingMembership {
    pub fn has_left(&self) -> bool {
        self.left.load(Ordering::Acquire)
    }
}

/// The handle a room hands out, onto a membership the test keeps.
pub(crate) struct SharedMembership(pub Arc<RecordingMembership>);

impl Membership for SharedMembership {
    fn receive(&self, frame: Vec<u8>) -> BoxFuture<'_, Result<(), Error>> {
        self.0.frames.lock().unwrap().push(frame);
        Box::pin(async { Ok(()) })
    }

    fn leave(&self) {
        self.0.left.store(true, Ordering::Release);
    }
}

/// A served ws Conn and the raw client end over loopback.
pub(crate) async fn ws_pair() -> (blok_ws::Conn, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
    let (read, write) = accepted.unwrap().0.into_split();
    let server = blok_ws::Conn::new(read, write, Vec::new(), blok_ws::Options::default());
    (server, client.unwrap())
}

/// A client frame with a zero mask; first is the byte with FIN and opcode.
pub(crate) fn client_frame(first: u8, payload: &[u8]) -> Vec<u8> {
    let mut b = vec![first];
    match payload.len() {
        n if n <= 125 => b.push(0x80 | n as u8),
        n if n <= 0xffff => {
            b.push(0x80 | 126);
            b.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            b.push(0x80 | 127);
            b.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    b.extend_from_slice(&[0, 0, 0, 0]);
    b.extend_from_slice(payload);
    b
}

#[derive(Debug)]
pub(crate) struct ServerFrame {
    pub opcode: u8,
    pub payload: Vec<u8>,
}

pub(crate) async fn read_server_frame(r: &mut (impl AsyncRead + Unpin)) -> ServerFrame {
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut head = [0u8; 2];
        r.read_exact(&mut head).await.expect("reading a frame");
        let mut length = u64::from(head[1] & 0x7f);
        if length == 126 {
            let mut ext = [0u8; 2];
            r.read_exact(&mut ext).await.unwrap();
            length = u64::from(u16::from_be_bytes(ext));
        } else if length == 127 {
            let mut ext = [0u8; 8];
            r.read_exact(&mut ext).await.unwrap();
            length = u64::from_be_bytes(ext);
        }
        let mut payload = vec![0u8; length as usize];
        r.read_exact(&mut payload).await.unwrap();
        ServerFrame {
            opcode: head[0] & 0x0f,
            payload,
        }
    })
    .await
    .expect("no server frame in time")
}

/// A close as read off the wire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WireClose {
    pub status: u16,
    pub reason: String,
}

impl PartialEq<CloseFrame> for WireClose {
    fn eq(&self, other: &CloseFrame) -> bool {
        self.status == other.status && self.reason == other.reason
    }
}

pub(crate) fn wire_close(payload: &[u8]) -> WireClose {
    WireClose {
        status: u16::from_be_bytes([payload[0], payload[1]]),
        reason: String::from_utf8(payload[2..].to_vec()).unwrap(),
    }
}

pub(crate) async fn read_close(r: &mut (impl AsyncRead + Unpin)) -> WireClose {
    loop {
        let frame = read_server_frame(r).await;
        if frame.opcode == 0x8 {
            return wire_close(&frame.payload);
        }
    }
}

use std::net::SocketAddr;
use std::time::SystemTime;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use blok_auth::{Authorization, User};
use blok_collab::{JoinResult, JoinStatus, Member, Rooms};
use blok_http::{Handler, Request, ResponseWriter};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::{BudgetOptions, Config, ConnectionTable, Endpoint, SocketMember};

pub(crate) const TEST_SECRET: &str = "s3cret-value-at-least-32-chars-long!";

pub(crate) fn mint(payload: &str) -> String {
    let body = URL_SAFE_NO_PAD.encode(payload);
    let mut mac = Hmac::<Sha256>::new_from_slice(TEST_SECRET.as_bytes()).unwrap();
    mac.update(format!("{}.{body}", blok_ticket::HEADER_SEGMENT).as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{}.{body}.{signature}", blok_ticket::HEADER_SEGMENT)
}

pub(crate) fn write_ticket() -> String {
    mint(r#"{"user":"u1","doc":"doc-42","write":true,"exp":4102444800}"#)
}

pub(crate) fn read_ticket() -> String {
    mint(r#"{"user":"u1","doc":"doc-42","write":false,"exp":4102444800}"#)
}

pub(crate) fn userless_ticket() -> String {
    mint(r#"{"doc":"doc-42","write":true,"exp":4102444800}"#)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap()
}

/// Records joins and answers with a fixed status.
pub(crate) struct FakeRooms {
    state: Mutex<RoomsState>,
}

struct RoomsState {
    status: JoinStatus,
    fail: bool,
    members: Vec<Arc<dyn Member>>,
    joined: Vec<Arc<RecordingMembership>>,
}

impl Default for FakeRooms {
    fn default() -> Self {
        Self {
            state: Mutex::new(RoomsState {
                status: JoinStatus::Joined,
                fail: false,
                members: Vec::new(),
                joined: Vec::new(),
            }),
        }
    }
}

impl FakeRooms {
    pub fn joins(&self) -> usize {
        lock(&self.state).members.len()
    }

    pub fn membership(&self, i: usize) -> Arc<RecordingMembership> {
        Arc::clone(&lock(&self.state).joined[i])
    }

    pub fn answer(&self, status: JoinStatus, fail: bool) {
        let mut state = lock(&self.state);
        state.status = status;
        state.fail = fail;
    }

    pub fn last_member(&self) -> Arc<dyn Member> {
        Arc::clone(lock(&self.state).members.last().expect("no join"))
    }
}

impl Rooms for FakeRooms {
    fn join<'a>(
        &'a self,
        _doc: &'a str,
        member: Arc<dyn Member>,
    ) -> BoxFuture<'a, Result<JoinResult, Error>> {
        let mut state = lock(&self.state);
        state.members.push(member);
        let answer = if state.fail {
            Err("boom".into())
        } else if state.status != JoinStatus::Joined {
            Ok(JoinResult {
                status: state.status,
                membership: None,
                err: None,
            })
        } else {
            let membership = Arc::new(RecordingMembership::default());
            state.joined.push(Arc::clone(&membership));
            Ok(JoinResult {
                status: JoinStatus::Joined,
                membership: Some(Box::new(SharedMembership(membership))),
                err: None,
            })
        };
        Box::pin(async move { answer })
    }
}

#[derive(Default)]
pub(crate) struct FakeAuthorization {
    state: Mutex<AuthorizationState>,
}

#[derive(Default)]
pub(crate) struct AuthorizationState {
    pub read: bool,
    pub write: bool,
    pub fail: bool,
    pub seen: Vec<User>,
    pub writes: Vec<User>,
}

impl FakeAuthorization {
    pub fn new(read: bool, write: bool, fail: bool) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(AuthorizationState {
                read,
                write,
                fail,
                seen: Vec::new(),
                writes: Vec::new(),
            }),
        })
    }

    pub fn set(&self, edit: impl FnOnce(&mut AuthorizationState)) {
        edit(&mut lock(&self.state));
    }

    pub fn calls(&self) -> Vec<User> {
        lock(&self.state).seen.clone()
    }

    pub fn write_calls(&self) -> Vec<User> {
        lock(&self.state).writes.clone()
    }
}

impl Authorization for FakeAuthorization {
    fn can_read_document<'a>(
        &'a self,
        user: &'a User,
        _document_id: &'a str,
        _request: &'a blok_auth::Extensions,
    ) -> blok_auth::BoxFuture<'a, Result<bool, blok_auth::Error>> {
        let mut state = lock(&self.state);
        state.seen.push(user.clone());
        let answer = if state.fail {
            Err("authorization unavailable".into())
        } else {
            Ok(state.read)
        };
        Box::pin(async move { answer })
    }

    fn can_write_document<'a>(
        &'a self,
        user: &'a User,
        _document_id: &'a str,
        _request: &'a blok_auth::Extensions,
    ) -> blok_auth::BoxFuture<'a, Result<bool, blok_auth::Error>> {
        let mut state = lock(&self.state);
        state.writes.push(user.clone());
        let answer = if state.fail {
            Err("authorization unavailable".into())
        } else {
            Ok(state.write)
        };
        Box::pin(async move { answer })
    }
}

pub(crate) type Wrap = Box<dyn FnOnce(Arc<dyn Handler>) -> Arc<dyn Handler>>;

pub(crate) struct Harness {
    pub address: SocketAddr,
    pub rooms: Arc<FakeRooms>,
    pub endpoint: Endpoint,
}

pub(crate) fn test_config(rooms: Arc<FakeRooms>) -> Config {
    Config {
        auth: "none".into(),
        secret: TEST_SECRET.into(),
        origin_allowed: Arc::new(|origin| origin == "https://app.example.com"),
        rate_limit: Arc::new(|_| true),
        clock: Arc::new(SystemTime::now),
        authorization: None,
        rooms,
        has_operation_store: false,
        max_message_bytes: 1 << 20,
        keep_alive_interval: Duration::ZERO,
        connections: Arc::new(ConnectionTable::new(0, 8)),
        budget: BudgetOptions {
            frames_per_second: 50,
            burst_frames: 100,
            resyncs_per_minute: 60,
            awareness_bytes_per_second: 128 << 10,
        },
        budget_clock: None,
        upgrades: None,
    }
}

pub(crate) async fn start_endpoint(edit: impl FnOnce(&mut Config), wrap: Option<Wrap>) -> Harness {
    let rooms = Arc::new(FakeRooms::default());
    let mut config = test_config(Arc::clone(&rooms));
    edit(&mut config);
    let endpoint = Endpoint::new(config);
    let mut router = blok_route::Router::new();
    router.handle("/sync/{doc}", Some(&["GET"]), endpoint.clone());
    let mut handler: Arc<dyn Handler> = Arc::new(router);
    if let Some(wrap) = wrap {
        handler = wrap(handler);
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = blok_http::Server::new(
        move |request: Request, response: ResponseWriter| handler.serve(request, response),
        blok_http::Config::default(),
    );
    tokio::spawn(async move { server.serve(listener).await });
    Harness {
        address,
        rooms,
        endpoint,
    }
}

impl Harness {
    pub fn socket_member(&self, i: usize) -> Arc<SocketMember> {
        self.endpoint.members(i)
    }

    pub async fn dial(&self, path: &str, headers: &[(&str, &str)]) -> ClientConn {
        let stream = TcpStream::connect(self.address).await.unwrap();
        let mut request = format!(
            "GET {path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
             Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        );
        for (name, value) in headers {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        request.push_str("\r\n");
        let mut reader = BufReader::new(stream);
        reader
            .get_mut()
            .write_all(request.as_bytes())
            .await
            .unwrap();
        let (status, response_headers) = read_head(&mut reader).await;
        let mut client = ClientConn {
            reader,
            status,
            headers: response_headers,
            body: String::new(),
        };
        if status != 101 {
            client.body = read_body(&mut client).await;
        }
        client
    }
}

async fn read_head(reader: &mut BufReader<TcpStream>) -> (u16, Vec<(String, String)>) {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        let status = line.split(' ').nth(1).expect("no status").parse().unwrap();
        let mut headers = Vec::new();
        loop {
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                return (status, headers);
            }
            let (name, value) = line.split_once(':').unwrap();
            headers.push((name.to_owned(), value.trim().to_owned()));
        }
    })
    .await
    .expect("no response head")
}

async fn read_body(client: &mut ClientConn) -> String {
    let mut body = Vec::new();
    if client.header("Transfer-Encoding") == "chunked" {
        loop {
            let mut size = String::new();
            client.reader.read_line(&mut size).await.unwrap();
            let size = usize::from_str_radix(size.trim(), 16).unwrap();
            let mut chunk = vec![0u8; size + 2];
            client.reader.read_exact(&mut chunk).await.unwrap();
            if size == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..size]);
        }
    } else if let Ok(length) = client.header("Content-Length").parse::<usize>() {
        body.resize(length, 0);
        client.reader.read_exact(&mut body).await.unwrap();
    }
    String::from_utf8(body).unwrap()
}

pub(crate) struct ClientConn {
    pub reader: BufReader<TcpStream>,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl ClientConn {
    pub fn header(&self, name: &str) -> &str {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map_or("", |(_, v)| v.as_str())
    }

    pub async fn close_frame(&mut self) -> WireClose {
        read_close(&mut self.reader).await
    }

    pub async fn write(&mut self, bytes: &[u8]) {
        self.reader.get_mut().write_all(bytes).await.unwrap();
    }
}

pub(crate) fn ticket_offer(offers: &[&str]) -> Vec<(&'static str, String)> {
    vec![
        ("Origin", "https://app.example.com".to_owned()),
        ("Sec-WebSocket-Protocol", offers.join(", ")),
    ]
}

pub(crate) fn pairs<'a>(headers: &'a [(&'static str, String)]) -> Vec<(&'static str, &'a str)> {
    headers.iter().map(|(n, v)| (*n, v.as_str())).collect()
}

pub(crate) fn ticket_mode(config: &mut Config) {
    config.auth = "ticket".into();
}

/// Sets the host's own signed-in user, like RequireAuthorization.
pub(crate) fn signed_in(user: User) -> Wrap {
    Box::new(move |next: Arc<dyn Handler>| {
        Arc::new(move |mut request: Request, response: ResponseWriter| {
            request.extensions.insert(user.clone());
            next.serve(request, response)
        }) as Arc<dyn Handler>
    })
}

/// Reads frames until the close: the binary count and the close.
pub(crate) async fn drain(client: &mut ClientConn) -> (usize, WireClose) {
    let mut binaries = 0;
    loop {
        let frame = read_server_frame(&mut client.reader).await;
        match frame.opcode {
            0x2 => binaries += 1,
            0x8 => return (binaries, wire_close(&frame.payload)),
            _ => {}
        }
    }
}

pub(crate) async fn eventually(mut done: impl FnMut() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !done() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    done()
}

impl RecordingMembership {
    pub fn count(&self) -> usize {
        self.frames.lock().unwrap().len()
    }
}
