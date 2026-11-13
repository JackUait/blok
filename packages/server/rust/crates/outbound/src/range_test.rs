use crate::fetcher::ByteRange;
use crate::origin_test::*;

#[tokio::test]
async fn sends_the_range_on_every_hop() {
    let o = Origin::start(
        "127.0.0.1:0",
        None,
        answer(|seen, _| {
            if seen.target == "/start" {
                return b"HTTP/1.1 302 Found\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec();
            }
            b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 5-9/20\r\nContent-Length: 5\r\nConnection: close\r\n\r\n56789".to_vec()
        }),
    )
    .await
    .unwrap();
    let f = fixture_fetcher("pdf.example", o.port);
    let base = format!("http://pdf.example:{}", o.port);
    let mut limits = limits();
    limits.range = Some(ByteRange {
        start: 5,
        end: Some(9),
    });

    let response = f.get(&format!("{base}/start"), &limits).await.unwrap();
    assert_eq!(response.status_code, 206);
    assert_eq!(response.body, b"56789");
    assert_eq!(response.final_url, format!("{base}/final"));
    let seen: Vec<(String, Option<String>)> = o
        .seen
        .lock()
        .unwrap()
        .iter()
        .map(|s| (s.target.clone(), s.header("Range").map(str::to_owned)))
        .collect();
    assert_eq!(
        seen,
        vec![
            ("/start".to_owned(), Some("bytes=5-9".to_owned())),
            ("/final".to_owned(), Some("bytes=5-9".to_owned())),
        ]
    );
}

#[tokio::test]
async fn an_open_range_has_no_end() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fixture_fetcher("pdf.example", o.port);
    let mut limits = limits();
    limits.range = Some(ByteRange {
        start: 1400,
        end: None,
    });

    let _ = f
        .get(&format!("http://pdf.example:{}/doc.pdf", o.port), &limits)
        .await
        .unwrap();
    assert_eq!(o.last().unwrap().header("Range"), Some("bytes=1400-"));
}

#[tokio::test]
async fn no_range_sends_no_range_header() {
    let o = ok_origin("127.0.0.1:0").await.unwrap();
    let f = fixture_fetcher("pdf.example", o.port);
    let _ = f
        .get(&format!("http://pdf.example:{}/", o.port), &limits())
        .await
        .unwrap();
    assert_eq!(o.last().unwrap().header("Range"), None);
}
