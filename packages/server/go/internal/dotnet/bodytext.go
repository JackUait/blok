package dotnet

import (
	"bytes"
	"errors"
	"strings"
	"unicode/utf8"
)

// HttpContent.ReadBufferAsString (System.Net.Http 10.0.11, decompiled):
// the string Digest auth-int hashes. Pinned by the shared fixture
// outbound-body-text.json.

// errBadCharset is ReadBufferAsString's InvalidOperationException: a
// charset Encoding.GetEncoding does not know.
var errBadCharset = errors.New("The character set provided in ContentType is invalid. Cannot read content as string using an invalid character set.")

// errUTF7 is Encoding.GetEncoding's NotSupportedException for UTF-7,
// which .NET turns off.
var errUTF7 = errors.New("dotnet: UTF-7 is turned off, as in .NET")

// bodyTextErrorName is the .NET exception type of a bodyText error.
func bodyTextErrorName(err error) string {
	switch {
	case errors.Is(err, errBadCharset):
		return "InvalidOperationException"
	case errors.Is(err, errUTF7):
		return "NotSupportedException"
	}
	return ""
}

// Code pages .NET has without an EncodingProvider.
const (
	cpUTF16LE = 1200
	cpUTF16BE = 1201
	cpUTF32LE = 12000
	cpUTF32BE = 12001
	cpASCII   = 20127
	cpLatin1  = 28591
	cpUTF7    = 65000
	cpUTF8    = 65001
)

// encodingNames is EncodingTable's name list; names are matched lower case.
var encodingNames = map[string]int{
	"ansi_x3.4-1968": cpASCII, "ansi_x3.4-1986": cpASCII, "ascii": cpASCII, "cp367": cpASCII,
	"cp819": cpLatin1, "csascii": cpASCII, "csisolatin1": cpLatin1, "csunicode11utf7": cpUTF7,
	"ibm367": cpASCII, "ibm819": cpLatin1, "iso-10646-ucs-2": cpUTF16LE, "iso-8859-1": cpLatin1,
	"iso-ir-100": cpLatin1, "iso-ir-6": cpASCII, "iso646-us": cpASCII, "iso8859-1": cpLatin1,
	"iso_646.irv:1991": cpASCII, "iso_8859-1": cpLatin1, "iso_8859-1:1987": cpLatin1, "l1": cpLatin1,
	"latin1": cpLatin1, "ucs-2": cpUTF16LE, "unicode": cpUTF16LE, "unicode-1-1-utf-7": cpUTF7,
	"unicode-1-1-utf-8": cpUTF8, "unicode-2-0-utf-7": cpUTF7, "unicode-2-0-utf-8": cpUTF8,
	"unicodefffe": cpUTF16BE, "us": cpASCII, "us-ascii": cpASCII, "utf-16": cpUTF16LE,
	"utf-16be": cpUTF16BE, "utf-16le": cpUTF16LE, "utf-32": cpUTF32LE, "utf-32be": cpUTF32BE,
	"utf-32le": cpUTF32LE, "utf-7": cpUTF7, "utf-8": cpUTF8, "x-unicode-1-1-utf-7": cpUTF7,
	"x-unicode-1-1-utf-8": cpUTF8, "x-unicode-2-0-utf-7": cpUTF7, "x-unicode-2-0-utf-8": cpUTF8,
}

var preambles = map[int][]byte{
	cpUTF8:    {0xEF, 0xBB, 0xBF},
	cpUTF32LE: {0xFF, 0xFE, 0, 0},
	cpUTF16LE: {0xFF, 0xFE},
	cpUTF16BE: {0xFE, 0xFF},
	cpUTF32BE: {0, 0, 0xFE, 0xFF},
}

