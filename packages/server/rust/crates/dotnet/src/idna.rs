//! UTS 46 ToASCII as Go's idna.New(MapForLookup(), StrictDomainName(false),
//! VerifyDNSLength(false)) does it (golang.org/x/net/idna v0.62.0): the
//! nontransitional mapping, NFC, CheckHyphens on bytes, CheckJoiners, empty
//! labels allowed, and no bidi rule. .NET's Uri.IdnHost also skips the bidi
//! rule; the `idna` crate cannot, which is why this is not that crate. The
//! Unicode tables come from idna_adapter 1.1 (the unicode-rs back end).

use idna_adapter::{Adapter, LEFT_OR_DUAL_JOINING_MASK, RIGHT_OR_DUAL_JOINING_MASK};

const ACE_PREFIX: &str = "xn--";
const ZWJ: char = '\u{200d}';
const ZWNJ: char = '\u{200c}';

/// The ASCII form of `host`, or None where Go's ToASCII returns an error.
pub(crate) fn to_ascii(host: &str) -> Option<String> {
    let adapter = Adapter::new();
    // Disallowed and unassigned chars map to U+FFFD, which is itself
    // disallowed, so validate_label refuses them.
    let mapped: String = adapter.map_normalize(host.chars()).collect();
    let mut labels: Vec<String> = mapped.split('.').map(str::to_string).collect();
    for label in labels.iter_mut() {
        if label.is_empty() {
            continue;
        }
        if let Some(encoded) = label.strip_prefix(ACE_PREFIX) {
            let decoded = decode(encoded)?;
            if !decoded.is_empty() && decoded.is_ascii() {
                return None;
            }
            // NFC and every char valid: the validating mapper changes nothing.
            if !adapter
                .normalize_validate(decoded.chars())
                .eq(decoded.chars())
            {
                return None;
            }
            *label = decoded;
        }
        if !validate_label(&adapter, label) {
            return None;
        }
    }
    for label in labels.iter_mut() {
        if !label.is_ascii() {
            *label = encode(ACE_PREFIX, label)?;
        }
    }
    Some(labels.join("."))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Join {
    None,
    L,
    D,
    T,
    R,
    Zwj,
    Zwnj,
    Virama,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Start,
    Virama,
    Before,
    BeforeVirama,
    After,
    Fail,
}

/// Go's joinStates. A missing entry in Go's table is stateStart.
fn next_state(state: State, join: Join) -> State {
    use Join as J;
    use State as S;
    match (state, join) {
        (S::Start, J::L | J::D) => S::Before,
        (S::Start, J::Zwnj | J::Zwj) => S::Fail,
        (S::Start, J::Virama) => S::Virama,
        (S::Virama, J::L | J::D) => S::Before,
        (S::Before, J::L | J::D | J::T) => S::Before,
        (S::Before, J::Zwnj) => S::After,
        (S::Before, J::Zwj) => S::Fail,
        (S::Before, J::Virama) => S::BeforeVirama,
        (S::BeforeVirama, J::L | J::D | J::T) => S::Before,
        (S::After, J::L | J::Zwnj | J::Zwj) => S::Fail,
        (S::After, J::D) => S::Before,
        (S::After, J::T | J::Virama) => S::After,
        (S::After, J::R) => S::Start,
        (S::Fail, _) => S::Fail,
        _ => S::Start,
    }
}

/// Only L, D, T and R count, as in Go's table (C and U are none).
fn join_type(adapter: &Adapter, c: char) -> Join {
    let joining = adapter.joining_type(c);
    if joining.is_transparent() {
        return Join::T;
    }
    let mask = joining.to_mask();
    match (
        mask.intersects(LEFT_OR_DUAL_JOINING_MASK),
        mask.intersects(RIGHT_OR_DUAL_JOINING_MASK),
    ) {
        (true, true) => Join::D,
        (true, false) => Join::L,
        (false, true) => Join::R,
        (false, false) => Join::None,
    }
}

/// Go's validateLabel for the profile: hyphens on bytes, every char valid,
/// no leading mark, and the ContextJ rules for the joiners.
fn validate_label(adapter: &Adapter, label: &str) -> bool {
    let b = label.as_bytes();
    if b.is_empty() {
        return true;
    }
    if b.len() > 4 && b[2] == b'-' && b[3] == b'-' {
        return false;
    }
    if b[0] == b'-' || b[b.len() - 1] == b'-' {
        return false;
    }
    if label.contains('\u{fffd}') {
        return false;
    }
    if label.chars().next().is_some_and(|c| adapter.is_mark(c)) {
        return false;
    }
    if !label.contains([ZWJ, ZWNJ]) {
        return true;
    }
    let mut state = State::Start;
    for c in label.chars() {
        let join = match c {
            ZWJ => Join::Zwj,
            ZWNJ => Join::Zwnj,
            _ => join_type(adapter, c),
        };
        state = next_state(state, join);
        if adapter.is_virama(c) {
            state = next_state(state, Join::Virama);
        }
    }
    state != State::Fail && state != State::After
}

const BASE: i32 = 36;
const DAMP: i32 = 700;
const INITIAL_BIAS: i32 = 72;
const INITIAL_N: i32 = 128;
const SKEW: i32 = 38;
const TMAX: i32 = 26;
const TMIN: i32 = 1;

fn madd(a: i32, b: i32, c: i32) -> Option<i32> {
    let p = i64::from(b) * i64::from(c);
    if p > i64::from(i32::MAX) - i64::from(a) {
        return None;
    }
    Some(a + p as i32)
}

fn threshold(k: i32, bias: i32) -> i32 {
    if k <= bias {
        TMIN
    } else if k >= bias + TMAX {
        TMAX
    } else {
        k - bias
    }
}

fn adapt(mut delta: i32, points: i32, first: bool) -> i32 {
    delta /= if first { DAMP } else { 2 };
    delta += delta / points;
    let mut k = 0;
    while delta > ((BASE - TMIN) * TMAX) / 2 {
        delta /= BASE - TMIN;
        k += BASE;
    }
    k + (BASE - TMIN + 1) * delta / (delta + SKEW)
}

/// Go's punycode decode: a surrogate decodes to U+FFFD, as Go's
/// string([]rune) writes it.
fn decode(encoded: &str) -> Option<String> {
    if encoded.is_empty() {
        return Some(String::new());
    }
    let b = encoded.as_bytes();
    let mut pos = encoded.rfind('-').map_or(0, |at| at + 1);
    if pos == 1 {
        return None;
    }
    if pos == b.len() {
        return Some(encoded[..b.len() - 1].to_string());
    }
    let mut output: Vec<u32> = Vec::with_capacity(b.len());
    if pos != 0 {
        output.extend(encoded[..pos - 1].chars().map(u32::from));
    }
    let (mut i, mut n, mut bias) = (0i32, INITIAL_N, INITIAL_BIAS);
    while pos < b.len() {
        let (old_i, mut w) = (i, 1i32);
        let mut k = BASE;
        loop {
            let digit = decode_digit(*b.get(pos)?)?;
            pos += 1;
            i = madd(i, digit, w)?;
            let t = threshold(k, bias);
            if digit < t {
                break;
            }
            w = madd(0, w, BASE - t)?;
            k += BASE;
        }
        if output.len() >= 1024 {
            return None;
        }
        let x = output.len() as i32 + 1;
        bias = adapt(i - old_i, x, old_i == 0);
        n += i / x;
        i %= x;
        if !(0..=0x10ffff).contains(&n) {
            return None;
        }
        output.insert(i as usize, n as u32);
        i += 1;
    }
    Some(
        output
            .into_iter()
            .map(|u| char::from_u32(u).unwrap_or('\u{fffd}'))
            .collect(),
    )
}

fn decode_digit(x: u8) -> Option<i32> {
    match x {
        b'0'..=b'9' => Some(i32::from(x) - i32::from(b'0') + 26),
        b'A'..=b'Z' => Some(i32::from(x - b'A')),
        b'a'..=b'z' => Some(i32::from(x - b'a')),
        _ => None,
    }
}

fn encode_digit(digit: i32) -> char {
    match digit {
        0..26 => char::from(b'a' + digit as u8),
        26..36 => char::from(b'0' + (digit - 26) as u8),
        _ => unreachable!("punycode digit {digit}"),
    }
}

/// Go's punycode encode; U+FFFD is refused.
fn encode(prefix: &str, s: &str) -> Option<String> {
    let mut output = String::from(prefix);
    let (mut delta, mut n, mut bias) = (0i32, INITIAL_N, INITIAL_BIAS);
    let (mut basic, mut remaining) = (0i32, 0i32);
    for c in s.chars() {
        if c == '\u{fffd}' {
            return None;
        }
        if c.is_ascii() {
            basic += 1;
            output.push(c);
        } else {
            remaining += 1;
        }
    }
    let mut h = basic;
    if basic > 0 {
        output.push('-');
    }
    while remaining != 0 {
        let m = s
            .chars()
            .map(|c| c as i32)
            .filter(|&r| r >= n)
            .min()
            .unwrap_or(i32::MAX);
        delta = madd(delta, m - n, h + 1)?;
        n = m;
        for r in s.chars().map(|c| c as i32) {
            if r < n {
                delta += 1;
                if delta < 0 {
                    return None;
                }
                continue;
            }
            if r > n {
                continue;
            }
            let mut q = delta;
            let mut k = BASE;
            loop {
                let t = threshold(k, bias);
                if q < t {
                    break;
                }
                output.push(encode_digit(t + (q - t) % (BASE - t)));
                q = (q - t) / (BASE - t);
                k += BASE;
            }
            output.push(encode_digit(q));
            bias = adapt(delta, h + 1, h == basic);
            delta = 0;
            h += 1;
            remaining -= 1;
        }
        delta += 1;
        n += 1;
    }
    Some(output)
}
