use crate::uri::unescape_data_string;

/// HttpRequest.Query[key].FirstOrDefault() ?? "" in ASP.NET Core 10: pairs
/// split on '&' only (';' is data), name and value split on the first '=',
/// '+' becomes a space, then Uri.UnescapeDataString (a bad escape stays as
/// written), and names compare OrdinalIgnoreCase. key must be ASCII.
/// raw_query is the text after the first '?'.
pub fn query_first(raw_query: &str, key: &str) -> String {
    query_all(raw_query, key)
        .into_iter()
        .next()
        .unwrap_or_default()
}

/// Every value HttpRequest.Query[key] holds, in order, parsed as
/// `query_first` says. Names that differ only in ASCII case share one list.
pub fn query_all(raw_query: &str, key: &str) -> Vec<String> {
    let mut values = Vec::new();
    for pair in raw_query.split('&') {
        let (name, value) = match pair.split_once('=') {
            Some(split) => split,
            None if pair.is_empty() => continue,
            None => (pair, ""),
        };
        if decode_query_part(name).eq_ignore_ascii_case(key) {
            values.push(decode_query_part(value));
        }
    }
    values
}

fn decode_query_part(s: &str) -> String {
    if !s.contains(['%', '+']) {
        return s.to_string();
    }
    unescape_data_string(&s.replace('+', " "))
}
