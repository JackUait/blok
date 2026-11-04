use super::*;

/// FuzzReceive over its seed corpus: every receive either consumes input
/// or ends the loop, and a close receive is (0, Close, true).
#[tokio::test]
async fn fuzz_receive() {
    fn frame(first: u8, payload: &[u8]) -> Vec<u8> {
        let mask = [0x11, 0x22, 0x33, 0x44];
        let mut b = vec![first, 0x80 | payload.len() as u8];
        b.extend_from_slice(&mask);
        b.extend(payload.iter().enumerate().map(|(i, c)| c ^ mask[i & 3]));
        b
    }
    let seeds: Vec<(Vec<u8>, usize)> = vec![
        (frame(0x82, &[0, 0, 1, 0]), 16),
        ([frame(0x02, &[]), frame(0x80, b"ab")].concat(), 1),
        (
            [frame(0x89, b"hi"), frame(0x88, &[3, 232, b'o', b'k'])].concat(),
            4,
        ),
        (frame(0x81, &[0xe2, 0x82, 0xac]), 2),
        (vec![0x82, 0xff, 0, 0, 0, 0, 0, 0, 0, 9, 1, 2, 3, 4], 8),
    ];
    for (data, size) in seeds {
        let size = (size & 0x3fff) + 1;
        let conn = Conn::new(
            std::io::Cursor::new(data.clone()),
            tokio::io::sink(),
            Vec::new(),
            Options::default(),
        );
        let mut buf = vec![0u8; size];
        let mut ended = false;
        for _ in 0..data.len() + 2 {
            match conn.receive(&mut buf).await {
                Err(_) => {
                    ended = true;
                    break;
                }
                Ok((n, kind, end)) => {
                    assert!(n <= buf.len(), "n={n} with a {}-byte buffer", buf.len());
                    if kind == MessageType::Close {
                        assert!(end && n == 0, "close receive: n={n} end={end}");
                        ended = true;
                        break;
                    }
                }
            }
        }
        assert!(ended, "{} receives and no end of input", data.len() + 2);
    }
}
