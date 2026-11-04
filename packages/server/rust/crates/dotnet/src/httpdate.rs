use std::time::SystemTime;

use crate::ticks::{days_from_civil, from_unix};

/// Microsoft.Net.Http.Headers.HttpRuleParser.DateFormats (ASP.NET Core
/// 10.0.11, read with ilspycmd), tried in this order with
/// DateTimeStyles.AllowWhiteSpaces | AssumeUniversal. TryStringToDate tries
/// the "r" format first; that fast path accepts a subset of the first entry
/// here, to the same instant, so it is left out.
const HTTP_DATE_FORMATS: [&str; 16] = [
    "ddd, d MMM yyyy H:m:s 'GMT'",
    "ddd, d MMM yyyy H:m:s",
    "d MMM yyyy H:m:s 'GMT'",
    "d MMM yyyy H:m:s",
    "ddd, d MMM yy H:m:s 'GMT'",
    "ddd, d MMM yy H:m:s",
    "d MMM yy H:m:s 'GMT'",
    "d MMM yy H:m:s",
    "dddd, d'-'MMM'-'yy H:m:s 'GMT'",
    "dddd, d'-'MMM'-'yy H:m:s",
    "ddd, d'-'MMM'-'yyyy H:m:s 'GMT'",
    "ddd MMM d H:m:s yyyy",
    "ddd, d MMM yyyy H:m:s zzz",
    "ddd, d MMM yyyy H:m:s",
    "d MMM yyyy H:m:s zzz",
    "d MMM yyyy H:m:s",
];

const MONTH_ABBREVIATIONS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const DAY_ABBREVIATIONS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES: [&str; 7] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];

/// HeaderUtilities.TryParseDate: DateTimeOffset.TryParseExact over the
/// HTTP date formats with the invariant culture. It ports the parts of
/// DateTimeParse.DoStrictParse those formats reach.
pub fn parse_http_date(s: &str) -> Option<SystemTime> {
    if s.is_empty() {
        return None;
    }
    let input: Vec<char> = s.chars().collect();
    HTTP_DATE_FORMATS.iter().find_map(|format| {
        let format: Vec<char> = format.chars().collect();
        parse_exact(&input, &format)
    })
}

/// __DTString: the index starts at -1 and every step pre-increments.
struct Cursor {
    v: Vec<char>,
    i: isize,
}

/// .NET's char.IsWhiteSpace; Rust's char::is_whitespace is the same set as
/// Go's unicode.IsSpace (checked over every char, Unicode 17).
fn is_space(c: char) -> bool {
    c.is_whitespace()
}

impl Cursor {
    fn len(&self) -> isize {
        self.v.len() as isize
    }

    fn at(&self, i: isize) -> char {
        self.v[i as usize]
    }

    fn next(&mut self) -> bool {
        self.i += 1;
        self.i < self.len()
    }

    fn char(&self) -> char {
        self.at(self.i)
    }

    /// __DTString.Match(char): a format space also takes NBSP or U+202F.
    fn matches(&mut self, ch: char) -> bool {
        self.i += 1;
        if self.i >= self.len() {
            return false;
        }
        let c = self.char();
        if c == ch || (ch == ' ' && (c == '\u{a0}' || c == '\u{202f}')) {
            return true;
        }
        self.i -= 1;
        false
    }

    fn skip_white(&mut self) {
        while self.i + 1 < self.len() && is_space(self.at(self.i + 1)) {
            self.i += 1;
        }
    }

    fn trim_tail(&mut self) {
        while self.v.last().is_some_and(|&c| is_space(c)) {
            self.v.pop();
        }
    }

    fn repeat_count(&mut self) -> usize {
        let ch = self.char();
        let mut j = self.i + 1;
        while j < self.len() && self.at(j) == ch {
            j += 1;
        }
        let n = (j - self.i) as usize;
        self.i = j - 1;
        n
    }

    /// DateTimeParse.ParseDigits(min, max): ASCII digits only.
    fn digits(&mut self, min: usize, max: usize) -> Option<i32> {
        let start = self.i;
        let mut n = 0;
        let mut k = 0;
        while k < max {
            self.i += 1;
            if self.i >= self.len() || !self.char().is_ascii_digit() {
                self.i -= 1;
                break;
            }
            n = n * 10 + (u32::from(self.char()) - u32::from('0')) as i32;
            k += 1;
        }
        if k < min {
            self.i = start;
            return None;
        }
        Some(n)
    }

    /// ParseDigits(digitLen): one means one or two digits.
    fn digit_len(&mut self, n: usize) -> Option<i32> {
        if n == 1 {
            self.digits(1, 2)
        } else {
            self.digits(n, n)
        }
    }

    /// The invariant fast path: three ASCII chars, OR 0x20.
    fn three_letters(&mut self, names: &[&str]) -> Option<usize> {
        if !self.next() || self.len() - self.i < 3 {
            return None;
        }
        let mut key = [0u8; 3];
        for (k, slot) in key.iter_mut().enumerate() {
            let c = self.at(self.i + k as isize);
            if !c.is_ascii() {
                return None;
            }
            *slot = c as u8 | 0x20;
        }
        names.iter().position(|name| key == name.as_bytes()[..3])
    }

