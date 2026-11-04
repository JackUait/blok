//! Ordered header lists with case-insensitive lookup.

/// Header lines in the order they came or were set. Names keep the case
/// they were given; every lookup ignores ASCII case.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Headers {
    entries: Vec<(String, String)>,
}

impl Headers {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The first value under name.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// Every value under name, in order.
    pub fn get_all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.entries
            .iter()
            .filter(move |(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn contains(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.entries.iter().map(|(n, v)| (n.as_str(), v.as_str()))
    }

    /// Adds a line after the others.
    pub fn add(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.entries.push((name.into(), value.into()));
    }

    /// Replaces every line under name with one, where the first one was.
    pub fn set(&mut self, name: impl Into<String>, value: impl Into<String>) {
        let name = name.into();
        let value = value.into();
        match self
            .entries
            .iter()
            .position(|(n, _)| n.eq_ignore_ascii_case(&name))
        {
            Some(at) => {
                self.entries[at] = (name.clone(), value);
                let mut index = 0;
                self.entries.retain(|(n, _)| {
                    index += 1;
                    index - 1 <= at || !n.eq_ignore_ascii_case(&name)
                });
            }
            None => self.entries.push((name, value)),
        }
    }

    pub fn remove(&mut self, name: &str) {
        self.entries.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// StringValues.GetCommaSeparatedValues: every value under name split on
    /// commas, trimmed of spaces and tabs, empty ones dropped.
    pub fn tokens<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.get_all(name)
            .flat_map(|value| value.split(','))
            .map(|token| token.trim_matches([' ', '\t']))
            .filter(|token| !token.is_empty())
    }

    /// Whether a comma-separated token under name equals want, ignoring
    /// ASCII case.
    pub fn has_token(&self, name: &str, want: &str) -> bool {
        self.tokens(name)
            .any(|token| token.eq_ignore_ascii_case(want))
    }
}

/// Kestrel's response header check: tab and 0x20-0x7E only. Setting any
/// other byte throws there, which ends the request with an empty 500.
pub fn is_field_value(value: &str) -> bool {
    value
        .bytes()
        .all(|c| c == b'\t' || (0x20..=0x7e).contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookups_ignore_case_and_keep_order() {
        let mut headers = Headers::new();
        headers.add("X-A", "1");
        headers.add("Host", "h");
        headers.add("x-a", "2");
        assert_eq!(headers.get("X-a"), Some("1"));
        assert_eq!(headers.get_all("X-A").collect::<Vec<_>>(), ["1", "2"]);
        headers.set("X-A", "3");
        assert_eq!(
            headers.iter().collect::<Vec<_>>(),
            [("X-A", "3"), ("Host", "h")]
        );
        headers.remove("HOST");
        assert_eq!(headers.len(), 1);
    }

    #[test]
    fn tokens_split_on_commas_over_every_line() {
        let mut headers = Headers::new();
        headers.add("Connection", "keep-alive, Upgrade");
        headers.add("Connection", " ,close\t");
        assert_eq!(
            headers.tokens("connection").collect::<Vec<_>>(),
            ["keep-alive", "Upgrade", "close"]
        );
        assert!(headers.has_token("Connection", "upgrade"));
        assert!(!headers.has_token("Connection", "clos"));
    }

    #[test]
    fn field_values_are_tab_and_printable_ascii() {
        assert!(is_field_value("a\tb ~"));
        assert!(!is_field_value("a\x01"));
        assert!(!is_field_value("a\x7f"));
        assert!(!is_field_value("\u{e9}"));
    }
}
