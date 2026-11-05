package blokserver

import (
	"errors"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// defaultMaxRequestBodyBytes is Kestrel's MaxRequestBodySize default. A var
// so a test can lower it.
var defaultMaxRequestBodyBytes int64 = 30_000_000

type bodyRate struct {
	bytesPerSecond float64
	grace          time.Duration
}

// defaultMinBodyRate is Kestrel's MinRequestBodyDataRate default. A var so a
// test can shorten the grace.
var defaultMinBodyRate = bodyRate{bytesPerSecond: 240, grace: 5 * time.Second}

var errHostAnswered = errors.New("blokserver: the body limits already answered")

// withDefaultBodyLimits gives an app that mounts Handler in its own
// http.Server the body limits Kestrel gives a C# app unasked. A host that
// put its own setter in the context (blok-server does) keeps its limits.
//
// Over the cap or under the rate, a route that did not set the cap gets
// Kestrel's bare 413 or 408 with Connection: close, and what it writes
// after is dropped. A chunked body counts its data bytes only; blok-server
// counts the framing too, as Kestrel does.
func withDefaultBodyLimits(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body == nil || r.Body == http.NoBody || r.Context().Value(requestBodyLimitKey{}) != nil {
			next.ServeHTTP(w, r)
			return
		}
		writer := &refusingWriter{ResponseWriter: w}
		body := &defaultLimitedBody{
			ReadCloser: r.Body, writer: writer,
			limit: defaultMaxRequestBodyBytes, length: r.ContentLength, rate: defaultMinBodyRate,
			setDeadline: http.NewResponseController(w).SetReadDeadline,
		}
		r = r.WithContext(WithRequestBodyLimit(r.Context(), body.setLimit))
		r.Body = body
		next.ServeHTTP(writer, r)
	})
}

type defaultLimitedBody struct {
	io.ReadCloser
	writer        *refusingWriter
	setDeadline   func(time.Time) error
	limit, length int64
	rate          bodyRate
	read          int64
	// waited: only time spent inside a read counts, as Kestrel times only
	// reads the app waits on.
	waited   time.Duration
	started  bool
	routeSet bool
	failed   error
	slow     atomic.Bool
}

// setLimit is IHttpMaxRequestBodySizeFeature: read-only once reading starts.
func (b *defaultLimitedBody) setLimit(limit int64) {
	if !b.started {
		b.limit, b.routeSet = limit, true
	}
}

func (b *defaultLimitedBody) Read(p []byte) (int, error) {
	if b.failed != nil {
		return 0, b.failed
	}
	if !b.started {
		b.started = true
		if b.length > b.limit {
			return 0, b.refuse(http.StatusRequestEntityTooLarge, ErrRequestBodyTooLarge)
		}
	}
	// The read fails the rate if no byte comes before the grace ends and
	// before the bytes so far run out at the rate.
	due := max(b.rate.grace, time.Duration(float64(b.read)/b.rate.bytesPerSecond*float64(time.Second)))
	timer := time.AfterFunc(due-b.waited, func() {
		b.slow.Store(true)
		_ = b.setDeadline(time.Now())
	})
	started := time.Now()
	n, err := b.ReadCloser.Read(p)
	timer.Stop()
	b.waited += time.Since(started)
	if b.slow.Load() {
		return 0, b.refuse(http.StatusRequestTimeout, ErrRequestBodyTooSlow)
	}
	if b.read += int64(n); b.read > b.limit {
		return 0, b.refuse(http.StatusRequestEntityTooLarge, ErrRequestBodyTooLarge)
	}
	return n, err
}

// refuse answers for a route that did not set the cap; one that did, as
// /upload does, answers the error itself.
func (b *defaultLimitedBody) refuse(status int, err error) error {
	b.failed = err
	if !b.routeSet {
		b.writer.refuse(status)
	}
	return err
}

type refusingWriter struct {
	http.ResponseWriter
	mu      sync.Mutex
	wrote   bool
	refused bool
}

// refuse writes the bare answer, unless the route already started one.
// Headers the route set (CORS) go too: Kestrel's answer has none of them.
func (w *refusingWriter) refuse(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.wrote || w.refused {
		return
	}
	w.refused = true
	header := w.ResponseWriter.Header()
	clear(header)
	header.Set("Connection", "close")
	header.Set("Content-Length", "0")
	w.ResponseWriter.WriteHeader(status)
}

func (w *refusingWriter) WriteHeader(status int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.refused {
		return
	}
	w.wrote = true
	w.ResponseWriter.WriteHeader(status)
}

// Write does not hold the lock while it writes: a slow client would block a
// refusal behind it.
func (w *refusingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	if w.refused {
		w.mu.Unlock()
		return 0, errHostAnswered
	}
	w.wrote = true
	w.mu.Unlock()
	return w.ResponseWriter.Write(p)
}

// Unwrap lets http.ResponseController reach Flush, Hijack and the deadlines.
func (w *refusingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
