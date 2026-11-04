package main

import (
	"math"
	"net/http"
	"strings"
)

// kestrelHostValid is Kestrel's HttpUtilities.IsHostHeaderValid: empty, or a
// name of letters, digits and !$&'()-._~ with an optional :port of digits,
// or a bracketed IPv6 of hex, ':' and '.' at least "[::1]" long with an
// optional :port.
func kestrelHostValid(host string) bool {
	if host == "" {
		return true
	}
	if host[0] == '[' {
		for i := 1; i < len(host); i++ {
			c := host[i]
			if c == ']' {
				if i < 4 {
					return false
				}
				return i+1 == len(host) || kestrelPortValid(host[i+1:])
			}
			if !isHex(c) && c != ':' && c != '.' {
				return false
			}
		}
		return false
	}
	if host[0] == ':' {
		return false
	}
	if end := strings.IndexFunc(host, func(r rune) bool {
		return !(r < 0x80 && (isASCIILetterOrDigit(byte(r)) || strings.ContainsRune("!$&'()-._~", r)))
	}); end >= 0 {
		return kestrelPortValid(host[end:])
	}
	return true
}

func kestrelPortValid(rest string) bool {
	if len(rest) < 2 || rest[0] != ':' {
		return false
	}
	for i := 1; i < len(rest); i++ {
		if rest[i] < '0' || rest[i] > '9' {
			return false
		}
	}
	return true
}

func isASCIILetterOrDigit(c byte) bool {
	return '0' <= c && c <= '9' || 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z'
}

// maxChunkPrefix is Kestrel's MaxChunkPrefixBytes: enough for "7FFFFFFF\r\n".
const maxChunkPrefix = 10

// kestrelChunkPrefix is Kestrel's ParseChunkedPrefix and ParseExtension on
// the bytes so far. It gives 400 where Kestrel throws BadHttpRequest, 500
// where its int size overflows (an IOException), and 0 with complete false
// while it needs more bytes.
func kestrelChunkPrefix(b []byte) (status int, complete bool) {
	if len(b) < 2 {
		return 0, false
	}
	size, status := kestrelChunkDigit(b[0], 0)
	if status != 0 {
		return status, false
	}
	first := b[1]
	for consumed := 2; consumed < maxChunkPrefix; {
		if first == ';' {
			return kestrelChunkExtension(b[consumed:])
		}
		if consumed >= len(b) {
			return 0, false
		}
		second := b[consumed]
		consumed++
		if first == '\r' && second == '\n' {
			return 0, true
		}
		if size, status = kestrelChunkDigit(first, size); status != 0 {
			return status, false
		}
		first = second
	}
	return http.StatusBadRequest, false
}

func kestrelChunkDigit(c byte, size int32) (int32, int) {
	if !isHex(c) {
		return 0, http.StatusBadRequest
	}
	if size > (math.MaxInt32-int32(hexValue(c)))/16 {
		return 0, http.StatusInternalServerError
	}
	return size*16 + int32(hexValue(c)), 0
}

// kestrelChunkExtension takes anything up to the first CR or LF, which must
// start CRLF.
func kestrelChunkExtension(b []byte) (int, bool) {
	end := strings.IndexAny(string(b), "\r\n")
	if end < 0 || end+1 >= len(b) {
		return 0, false
	}
	if b[end] == '\r' && b[end+1] == '\n' {
		return 0, true
	}
	return http.StatusBadRequest, false
}
