use blok_jsjson::{
    ErrorKind, NAN_BITS, Object, Options, Str, Value, compare, format_number, nan, parse,
    parse_node, stringify,
};

fn fixture_dir() -> String {
    format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/jsjson",
        env!("CARGO_MANIFEST_DIR")
    )
}

// An odd run of backslashes before u+D800..DFFF is a lone-surrogate escape
// that a lossy fixture reader would turn into U+FFFD.
fn has_surrogate_escape(data: &[u8]) -> bool {
    let hex = |c: u8| c.is_ascii_hexdigit();
    let mut i = 0;
    while i < data.len() {
        if data[i] != b'\\' {
            i += 1;
            continue;
        }
        let start = i;
        while i < data.len() && data[i] == b'\\' {
            i += 1;
        }
        let odd = (i - start) % 2 == 1;
        if odd
            && i + 4 < data.len()
            && data[i] == b'u'
            && (data[i + 1] == b'd' || data[i + 1] == b'D')
            && matches!(data[i + 2], b'8'..=b'9' | b'a'..=b'f' | b'A'..=b'F')
            && hex(data[i + 3])
            && hex(data[i + 4])
        {
            return true;
        }
    }
    false
}

fn read_fixture(name: &str) -> Value {
    let path = format!("{}/{}", fixture_dir(), name);
    let data = std::fs::read(&path)
        .unwrap_or_else(|e| panic!("{path}: {e}; run node scripts/generate-jsjson-fixtures.mjs"));
    assert!(
        !has_surrogate_escape(&data),
        "{name} holds a surrogate escape outside a string; write it as hex units"
    );
    parse(&data).unwrap()
}

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => object.get(&Str::from(key)),
        _ => None,
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    match field(value, key) {
        Some(Value::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    match field(value, key) {
        Some(Value::Array(items)) => items,
        _ => &[],
    }
}

fn units_of(hex_units: &str) -> Str {
    let raw = hex_units.as_bytes();
    assert!(raw.len().is_multiple_of(4), "bad units {hex_units:?}");
    Str(raw
        .chunks(4)
        .map(|chunk| u16::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap())
        .collect())
}

fn bytes_of(hex: &str) -> Vec<u8> {
    hex.as_bytes()
        .chunks(2)
        .map(|chunk| u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap())
        .collect()
}

fn number_of(bits: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(bits, 16).unwrap())
}

// build turns a fixture value spec into a JS value (see the generator).
fn build(spec: &Value) -> Value {
    match spec {
        Value::Null | Value::Bool(_) => return spec.clone(),
        Value::Object(_) => {
            if let Some(bits) = text(spec, "n") {
                return Value::Number(number_of(&bits));
            }
            if let Some(units) = text(spec, "s") {
                return Value::String(units_of(&units));
            }
            if field(spec, "u").is_some_and(|u| *u != Value::Null) {
                return Value::Undefined;
            }
            if let Some(Value::Array(list)) = field(spec, "a") {
                return Value::Array(list.iter().map(build).collect());
            }
            if let Some(Value::Array(list)) = field(spec, "o") {
                let mut object = Object::default();
                for member in list {
                    let Value::Array(pair) = member else {
                        panic!("bad member {member:?}")
                    };
                    let Value::String(key) = &pair[0] else {
                        panic!("bad key {pair:?}")
                    };
                    object.set(units_of(&key.to_string()), build(&pair[1]));
                }
                return Value::Object(object);
            }
        }
        _ => {}
    }
    panic!("bad value spec {spec:?}")
}

