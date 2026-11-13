package outbound

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync"
	"testing"
)

func rangeOrigin(t *testing.T, handler http.HandlerFunc) (*Fetcher, string) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	port := server.Listener.Addr().(*net.TCPAddr).Port
	f := newTestFetcher(&fixturePolicy{host: "pdf.example", port: port, allowed: addrs("127.0.0.1")},
		&countingResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}})
	return f, "http://pdf.example:" + strconv.Itoa(port)
}

func TestSendsTheRangeOnEveryHop(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	f, base := rangeOrigin(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.URL.Path+" "+r.Header.Get("Range"))
		mu.Unlock()
		if r.URL.Path == "/start" {
			w.Header().Set("Location", "/final")
			w.WriteHeader(http.StatusFound)
			return
		}
		w.Header().Set("Content-Range", "bytes 5-9/20")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(w, "56789")
	})
	limits := testLimits
	limits.Range = &ByteRange{Start: 5, End: 9}

	response, err := f.Get(context.Background(), base+"/start", limits)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Release()
	if string(response.Body) != "56789" || response.StatusCode != http.StatusPartialContent || response.FinalURL != base+"/final" {
		t.Fatalf("got %d %q %s", response.StatusCode, response.Body, response.FinalURL)
	}
	if len(seen) != 2 || seen[0] != "/start bytes=5-9" || seen[1] != "/final bytes=5-9" {
		t.Fatalf("origin saw %q", seen)
	}
}

func TestAnOpenRangeHasNoEnd(t *testing.T) {
	var got string
	f, base := rangeOrigin(t, func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Range")
	})
	limits := testLimits
	limits.Range = &ByteRange{Start: 1400, End: -1}

	response, err := f.Get(context.Background(), base+"/doc.pdf", limits)
	if err != nil {
		t.Fatal(err)
	}
	response.Release()
	if got != "bytes=1400-" {
		t.Fatalf("Range %q", got)
	}
}
