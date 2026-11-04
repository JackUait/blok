//! Go's fuzz targets, run over their seed corpus and a fixed pseudo-random
//! sweep, so `cargo test` checks the same properties every run.

use blok_jsjson::{Options, parse_node};

use crate::awareness::is_json_document;
use crate::jsonreader::MAX_DEPTH;
use crate::wire_test::{fixture, items, text, unhex};
use crate::*;

struct XorShift(u64);

impl XorShift {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn seeds() -> Vec<Vec<u8>> {
    let f = fixture("sync-wire-decode.json");
    let mut seeds: Vec<Vec<u8>> = items(&f, "decode")
        .iter()
        .map(|c| unhex(&text(c, "frameHex")))
        .collect();
    for c in items(&f, "awareness") {
        let mut frame = vec![1];
        append_var_bytes(&mut frame, &unhex(&text(c, "payloadHex")));
        seeds.push(frame);
    }
    seeds
}

fn mutate(rng: &mut XorShift, seed: &[u8]) -> Vec<u8> {
    let mut b = seed.to_vec();
    for _ in 0..=rng.below(4) {
        match rng.below(4) {
            0 if !b.is_empty() => {
                let i = rng.below(b.len());
                b[i] = rng.next() as u8;
            }
            1 if !b.is_empty() => {
                let i = rng.below(b.len());
                b.remove(i);
            }
            2 => {
                let i = rng.below(b.len() + 1);
                b.insert(i, rng.next() as u8);
            }
            _ => b.truncate(rng.below(b.len() + 1)),
        }
    }
    b
}

// Decode never panics, and anything it accepts (bar Unknown) encodes and
// decodes back to the same message.
fn decode_property(frame: &[u8]) {
    let m = match decode(frame) {
        Err(error) => {
            assert!(!error.reason.is_empty(), "a refusal with no reason");
            return;
        }
        Ok(Message::Unknown { .. }) => return,
        Ok(m) => m,
    };
    let again = encode(&m).unwrap_or_else(|e| panic!("decoded {m:?} but cannot encode it: {e}"));
    assert_eq!(decode(&again), Ok(m.clone()), "round trip changed {m:?}");
    if let Message::Awareness { update } = &m {
        let mut entries = Vec::new();
        validate_awareness_update(update, 1 << 20, Some(&mut entries));
    }
}

#[test]
fn fuzz_decode() {
    let seeds = seeds();
    for seed in &seeds {
        decode_property(seed);
    }
    let mut rng = XorShift(0x9e37_79b9_7f4a_7c15);
    for _ in 0..50_000 {
        let seed = &seeds[rng.below(seeds.len())];
        decode_property(&mutate(&mut rng, seed));
    }
}

// The deepest container level of valid JSON.
fn nesting(text: &[u8]) -> usize {
    let (mut depth, mut deepest, mut in_string) = (0usize, 0, false);
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        if in_string && c == b'\\' {
            i += 1;
        } else if c == b'"' {
            in_string = !in_string;
        } else if !in_string && (c == b'{' || c == b'[') {
            depth += 1;
            deepest = deepest.max(depth);
        } else if !in_string && (c == b'}' || c == b']') {
            depth = depth.saturating_sub(1);
        }
        i += 1;
    }
    deepest
}

// The oracle is blok-jsjson's grammar with no depth cap, in place of Go's
// json.Valid; the sweep stays ASCII so UTF-8 policy never decides a case.
fn json_reader_property(text: &[u8]) {
    let got = is_json_document(text);
    let options = Options {
        max_depth: 1 << 20,
        refuse_duplicates: false,
    };
    if parse_node(text, options).is_err() {
        assert!(!got, "{text:?}: accepted, but it is not JSON");
        return;
    }
    let want = nesting(text) <= MAX_DEPTH;
    assert_eq!(
        got,
        want,
        "{:?} (depth {})",
        String::from_utf8_lossy(text),
        nesting(text)
    );
}

#[test]
fn fuzz_json_reader() {
    let seeds: Vec<Vec<u8>> = [
        r#"{}"#,
        "[1,2]",
        r#"{"a":[{"b":null}]}"#,
        r#""\ud800""#,
        "1e5",
        " 0 ",
        "[[[]]]",
        "-0.5E-3",
        r#"{"a":1,}"#,
        "\"\x1f\"",
    ]
    .iter()
    .map(|s| s.as_bytes().to_vec())
    .collect();
    for seed in &seeds {
        json_reader_property(seed);
    }
    let deep_ok = format!("{}{}", "[".repeat(MAX_DEPTH), "]".repeat(MAX_DEPTH));
    let deep_bad = format!("{}{}", "[".repeat(MAX_DEPTH + 1), "]".repeat(MAX_DEPTH + 1));
    json_reader_property(deep_ok.as_bytes());
    json_reader_property(deep_bad.as_bytes());
    let alphabet = b"{}[],:\"\\ \t\n0123456789-+.eEtrufalsn\x01x";
    let mut rng = XorShift(0x2545_f491_4f6c_dd1d);
    for _ in 0..50_000 {
        let text: Vec<u8> = if rng.below(2) == 0 {
            let seed = &seeds[rng.below(seeds.len())];
            mutate(&mut rng, seed)
                .into_iter()
                .map(|c| if c.is_ascii() { c } else { b'x' })
                .collect()
        } else {
            (0..rng.below(12))
                .map(|_| alphabet[rng.below(alphabet.len())])
                .collect()
        };
        json_reader_property(&text);
    }
}
