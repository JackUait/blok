package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
)

// chunkedBody splits data into k chunks; ext goes on the first size line.
func chunkedBody(data, k int, ext, trailer string) string {
	payload := strings.Repeat("x", data)
	size := (data + k - 1) / k
	var b strings.Builder
	for i := 0; i < data; i += size {
		part := payload[i:min(i+size, data)]
		fmt.Fprintf(&b, "%x", len(part))
		if i == 0 {
			b.WriteString(ext)
		}
		b.WriteString("\r\n" + part + "\r\n")
	}
	return b.String() + "0\r\n" + trailer + "\r\n"
}

// Measured on the C# host (/upload, cap 1000): Kestrel counts every byte of
// a chunked body against the cap, its size lines, extensions and CRLFs
// included, and the last CRLF too unless a trailer comes before it. The
// trailer's own lines are not counted.
func TestKestrelCountsAChunkedBodysFramingAgainstTheCap(t *testing.T) {
	read := func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/route" {
			blokserver.SetRequestBodyLimit(r.Context(), 1000)
		}
		if _, err := io.ReadAll(r.Body); err != nil {
			return
		}
		_, _ = io.WriteString(w, "read")
	}
	address := startBodyHost(t, http.HandlerFunc(read))
	saved := maxRequestBodyBytes
	t.Cleanup(func() { maxRequestBodyBytes = saved })
	cases := []struct {
		name string
		body func(data int) string
		max  int
	}{
		{"one chunk", func(d int) string { return chunkedBody(d, 1, "", "") }, 988},
		{"a one-byte extension", func(d int) string { return chunkedBody(d, 1, ";", "") }, 987},
		{"a two-byte extension", func(d int) string { return chunkedBody(d, 1, ";e", "") }, 986},
		{"a 101-byte extension", func(d int) string { return chunkedBody(d, 1, ";"+strings.Repeat("e", 100), "") }, 887},
		{"a 501-byte extension", func(d int) string { return chunkedBody(d, 1, ";"+strings.Repeat("e", 500), "") }, 487},
		{"ten chunks", func(d int) string { return chunkedBody(d, 10, "", "") }, 935},
		{"fifty chunks", func(d int) string { return chunkedBody(d, 50, "", "") }, 745},
		{"a trailer", func(d int) string { return chunkedBody(d, 1, "", "X-T: 1\r\n") }, 990},
	}
	head := func(path string) string {
		return "POST " + path + " HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
	}
	for _, path := range []string{"/default", "/route"} {
		if path == "/default" {
			maxRequestBodyBytes = 1000
		} else {
			maxRequestBodyBytes = saved
		}
		for _, c := range cases {
			for _, data := range []int{c.max, c.max + 1} {
				got := trickle(t, address, head(path)+c.body(data), "", 1, 0)
				taken := strings.HasSuffix(got, "\r\n\r\nread")
				if taken != (data == c.max) {
					t.Errorf("%s %s, %d bytes of data: got %q", path, c.name, data, got)
				}
			}
		}
	}
	// The bytes may come after the route set its cap, or with the head.
	maxRequestBodyBytes = saved
	if got := trickleAfter(t, address, head("/route"), chunkedBody(989, 1, "", ""), 4096, 0, 100*time.Millisecond); strings.HasSuffix(got, "read") {
		t.Errorf("a late body over the route's cap: got %q", got)
	}
}
