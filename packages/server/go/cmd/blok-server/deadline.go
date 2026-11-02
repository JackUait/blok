package main

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

// withDeadline is the host's RequestTimeoutPolicy: each request gets
// timeout, its context is cancelled then, and if nothing was written yet the
// answer is 504. Not http.TimeoutHandler: that answers 503 and buffers the
// whole response.
func withDeadline(next http.Handler, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		deadline := time.Now().Add(timeout)
		// A stalled body read does not watch the context; the read deadline
		// ends it at the same moment.
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(deadline)
		tracked := &trackingWriter{ResponseWriter: w}
		timer := time.AfterFunc(timeout, func() {
			if tracked.timeOut() {
				cancel()
			}
		})
		defer timer.Stop()
		// A route that opts out (GET /sync/{doc}) lifts all of it. The read
		// deadline must go too: net/http's background read fails at it and
		// cancels the request context.
		lift := func() {
			if tracked.exempt() {
				timer.Stop()
				_ = controller.SetReadDeadline(time.Time{})
			}
		}
		next.ServeHTTP(tracked, r.WithContext(blokserver.WithRequestTimeoutLift(ctx, lift)))
		// By the clock, not ctx.Err(): the read deadline can cancel the
		// connection's context first, and that reads as Canceled.
		if !time.Now().Before(deadline) {
			tracked.timeOut()
		}
	})
}

type trackingWriter struct {
	http.ResponseWriter
	mu       sync.Mutex
	wrote    bool
	timedOut bool
	expired  bool
	lifted   bool
}

// exempt takes the request out of the deadline; false if it passed first.
func (t *trackingWriter) exempt() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.expired {
		return false
	}
	t.lifted = true
	return true
}

// timeOut is the deadline passing; false if the request was lifted first.
// It writes 504 once, unless the handler already started its answer.
func (t *trackingWriter) timeOut() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.lifted {
		return false
	}
	t.expired = true
	if t.wrote || t.timedOut {
		return true
	}
	t.timedOut = true
	t.ResponseWriter.Header().Set("Content-Length", "0")
	t.ResponseWriter.WriteHeader(http.StatusGatewayTimeout)
	return true
}

func (t *trackingWriter) WriteHeader(status int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return
	}
	t.wrote = true
	t.ResponseWriter.WriteHeader(status)
}

func (t *trackingWriter) Write(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return 0, http.ErrHandlerTimeout
	}
	t.wrote = true
	return t.ResponseWriter.Write(b)
}

// Hijack marks the writer done before handing the conn over, so the
// deadline never writes a 504 onto a WebSocket. ResponseController finds
// this method before it unwraps.
func (t *trackingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return nil, nil, http.ErrHandlerTimeout
	}
	conn, buffered, err := http.NewResponseController(t.ResponseWriter).Hijack()
	if err == nil {
		t.wrote = true
	}
	return conn, buffered, err
}

// Unwrap lets http.ResponseController reach Flush and the deadlines.
func (t *trackingWriter) Unwrap() http.ResponseWriter { return t.ResponseWriter }
