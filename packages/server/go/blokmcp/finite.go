package blokmcp

import (
	"math"
	"strconv"
)

// finiteJSON writes null for a number past float64's range, as
// JSON.stringify writes the Infinity that JSON.parse reads: Go's decoder,
// and the bundle's JSON.parse built on it, refuse such a number. Strings
// are left alone. Unchanged input is returned as is.
func finiteJSON(text []byte) []byte {
	var out []byte
	last := 0
	inString := false
	for i := 0; i < len(text); i++ {
		c := text[i]
		if inString {
			if c == '\\' {
				i++
			} else if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			continue
		}
		if c != '-' && (c < '0' || c > '9') {
			continue
		}
		end := i + 1
		for end < len(text) && isNumberByte(text[end]) {
			end++
		}
		if value, err := strconv.ParseFloat(string(text[i:end]), 64); err != nil && math.IsInf(value, 0) {
			out = append(out, text[last:i]...)
			out = append(out, "null"...)
			last = end
		}
		i = end - 1
	}
	if out == nil {
		return text
	}
	return append(out, text[last:]...)
}

func isNumberByte(c byte) bool {
	return (c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-'
}
