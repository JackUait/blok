package dotnet

import (
	"unicode"
	"unicode/utf8"
)

// EqualsOrdinalIgnoreCase is string.Equals(a, b, OrdinalIgnoreCase): the
// simple upper case of each char, as OrdinalCasing.ToUpper. Unlike
// strings.EqualFold it never folds U+212A to "k", U+017F to "s", U+0131
// to "i" or "ß" to "ẞ". An invalid UTF-8 byte only equals itself.
func EqualsOrdinalIgnoreCase(a, b string) bool {
	for a != "" && b != "" {
		x, xn := utf8.DecodeRuneInString(a)
		y, yn := utf8.DecodeRuneInString(b)
		if xn != yn || a[:xn] != b[:yn] && ordinalUpper(x) != ordinalUpper(y) {
			return false
		}
		if x == utf8.RuneError && xn == 1 && a[0] != b[0] {
			return false
		}
		a, b = a[xn:], b[yn:]
	}
	return a == "" && b == ""
}

func ordinalUpper(r rune) rune {
	// Measured on .NET 10: these two keep their case.
	if r == 'ı' || r == 'ſ' {
		return r
	}
	return unicode.ToUpper(r)
}
