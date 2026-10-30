// Package jsjson holds JS strings and the two JSON dialects the C# server
// speaks: JavaScript's JSON.stringify/JSON.parse (C# Yjs/JsJson.cs, what a
// yjs peer reads), and System.Text.Json's reader and default writer (what C#
// writes for digests, caps and envelopes).
//
// A JS string is a Str: UTF-16 code units, not WTF-8. C#, JS and yjs all
// count, index, split and sort strings by UTF-16 units: the caps, Y.Text
// offsets, TextDiff indices and the ordinal key sort. A lone surrogate is a
// legal unit that must survive a parse/stringify round trip. With []uint16
// all of that is direct; WTF-8 would need a conversion for each of those
// operations and a re-pairing step whenever two halves are joined.
//
// The fixtures under test/unit/server-conformance/fixtures/jsjson pin both
// dialects; Blok.Server.Tests reads the same files.
package jsjson

import (
	"slices"
	"unicode/utf16"
	"unicode/utf8"
)

// Str is a JS string: UTF-16 code units, lone surrogates allowed.
type Str []uint16

// FromString converts UTF-8. Each invalid byte run becomes one U+FFFD per
// maximal subpart, as .NET's UTF-8 decoder does (Go's utf8 package counts
// some truncated sequences differently).
func FromString(s string) Str {
	units, _ := appendUTF8(nil, []byte(s))
	return units
}

// String converts to UTF-8. A lone surrogate becomes U+FFFD, as TextEncoder
// and C#'s Encoding.UTF8 do.
func (s Str) String() string {
	return string(utf16.Decode(s))
}

// Compare orders by UTF-16 code units, like JS sort() and C#
// StringComparer.Ordinal. Go's byte order differs: it puts U+FF61 before
// U+1F600.
func Compare(a, b Str) int {
	return slices.Compare(a, b)
}

func isHigh(unit uint16) bool { return unit >= 0xd800 && unit <= 0xdbff }
func isLow(unit uint16) bool  { return unit >= 0xdc00 && unit <= 0xdfff }

// hasLone reports a surrogate that is not half of a pair.
func hasLone(s Str) bool {
	for i := 0; i < len(s); i++ {
		switch {
		case isHigh(s[i]) && i+1 < len(s) && isLow(s[i+1]):
			i++
		case isHigh(s[i]) || isLow(s[i]):
			return true
		}
	}
	return false
}

// appendUTF8 decodes b onto dst and reports whether any byte was invalid.
func appendUTF8(dst Str, b []byte) (Str, bool) {
	replaced := false
	for i := 0; i < len(b); {
		if b[i] < utf8.RuneSelf {
			dst = append(dst, uint16(b[i]))
			i++
			continue
		}
		r, size, ok := decodeMaximal(b[i:])
		replaced = replaced || !ok
		dst = utf16.AppendRune(dst, r)
		i += size
	}
	return dst, replaced
}

// decodeMaximal reads one well-formed sequence (Unicode Table 3-7), or
// U+FFFD over the longest prefix of one (its maximal subpart).
func decodeMaximal(b []byte) (rune, int, bool) {
	lead := b[0]
	var need int
	lo, hi := byte(0x80), byte(0xbf)
	switch {
	case lead >= 0xc2 && lead <= 0xdf:
		need = 1
	case lead == 0xe0:
		need, lo = 2, 0xa0
	case lead == 0xed:
		need, hi = 2, 0x9f
	case lead >= 0xe1 && lead <= 0xef:
		need = 2
	case lead == 0xf0:
		need, lo = 3, 0x90
	case lead == 0xf4:
		need, hi = 3, 0x8f
	case lead >= 0xf1 && lead <= 0xf3:
		need = 3
	default:
		return utf8.RuneError, 1, false
	}
	for i := 1; i <= need; i++ {
		if i >= len(b) || b[i] < lo || b[i] > hi {
			return utf8.RuneError, i, false
		}
		lo, hi = 0x80, 0xbf
	}
	r, _ := utf8.DecodeRune(b[:need+1])
	return r, need + 1, true
}
