package dotnet

import (
	"strconv"
	"strings"
)

// ParseUInt64None is ulong.TryParse with NumberStyles.None and the
// invariant culture: ASCII digits only, no sign or space, but trailing NULs
// are skipped (measured with dotnet fsi: "1\0" parses, "\0" and "1\0x" do
// not).
func ParseUInt64None(s string) (uint64, bool) {
	digits := strings.TrimRight(s, "\x00")
	if digits == "" {
		return 0, false
	}
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return 0, false
		}
	}
	value, err := strconv.ParseUint(digits, 10, 64)
	return value, err == nil
}
