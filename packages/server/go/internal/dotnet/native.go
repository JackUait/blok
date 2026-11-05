package dotnet

import (
	"strings"
	"unicode/utf8"
)

// NativeText is how the .NET host decodes argv and environment bytes on
// Unix (measured; native-text.json). Valid UTF-8 is kept. Each bad
// sequence becomes U+FFFD, but unlike Go's and the WHATWG rule, a lead byte
// and a continuation byte outside its range (e0 80, ed a0, f4 90) are one
// U+FFFD together.
func NativeText(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	var out strings.Builder
	for i := 0; i < len(s); {
		b := s[i]
		need := 0
		switch {
		case b < 0x80:
			out.WriteByte(b)
			i++
			continue
		case b >= 0xc2 && b <= 0xdf:
			need = 1
		case b >= 0xe0 && b <= 0xef:
			need = 2
		case b >= 0xf0 && b <= 0xf4:
			need = 3
		default:
			out.WriteRune(utf8.RuneError)
			i++
			continue
		}
		if i+1 >= len(s) || !continuation(s[i+1]) {
			out.WriteRune(utf8.RuneError)
			i++
			continue
		}
		if !secondInRange(b, s[i+1]) {
			out.WriteRune(utf8.RuneError)
			i += 2
			continue
		}
		end := i + 2
		for end < len(s) && end < i+1+need && continuation(s[end]) {
			end++
		}
		if end == i+1+need {
			out.WriteString(s[i:end])
		} else {
			out.WriteRune(utf8.RuneError)
		}
		i = end
	}
	return out.String()
}

func continuation(b byte) bool { return b&0xc0 == 0x80 }

// secondInRange rules out overlong forms, surrogates and code points past
// U+10FFFF from the second byte.
func secondInRange(lead, second byte) bool {
	switch lead {
	case 0xe0:
		return second >= 0xa0
	case 0xed:
		return second <= 0x9f
	case 0xf0:
		return second >= 0x90
	case 0xf4:
		return second <= 0x8f
	}
	return true
}
