package blokserver

import (
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// decodeExtendedValue is ContentDispositionHeaderValue.TryDecode5987:
// "charset'language'value", split on every quote. Each run of %XX bytes is
// decoded on its own with the charset; other chars are kept as they are.
func decodeExtendedValue(value string) (string, bool) {
	parts := strings.Split(value, "'")
	if len(parts) != 3 {
		return "", false
	}
	decode, ok := charsetDecoders[charsetCodePages[strings.ToLower(parts[0])]]
	if !ok {
		return "", false
	}
	var out strings.Builder
	var run []byte
	text := parts[2]
	for i := 0; i < len(text); i++ {
		if text[i] == '%' && len(text)-i >= 3 && isHexDigit(text[i+1]) && isHexDigit(text[i+2]) {
			run = append(run, hexValue(text[i+1])<<4|hexValue(text[i+2]))
			i += 2
			continue
		}
		if len(run) > 0 {
			out.WriteString(decode(run))
			run = run[:0]
		}
		out.WriteByte(text[i])
	}
	if len(run) > 0 {
		out.WriteString(decode(run))
	}
	return out.String(), true
}

func hexValue(c byte) byte {
	switch {
	case c <= '9':
		return c - '0'
	case c <= 'F':
		return c - 'A' + 10
	}
	return c - 'a' + 10
}

// charsetCodePages is EncodingTable's name list (System.Private.CoreLib
// 10.0.11). No EncodingProvider is registered, so nothing else resolves.
// The UTF-7 names (65000) are left out: UploadEndpoint treats them as
// unknown, since Encoding.GetEncoding refuses UTF-7.
var charsetCodePages = map[string]int{
	"ansi_x3.4-1968": 20127, "ansi_x3.4-1986": 20127, "ascii": 20127, "cp367": 20127,
	"cp819": 28591, "csascii": 20127, "csisolatin1": 28591, "ibm367": 20127,
	"ibm819": 28591, "iso-10646-ucs-2": 1200, "iso-8859-1": 28591, "iso-ir-100": 28591,
	"iso-ir-6": 20127, "iso646-us": 20127, "iso8859-1": 28591, "iso_646.irv:1991": 20127,
	"iso_8859-1": 28591, "iso_8859-1:1987": 28591, "l1": 28591, "latin1": 28591,
	"ucs-2": 1200, "unicode": 1200, "unicode-1-1-utf-8": 65001, "unicode-2-0-utf-8": 65001,
	"unicodefffe": 1201, "us": 20127, "us-ascii": 20127, "utf-16": 1200,
	"utf-16be": 1201, "utf-16le": 1200, "utf-32": 12000, "utf-32be": 12001,
	"utf-32le": 12000, "utf-8": 65001, "x-unicode-1-1-utf-8": 65001, "x-unicode-2-0-utf-8": 65001,
}

// charsetDecoders decode with .NET's default replacement fallback: "?" for
// ASCII, U+FFFD for the Unicode encodings.
var charsetDecoders = map[int]func([]byte) string{
	20127: decodeASCII,
	28591: decodeLatin1,
	65001: decodeUTF8,
	1200:  func(b []byte) string { return decodeUTF16(b, false) },
	1201:  func(b []byte) string { return decodeUTF16(b, true) },
	12000: func(b []byte) string { return decodeUTF32(b, false) },
	12001: func(b []byte) string { return decodeUTF32(b, true) },
}

func decodeASCII(b []byte) string {
	out := make([]byte, len(b))
	for i, c := range b {
		if c >= 0x80 {
			c = '?'
		}
		out[i] = c
	}
	return string(out)
}

func decodeLatin1(b []byte) string {
	var out strings.Builder
	for _, c := range b {
		out.WriteRune(rune(c))
	}
	return out.String()
}

// decodeUTF8 replaces each maximal ill-formed subpart with one U+FFFD, as
// .NET does (and Go's utf8 package does not: it replaces byte by byte).
func decodeUTF8(b []byte) string {
	var out strings.Builder
	for len(b) > 0 {
		if r, size := utf8.DecodeRune(b); r != utf8.RuneError || size > 1 {
			out.WriteRune(r)
			b = b[size:]
			continue
		}
		out.WriteRune(utf8.RuneError)
		b = b[validPrefix(b):]
	}
	return out.String()
}

// validPrefix is how many bytes of an ill-formed sequence start a
// well-formed one, at least 1.
func validPrefix(b []byte) int {
	lead := b[0]
	size, low, high := 0, byte(0x80), byte(0xBF)
	switch {
	case lead >= 0xC2 && lead <= 0xDF:
		size = 2
	case lead == 0xE0:
		size, low = 3, 0xA0
	case lead == 0xED:
		size, high = 3, 0x9F
	case lead >= 0xE1 && lead <= 0xEF:
		size = 3
	case lead == 0xF0:
		size, low = 4, 0x90
	case lead == 0xF4:
		size, high = 4, 0x8F
	case lead >= 0xF1 && lead <= 0xF3:
		size = 4
	default:
		return 1
	}
	n := 1
	for n < size && n < len(b) {
		c := b[n]
		if n == 1 && (c < low || c > high) || n > 1 && (c < 0x80 || c > 0xBF) {
			break
		}
		n++
	}
	return n
}

func decodeUTF16(b []byte, bigEndian bool) string {
	var out strings.Builder
	unit := func(i int) uint16 {
		if bigEndian {
			return uint16(b[i])<<8 | uint16(b[i+1])
		}
		return uint16(b[i+1])<<8 | uint16(b[i])
	}
	i := 0
	for ; i+1 < len(b); i += 2 {
		u := unit(i)
		switch {
		case utf16.IsSurrogate(rune(u)) && u < 0xDC00 && i+3 < len(b) && unit(i+2) >= 0xDC00 && unit(i+2) <= 0xDFFF:
			out.WriteRune(utf16.DecodeRune(rune(u), rune(unit(i+2))))
			i += 2
		case utf16.IsSurrogate(rune(u)):
			out.WriteRune(utf8.RuneError)
		default:
			out.WriteRune(rune(u))
		}
	}
	if i < len(b) {
		out.WriteRune(utf8.RuneError)
	}
	return out.String()
}

func decodeUTF32(b []byte, bigEndian bool) string {
	var out strings.Builder
	i := 0
	for ; i+3 < len(b); i += 4 {
		var v uint32
		if bigEndian {
			v = uint32(b[i])<<24 | uint32(b[i+1])<<16 | uint32(b[i+2])<<8 | uint32(b[i+3])
		} else {
			v = uint32(b[i+3])<<24 | uint32(b[i+2])<<16 | uint32(b[i+1])<<8 | uint32(b[i])
		}
		if v > utf8.MaxRune || v >= 0xD800 && v <= 0xDFFF {
			out.WriteRune(utf8.RuneError)
			continue
		}
		out.WriteRune(rune(v))
	}
	if i < len(b) {
		out.WriteRune(utf8.RuneError)
	}
	return out.String()
}
