package outbound

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"hash/crc32"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

// The C# /unfurl answers for each Content-Encoding the fixture origin sends
// (http-host-contract captures it from C#).
const encodingsFixture = "../../../../../test/unit/server-conformance/fixtures/outbound-encodings.json"

// The cases whose origin body is the page itself or one gzip of it. The
// rest need node's compressors to rebuild, and only the black-box run has
// them.
var encodedBodies = map[string]bool{
	"identity": false, "empty": false, "unknown": false, "compress": false,
	"param": false, "quoted": false, "two-words": false, "slash": false,
	"parens": false, "only-commas": false,
	"gzip": true, "upper-gzip": true, "spaced": true, "good-then-bad-item": true,
	"bad-line-then-good-line": true, "trailing-comma": true, "tab-spaced": true,
	"gzip-long-name": true, "gzip-long-comment": true,
}

func TestContentEncodingMatchesTheCSharpFixture(t *testing.T) {
	data, err := os.ReadFile(encodingsFixture)
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string   `json:"name"`
		Encoding []string `json:"encoding"`
		Response struct {
			Body string `json:"body"`
		} `json:"response"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	page := []byte(`<meta property="og:title" content="t">`)
	var zipped bytes.Buffer
	writer := gzip.NewWriter(&zipped)
	writer.Write(page)
	writer.Close()
	long := func(set func(*gzip.Header)) []byte {
		var out bytes.Buffer
		writer := gzip.NewWriter(&out)
		set(&writer.Header)
		writer.Write(page)
		writer.Close()
		return out.Bytes()
	}
	longHeaders := map[string][]byte{
		"gzip-long-name":    long(func(h *gzip.Header) { h.Name = strings.Repeat("a", 600) }),
		"gzip-long-comment": long(func(h *gzip.Header) { h.Comment = strings.Repeat("a", 600) }),
	}

	seen := 0
	for _, c := range cases {
		gzipped, ok := encodedBodies[c.Name]
		if !ok {
			continue
		}
		seen++
		body := page
		if gzipped {
			body = zipped.Bytes()
		}
		if b, ok := longHeaders[c.Name]; ok {
			body = b
		}
		response := &http.Response{
			Header:        http.Header{"Content-Encoding": c.Encoding},
			Body:          io.NopCloser(bytes.NewReader(body)),
			ContentLength: int64(len(body)),
		}
		got, err := readBounded(response, 1<<20, false)

		// C# answers success:0 on a refused encoding, a title when the page
		// decoded, and no title when the raw bytes were read as identity.
		var want []byte
		switch {
		case strings.HasPrefix(c.Response.Body, `{"success":0`):
			if err == nil {
				t.Errorf("%s %q: read %q, C# refused it", c.Name, c.Encoding, got)
			}
			continue
		case strings.Contains(c.Response.Body, `"title"`):
			want = page
		default:
			want = body
		}
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s %q: got %q, %v; want %q", c.Name, c.Encoding, got, err, want)
		}
	}
	if seen != len(encodedBodies) {
		t.Fatalf("matched %d of %d fixture cases", seen, len(encodedBodies))
	}
}

// The header CRC covers the name, however long it is.
func TestGzipHeaderCRCCoversALongName(t *testing.T) {
	page := []byte("<p>")
	var member bytes.Buffer
	writer := gzip.NewWriter(&member)
	writer.Write(page)
	writer.Close()
	zipped := member.Bytes()
	head := append(append([]byte{}, zipped[:10]...), append(bytes.Repeat([]byte("a"), 600), 0)...)
	head[3] |= 0x08 | 0x02
	sum := crc32.ChecksumIEEE(head)
	for _, c := range []struct {
		crc  uint16
		fail bool
	}{{uint16(sum), false}, {uint16(sum) ^ 1, true}} {
		body := append(append(append([]byte{}, head...), byte(c.crc), byte(c.crc>>8)), zipped[10:]...)
		got, err := io.ReadAll(&gzipMembers{in: bufio.NewReader(bytes.NewReader(body))})
		if c.fail != (err != nil) || !c.fail && !bytes.Equal(got, page) {
			t.Errorf("crc %x: got %q, %v", c.crc, got, err)
		}
	}
}
