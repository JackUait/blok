package blokmcp

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const endpointDoc = `{"data":{"title":"T","blocks":[{"id":"p1","type":"paragraph","data":{"text":"hi"}}]},"version":"v1"}`

func endpointLoad(t *testing.T, url, auth string) (*loaded, error) {
	t.Helper()
	return newEndpointSource(&Source{Kind: "endpoint", URL: url, EndpointAuth: auth}).load(context.Background(), "doc")
}

// Node's fetch asks for gzip and deflate, decodes them, and its text()
// drops a leading BOM.
func TestEndpointAnswersAreDecodedAsNodesFetchDoes(t *testing.T) {
	encode := map[string]func([]byte) ([]byte, string){
		"plain": func(b []byte) ([]byte, string) { return b, "" },
		"bom":   func(b []byte) ([]byte, string) { return append([]byte("\xef\xbb\xbf"), b...), "" },
		"gzip": func(b []byte) ([]byte, string) {
			var out bytes.Buffer
			w := gzip.NewWriter(&out)
			_, _ = w.Write(b)
			_ = w.Close()
			return out.Bytes(), "gzip"
		},
		"zlib": func(b []byte) ([]byte, string) {
			var out bytes.Buffer
			w := zlib.NewWriter(&out)
			_, _ = w.Write(b)
			_ = w.Close()
			return out.Bytes(), "deflate"
		},
		"raw deflate": func(b []byte) ([]byte, string) {
			var out bytes.Buffer
			w, _ := flate.NewWriter(&out, flate.DefaultCompression)
			_, _ = w.Write(b)
			_ = w.Close()
			return out.Bytes(), "deflate"
		},
	}
	for name, how := range encode {
		var asked string
		host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			asked = r.Header.Get("Accept-Encoding")
			body, coding := how([]byte(endpointDoc))
			if coding != "" {
				w.Header().Set("Content-Encoding", coding)
			}
			_, _ = w.Write(body)
		}))
		got, err := endpointLoad(t, host.URL+"/docs", "Token t")
		host.Close()
		if err != nil || got.version == nil || *got.version != "v1" {
			t.Errorf("%s: %v", name, err)
		}
		if asked != "gzip, deflate" {
			t.Errorf("%s: Accept-Encoding %q", name, asked)
		}
	}
}

// A body cut off after the status line is Node's "dropped the
// connection while answering", not "could not be reached".
func TestAnEndpointBodyCutOffSaysTheConnectionDropped(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			buffer := make([]byte, 4096)
			_, _ = conn.Read(buffer)
			_, _ = conn.Write([]byte("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{\"data\":"))
			_ = conn.Close()
		}
	}()
	_, err = endpointLoad(t, "http://"+listener.Addr().String()+"/docs", "Token t")
	if err == nil || !strings.Contains(err.Error(), "dropped the connection while answering") {
		t.Fatalf("got %v", err)
	}
}

// Header values go out as Latin-1, as undici sends them; a character past
// U+00FF, or CR, LF or NUL, is refused before anything is sent.
func TestEndpointHeaderValuesGoOutAsLatin1(t *testing.T) {
	var got []byte
	calls := 0
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		got = []byte(r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(endpointDoc))
	}))
	t.Cleanup(host.Close)
	if _, err := endpointLoad(t, host.URL+"/docs", "Token café"); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, []byte("Token caf\xe9")) {
		t.Fatalf("sent %q", got)
	}
	for _, auth := range []string{"Token €", "Token a\r\nX: y", "Token a\x00"} {
		_, err := endpointLoad(t, host.URL+"/docs", auth)
		if err == nil || !strings.Contains(err.Error(), "could not be reached") {
			t.Errorf("%q: %v", auth, err)
		}
	}
	if calls != 1 {
		t.Fatalf("%d calls reached the host", calls)
	}
}
