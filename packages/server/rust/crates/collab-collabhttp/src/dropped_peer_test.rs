//! C# SyncDroppedPeerTests: a peer whose TCP connection drops while its
//! frame waits behind a busy room lane. The real sync endpoint over the real
//! room manager, and a raw socket, so the drop is a real FIN or RST.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use blok_auth::{Authorization, BoxFuture as AuthFuture, Error as AuthError, User};
use blok_collab_synchttp::{BudgetOptions, Config as SyncConfig, ConnectionTable, Endpoint};
use blok_collab_wire::Message;
use blok_route::Router;
use blok_yjs::Doc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Notify;

use crate::test_support::{AppOptions, start, start_app};

/// Holds every read check once held; C# GatedAuthorization.
#[derive(Default)]
struct GatedHook {
    held: AtomicBool,
    entered: Notify,
    release: Notify,
    released: AtomicBool,
    once: Mutex<bool>,
}

impl Authorization for GatedHook {
    fn can_read_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
    ) -> AuthFuture<'a, Result<bool, AuthError>> {
        Box::pin(async move {
            if self.held.load(Ordering::SeqCst) {
                let released = self.release.notified();
                if !std::mem::replace(&mut *self.once.lock().unwrap(), true) {
                    self.entered.notify_one();
                }
                if !self.released.load(Ordering::SeqCst) {
                    released.await;
                }
            }
            Ok(true)
        })
    }

    fn can_write_document<'a>(
        &'a self,
        _: &'a User,
        _: &'a str,
    ) -> AuthFuture<'a, Result<bool, AuthError>> {
        Box::pin(async { Ok(true) })
    }
}

struct Peer(TcpStream);

impl Peer {
    async fn connect(address: std::net::SocketAddr) -> Self {
        let mut stream = TcpStream::connect(address).await.unwrap();
        stream
            .write_all(
                b"GET /sync/doc HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
                  Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
                  Origin: https://app.example.com\r\n\r\n",
            )
            .await
            .unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(stream.read_u8().await.unwrap());
        }
        assert!(
            head.starts_with(b"HTTP/1.1 101"),
            "{}",
            String::from_utf8_lossy(&head)
        );
        Self(stream)
    }

    async fn send(&mut self, message: &Message) {
        let payload = blok_collab_wire::encode(message).unwrap();
        let mut frame = vec![0x82];
        if payload.len() <= 125 {
            frame.push(0x80 | payload.len() as u8);
        } else {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        // A zero mask leaves the payload as is.
        frame.extend_from_slice(&[0; 4]);
        frame.extend_from_slice(&payload);
        self.0.write_all(&frame).await.unwrap();
    }

    async fn receive(&mut self) -> Message {
        let _first = self.0.read_u8().await.unwrap();
        let mut length = u64::from(self.0.read_u8().await.unwrap() & 0x7f);
        if length == 126 {
            length = u64::from(self.0.read_u16().await.unwrap());
        } else if length == 127 {
            length = self.0.read_u64().await.unwrap();
        }
        let mut payload = vec![0u8; usize::try_from(length).unwrap()];
        self.0.read_exact(&mut payload).await.unwrap();
        blok_collab_wire::decode(&payload).expect("a frame the codec reads")
    }
}

async fn text_after_a_queued_frame(drop_kind: &str) -> String {
    let app = start_app(AppOptions::default()).await;
    let hook = Arc::new(GatedHook::default());
    let rooms = app.manager.clone();
    let endpoint = Endpoint::new(SyncConfig {
        auth: "none".into(),
        secret: String::new(),
        origin_allowed: Arc::new(|origin| origin == "https://app.example.com"),
        rate_limit: Arc::new(|_| true),
        clock: Arc::new(SystemTime::now),
        authorization: Some(hook.clone()),
        rooms: Arc::new(rooms),
        has_operation_store: false,
        max_message_bytes: 1 << 20,
        keep_alive_interval: Duration::ZERO,
        connections: Arc::new(ConnectionTable::new(0, 8)),
        budget: BudgetOptions {
            frames_per_second: 0,
            burst_frames: 100,
            resyncs_per_minute: 0,
            awareness_bytes_per_second: 0,
        },
        budget_clock: None,
        upgrades: None,
    });
    let mut router = Router::new();
    router.handle("/sync/{doc}", Some(&["GET"]), endpoint);
    let running = start(router).await;
    let mut peer = Peer::connect(running.address).await;

    // The recheck runs inside the room lane, so a held hook holds the lane.
    hook.held.store(true, Ordering::SeqCst);
    let entered = hook.entered.notified();
    let manager = app.manager.clone();
    let recheck = tokio::spawn(async move { manager.recheck_access("doc").await });
    entered.await;

    let client = Doc::new(blok_yjs::Options::default());
    let text = client.get_text("content").unwrap();
    let update = client
        .transact(|txn| text.insert(Some(txn), 0, "late", None))
        .unwrap()
        .expect("an update");
    peer.send(&Message::SyncUpdate { update }).await;
    // Long enough for the frame to reach the lane wait.
    tokio::time::sleep(Duration::from_millis(300)).await;
    match drop_kind {
        "fin" => peer.0.shutdown().await.unwrap(),
        "rst" => {
            peer.0.set_zero_linger().unwrap();
            drop(peer);
        }
        _ => {}
    }
    if !drop_kind.is_empty() {
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    hook.released.store(true, Ordering::SeqCst);
    hook.release.notify_waiters();
    recheck.await.unwrap().unwrap();

    let mut reader = Peer::connect(running.address).await;
    let mirror = Doc::new(blok_yjs::Options::default());
    reader
        .send(&Message::SyncStep1 {
            state_vector: mirror.encode_state_vector(),
        })
        .await;
    let step2 = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Message::SyncStep2 { update } = reader.receive().await {
                return update;
            }
        }
    })
    .await
    .expect("a SyncStep2");
    mirror.apply_update(&step2).unwrap();
    mirror.get_text("content").unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_frame_waiting_on_a_busy_room_is_dropped_when_the_peer_connection_drops() {
    for drop_kind in ["fin", "rst"] {
        assert_eq!(
            text_after_a_queued_frame(drop_kind).await,
            "",
            "{drop_kind}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_frame_waiting_on_a_busy_room_is_applied_when_the_peer_stays() {
    assert_eq!(text_after_a_queued_frame("").await, "late");
}
