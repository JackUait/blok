package jsjson

import (
	"math"
	"strconv"
	"strings"
)

// NaNBits is the NaN yjs writes. Go's math.NaN() is 0x7ff8000000000001 and
// .NET's double.NaN is 0xfff8000000000000, so write these bits explicitly.
const NaNBits uint64 = 0x7ff8000000000000

// NaN returns the NaN with NaNBits.
func NaN() float64 { return math.Float64frombits(NaNBits) }

// FormatNumber is what JSON.stringify writes for a number: Number::toString
// on the shortest round-trip digits, and null for NaN and ±Infinity. Do not
// use strconv 'g': it writes 1e-07 where JS writes 1e-7.
func FormatNumber(number float64) string {
	if math.IsNaN(number) || math.IsInf(number, 0) {
		return "null"
	}
	if number == 0 {
		return "0"
	}
	shortest := strconv.FormatFloat(math.Abs(number), 'e', -1, 64)
	mantissa, exponentText, _ := strings.Cut(shortest, "e")
	exponent, _ := strconv.Atoi(exponentText)
	digits := strings.TrimRight(strings.Replace(mantissa, ".", "", 1), "0")
	// n: where the decimal point sits after the first digit.
	n := exponent + 1
	k := len(digits)
	var out strings.Builder
	if number < 0 {
		out.WriteByte('-')
	}
	switch {
	case k <= n && n <= 21:
		out.WriteString(digits)
		out.WriteString(strings.Repeat("0", n-k))
	case 0 < n && n <= 21:
		out.WriteString(digits[:n])
		out.WriteByte('.')
		out.WriteString(digits[n:])
	case -6 < n && n <= 0:
		out.WriteString("0.")
		out.WriteString(strings.Repeat("0", -n))
		out.WriteString(digits)
	default:
		out.WriteByte(digits[0])
		if k > 1 {
			out.WriteByte('.')
			out.WriteString(digits[1:])
		}
		out.WriteByte('e')
		if n-1 >= 0 {
			out.WriteByte('+')
		}
		out.WriteString(strconv.Itoa(n - 1))
	}
	return out.String()
}
