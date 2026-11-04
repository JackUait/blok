/// ulong.TryParse with NumberStyles.None and the invariant culture: ASCII
/// digits only, no sign or space, but trailing NULs are skipped (measured
/// with dotnet fsi: "1\0" parses, "\0" and "1\0x" do not).
pub fn parse_uint64_none(s: &str) -> Option<u64> {
    let digits = s.trim_end_matches('\0');
    if digits.is_empty() || !digits.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}
