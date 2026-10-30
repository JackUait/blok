package dotnet

import (
	"time"
	"unicode"
)

// httpDateFormats is Microsoft.Net.Http.Headers.HttpRuleParser.DateFormats
// (ASP.NET Core 10.0.11, read with ilspycmd), tried in this order with
// DateTimeStyles.AllowWhiteSpaces | AssumeUniversal. TryStringToDate tries the
// "r" format first; that fast path accepts a subset of the first entry here,
// to the same instant, so it is left out.
var httpDateFormats = []string{
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
}

var (
	monthAbbreviations = []string{"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"}
	dayAbbreviations   = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	dayNames           = []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"}
)

// ParseHTTPDate is HeaderUtilities.TryParseDate: DateTimeOffset.TryParseExact
// over httpDateFormats with the invariant culture. It ports the parts of
// DateTimeParse.DoStrictParse those formats reach.
func ParseHTTPDate(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	input := []rune(s)
	for _, format := range httpDateFormats {
		if t, ok := parseExact(input, []rune(format)); ok {
			return t, true
		}
	}
	return time.Time{}, false
}

// cursor is __DTString: Index starts at -1 and every step pre-increments.
type cursor struct {
	v []rune
	i int
}

func (c *cursor) next() bool {
	c.i++
	return c.i < len(c.v)
}

func (c *cursor) char() rune { return c.v[c.i] }

// match is __DTString.Match(char): a format space also takes NBSP or U+202F.
func (c *cursor) match(ch rune) bool {
	c.i++
	if c.i >= len(c.v) {
		return false
	}
	if c.v[c.i] == ch || (ch == ' ' && (c.v[c.i] == ' ' || c.v[c.i] == ' ')) {
		return true
	}
	c.i--
	return false
}

// skipWhite is __DTString.SkipWhiteSpaces; unicode.IsSpace is the same set
// as .NET's char.IsWhiteSpace.
func (c *cursor) skipWhite() {
	for c.i+1 < len(c.v) && unicode.IsSpace(c.v[c.i+1]) {
		c.i++
	}
}

func (c *cursor) trimTail() {
	n := len(c.v)
	for n > 0 && unicode.IsSpace(c.v[n-1]) {
		n--
	}
	c.v = c.v[:n]
}

func (c *cursor) repeatCount() int {
	ch := c.v[c.i]
	j := c.i + 1
	for j < len(c.v) && c.v[j] == ch {
		j++
	}
	n := j - c.i
	c.i = j - 1
	return n
}

// digits is DateTimeParse.ParseDigits(min, max): ASCII digits only.
func (c *cursor) digits(min, max int) (int, bool) {
	start, n, k := c.i, 0, 0
	for ; k < max; k++ {
		c.i++
		if c.i >= len(c.v) || c.v[c.i] < '0' || c.v[c.i] > '9' {
			c.i--
			break
		}
		n = n*10 + int(c.v[c.i]-'0')
	}
	if k < min {
		c.i = start
		return 0, false
	}
	return n, true
}

// digitLen is ParseDigits(digitLen): one means one or two digits.
func (c *cursor) digitLen(n int) (int, bool) {
	if n == 1 {
		return c.digits(1, 2)
	}
	return c.digits(n, n)
}

// threeLetters is the invariant fast path: three ASCII chars, OR 0x20.
func (c *cursor) threeLetters(names []string) int {
	if !c.next() || len(c.v)-c.i < 3 {
		return -1
	}
	var key [3]byte
	for k := 0; k < 3; k++ {
		r := c.v[c.i+k]
		if r > 127 {
			return -1
		}
		key[k] = byte(r) | 0x20
	}
	for index, name := range names {
		if string(key[:]) == name[:3] {
			return index
		}
	}
	return -1
}

func (c *cursor) abbreviation(names []string) (int, bool) {
	index := c.threeLetters(names)
	if index < 0 {
		return 0, false
	}
	c.i += 2
	return index, true
}

