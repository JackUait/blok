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

// Kestrel's ParseChunkedPrefix and ParseExtension: 0 when the line is
// whole and taken, a status when Kestrel refuses it.
func TestKestrelChunkPrefix(t *testing.T) {
	for line, want := range map[string]struct {
		status   int
		complete bool
	}{
		"2\r\n": {0, true}, "7FFFFFFF\r\n": {0, true}, "00000002\r\n": {0, true}, "2;a=b\r\n": {0, true}, "0\r\n": {0, true},
		"2": {0, false}, "2\r": {0, false}, "2;a": {0, false},
		"zz\r\n": {400, false}, "2 \r\n": {400, false}, "-2\r\n": {400, false}, "2\n{": {400, false}, "2\n": {0, false}, "\r\n": {400, false},
		"0000000002\r\n": {400, false}, "2;a\nx": {400, false}, "2;a\n": {0, false}, "2;a\rx": {400, false},
		"80000000\r\n": {500, false}, "100000000\r\n": {500, false}, "fffffffffffffffffff\r\n": {500, false},
	} {
		status, complete := kestrelChunkPrefix([]byte(line))
		if status != want.status || status == 0 && complete != want.complete {
			t.Errorf("%q: %d %v, want %d %v", line, status, complete, want.status, want.complete)
		}
	}
}
