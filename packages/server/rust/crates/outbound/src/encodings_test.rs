use std::io::Write;

use flate2::Compression;
use flate2::write::{DeflateEncoder, GzEncoder, ZlibEncoder};

use crate::body::read_bounded;
use crate::test_json::{field, fixture_path, items, load, string, text};

// The C# /unfurl answers for each Content-Encoding the fixture origin sends
// (http-host-contract captures them from C#). The bodies are rebuilt here
// the way fixture-origin.ts builds them, with Rust's compressors.

const UNFURL_MAX: u64 = 2 << 20;

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn gzip_with(builder: flate2::GzBuilder, data: &[u8]) -> Vec<u8> {
    let mut e = builder.write(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn zlib(data: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn raw_deflate(data: &[u8]) -> Vec<u8> {
    let mut e = DeflateEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn brotli(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut w = brotli::CompressorWriter::new(&mut out, 4096, 11, 22);
        w.write_all(data).unwrap();
    }
    out
}

fn cut(bytes: Vec<u8>) -> Vec<u8> {
    bytes[..bytes.len() / 2].to_vec()
}

fn flip(mut bytes: Vec<u8>, from_end: usize) -> Vec<u8> {
    let at = bytes.len() - from_end;
    bytes[at] ^= 0xff;
    bytes
}

fn concat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

/// fixture-origin.ts ENCODED.
fn origin_body(name: &str, page: &[u8]) -> Option<Vec<u8>> {
    let oversized = vec![b'x'; (2 << 20) + 1];
    Some(match name {
        "gzip"
        | "upper-gzip"
        | "spaced"
        | "good-then-bad-item"
        | "bad-line-then-good-line"
        | "trailing-comma"
        | "tab-spaced" => gzip(page),
        "br" => brotli(page),
        "deflate" => zlib(page),
        "raw-deflate" => raw_deflate(page),
        "identity" | "empty" | "unknown" | "compress" | "param" | "quoted" | "two-words"
        | "slash" | "parens" | "only-commas" => page.to_vec(),
        "two-in-one" | "two-lines" => gzip(&gzip(page)),
        "corrupt-gzip" => b"not gzip at all".to_vec(),
        "trailing-garbage" => concat(&[&gzip(page), b"garbage"]),
        "bomb" => gzip(&oversized),
        "truncated-gzip" => cut(gzip(page)),
        "truncated-deflate" => cut(zlib(page)),
        "truncated-br" => cut(brotli(page)),
        "two-gzip-members" => concat(&[&gzip(&page[..100]), &gzip(&page[100..])]),
        "gzip-zero-padding" => concat(&[&gzip(page), &[0u8; 512]]),
        "gzip-then-bad-member" => concat(&[&gzip(page), &[0x1f, 0x8b, 0x00, 0x00]]),
        "gzip-then-one-magic-byte" => concat(&[&gzip(page), &[0x1f]]),
        "gzip-bad-crc" => flip(gzip(page), 8),
        "deflate-bad-adler" => flip(zlib(page), 1),
        "deflate-trailing-garbage" => concat(&[&zlib(page), b"garbage"]),
        "br-trailing-garbage" => concat(&[&brotli(page), b"garbage"]),
        "empty-gzip-body" | "empty-br-body" | "empty-deflate-body" => Vec::new(),
        "gzip-long-name" => gzip_with(flate2::GzBuilder::new().filename(vec![b'a'; 600]), page),
        "gzip-long-comment" => gzip_with(flate2::GzBuilder::new().comment(vec![b'a'; 600]), page),
        _ => return None,
    })
}

#[tokio::test]
async fn content_encoding_matches_the_c_sharp_fixture() {
    let page = std::fs::read(fixture_path("metadata/precedence.html")).unwrap();
    let fixture = load("outbound-encodings.json");
    let cases = items(&fixture);
    assert!(!cases.is_empty());
    for c in cases {
        let name = string(c, "name");
        let body = origin_body(&name, &page).unwrap_or_else(|| panic!("{name}: no body"));
        let lines: Vec<String> = items(field(c, "encoding"))
            .iter()
            .filter_map(text)
            .collect();
        let lines: Vec<&[u8]> = lines.iter().map(|l| l.as_bytes()).collect();
        let got = read_bounded(
            &body[..],
            Some(body.len() as u64),
            &lines,
            UNFURL_MAX,
            false,
        )
        .await;
        let answer = string(field(c, "response"), "body");
        // C# answers success:0 on a refused body, the OpenGraph title when
        // the page decoded, the plain title when a cut-short stream ended
        // early, and no title when the raw bytes were read as identity.
        if answer.starts_with("{\"success\":0") {
            assert!(
                got.is_err(),
                "{name}: read {} bytes, C# refused it",
                got.unwrap().len()
            );
        } else if answer.contains("\"OpenGraph title\"") {
            assert_eq!(got.ok().as_deref(), Some(&page[..]), "{name}");
        } else if answer.contains("\"Plain title\"") {
            let got = got.unwrap_or_else(|e| panic!("{name}: {e:?}"));
            assert!(
                !got.is_empty() && got.len() < page.len() && page.starts_with(&got),
                "{name}: {} bytes",
                got.len()
            );
        } else {
            assert_eq!(got.ok().as_deref(), Some(&body[..]), "{name}");
        }
    }
}

// The header CRC covers the name, however long it is.
#[tokio::test]
async fn gzip_header_crc_covers_a_long_name() {
    let page = b"<p>";
    let zipped = gzip(page);
    let mut head = zipped[..10].to_vec();
    head.extend_from_slice(&[b'a'; 600]);
    head.push(0);
    head[3] |= 0x08 | 0x02;
    let mut crc = flate2::Crc::new();
    crc.update(&head);
    let sum = crc.sum() as u16;
    for (header_crc, fail) in [(sum, false), (sum ^ 1, true)] {
        let body = concat(&[&head, &header_crc.to_le_bytes(), &zipped[10..]]);
        let got = read_bounded(
            &body[..],
            Some(body.len() as u64),
            &[b"gzip"],
            UNFURL_MAX,
            false,
        )
        .await;
        if fail {
            assert!(got.is_err(), "crc {header_crc:x}: read {got:?}");
        } else {
            assert_eq!(got.ok().as_deref(), Some(&page[..]), "crc {header_crc:x}");
        }
    }
}
