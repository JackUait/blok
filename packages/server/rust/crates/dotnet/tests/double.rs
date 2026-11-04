mod common;

use blok_dotnet::format_double;
use common::{items, load, string};

// The doubles C# writes, from fixtures/canonical-edit-digest.json.
#[test]
fn formats_doubles_like_dotnet() {
    let fixture = load("canonical-edit-digest.json");
    let doubles = items(&fixture, "doubles");
    assert!(!doubles.is_empty(), "no doubles");
    let mut failures = Vec::new();
    for c in doubles {
        // Signed decimal int64 bits.
        let bits: i64 = string(c, "bits").parse().unwrap();
        let value = f64::from_bits(bits as u64);
        let (invariant, json) = (string(c, "invariant"), string(c, "json"));
        let got = format_double(value);
        if got != invariant || got != json {
            failures.push(format!("{value}: {got}, want {invariant} (json {json})"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Measured with .NET 10 (dotnet fsi): ties between two shortest candidates
// go to the even one.
#[test]
fn formats_ties_to_even_like_dotnet() {
    for (bits, want) in [
        (4832470896528495757_u64, "1153023996831011.2"),
        (14052651468801117066_u64, "-740528879067505.2"),
    ] {
        assert_eq!(format_double(f64::from_bits(bits)), want, "{bits}");
    }
}

// Measured with .NET 10.0.11 on arm64 over every power of two: these two
// print 16 digits that do not round-trip, in ToString and Utf8JsonWriter.
#[test]
fn formats_the_two_powers_of_two_dotnet_misprints() {
    for (exponent, want) in [
        (-958, "4.104536801298376E-289"),
        (-25, "2.980232238769531E-08"),
    ] {
        let value = 2f64.powi(exponent);
        assert_eq!(format_double(value), want, "2^{exponent}");
        assert_eq!(format_double(-value), format!("-{want}"), "-2^{exponent}");
    }
}