// bodyText is ReadBufferAsString over body, with the request's raw
// Content-Type when it has one. The answer is UTF-8, as ComputeHash
// encodes it.
func bodyText(body []byte, contentType string, hasContentType bool) (string, error) {
	if len(body) == 0 {
		return "", nil
	}
	codePage := 0
	preamble := 0
	if charset, ok := contentTypeCharset(contentType, hasContentType); ok {
		if len(charset) > 2 && charset[0] == '"' && charset[len(charset)-1] == '"' {
			charset = charset[1 : len(charset)-1]
		}
		// Names are ASCII here: ToLowerInvariant folds only those.
		found, known := encodingNames[asciiLower(charset)]
		if !known {
			return "", errBadCharset
		}
		if found == cpUTF7 {
			return "", errUTF7
		}
		codePage = found
		if bytes.HasPrefix(body, preambles[codePage]) {
			preamble = len(preambles[codePage])
		}
	} else {
		// TryDetectEncoding: UTF-32 LE is tried before UTF-16 LE.
		for _, page := range []int{cpUTF8, cpUTF32LE, cpUTF16LE, cpUTF16BE} {
			if bytes.HasPrefix(body, preambles[page]) {
				codePage, preamble = page, len(preambles[page])
				break
			}
		}
		if codePage == 0 {
			codePage = cpUTF8
		}
	}
	return decodeCodePage(body[preamble:], codePage), nil
}

// contentTypeCharset is MediaTypeHeaderValue.CharSet over the raw value
// (System.Net.Http's parser, one value): the first charset parameter, as
// written; false when there is none, it has no value, or the value does
// not parse.
func contentTypeCharset(value string, has bool) (string, bool) {
	if !has {
		return "", false
	}
	params, ok := mediaTypeParams(value)
	if !ok {
		return "", false
	}
	for _, p := range params {
		if asciiLower(p[0]) == "charset" {
			return p[1], p[2] == "="
		}
	}
	return "", false
}

// mediaTypeParams is BaseHeaderParser.TryParseValue for one media type
// (MediaTypeHeaderValue.GetMediaTypeLength): each parameter's name, its
// value as written, and "=" when it has one.
func mediaTypeParams(s string) ([][3]string, bool) {
	i, separator := nextNonEmptyKeep(s, 0)
	if separator || i == len(s) {
		return nil, false
	}
	n := tokenLength(s, i)
	if n == 0 {
		return nil, false
	}
	i += n
	i += spaceLength(s, i)
	if i >= len(s) || s[i] != '/' {
		return nil, false
	}
	i++
	i += spaceLength(s, i)
	if n = tokenLength(s, i); n == 0 {
		return nil, false
	}
	i += n
	i += spaceLength(s, i)
	var params [][3]string
	if i < len(s) && s[i] == ';' {
		i++
		// NameValueHeaderValue.GetNameValueListLength: at least one pair.
		i += spaceLength(s, i)
		for {
			n := tokenLength(s, i)
			if n == 0 {
				return nil, false
			}
			name := s[i : i+n]
			i += n
			i += spaceLength(s, i)
			if i == len(s) || s[i] != '=' {
				params = append(params, [3]string{name, "", ""})
			} else {
				i++
				i += spaceLength(s, i)
				v := 0
				if i < len(s) {
					if v = tokenLength(s, i); v == 0 {
						v = quotedStringLength(s, i)
					}
				}
				if v == 0 {
					return nil, false
				}
				params = append(params, [3]string{name, s[i : i+v], "="})
				i += v
				i += spaceLength(s, i)
			}
			if i == len(s) || s[i] != ';' {
				break
			}
			i++
			i += spaceLength(s, i)
		}
	}
	// One value only: anything left, a comma too, fails.
	if end, separator := nextNonEmptyKeep(s, i); separator || end < len(s) {
		return nil, false
	}
	return params, true
}

// nextNonEmptyKeep is GetNextNonEmptyOrWhitespaceIndex without skipping
// empty values.
func nextNonEmptyKeep(s string, i int) (int, bool) {
	i += spaceLength(s, i)
	if i == len(s) || s[i] != ',' {
		return i, false
	}
	i++
	return i + spaceLength(s, i), true
}

