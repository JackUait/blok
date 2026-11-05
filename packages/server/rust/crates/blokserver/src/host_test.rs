use blok_jsjson::{Kind, parse_node, to_string_lossy};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

use crate::host::{host_allowed, host_names};
use crate::testutil::{Answer, Running, fixture_path, fixture_ticket, read_answer, start};
use crate::{Options, Server};

async fn get_with_host(running: &Running, target: &str, host: &str, extra: &str) -> Answer {
    let mut conn = TcpStream::connect(running.address).await.unwrap();
    let head = format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n");
    conn.write_all(head.as_bytes()).await.unwrap();
    read_answer(&mut conn).await
}

// A DNS-rebinding page sends a same-origin GET under its own name and no
// Origin.
#[tokio::test]
async fn a_loopback_server_refuses_a_frame_check_under_a_foreign_host() {
    let options = Options {
        auth: "proxy".into(),
        unfurl_enabled: true,
        loopback_host_check: true,
        ..Options::default()
    };
    let running = start(Server::new(options).unwrap().handler("")).await;
    let got = get_with_host(
        &running,
        "/frame-check?url=https%3A%2F%2Fexample.com%2F",
        "attacker.example:4000",
        "Sec-Fetch-Site: same-origin\r\n",
    )
    .await;
    assert_eq!(
        (got.text(), got.status, got.header("Content-Type")),
        (
            "host not allowed\n".to_owned(),
            421,
            "text/plain; charset=utf-8"
        )
    );
}

// An app that mounts the handler on its own public name, with the check
// off, keeps serving that name.
#[tokio::test]
async fn the_host_check_is_off_unless_asked() {
    let options = Options {
        unfurl_enabled: true,
        ..Options::default()
    };
    let running = start(Server::new(options).unwrap().handler("")).await;
    let got = get_with_host(&running, "/frame-check", "app.example.com", "").await;
    assert_ne!(got.status, 421);
}

// Ticket mode already needs an allowed Origin and a pass, and a proxy in
// front of it may forward the public Host.
#[tokio::test]
async fn ticket_mode_keeps_any_host() {
    let options = Options {
        auth: "ticket".into(),
        secret: fixture_ticket("secret"),
        allowed_origins: vec!["https://app.example.com".into()],
        unfurl_enabled: true,
        loopback_host_check: true,
        ..Options::default()
    };
    let running = start(Server::new(options).unwrap().handler("")).await;
    let got = get_with_host(
        &running,
        "/frame-check?url=https%3A%2F%2Fexample.com%2F",
        "blok.example.com",
        "Origin: https://app.example.com\r\n",
    )
    .await;
    assert_eq!(got.text(), "missing pass\n");
}

#[test]
fn request_hosts_match_the_shared_fixture() {
    let bytes = std::fs::read(fixture_path("request-hosts.json")).unwrap();
    let root = parse_node(&bytes, Default::default()).unwrap();
    let text = |node: &blok_jsjson::Node| to_string_lossy(node.text().unwrap().units());
    let field = |name: &str| root.lookup(name).unwrap().unwrap();
    let origins: Vec<String> = field("allowedOrigins").items.iter().map(text).collect();
    let names = host_names(&origins, &text(field("publicUrl")));
    let mut wrong = Vec::new();
    for row in &field("cases").items {
        let host = text(row.lookup("host").unwrap().unwrap());
        let allowed = row.lookup("allowed").unwrap().unwrap().kind == Kind::True;
        if host_allowed(&host, &names) != allowed {
            wrong.push(host);
        }
    }
    assert!(wrong.is_empty(), "{wrong:?}");
}
