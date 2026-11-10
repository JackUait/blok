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
