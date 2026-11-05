package dotnet

import (
	"net/http"
	"strings"
)

// headClosesConn is where a head makes .NET drop the conn after the
// response (HttpConnection._connectionClose): a Connection line with a
// "close" token, or a Keep-Alive line with max=0 or a timeout of 0 or 1.
// The status line's version plays no part. Measured by C#'s
// ConnectionReuseMatchesTheFixture.
func headClosesConn(header http.Header) bool {
	for _, value := range header.Values("Connection") {
		if connectionLineCloses(value) {
			return true
		}
	}
	for _, value := range header.Values("Keep-Alive") {
		if keepAliveLineCloses(value) {
			return true
		}
	}
	return false
}

// connectionLineCloses is GetConnectionClose for one line: the token list
// parser takes a line whole or not at all, and empty items are skipped.
func connectionLineCloses(value string) bool {
	closes := false
	for _, item := range strings.Split(value, ",") {
		item = strings.Trim(item, " \t")
		if item == "" {
			continue
		}
		if !isToken(item) {
			return false
		}
		closes = closes || strings.EqualFold(item, "close")
	}
	return closes
}

// keepAliveLineCloses is ProcessKeepAliveHeader: the line must parse whole
// as a name-value list (NameValueHeaderValue.GetNameValueListLength).
func keepAliveLineCloses(value string) bool {
	type pair struct{ name, value string }
	var pairs []pair
	at := spaceLength(value, 0)
	for at < len(value) {
		n := tokenLength(value, at)
		if n == 0 {
			return false
		}
		item := pair{name: value[at : at+n]}
		at += n
		at += spaceLength(value, at)
		if at < len(value) && value[at] == '=' {
			at++
			at += spaceLength(value, at)
			v := tokenLength(value, at)
			if v == 0 {
				v = quotedStringLength(value, at)
			}
			if v == 0 {
				return false
			}
			item.value = value[at : at+v]
			at += v
			at += spaceLength(value, at)
		}
		pairs = append(pairs, item)
		if at == len(value) || value[at] != ',' {
			break
		}
		at++
		at += spaceLength(value, at)
		if at == len(value) {
			// A trailing comma leaves an empty item, which does not parse.
			return false
		}
	}
	if at != len(value) {
		return false
	}
	for _, p := range pairs {
		switch {
		case strings.EqualFold(p.name, "timeout"):
			// int.TryParse with NumberStyles.None: digits only, in range.
			if n, ok := parseDigits(p.value); ok && n <= 1 {
				return true
			}
		case strings.EqualFold(p.name, "max") && p.value == "0":
			return true
		}
	}
	return false
}

func parseDigits(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	var n int64
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		n = n*10 + int64(s[i]-'0')
		if n > 1<<31-1 {
			return 0, false
		}
	}
	return n, true
}

func spaceLength(s string, at int) int {
	n := 0
	for at+n < len(s) && (s[at+n] == ' ' || s[at+n] == '\t') {
		n++
	}
	return n
}

func tokenLength(s string, at int) int {
	n := 0
	for at+n < len(s) && isToken(s[at+n:at+n+1]) {
		n++
	}
	return n
}

// quotedStringLength is HttpRuleParser.GetQuotedStringLength: 0 when s
// has no well-formed quoted string at at. A backslash pairs with the next
// char only when two more chars follow it and that char is ASCII and not
// NUL, CR or LF; otherwise it is a plain char.
func quotedStringLength(s string, at int) int {
	if at >= len(s) || s[at] != '"' {
		return 0
	}
	for i := at + 1; i < len(s); {
		if i+2 < len(s) && s[i] == '\\' {
			if c := s[i+1]; c <= 0x7f && c != 0 && c != '\n' && c != '\r' {
				i += 2
				continue
			}
		}
		switch s[i] {
		case '\r', '\n', 0:
			return 0
		case '"':
			return i - at + 1
		}
		i++
	}
	return 0
}
