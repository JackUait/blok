package main

import (
	"io"
	"sync/atomic"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

// maxRequestBodyBytes is Kestrel's MaxRequestBodySize default. A var so a
// test can lower it.
var maxRequestBodyBytes int64 = 30_000_000

// dataRate is Kestrel's MinDataRate.
type dataRate struct {
	bytesPerSecond float64
	grace          time.Duration
}

// minBodyRate is Kestrel's MinRequestBodyDataRate default. A var so a test
// can shorten the grace.
var minBodyRate = dataRate{bytesPerSecond: 240, grace: 5 * time.Second}

// bodyDrainTimeout is how long Kestrel waits, after the answer, for what a
// route left of a body, measured on the C# host (it cuts off at 6 to 7 s on
// its 1 s heartbeat). A var so a test can shorten it.
var bodyDrainTimeout = 5 * time.Second

// limitedBody is Kestrel's body limits.
//
// The cap: checked on the first read against Content-Length, then against
// the bytes read. Over it the handler gets blokserver.ErrRequestBodyTooLarge.
//
// The rate: only time spent waiting inside a read counts, as Kestrel times
// only reads the app is waiting on. Past the grace, a body read slower than
// the rate is ended through the read deadline.
//
// Either way, unless the route set the cap itself, Kestrel's bare answer
// (413 or 408) goes out and the connection closes. Measured on the C# host:
// /upload, which sets the cap, answers both with its own text.
type limitedBody struct {
	io.ReadCloser
	writer        *trackingWriter
	setDeadline   func(time.Time) error
	limit, length int64
	read          int64
	waited        time.Duration
	started       bool
	// routeSet: the route set the cap, so it answers a refused read, as
	// UploadEndpoint catches Kestrel's exceptions.
	routeSet bool
	failed   error
	slow     atomic.Bool
	// ended: a read returned io.EOF.
	ended bool
	// continueTo is the socket for Kestrel's 100 Continue, or nil.
	continueTo io.Writer
}

// setLimit is IHttpMaxRequestBodySizeFeature: read-only once reading starts.
func (b *limitedBody) setLimit(limit int64) {
	if !b.started {
		b.limit, b.routeSet = limit, true
	}
}

func (b *limitedBody) Read(p []byte) (int, error) {
	if b.failed != nil {
		return 0, b.failed
	}
	// Before the first read of the body under it: that read sends an
	// Expect: 100-continue answer, which Kestrel never sends here.
	if !b.started {
		b.started = true
		if b.length > b.limit {
			return 0, b.refuse(413, blokserver.ErrRequestBodyTooLarge)
		}
		if b.continueTo != nil && !b.writer.started() {
			// Nothing of the answer is written yet, so it goes first.
			if _, err := io.WriteString(b.continueTo, "HTTP/1.1 100 Continue\r\n\r\n"); err != nil {
				return 0, err
			}
		}
	}
	// The moment the rate fails if no byte comes: past the grace, and past
	// the time the bytes so far are worth at the rate.
	due := max(minBodyRate.grace, time.Duration(float64(b.read)/minBodyRate.bytesPerSecond*float64(time.Second)))
	timer := time.AfterFunc(due-b.waited+time.Millisecond, func() {
		b.slow.Store(true)
		_ = b.setDeadline(time.Now())
	})
	started := time.Now()
	n, err := b.ReadCloser.Read(p)
	timer.Stop()
	b.waited += time.Since(started)
	if b.slow.Load() {
		return 0, b.refuse(408, blokserver.ErrRequestBodyTooSlow)
	}
	if b.read += int64(n); b.read > b.limit {
		return 0, b.refuse(413, blokserver.ErrRequestBodyTooLarge)
	}
	b.ended = err == io.EOF
	return n, err
}

func (b *limitedBody) refuse(status int, err error) error {
	b.failed = err
	if !b.routeSet {
		b.writer.refuse(status)
	}
	return err
}
