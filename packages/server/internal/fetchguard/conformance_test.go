//go:build conformance

package fetchguard_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

func TestConformanceOriginChecksInitialAndRedirectOriginsExactly(t *testing.T) {
	var requests atomic.Int32
	var server *httptest.Server

	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, strings.Replace(server.URL, "127.0.0.1", "localhost", 1)+"/ok", http.StatusFound)

			return
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	cfg := fetchguard.Config{Timeout: time.Second, MaxBytes: 1024, MaxRedirects: 3}
	fetchguard.AllowConformanceOrigin(&cfg, server.URL, strings.TrimPrefix(server.URL, "http://"))
	client := fetchguard.New(cfg)

	if _, err := client.Get(context.Background(), server.URL+"/ok"); err != nil {
		t.Fatalf("exact origin: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("requests after exact origin = %d, want 1", got)
	}

	localhost := strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
	if _, err := client.Get(context.Background(), localhost+"/ok"); !errors.Is(err, fetchguard.ErrBlockedAddress) {
		t.Fatalf("alternate host error = %v, want ErrBlockedAddress", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("alternate host reached the fixture: requests = %d", got)
	}

	if _, err := client.Get(context.Background(), server.URL+"/redirect"); !errors.Is(err, fetchguard.ErrBlockedAddress) {
		t.Fatalf("redirect error = %v, want ErrBlockedAddress", err)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("redirect target reached the fixture: requests = %d, want only the exact-origin redirect request", got)
	}
}
