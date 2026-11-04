use std::panic::{AssertUnwindSafe, catch_unwind};

use blok_jsjson::{Object, Str, Value, compare, nan, stringify};
use blok_lib0::{Reader, Writer, read_any, write_any};

fn fixture_dir() -> String {
    format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/yjs-engine",
        env!("CARGO_MANIFEST_DIR")
    )
}

// What Go's yjstest.Load does: the file read as JS values, keys in order.
fn load(name: &str) -> Value {
    let path = format!("{}/{name}", fixture_dir());
    let data = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    blok_jsjson::parse(&data).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    match value {
        Value::Object(object) => object.get(&Str::from(key)).unwrap_or(&Value::Null),
        _ => &Value::Null,
    }
}

fn string(value: &Value, key: &str) -> String {
    match field(value, key) {
        Value::String(s) => s.to_string(),
        _ => String::new(),
    }
}

fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    match field(value, key) {
        Value::Array(items) => items,
        _ => &[],
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_decode(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for c in text.bytes().filter(|&c| c != b'=') {
        let v = B64.iter().position(|&b| b == c).expect("base64") as u32;
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let n = chunk.iter().fold(0u32, |n, &b| n << 8 | u32::from(b)) << (8 * (3 - chunk.len()));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(B64[(n >> (18 - 6 * i) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn b64(value: &Value, key: &str) -> Vec<u8> {
    match field(value, key) {
        Value::String(s) => base64_decode(&s.to_string()),
        _ => panic!("{key:?} is not a string"),
    }
}

// yjstest.ToEngine: the sentinel objects $num, $undefined, $bigint and $u8.
fn to_engine(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            if let [member] = object.members() {
                let text = match &member.value {
                    Value::String(s) => s.to_string(),
                    _ => String::new(),
                };
                match member.key.to_string().as_str() {
                    "$num" => {
                        return Value::Number(match text.as_str() {
                            "NaN" => nan(),
                            "-0" => -0.0,
                            "Infinity" => f64::INFINITY,
                            "-Infinity" => f64::NEG_INFINITY,
                            _ => panic!("bad $num {text:?}"),
                        });
                    }
                    "$undefined" => return Value::Undefined,
                    "$bigint" => return Value::BigInt(text.parse().expect("bad $bigint")),
                    "$u8" => return Value::Bytes(base64_decode(&text)),
                    _ => {}
                }
            }
            Value::Object(
                object
                    .members()
                    .iter()
                    .map(|member| (member.key.clone(), to_engine(&member.value)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(to_engine).collect()),
        other => other.clone(),
    }
}

fn sentinel(key: &str, value: Value) -> Value {
    Value::Object([(Str::from(key), value)].into_iter().collect())
}

// yjstest.ToFixture, the inverse of to_engine.
fn to_fixture(value: &Value) -> Value {
    match value {
        Value::Number(n) if n.is_nan() => sentinel("$num", Value::String(Str::from("NaN"))),
        Value::Number(n) if *n == 0.0 && n.is_sign_negative() => {
            sentinel("$num", Value::String(Str::from("-0")))
        }
        Value::Number(n) if n.is_infinite() => sentinel(
            "$num",
            Value::String(Str::from(if *n > 0.0 { "Infinity" } else { "-Infinity" })),
        ),
        Value::Undefined => sentinel("$undefined", Value::Bool(true)),
        Value::BigInt(n) => sentinel("$bigint", Value::String(Str::from(n.to_string()))),
        Value::Bytes(b) => sentinel("$u8", Value::String(Str::from(base64_encode(b)))),
        Value::Object(object) => Value::Object(
            object
                .members()
                .iter()
                .map(|member| (member.key.clone(), to_fixture(&member.value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(to_fixture).collect()),
        other => other.clone(),
    }
}

// yjstest.Canonical: keys sorted by UTF-16 units at every level.
fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut members: Vec<_> = object.members().iter().collect();
            members.sort_by(|a, b| compare(&a.key, &b.key));
            let sorted: Object = members
                .into_iter()
                .map(|member| (member.key.clone(), canonicalize(&member.value)))
                .collect();
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

fn canonical(value: &Value) -> String {
    stringify(&canonicalize(value)).unwrap()
}

fn engine_number(value: &Value) -> f64 {
    match to_engine(value) {
        Value::Number(n) => n,
        other => panic!("{other:?} is not a number"),
    }
}

fn hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn var_uint_goldens() {
    let file = load("varint.json");
    let cases = items(&file, "varuint");
    assert_eq!(cases.len(), 19, "varuint cases");
    for c in cases {
        let want = engine_number(field(c, "value")) as u64;
        let data = b64(c, "bytes");
        let mut reader = Reader::new(&data);
        let got = reader.read_var_uint();
        assert!(
            got == Ok(want) && reader.at_end(),
            "read {}: got {got:?}, want {want}",
            hex(&data)
        );
        let mut writer = Writer::default();
        writer.write_var_uint(want);
        assert_eq!(writer.bytes(), data, "write {want}");
    }
}

#[test]
fn var_int_goldens() {
    let file = load("varint.json");
    let cases = items(&file, "varint");
    assert_eq!(cases.len(), 22, "varint cases");
    for c in cases {
        let want = engine_number(field(c, "value"));
        let data = b64(c, "bytes");
        let mut reader = Reader::new(&data);
        let got = reader.read_var_int();
        assert!(
            got.as_ref().is_ok_and(|g| g.to_bits() == want.to_bits()) && reader.at_end(),
            "read {}: got {got:?}, want {want}",
            hex(&data)
        );
        let mut writer = Writer::default();
        writer.write_var_int(want);
        assert_eq!(writer.bytes(), data, "write {want}");
    }
}

#[test]
fn rejects_var_uint_past_2_pow_53() {
    let data = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10];
    assert!(Reader::new(&data).read_var_uint().is_err());
    let data = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00];
    assert!(Reader::new(&data).read_var_uint().is_err(), "nine bytes");
}

#[test]
fn rejects_var_int_past_2_pow_53() {
    // 2^53: 6 bits, then 7 per byte, so bit 53 is 0x20 of the eighth byte.
    let data = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x20];
    assert!(Reader::new(&data).read_var_int().is_err());
    let data = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00];
    assert!(Reader::new(&data).read_var_int().is_err(), "nine bytes");
}

#[test]
fn write_var_int_refuses_non_integers() {
    for bad in [0.5, nan(), f64::INFINITY, 9007199254740992.0] {
        let result = catch_unwind(AssertUnwindSafe(|| Writer::default().write_var_int(bad)));
        assert!(result.is_err(), "{bad}: no panic");
    }
}

#[test]
fn rejects_truncated_var_string() {
    assert!(Reader::new(&[0x05, 0x61, 0x62]).read_var_string().is_err());
}

#[test]
fn rejects_invalid_utf8() {
    for data in [
        &[0x02, 0xc3, 0x28][..],
        &[0x03, 0xed, 0xa0, 0x80], // CESU-8 surrogate
        &[0x02, 0xc0, 0x80],       // overlong NUL
    ] {
        assert!(
            Reader::new(data).read_var_string().is_err(),
            "{}",
            hex(data)
        );
    }
}

#[test]
fn round_trips_a_nul_bearing_string() {
    let mut writer = Writer::default();
    writer.write_var_string(&Str::from("a\0b"));
    assert_eq!(writer.bytes(), [0x03, 0x61, 0x00, 0x62]);
    let got = Reader::new(writer.bytes()).read_var_string().unwrap();
    assert_eq!(got.to_string(), "a\0b");
}

#[test]
fn writes_a_lone_surrogate_as_the_replacement_character() {
    let mut writer = Writer::default();
    writer.write_var_string(&[u16::from(b'a'), 0xd83d]);
    assert_eq!(writer.bytes(), [0x04, 0x61, 0xef, 0xbf, 0xbd]);
}

#[test]
fn reads_floats_big_endian() {
    let data = [
        0x3f, 0x00, 0x00, 0x00, 0x3f, 0xb9, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a,
    ];
    let mut reader = Reader::new(&data);
    assert_eq!(reader.read_float32(), Ok(0.5));
    assert_eq!(reader.read_float64(), Ok(0.1));
    assert!(reader.read_float32().is_err(), "past the end");
}

#[test]
fn rejects_var_bytes_past_the_buffer() {
    // A length near 2^53 must be refused before any slice is made.
    let data = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f];
    assert!(Reader::new(&data).read_var_bytes().is_err());
}

fn any_cases() -> Vec<Value> {
    let cases = items(&load("any.json"), "cases").to_vec();
    assert_eq!(cases.len(), 35, "any cases");
    cases
}

#[test]
fn reads_every_any_golden() {
    for c in any_cases() {
        let name = string(&c, "name");
        let data = b64(&c, "bytes");
        let Value::Number(tag) = field(&c, "tag") else {
            panic!("{name}: no tag")
        };
        assert_eq!(f64::from(data[0]), *tag, "{name}: tag");
        let mut reader = Reader::new(&data);
        let value = read_any(&mut reader).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            reader.at_end(),
            "{name}: {} bytes unread",
            reader.len() - reader.pos()
        );
        assert_eq!(
            canonical(&to_fixture(&value)),
            canonical(field(&c, "value")),
            "{name}"
        );
    }
}

#[test]
fn writes_every_any_golden() {
    let mut written = 0;
    for c in any_cases() {
        if matches!(field(&c, "decodeOnly"), Value::Bool(true)) {
            continue;
        }
        written += 1;
        let name = string(&c, "name");
        let mut writer = Writer::default();
        write_any(&mut writer, &to_engine(field(&c, "value")));
        assert_eq!(
            base64_encode(writer.bytes()),
            base64_encode(&b64(&c, "bytes")),
            "{name}"
        );
    }
    assert_eq!(written, 34, "writable cases");
}

fn write_any_bytes(value: &Value) -> Vec<u8> {
    let mut writer = Writer::default();
    write_any(&mut writer, value);
    writer.into_bytes()
}

#[test]
fn number_tags() {
    for (value, want) in [
        (-0.0, &[0x7d, 0x40][..]),
        // Go's math.NaN() bits.
        (
            f64::from_bits(0x7ff8000000000001),
            &[0x7b, 0x7f, 0xf8, 0, 0, 0, 0, 0, 0],
        ),
        (
            f64::from_bits(0xfff8000000000000),
            &[0x7b, 0x7f, 0xf8, 0, 0, 0, 0, 0, 0],
        ),
        (f64::INFINITY, &[0x7c, 0x7f, 0x80, 0, 0]),
        (2147483648.0, &[0x7c, 0x4f, 0, 0, 0]),
    ] {
        assert_eq!(write_any_bytes(&Value::Number(value)), want, "{value}");
    }
}

#[test]
fn object_keys_keep_insertion_order_and_undefined_round_trips() {
    for c in any_cases() {
        let name = string(&c, "name");
        if name != "object-order" && name != "object-undefined-member" {
            continue;
        }
        let data = b64(&c, "bytes");
        let value = read_any(&mut Reader::new(&data)).unwrap();
        let Value::Object(object) = &value else {
            panic!("{name}: not an object")
        };
        if name == "object-order" {
            assert_eq!(object.members()[0].key.to_string(), "b", "order lost");
        } else {
            assert_eq!(object.get(&Str::from("u")), Some(&Value::Undefined));
        }
        assert_eq!(write_any_bytes(&value), data, "{name}: rewrite");
    }
}

#[test]
fn repeated_object_key_keeps_its_first_place() {
    // {"a":1,"b":2,"a":3} on the wire.
    let data = [118, 3, 1, b'a', 125, 1, 1, b'b', 125, 2, 1, b'a', 125, 3];
    let value = read_any(&mut Reader::new(&data)).unwrap();
    assert_eq!(
        write_any_bytes(&value),
        [118, 2, 1, b'a', 125, 3, 1, b'b', 125, 2]
    );
}

fn nested_arrays(depth: usize) -> Vec<u8> {
    let mut data = Vec::with_capacity(depth * 2 + 1);
    for _ in 0..depth {
        data.extend([117, 1]);
    }
    data.push(126);
    data
}

#[test]
fn nested_depth_past_4096_rejects() {
    assert!(
        read_any(&mut Reader::new(&nested_arrays(4096))).is_ok(),
        "4096"
    );
    assert!(
        read_any(&mut Reader::new(&nested_arrays(4097))).is_err(),
        "4097"
    );
}

#[test]
fn unknown_any_tag_is_a_format_error() {
    assert!(read_any(&mut Reader::new(&[115])).is_err());
}

#[test]
#[ignore = "Value is a closed enum: every value write_any takes is an Any"]
fn write_any_refuses_non_any_values() {}

// A peer controls the depth. Reading and writing do not recurse; dropping
// the Value does, and measured 512 KiB-1 MiB in a debug build at 4096 levels
// (256-512 KiB in release). 1 MiB is half a tokio worker's stack.
#[test]
fn the_deepest_value_fits_half_a_worker_stack() {
    let data = nested_arrays(4096);
    let worker = std::thread::Builder::new()
        .stack_size(1024 * 1024)
        .spawn(move || {
            let value = read_any(&mut Reader::new(&data)).unwrap();
            assert_eq!(write_any_bytes(&value), data);
            drop(value);
            assert!(read_any(&mut Reader::new(&nested_arrays(4097))).is_err());
        })
        .unwrap();
    worker.join().unwrap();
}