    fn abbreviation(&mut self, names: &[&str]) -> Option<usize> {
        let index = self.three_letters(names)?;
        self.i += 2;
        Some(index)
    }

    /// MatchDayName: SetIfStartsWith compares OrdinalIgnoreCase, which folds
    /// ASCII only here (.NET rejects "Tueſday", see http-dates.json).
    fn day_name(&mut self) -> Option<usize> {
        let index = self.three_letters(&DAY_ABBREVIATIONS)?;
        let name = DAY_NAMES[index].as_bytes();
        if self.len() - self.i < name.len() as isize {
            return None;
        }
        for (k, &want) in name.iter().enumerate() {
            let c = self.at(self.i + k as isize);
            if !c.is_ascii() || c as u8 | 0x20 != want {
                return None;
            }
        }
        self.i += name.len() as isize - 1;
        Some(index)
    }

    /// ParseTimeZoneOffset for "zzz": sign, one or two hour digits, an
    /// optional ':', then exactly two minute digits below 60. No inner
    /// spaces.
    fn offset(&mut self) -> Option<i32> {
        if !self.next() {
            return None;
        }
        let sign = match self.char() {
            '+' => 1,
            '-' => -1,
            _ => return None,
        };
        let hours = self.digits(1, 2)?;
        self.matches(':');
        let minutes = self.digits(2, 2).filter(|&minutes| minutes < 60)?;
        Some(sign * (hours * 60 + minutes))
    }
}

fn days_in_month(year: i32, month: i32) -> i32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn parse_exact(input: &[char], format: &[char]) -> Option<SystemTime> {
    let mut str = Cursor {
        v: input.to_vec(),
        i: -1,
    };
    let mut f = Cursor {
        v: format.to_vec(),
        i: -1,
    };
    str.trim_tail();
    str.skip_white();
    let (mut year, mut month, mut day, mut hour, mut minute, mut second) = (-1, -1, -1, -1, -1, -1);
    let mut weekday: Option<usize> = None;
    let mut offset_minutes = 0;
    let mut two_digit_year = false;
    while f.next() {
        str.skip_white();
        let ch = f.char();
        let ok = match ch {
            'y' => {
                let n = f.repeat_count();
                two_digit_year = n <= 2;
                str.digit_len(n).map(|v| year = v).is_some()
            }
            'M' => {
                if f.repeat_count() != 3 {
                    return None;
                }
                str.abbreviation(&MONTH_ABBREVIATIONS)
                    .map(|v| month = v as i32 + 1)
                    .is_some()
            }
            'd' => match f.repeat_count() {
                n @ 1..=2 => str.digit_len(n).map(|v| day = v).is_some(),
                3 => str
                    .abbreviation(&DAY_ABBREVIATIONS)
                    .map(|v| weekday = Some(v))
                    .is_some(),
                _ => str.day_name().map(|v| weekday = Some(v)).is_some(),
            },
            'H' | 'm' | 's' => {
                let n = f.repeat_count().min(2);
                match str.digit_len(n) {
                    Some(v) => {
                        match ch {
                            'H' => hour = v,
                            'm' => minute = v,
                            _ => second = v,
                        }
                        true
                    }
                    None => false,
                }
            }
            'z' => {
                if f.repeat_count() != 3 {
                    return None;
                }
                str.offset().map(|v| offset_minutes = v).is_some()
            }
            ':' => str.matches(':'),
            '\'' => {
                let mut ok = true;
                while f.next() && f.char() != '\'' {
                    if is_space(f.char()) {
                        str.skip_white();
                    } else if !str.matches(f.char()) {
                        ok = false;
                        break;
                    }
                }
                ok
            }
            _ => is_space(ch) || str.matches(ch),
        };
        if !ok {
            return None;
        }
    }
    if str.i < str.len() - 1 {
        return None;
    }
    if two_digit_year {
        // The invariant calendar's TwoDigitYearMax is 2049.
        year += if year > 49 { 1900 } else { 2000 };
    }
    if !(1..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day < 1
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    if day > days_in_month(year, month) {
        return None;
    }
    let days = days_from_civil(i64::from(year), month as u32, day as u32);
    // 1970-01-01 was a Thursday.
    if weekday.is_some_and(|weekday| weekday as i64 != (days + 4).rem_euclid(7)) {
        return None;
    }
    if !(-14 * 60..=14 * 60).contains(&offset_minutes) {
        return None;
    }
    let local = days * 86400 + i64::from(hour * 3600 + minute * 60 + second);
    let utc = local - i64::from(offset_minutes) * 60;
    let min = days_from_civil(1, 1, 1) * 86400;
    let max = days_from_civil(9999, 12, 31) * 86400 + 86399;
    if utc < min || utc > max {
        return None;
    }
    Some(from_unix(utc, 0))
}
