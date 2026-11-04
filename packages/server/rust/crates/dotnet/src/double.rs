/// double.ToString(InvariantCulture), which is also what
/// Utf8JsonWriter.WriteNumberValue writes: the shortest round-trip digits,
/// fixed when the decimal exponent is in -4..16, else d.dddE+XX with at
/// least two exponent digits.
pub fn format_double(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let sign = if value.is_sign_negative() { "-" } else { "" };
    let value = value.abs();
    if value == 0.0 {
        return format!("{sign}0");
    }
    // {:e} is the shortest round-trip form; {} is not.
    let text = format!("{value:e}");
    let (mantissa, exponent) = text.split_once('e').expect("{:e} has an exponent");
    let digits = mantissa.replacen('.', "", 1);
    let exponent: i32 = exponent.parse().expect("exponent");
    if !(-4..=16).contains(&exponent) {
        let mut out = digits[..1].to_string();
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let exponent_sign = if exponent < 0 { '-' } else { '+' };
        return format!("{sign}{out}E{exponent_sign}{:02}", exponent.abs());
    }
    if exponent < 0 {
        return format!("{sign}0.{}{digits}", "0".repeat((-exponent - 1) as usize));
    }
    let point = exponent as usize + 1;
    if digits.len() <= point {
        return format!("{sign}{digits}{}", "0".repeat(point - digits.len()));
    }
    format!("{sign}{}.{}", &digits[..point], &digits[point..])
}
