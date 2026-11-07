package blokmcp

import (
	"math"
	"strconv"
)

// finiteJSON writes null for a number past float64's range, as
// JSON.stringify writes the Infinity that JSON.parse reads: Go's decoder
// refuses such a number. Strings are left alone. Unchanged input is
// returned as is.
func finiteJSON(text []byte) []byte {
	return replaceNumbers(text, func(token []byte) []byte {
		if overflows(token) {
			return []byte("null")
		}
		return nil
	})
}

// overflowStandIn is what a number past float64 crosses to mcpCheckCall as,
// as in Rust (lenient.rs): the step it gives back would carry Infinity as
// null. Every other op gets it back as 1e400, which the engine reads as
// Infinity (jsruntime's JSON.parse), as Node's JSON.parse does.
const overflowStandIn = "1.2345e+308"

// engineJSON is the input text an engine op gets.
func engineJSON(op string, text []byte) []byte {
	if op == "mcpCheckCall" {
		return replaceNumbers(text, func(token []byte) []byte {
			if !overflows(token) {
				return nil
			}
			if token[0] == '-' {
				return []byte("-" + overflowStandIn)
			}
			return []byte(overflowStandIn)
		})
	}
	return replaceNumbers(text, func(token []byte) []byte {
		switch string(token) {
		case overflowStandIn:
			return []byte("1e400")
		case "-" + overflowStandIn:
			return []byte("-1e400")
		}
		return nil
	})
}

func overflows(token []byte) bool {
	value, err := strconv.ParseFloat(string(token), 64)
	return err != nil && math.IsInf(value, 0)
}

// replaceNumbers swaps each number token outside strings for what with
// gives, or keeps it when with gives nil.
func replaceNumbers(text []byte, with func(token []byte) []byte) []byte {
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
		if swapped := with(text[i:end]); swapped != nil {
			out = append(out, text[last:i]...)
			out = append(out, swapped...)
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
