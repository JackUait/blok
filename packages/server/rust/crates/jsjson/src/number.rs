/// The NaN yjs writes. Rust's `f64::NAN` bits are not guaranteed and .NET's
/// double.NaN is 0xfff8000000000000, so write these bits explicitly.
pub const NAN_BITS: u64 = 0x7ff8000000000000;

/// The NaN with [`NAN_BITS`].
pub fn nan() -> f64 {
    f64::from_bits(NAN_BITS)
}

/// Splits `{:e}` output (the shortest round-trip digits) into the digits
/// without trailing zeros and the decimal exponent.
pub(crate) fn shortest_digits(magnitude: f64) -> (String, i32) {
    let shortest = format!("{magnitude:e}");
    let (mantissa, exponent) = shortest.split_once('e').expect("{:e} has an exponent");
    let digits = mantissa
        .replacen('.', "", 1)
        .trim_end_matches('0')
        .to_string();
    (digits, exponent.parse().expect("exponent"))
}

/// What JSON.stringify writes for a number: Number::toString on the
/// shortest round-trip digits, and null for NaN and ±Infinity.
pub fn format_number(number: f64) -> String {
    if !number.is_finite() {
        return "null".into();
    }
    if number == 0.0 {
        return "0".into();
    }
    let (digits, exponent) = shortest_digits(number.abs());
    // n: where the decimal point sits after the first digit.
    let n = exponent + 1;
    let k = digits.len() as i32;
    let mut out = String::new();
    if number < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.push_str(&"0".repeat((n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.push_str(&"0".repeat((-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        if n > 0 {
            out.push('+');
        }
        out.push_str(&(n - 1).to_string());
    }
    out
}
