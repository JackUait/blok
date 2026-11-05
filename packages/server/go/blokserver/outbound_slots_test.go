package blokserver

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/outbound"
)

// slotOrigin serves /plain and /png at once, and /stall: the head, then a
// body held until release.
type slotOrigin struct {
	*httptest.Server
	release chan struct{}
	stalled atomic.Int32
	pngs    atomic.Int32
}

func newSlotOrigin(t *testing.T) *slotOrigin {
	t.Helper()
	o := &slotOrigin{release: make(chan struct{})}
	o.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/plain":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<html><head><title>t</title></head></html>"))
		case "/png":
			o.pngs.Add(1)
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("png bytes"))
		case "/stall":
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Content-Length", "100")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			o.stalled.Add(1)
			select {
			case <-o.release:
			case <-r.Context().Done():
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(func() {
		o.unstall()
		o.Close()
	})
	return o
}

func (o *slotOrigin) unstall() {
	select {
	case <-o.release:
	default:
		close(o.release)
	}
}

func (o *slotOrigin) waitStalled(t *testing.T, want int32) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for o.stalled.Load() < want && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := o.stalled.Load(); got != want {
		t.Fatalf("%d fetches reached the stalling page, want %d", got, want)
	}
}

func slotServer(t *testing.T, origin *slotOrigin, rateLimit int64) http.Handler {
	t.Helper()
	o := DefaultOptions()
	o.UnfurlEnabled = true
	o.AllowedOrigins = []string{frameEditor}
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "https://uploads.example.com/files/"
	o.RateLimitPerMinute = rateLimit
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(strings.TrimPrefix(origin.URL, "http://127.0.0.1:"))
	s.fetcher = outbound.NewFetcher(outbound.ExactOriginPolicy{Origin: origin.URL, Port: port})
	return s.Handler("")
}

func slotUpload(h http.Handler, remote, target string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/upload-by-url", strings.NewReader(`{"url":"`+target+`"}`))
	request.RemoteAddr = remote
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder
}

func slotFrameCheck(h http.Handler, remote, target string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/frame-check?url="+url.QueryEscape(target), nil)
	request.RemoteAddr = remote
	request.Header.Set("Origin", frameEditor)
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder
}

// stallUploads starts uploads of /stall from each remote and returns a wait
// for them to end.
func stallUploads(h http.Handler, origin *slotOrigin, remotes ...string) func() {
	var wg sync.WaitGroup
	for _, remote := range remotes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			slotUpload(h, remote, origin.URL+"/stall")
		}()
	}
	return wg.Wait
}

// Four stalled uploads fill the upload pool, never the one frame checks use.
func TestStalledUploadsByURLNeverStarveAnotherCallersFrameCheck(t *testing.T) {
	origin := newSlotOrigin(t)
	h := slotServer(t, origin, 60)
	saved := frameCheckLimits
	frameCheckLimits.Timeout = time.Second
	t.Cleanup(func() { frameCheckLimits = saved })
	wait := stallUploads(h, origin, "192.0.2.1:1", "192.0.2.2:1", "192.0.2.3:1", "192.0.2.4:1")
	defer wait()
	defer origin.unstall()
	origin.waitStalled(t, 4)
	recorder := slotFrameCheck(h, "192.0.2.5:1", origin.URL+"/plain")
	if body := recorder.Body.String(); !strings.HasPrefix(body, `{"verdict":"insecure"`) {
		t.Errorf("another caller's frame check got %d %s", recorder.Code, strings.TrimSpace(body))
	}
}

// One caller holds at most two upload slots. Its third upload waits for one
// of them and never reaches the page meanwhile; other callers and the
// caller's own checks are served at once.
func TestAThirdConcurrentUploadFromOneCallerWaitsForItsOwnSlot(t *testing.T) {
	origin := newSlotOrigin(t)
	h := slotServer(t, origin, 60)
	wait := stallUploads(h, origin, "192.0.2.1:1", "192.0.2.1:2")
	defer wait()
	defer origin.unstall()
	origin.waitStalled(t, 2)
	third := make(chan *httptest.ResponseRecorder, 1)
	go func() { third <- slotUpload(h, "192.0.2.1:3", origin.URL+"/png") }()
	time.Sleep(300 * time.Millisecond)
	select {
	case recorder := <-third:
		t.Fatalf("the third upload answered while its caller held two: %d %q", recorder.Code, recorder.Body.String())
	default:
	}
	if got := origin.pngs.Load(); got != 0 {
		t.Fatalf("the waiting upload reached the page %d times", got)
	}
	if check := slotFrameCheck(h, "192.0.2.1:4", origin.URL+"/plain"); !strings.HasPrefix(check.Body.String(), `{"verdict":"insecure"`) {
		t.Errorf("the caller's own frame check: %d %s", check.Code, check.Body.String())
	}
	if other := slotUpload(h, "192.0.2.2:1", origin.URL+"/png"); other.Code != http.StatusOK {
		t.Errorf("another caller's upload: %d %s", other.Code, other.Body.String())
	}
	origin.unstall()
	select {
	case recorder := <-third:
		if recorder.Code != http.StatusOK {
			t.Errorf("the third upload after a slot freed: %d %s", recorder.Code, recorder.Body.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the third upload never ran after its caller freed a slot")
	}
}

// A third check that waits out its deadline answers as a pool wait would.
func TestAThirdConcurrentFrameCheckFromOneCallerTimesOutLikeAPoolWait(t *testing.T) {
	origin := newSlotOrigin(t)
	h := slotServer(t, origin, 60)
	saved := frameCheckLimits
	frameCheckLimits.Timeout = 500 * time.Millisecond
	t.Cleanup(func() { frameCheckLimits = saved })
	var wg sync.WaitGroup
	// Unfurls hold the caller's two check slots past the frame check's deadline.
	for _, remote := range []string{"192.0.2.1:1", "192.0.2.1:2"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			request := httptest.NewRequest(http.MethodGet, "/unfurl?url="+url.QueryEscape(origin.URL+"/stall"), nil)
			request.RemoteAddr = remote
			h.ServeHTTP(httptest.NewRecorder(), request)
		}()
	}
	defer wg.Wait()
	defer origin.unstall()
	origin.waitStalled(t, 2)
	third := slotFrameCheck(h, "192.0.2.1:3", origin.URL+"/plain")
	if third.Code != http.StatusOK || third.Body.String() != "{\"verdict\":\"unknown\"}\n" {
		t.Fatalf("third frame check from one caller: %d %q", third.Code, third.Body.String())
	}
}

// With the rate limit off there are no per-caller limits.
func TestTheCallerCapIsOffWithTheRateLimit(t *testing.T) {
	origin := newSlotOrigin(t)
	h := slotServer(t, origin, 0)
	wait := stallUploads(h, origin, "192.0.2.1:1", "192.0.2.1:2", "192.0.2.1:3")
	defer wait()
	defer origin.unstall()
	origin.waitStalled(t, 3)
}
