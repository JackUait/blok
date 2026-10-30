package main

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// withDeadline is the host's RequestTimeoutPolicy: each request gets
// timeout, its context is cancelled then, and if nothing was written yet the
// answer is 504. Not http.TimeoutHandler: that answers 503 and buffers the
// whole response.
func withDeadline(next http.Handler, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		deadline, _ := ctx.Deadline()
		// A stalled body read does not watch the context; the read deadline
		// ends it at the same moment.
		_ = http.NewResponseController(w).SetReadDeadline(deadline)
		tracked := &trackingWriter{ResponseWriter: w}
		// By the clock, not ctx.Err(): the read deadline can cancel the
		// connection's context first, and that reads as Canceled.
		expired := func() bool { return !time.Now().Before(deadline) }
		stop := context.AfterFunc(ctx, func() {
			if expired() {
				tracked.timeOut()
			}
		})
		defer stop()
		next.ServeHTTP(tracked, r.WithContext(ctx))
		if expired() {
			tracked.timeOut()
		}
	})
}

type trackingWriter struct {
	http.ResponseWriter
	mu       sync.Mutex
	wrote    bool
	timedOut bool
}

// timeOut writes 504 once, unless the handler already started its answer.
func (t *trackingWriter) timeOut() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.wrote || t.timedOut {
		return
	}
	t.timedOut = true
	t.ResponseWriter.Header().Set("Content-Length", "0")
	t.ResponseWriter.WriteHeader(http.StatusGatewayTimeout)
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

// Unwrap lets http.ResponseController reach Flush and the deadlines.
func (t *trackingWriter) Unwrap() http.ResponseWriter { return t.ResponseWriter }
