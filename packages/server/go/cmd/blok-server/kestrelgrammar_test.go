package main

import "testing"

// Kestrel's HttpUtilities.IsHostHeaderValid, measured on the C# host in
// request-heads.json.
func TestKestrelHostGrammar(t *testing.T) {
	for host, want := range map[string]bool{
		"": true, "x": true, "a.b-c_d~": true, "a:80": true, "a:65536": true, "a:0080": true, "[::1]": true, "[::1]:80": true,
		"a:": false, ":80": false, "[::1": false, "a%41": false, "a:b": false, "[::1]x": false, "a:80:80": false,
		"[::]": false, "[g::1]": false, "a b": false, "a@b": false,
	} {
		if got := kestrelHostValid(host); got != want {
			t.Errorf("%q: %v, want %v", host, got, want)
		}
	}
}

// Kestrel's ParseChunkedPrefix: 0 when the line is whole and taken, a
// status when Kestrel refuses it, and where an extension starts.
func TestKestrelChunkPrefix(t *testing.T) {
	for line, want := range map[string]struct {
		status    int
		complete  bool
		extension int
	}{
		"2\r\n": {0, true, -1}, "7FFFFFFF\r\n": {0, true, -1}, "00000002\r\n": {0, true, -1}, "0\r\n": {0, true, -1},
		"2;a=b\r\n": {0, false, 1}, "2;": {0, false, 1}, "7FFFFFF;\r\n": {0, false, 7},
		"5\r\nA;xyz": {0, true, -1}, "3\r\n;ab": {0, true, -1},
		"2": {0, false, -1}, "2\r": {0, false, -1}, "2\n": {0, false, -1},
		"zz\r\n": {400, false, -1}, "2 \r\n": {400, false, -1}, "-2\r\n": {400, false, -1}, "2\n{": {400, false, -1},
		"\r\n": {400, false, -1}, "0000000002\r\n": {400, false, -1}, ";a\r\n": {400, false, -1},
		"80000000\r\n": {500, false, -1}, "100000000\r\n": {500, false, -1}, "fffffffffffffffffff\r\n": {500, false, -1},
	} {
		status, complete, extension := kestrelChunkPrefix([]byte(line))
		if status != want.status || complete != want.complete || extension != want.extension {
			t.Errorf("%q: %d %v %d, want %d %v %d", line, status, complete, extension, want.status, want.complete, want.extension)
		}
	}
}