// decodeCodePage is Encoding.GetString with .NET's replacement fallback:
// U+FFFD for bad UTF-8, UTF-16 and UTF-32, '?' for ASCII past 0x7F.
func decodeCodePage(b []byte, codePage int) string {
	var out strings.Builder
	switch codePage {
	case cpASCII:
		for _, c := range b {
			if c >= 0x80 {
				c = '?'
			}
			out.WriteByte(c)
		}
	case cpLatin1:
		for _, c := range b {
			out.WriteRune(rune(c))
		}
	case cpUTF16LE, cpUTF16BE:
		unit := func(i int) rune {
			if codePage == cpUTF16LE {
				return rune(b[i]) | rune(b[i+1])<<8
			}
			return rune(b[i])<<8 | rune(b[i+1])
		}
		i := 0
		for ; i+1 < len(b); i += 2 {
			u := unit(i)
			switch {
			case 0xD800 <= u && u < 0xDC00 && i+3 < len(b) && 0xDC00 <= unit(i+2) && unit(i+2) < 0xE000:
				out.WriteRune(0x10000 + (u-0xD800)<<10 + unit(i+2) - 0xDC00)
				i += 2
			case 0xD800 <= u && u < 0xE000:
				out.WriteRune(utf8.RuneError)
			default:
				out.WriteRune(u)
			}
		}
		if i < len(b) {
			out.WriteRune(utf8.RuneError)
		}
	case cpUTF32LE, cpUTF32BE:
		i := 0
		for ; i+3 < len(b); i += 4 {
			var u uint32
			if codePage == cpUTF32LE {
				u = uint32(b[i]) | uint32(b[i+1])<<8 | uint32(b[i+2])<<16 | uint32(b[i+3])<<24
			} else {
				u = uint32(b[i])<<24 | uint32(b[i+1])<<16 | uint32(b[i+2])<<8 | uint32(b[i+3])
			}
			if u > 0x10FFFF || 0xD800 <= u && u < 0xE000 {
				out.WriteRune(utf8.RuneError)
			} else {
				out.WriteRune(rune(u))
			}
		}
		if i < len(b) {
			out.WriteRune(utf8.RuneError)
		}
	default:
		decodeUTF8(&out, b)
	}
	return out.String()
}

// decodeUTF8 replaces each maximal ill-formed subpart with one U+FFFD
// (Unicode 3.9, Table 3-7), as .NET's UTF8Encoding does. Go's own
// decoder gives a U+FFFD per byte of a cut-off sequence instead.
func decodeUTF8(out *strings.Builder, b []byte) {
	for i := 0; i < len(b); {
		c := b[i]
		if c < 0x80 {
			out.WriteByte(c)
			i++
			continue
		}
		size, lo, hi := 0, byte(0x80), byte(0xBF)
		switch {
		case 0xC2 <= c && c <= 0xDF:
			size = 2
		case c == 0xE0:
			size, lo = 3, 0xA0
		case 0xE1 <= c && c <= 0xEC || c == 0xEE || c == 0xEF:
			size = 3
		case c == 0xED:
			size, hi = 3, 0x9F
		case c == 0xF0:
			size, lo = 4, 0x90
		case 0xF1 <= c && c <= 0xF3:
			size = 4
		case c == 0xF4:
			size, hi = 4, 0x8F
		}
		n := 1
		for n < size && i+n < len(b) {
			low, high := byte(0x80), byte(0xBF)
			if n == 1 {
				low, high = lo, hi
			}
			if b[i+n] < low || b[i+n] > high {
				break
			}
			n++
		}
		if size > 0 && n == size {
			out.Write(b[i : i+n])
		} else {
			out.WriteRune(utf8.RuneError)
		}
		i += n
	}
}
