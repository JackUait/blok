package cloud

import "unicode/utf8"

// Accept Unicode emoji sequences rather than one codepoint: ZWJ families,
// modifiers, flags, keycaps and subdivision flag tags all use multiple runes.
// This is a bounded symbol allowlist, not a Unicode grapheme normalizer. The UI
// chooses one emoji; the API also permits multiple emoji symbols within the bound.
// No markup, URLs, whitespace or ordinary letters can enter this field.
func validWorkspaceEmoji(value string) bool {
	if !utf8.ValidString(value) || len(value) > 256 {
		return false
	}
	runes := []rune(value)
	if len(runes) == 0 || len(runes) > 64 {
		return false
	}
	base := false
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case r == '#' || r == '*' || (r >= '0' && r <= '9'):
			j := i + 1
			if j < len(runes) && runes[j] == 0xfe0f {
				j++
			}
			if j >= len(runes) || runes[j] != 0x20e3 {
				return false
			}
			i = j
			base = true
		case r == 0x200d:
			if !base || i+1 == len(runes) {
				return false
			}
			base = false
		case r == 0xfe0f || r == 0xfe0e || (r >= 0x1f3fb && r <= 0x1f3ff) || (r >= 0xe0020 && r <= 0xe007f):
			if !base {
				return false
			}
		case (r >= 0x1f000 && r <= 0x1faff) || (r >= 0x2600 && r <= 0x27bf) ||
			(r >= 0x2194 && r <= 0x2199) || (r >= 0x21a9 && r <= 0x21aa) ||
			(r >= 0x231a && r <= 0x231b) || (r >= 0x23e9 && r <= 0x23f3) || (r >= 0x23f8 && r <= 0x23fa) ||
			r == 0x2328 || r == 0x23cf || r == 0x24c2 || r == 0x25aa || r == 0x25ab || r == 0x25b6 || r == 0x25c0 ||
			(r >= 0x25fb && r <= 0x25fe) || r == 0xa9 || r == 0xae || r == 0x203c || r == 0x2049 || r == 0x2122 || r == 0x2139 ||
			r == 0x2934 || r == 0x2935 || r == 0x2b05 || r == 0x2b06 || r == 0x2b07 || r == 0x2b1b || r == 0x2b1c || r == 0x2b50 || r == 0x2b55 || r == 0x3030 || r == 0x303d || r == 0x3297 || r == 0x3299:
			base = true
		default:
			return false
		}
	}
	return base
}
