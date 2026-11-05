use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use super::*;

async fn pair() -> (Conn, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
    let (read, write) = accepted.unwrap().0.into_split();
    (
        Conn::new(read, write, Vec::new(), Options::default()),
        client.unwrap(),
    )
}

// Kestrel's transport keeps reading under an upgraded socket, so a FIN or
// RST aborts the request even while nobody calls receive.
#[tokio::test]
async fn peer_gone_fires_when_the_peer_ends_the_connection_while_nothing_receives() {
    for reset in [false, true] {
        let (server, mut client) = pair().await;
        if reset {
            client.set_zero_linger().unwrap();
            drop(client);
        } else {
            client.shutdown().await.unwrap();
        }
        timeout(Duration::from_secs(3), server.peer_gone())
            .await
            .unwrap_or_else(|_| panic!("the peer's end was not seen (reset {reset})"));
    }
}

// Bytes read ahead are still served before the peer's end, and a FIN still
// reads as a premature close.
#[tokio::test]
async fn frames_read_ahead_are_still_received_before_the_peers_end() {
    let (server, mut client) = pair().await;
    client
        .write_all(&[0x82, 0x83, 0, 0, 0, 0, 1, 2, 3])
        .await
        .unwrap();
    client.shutdown().await.unwrap();
    timeout(Duration::from_secs(3), server.peer_gone())
        .await
        .expect("the peer's end was not seen");
    let mut buf = [0u8; 16];
    assert_eq!(
        server.receive(&mut buf).await.unwrap(),
        (3, MessageType::Binary, true)
    );
    assert_eq!(server.receive(&mut buf).await, Err(Error::PrematureClose));
}

#[tokio::test]
async fn peer_gone_stays_pending_while_the_peer_stays_or_we_abort() {
    let (server, _client) = pair().await;
    assert!(
        timeout(Duration::from_millis(200), server.peer_gone())
            .await
            .is_err(),
        "fired with the peer still there"
    );
    server.abort();
    assert!(
        timeout(Duration::from_millis(200), server.peer_gone())
            .await
            .is_err(),
        "fired on our own abort"
    );
}