#[test]
fn format_number_matches_node() {
    let fixture = read_fixture("js.json");
    let numbers = items(&fixture, "numbers");
    assert!(numbers.len() >= 1000, "only {} numbers", numbers.len());
    let mut failures = Vec::new();
    for pair in numbers {
        let Value::Array(pair) = pair else { panic!() };
        let (Value::String(bits), Value::String(node)) = (&pair[0], &pair[1]) else {
            panic!()
        };
        let (bits, node) = (bits.to_string(), node.to_string());
        let number = number_of(&bits);
        // String(x) for the non-finite; JSON.stringify writes them as null.
        let mut want = node.clone();
        if number.is_nan() {
            want = "null".into();
            assert_eq!(node, "NaN", "{bits}: node wrote {node:?}");
        } else if number.is_infinite() {
            want = "null".into();
        }
        let got = format_number(number);
        if got != want {
            failures.push(format!(
                "format_number({bits} = {number}) = {got:?}, want {want:?}"
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn nan_bits_match_node() {
    let fixture = read_fixture("js.json");
    assert_eq!(
        format!("{:x}", nan().to_bits()),
        text(&fixture, "nanBits").unwrap()
    );
    assert_eq!(NAN_BITS, 0x7ff8000000000000);
}

#[test]
fn stringify_matches_node() {
    let fixture = read_fixture("js.json");
    let mut failures = Vec::new();
    for entry in items(&fixture, "stringify") {
        let name = text(entry, "name").unwrap();
        let got = stringify(&build(field(entry, "value").unwrap_or(&Value::Null)));
        match text(entry, "json") {
            None => {
                if let Ok(got) = got {
                    failures.push(format!("{name}: stringify = {got:?}, want an error"));
                }
            }
            Some(want) => {
                if got.as_deref() != Ok(want.as_str()) {
                    failures.push(format!("{name}: stringify = {got:?}; want {want:?}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn parse_matches_node() {
    let fixture = read_fixture("js.json");
    let mut failures = Vec::new();
    for entry in items(&fixture, "parse") {
        let name = text(entry, "name").unwrap();
        let input = text(entry, "text").unwrap();
        let value = parse(input.as_bytes());
        let Some(want) = text(entry, "json") else {
            if value.is_ok() {
                failures.push(format!("{name}: parse accepted {input:?}"));
            }
            continue;
        };
        // C# validates with JsonDocument at depth 512 first; JS has no limit.
        if name == "depth 513 (JS has no limit)" {
            if !value.as_ref().is_err_and(|e| e.kind() == ErrorKind::Depth) {
                failures.push(format!("{name}: parse gave {value:?}, want Depth like C#"));
            }
            continue;
        }
        match value {
            Err(e) => failures.push(format!("{name}: parse error {e}")),
            Ok(value) => {
                let got = stringify(&value);
                if got.as_deref() != Ok(want.as_str()) {
                    failures.push(format!("{name}: stringify(parse) = {got:?}; want {want:?}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

enum Outcome {
    Text(String),
    Error(ErrorKind),
}

fn outcome(value: Option<&Value>) -> Option<Outcome> {
    match value? {
        Value::String(s) => Some(Outcome::Text(s.to_string())),
        failed => Some(Outcome::Error(error_kind(&text(failed, "error").unwrap()))),
    }
}

fn error_kind(name: &str) -> ErrorKind {
    match name {
        "invalid" => ErrorKind::Invalid,
        "depth" => ErrorKind::Depth,
        "duplicate" => ErrorKind::Duplicate,
        "loneSurrogate" => ErrorKind::LoneSurrogate,
        "invalidUtf8" => ErrorKind::InvalidUtf8,
        _ => panic!("unknown error kind {name:?}"),
    }
}

fn check_outcome(
    failures: &mut Vec<String>,
    name: &str,
    what: &str,
    got: Result<Vec<u8>, blok_jsjson::Error>,
    want: Option<Outcome>,
) {
    let Some(want) = want else {
        panic!("{name}: fixture has no {what}")
    };
    match want {
        Outcome::Text(want) => match &got {
            Ok(bytes) if *bytes == want.as_bytes() => {}
            _ => failures.push(format!("{name}: {what} = {got:?}; want {want:?}")),
        },
        Outcome::Error(kind) => {
            if !got.as_ref().is_err_and(|e| e.kind() == kind) {
                failures.push(format!("{name}: {what} = {got:?}; want {kind:?}"));
            }
        }
    }
}

#[test]
fn node_matches_system_text_json() {
    let fixture = read_fixture("dotnet.json");
    let mut failures = Vec::new();
    for entry in items(&fixture, "documents") {
        let name = text(entry, "name").unwrap();
        let data = match text(entry, "text") {
            Some(text) => text.into_bytes(),
            None => bytes_of(&text(entry, "hex").unwrap()),
        };
        let max_depth = match field(entry, "maxDepth") {
            Some(Value::Number(n)) => *n as usize,
            _ => 0,
        };
        let refuse_duplicates = matches!(field(entry, "refuseDuplicates"), Some(Value::Bool(true)));
        let node = parse_node(
            &data,
            Options {
                max_depth,
                refuse_duplicates,
            },
        );
        let parse_want = text(entry, "parse").unwrap();
        if parse_want != "ok" {
            check_outcome(
                &mut failures,
                &name,
                "parse",
                node.map(|_| Vec::new()),
                Some(Outcome::Error(error_kind(&parse_want))),
            );
            continue;
        }
        let node = match node {
            Ok(node) => node,
            Err(e) => {
                failures.push(format!("{name}: parse_node error {e}"));
                continue;
            }
        };
        let mut written = Vec::new();
        let result = node.append_json(&mut written).map(|()| written);
        check_outcome(
            &mut failures,
            &name,
            "write",
            result,
            outcome(field(entry, "write")),
        );
        let mut canonical = Vec::new();
        let result = node.append_canonical(&mut canonical).map(|()| canonical);
        check_outcome(
            &mut failures,
            &name,
            "canonical",
            result,
            outcome(field(entry, "canonical")),
        );
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn quoted_matches_system_text_json() {
    let fixture = read_fixture("dotnet.json");
    let mut failures = Vec::new();
    for entry in items(&fixture, "strings") {
        let name = text(entry, "name").unwrap();
        let mut got = Vec::new();
        blok_jsjson::append_quoted(&mut got, &units_of(&text(entry, "units").unwrap()));
        check_outcome(
            &mut failures,
            &name,
            "quote",
            Ok(got),
            outcome(field(entry, "json")),
        );
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// .NET output is pure ASCII, so a byte count is a UTF-16 count: the agent's
// ToJsonString().Length caps become len() in Rust.
#[test]
fn dotnet_output_is_ascii() {
    let node = parse_node(
        "{\"t\":\"🚀<a>&'+é\",\"n\":1}".as_bytes(),
        Options::default(),
    )
    .unwrap();
    let mut written = Vec::new();
    node.append_json(&mut written).unwrap();
    assert!(written.is_ascii(), "non-ASCII byte in {written:?}");
    let want = "{\"t\":\"\\uD83D\\uDE80\\u003Ca\\u003E\\u0026\\u0027\\u002B\\u00E9\",\"n\":1}";
    assert_eq!(String::from_utf8(written).unwrap(), want);
}

#[test]
fn compare_uses_utf16_units() {
    let (emoji, fullwidth) = (Str::from("😀"), Str::from("～"));
    assert!(
        compare(&emoji, &fullwidth).is_lt(),
        "U+1F600 must sort before U+FF5E by UTF-16 units"
    );
    assert!(compare(&Str::from("a"), &Str::from("ab")).is_lt());
    assert!(compare(&Str::from("b"), &Str::from("b")).is_eq());
}

#[test]
fn str_round_trips_and_replaces_lone_surrogates() {
    assert_eq!(Str::from("a😀é").to_string(), "a😀é");
    assert_eq!(
        Str(vec![u16::from(b'a'), 0xd800, u16::from(b'b')]).to_string(),
        "a\u{fffd}b"
    );
    assert_eq!(Str::from("😀").len(), 2);
}

#[test]
fn object_set_keeps_first_place_and_last_value() {
    let mut object = Object::default();
    object.set(Str::from("a"), Value::Number(1.0));
    object.set(Str::from("b"), Value::Number(2.0));
    object.set(Str::from("a"), Value::Number(3.0));
    let object = Value::Object(object);
    assert_eq!(stringify(&object).unwrap(), r#"{"a":3,"b":2}"#);
    assert_eq!(field(&object, "a"), Some(&Value::Number(3.0)));
}

// Go also refuses a Go string, an int and a map; Value cannot hold those.
#[test]
fn stringify_refuses_values_with_no_json_form() {
    for value in [Value::Bytes(vec![1]), Value::BigInt(1), Value::Undefined] {
        let got = stringify(&value);
        assert!(
            got.as_ref()
                .is_err_and(|e| e.kind() == ErrorKind::NoJsonForm),
            "stringify({value:?}) = {got:?}, want an error"
        );
    }
    let nested = Value::Array(vec![Value::BigInt(1)]);
    assert!(stringify(&nested).is_err());
}

#[test]
fn from_utf8_replaces_each_maximal_subpart() {
    assert_eq!(Str::from_utf8(b"a\xf0\x9f\x98").to_string(), "a\u{fffd}");
    assert_eq!(
        Str::from_utf8(b"\xed\xa0\x80").to_string(),
        "\u{fffd}\u{fffd}\u{fffd}"
    );
}

// When two shortest candidates are equally close, Number::toString takes the
// even one. Measured with node 24: String(x).
#[test]
fn format_number_rounds_ties_to_even() {
    for (bits, want) in [
        (0x4310_62ad_46fe_948d_u64, "1153023996831011.2"),
        (0xc305_0c0e_8643_0b8a_u64, "-740528879067505.2"),
    ] {
        assert_eq!(format_number(f64::from_bits(bits)), want, "{bits:x}");
    }
}
