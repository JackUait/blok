package dotnet

import "strings"

// QueryFirst is HttpRequest.Query[key].FirstOrDefault() ?? "" in ASP.NET
// Core 10: pairs split on '&' only (';' is data), name and value split on the
// first '=', '+' becomes a space, then Uri.UnescapeDataString (a bad escape
// stays as written), and names compare OrdinalIgnoreCase. key must be ASCII.
// rawQuery is the text after the first '?', which is QueryString with its
// one leading '?' already stripped.
func QueryFirst(rawQuery, key string) string {
	for rawQuery != "" {
		pair := rawQuery
		if i := strings.IndexByte(rawQuery, '&'); i >= 0 {
			pair, rawQuery = rawQuery[:i], rawQuery[i+1:]
		} else {
			rawQuery = ""
		}
		name, value := pair, ""
		if i := strings.IndexByte(pair, '='); i >= 0 {
			name, value = pair[:i], pair[i+1:]
		} else if pair == "" {
			continue
		}
		if asciiEqualFold(decodeQueryPart(name), key) {
			return decodeQueryPart(value)
		}
	}
	return ""
}

func decodeQueryPart(s string) string {
	if !strings.ContainsAny(s, "%+") {
		return s
	}
	return UnescapeDataString(strings.ReplaceAll(s, "+", " "))
}

func asciiEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		x, y := a[i], b[i]
		if 'A' <= x && x <= 'Z' {
			x += 'a' - 'A'
		}
		if 'A' <= y && y <= 'Z' {
			y += 'a' - 'A'
		}
		if x != y {
			return false
		}
	}
	return true
}