// dayName is MatchDayName: SetIfStartsWith compares OrdinalIgnoreCase, which
// folds ASCII only here (.NET rejects "Tueſday", see http-dates.json).
func (c *cursor) dayName() (int, bool) {
	index := c.threeLetters(dayAbbreviations)
	if index < 0 {
		return 0, false
	}
	name := dayNames[index]
	if len(c.v)-c.i < len(name) {
		return 0, false
	}
	for k := 0; k < len(name); k++ {
		r := c.v[c.i+k]
		if r > 127 || byte(r)|0x20 != name[k] {
			return 0, false
		}
	}
	c.i += len(name) - 1
	return index, true
}

// offset is ParseTimeZoneOffset for "zzz": sign, one or two hour digits, an
// optional ':', then exactly two minute digits below 60. No inner spaces.
func (c *cursor) offset() (int, bool) {
	if !c.next() {
		return 0, false
	}
	sign := 1
	switch c.char() {
	case '+':
	case '-':
		sign = -1
	default:
		return 0, false
	}
	hours, ok := c.digits(1, 2)
	if !ok {
		return 0, false
	}
	c.match(':')
	minutes, ok := c.digits(2, 2)
	if !ok || minutes >= 60 {
		return 0, false
	}
	return sign * (hours*60 + minutes), true
}

func parseExact(input, format []rune) (time.Time, bool) {
	str := cursor{v: append([]rune(nil), input...), i: -1}
	f := cursor{v: format, i: -1}
	str.trimTail()
	str.skipWhite()
	year, month, day, hour, minute, second := -1, -1, -1, -1, -1, -1
	weekday, offsetMinutes := -1, 0
	twoDigitYear := false
	for f.next() {
		str.skipWhite()
		ch := f.char()
		var ok bool
		switch ch {
		case 'y':
			n := f.repeatCount()
			twoDigitYear = n <= 2
			year, ok = str.digitLen(n)
		case 'M':
			if f.repeatCount() != 3 {
				return time.Time{}, false
			}
			month, ok = str.abbreviation(monthAbbreviations)
			month++
		case 'd':
			switch n := f.repeatCount(); {
			case n <= 2:
				day, ok = str.digitLen(n)
			case n == 3:
				weekday, ok = str.abbreviation(dayAbbreviations)
			default:
				weekday, ok = str.dayName()
			}
		case 'H', 'm', 's':
			n := f.repeatCount()
			if n > 2 {
				n = 2
			}
			var v int
			v, ok = str.digitLen(n)
			switch ch {
			case 'H':
				hour = v
			case 'm':
				minute = v
			default:
				second = v
			}
		case 'z':
			if f.repeatCount() != 3 {
				return time.Time{}, false
			}
			offsetMinutes, ok = str.offset()
		case ':':
			ok = str.match(':')
		case '\'':
			ok = true
			for f.next() && f.char() != '\'' {
				if unicode.IsSpace(f.char()) {
					str.skipWhite()
				} else if !str.match(f.char()) {
					ok = false
					break
				}
			}
		default:
			ok = unicode.IsSpace(ch) || str.match(ch)
		}
		if !ok {
			return time.Time{}, false
		}
	}
	if str.i < len(str.v)-1 {
		return time.Time{}, false
	}
	if twoDigitYear {
		// The invariant calendar's TwoDigitYearMax is 2049.
		if year > 49 {
			year += 1900
		} else {
			year += 2000
		}
	}
	if year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 ||
		hour > 23 || minute > 59 || second > 59 {
		return time.Time{}, false
	}
	local := time.Date(year, time.Month(month), day, hour, minute, second, 0, time.UTC)
	if local.Day() != day {
		return time.Time{}, false
	}
	if weekday >= 0 && weekday != int(local.Weekday()) {
		return time.Time{}, false
	}
	if offsetMinutes < -14*60 || offsetMinutes > 14*60 {
		return time.Time{}, false
	}
	utc := local.Add(-time.Duration(offsetMinutes) * time.Minute)
	if utc.Before(minDateTime) || utc.After(maxDateTime) {
		return time.Time{}, false
	}
	return utc, true
}

var (
	minDateTime = time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)
	maxDateTime = time.Date(9999, 12, 31, 23, 59, 59, 999999900, time.UTC)
)
