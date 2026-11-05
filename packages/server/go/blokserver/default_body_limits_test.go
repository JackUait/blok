package blokserver

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func startLimitsHost(t *testing.T, wrap func(http.Handler) http.Handler) (*Server, string) {
	t.Helper()
	o := DefaultOptions()
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	var handler http.Handler = s.Handler("")
	if wrap != nil {
		handler = wrap(handler)
	}
	host := httptest.NewServer(handler)
	t.Cleanup(host.Close)
	return s, strings.TrimPrefix(host.URL, "http://")
}

// sendRaw writes head and body, then reads the status, the
// answer's body, and whether it closes the connection.
func sendRaw(t *testing.T, address, head, body string) (string, bool) {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err := io.WriteString(conn, head+body); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	answer, _ := io.ReadAll(response.Body)
	return response.Status + " " + string(answer), response.Close
}

func deleteHead(length string) string {
	return "POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: " + length + "\r\n\r\n"
}

func lowerBodyCap(t *testing.T, limit int64) {
	saved := defaultMaxRequestBodyBytes
	defaultMaxRequestBodyBytes = limit
	t.Cleanup(func() { defaultMaxRequestBodyBytes = saved })
}

// Kestrel gives a C# app a 30,000,000 byte body cap without being asked;
// an app that mounts Handler in its own http.Server gets the same.
func TestHandlerCapsABodyLikeKestrelByDefault(t *testing.T) {
	if defaultMaxRequestBodyBytes != 30_000_000 {
		t.Fatalf("cap %d, want Kestrel's 30000000", defaultMaxRequestBodyBytes)
	}
	lowerBodyCap(t, 8)
	_, address := startLimitsHost(t, nil)
	status, closes := sendRaw(t, address, deleteHead("9"), `{"url":1}`)
	if status != "413 Request Entity Too Large " || !closes {
		t.Fatalf("over the cap: %q, closes %v", status, closes)
	}
	// At the cap the route answers.
	if status, _ := sendRaw(t, address, deleteHead("8"), `{"url":}`); !strings.HasPrefix(status, "400 ") {
		t.Fatalf("at the cap: %q", status)
	}
}

// A chunked body has no length up front, so the bytes read count.
func TestHandlerCapsAChunkedBodyByTheBytesRead(t *testing.T) {
	lowerBodyCap(t, 8)
	_, address := startLimitsHost(t, nil)
	head := "POST /delete HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
	if status, _ := sendRaw(t, address, head, "9\r\n{\"url\":1}\r\n0\r\n\r\n"); status != "413 Request Entity Too Large " {
		t.Fatalf("got %q", status)
	}
}

// POST /upload raises the cap to MaxUploadBytes, as UploadEndpoint does.
func TestHandlerLetsUploadRaiseTheDefaultCap(t *testing.T) {
	lowerBodyCap(t, 8)
	_, address := startLimitsHost(t, nil)
	body := multipartBody("a.txt", "one")
	head := "POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=" + testBoundary +
		"\r\nContent-Length: " + strconv.Itoa(len(body)) + "\r\n\r\n"
	if status, _ := sendRaw(t, address, head, body); !strings.HasPrefix(status, "200 ") {
		t.Fatalf("got %q", status)
	}
}

// Kestrel's MinRequestBodyDataRate: 240 bytes a second after a 5 s grace.
func TestHandlerEndsASlowBodyWith408ByDefault(t *testing.T) {
	if defaultMinBodyRate.bytesPerSecond != 240 || defaultMinBodyRate.grace != 5*time.Second {
		t.Fatalf("rate %+v, want Kestrel's 240 B/s after 5s", defaultMinBodyRate)
	}
	saved := defaultMinBodyRate
	defaultMinBodyRate.grace = 200 * time.Millisecond
	t.Cleanup(func() { defaultMinBodyRate = saved })
	_, address := startLimitsHost(t, nil)
	status, closes := sendRaw(t, address, deleteHead("100"), `{"url"`)
	if status != "408 Request Timeout " || !closes {
		t.Fatalf("got %q, closes %v", status, closes)
	}
}

// A host that set its own limits with WithRequestBodyLimit, as blok-server
// does, keeps them: Handler adds none of its own.
func TestHandlerLeavesBodyLimitsToAHostThatSetsThem(t *testing.T) {
	lowerBodyCap(t, 8)
	_, address := startLimitsHost(t, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithRequestBodyLimit(r.Context(), func(int64) {})))
		})
	})
	if status, _ := sendRaw(t, address, deleteHead("9"), `{"url":1}`); !strings.HasPrefix(status, "400 ") {
		t.Fatalf("got %q", status)
	}
}
