package main

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"strings"
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
		// cancels the request context. A request with a body keeps it:
		// net/http drains an unread body after the handler, and a trickled
		// one would pin the connection. The sync door refuses any body.
		lift := func() {
			if tracked.exempt() {
				timer.Stop()
				if r.ContentLength == 0 {
					_ = controller.SetReadDeadline(time.Time{})
				}
			}
		}
		limited, body := withBodyLimit(r, blokserver.WithRequestTimeoutLift(ctx, lift), tracked)
		next.ServeHTTP(tracked, limited)
		// By the clock, not ctx.Err(): the read deadline can cancel the
		// connection's context first, and that reads as Canceled.
		if !time.Now().Before(deadline) {
			tracked.timeOut()
		}
		// net/http reads what is left of the body after the answer, under
		// the read deadline; Kestrel gives it bodyDrainTimeout. Never on a
		// hijacked conn: the deadline would land on its new owner.
		if body != nil && !body.ended && !tracked.hijacked() {
			if drain := time.Now().Add(time.Duration(bodyDrainTimeout.Load())); drain.Before(deadline) {
				_ = controller.SetReadDeadline(drain)
			}
		}
	})
}

// withBodyLimit puts Kestrel's body cap on r's body, and the setter a route
// raises it with in its context.
func withBodyLimit(r *http.Request, ctx context.Context, tracked *trackingWriter) (*http.Request, *limitedBody) {
	if r.Body == nil || r.Body == http.NoBody {
		return r.WithContext(ctx), nil
	}
	body := &limitedBody{
		ReadCloser: r.Body, writer: tracked, limit: maxRequestBodyBytes, length: r.ContentLength,
		setDeadline: http.NewResponseController(tracked).SetReadDeadline,
	}
	// Kestrel answers before it reads what the route left of a body. Off
	// full duplex, net/http reads up to 256 KiB of it before the answer and
	// says Connection: close past that; on it, net/http reads after the
	// answer, the same 256 KiB, and closes without a word past it.
	_ = http.NewResponseController(tracked).EnableFullDuplex()
	if conn, ok := r.Context().Value(headerConnKey{}).(*headerConn); ok && conn.targets != nil {
		body.stream = conn.targets
		// The stream hid Expect from net/http; Kestrel answers only a
		// first line of 100-continue, on HTTP/1.1.
		if r.ProtoAtLeast(1, 1) && len(r.Header["Expect"]) > 0 &&
			strings.EqualFold(strings.Trim(r.Header["Expect"][0], " \t"), "100-continue") {
			body.continueTo = conn.Conn
		}
	}
	limited := r.WithContext(blokserver.WithRequestBodyLimit(ctx, body.setLimit))
	limited.Body = body
	return limited, body
}

type trackingWriter struct {
	http.ResponseWriter
	mu       sync.Mutex
	wrote    bool
	timedOut bool
	expired  bool
	lifted   bool
	hijack   bool
}

// started reports whether any of the answer went out.
func (t *trackingWriter) started() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.wrote || t.timedOut
}

func (t *trackingWriter) hijacked() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.hijack
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

// refuse is Kestrel ending a request over its body: its bare answer, unless
// the handler already started one, and nothing the handler writes after.
func (t *trackingWriter) refuse(status int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.wrote || t.timedOut {
		return
	}
	t.timedOut = true
	answerAndClose(t.ResponseWriter, status)
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
		t.wrote, t.hijack = true, true
	}
	return conn, buffered, err
}

// Unwrap lets http.ResponseController reach Flush and the deadlines.
func (t *trackingWriter) Unwrap() http.ResponseWriter { return t.ResponseWriter }
