package dotnet

import (
	"math"
	"strconv"
	"strings"
)

// FormatDouble is double.ToString(InvariantCulture), which is also what
// Utf8JsonWriter.WriteNumberValue writes: the shortest round-trip digits,
// fixed when the decimal exponent is in -4..16, else d.dddE+XX with at
// least two exponent digits. strconv writes 1e+21 where .NET writes 1E+21.
func FormatDouble(value float64) string {
	switch {
	case math.IsNaN(value):
		return "NaN"
	case math.IsInf(value, 1):
		return "Infinity"
	case math.IsInf(value, -1):
		return "-Infinity"
	}
	sign := ""
	if math.Signbit(value) {
		sign = "-"
		value = -value
	}
	if value == 0 {
		return sign + "0"
	}
	// .NET prints these two powers of two with 16 digits that do not
	// round-trip (measured on .NET 10.0.11 over every power of two).
	switch value {
	case 0x1p-958:
		return sign + "4.104536801298376E-289"
	case 0x1p-25:
		return sign + "2.980232238769531E-08"
	}
	text := strconv.FormatFloat(value, 'e', -1, 64)
	mark := strings.IndexByte(text, 'e')
	digits := strings.Replace(text[:mark], ".", "", 1)
	exponent, _ := strconv.Atoi(text[mark+1:])
	if exponent < -4 || exponent > 16 {
		out := digits[:1]
		if len(digits) > 1 {
			out += "." + digits[1:]
		}
		exponentSign := "+"
		if exponent < 0 {
			exponentSign = "-"
			exponent = -exponent
		}
		exponentText := strconv.Itoa(exponent)
		if len(exponentText) < 2 {
			exponentText = "0" + exponentText
		}
		return sign + out + "E" + exponentSign + exponentText
	}
	if exponent < 0 {
		return sign + "0." + strings.Repeat("0", -exponent-1) + digits
	}
	if len(digits) <= exponent+1 {
		return sign + digits + strings.Repeat("0", exponent+1-len(digits))
	}
	return sign + digits[:exponent+1] + "." + digits[exponent+1:]
}
