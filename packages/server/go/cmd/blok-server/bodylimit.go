package main

import (
	"io"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

// maxRequestBodyBytes is Kestrel's MaxRequestBodySize default. A var so a
// test can lower it.
var maxRequestBodyBytes int64 = 30_000_000

// limitedBody is Kestrel's body cap: checked on the first read against
// Content-Length, then against the bytes read. Over it the handler gets
// blokserver.ErrRequestBodyTooLarge, and unless the route set the cap
// itself, Kestrel's empty 413 goes out and the connection closes.
type limitedBody struct {
	io.ReadCloser
	writer        *trackingWriter
	limit, length int64
	read          int64
	started       bool
	// routeSet: the route set the cap, so it answers an over-cap read, as
	// UploadEndpoint catches Kestrel's 413.
	routeSet bool
	failed   bool
}

// setLimit is IHttpMaxRequestBodySizeFeature: read-only once reading starts.
func (b *limitedBody) setLimit(limit int64) {
	if !b.started {
		b.limit, b.routeSet = limit, true
	}
}

func (b *limitedBody) Read(p []byte) (int, error) {
	if b.failed {
		return 0, blokserver.ErrRequestBodyTooLarge
	}
	// Before the first read of the body under it: that read sends an
	// Expect: 100-continue answer, which Kestrel never sends here.
	if !b.started {
		b.started = true
		if b.length > b.limit {
			return 0, b.refuse()
		}
	}
	n, err := b.ReadCloser.Read(p)
	if b.read += int64(n); b.read > b.limit {
		return 0, b.refuse()
	}
	return n, err
}

func (b *limitedBody) refuse() error {
	b.failed = true
	if !b.routeSet {
		b.writer.refuse(413)
	}
	return blokserver.ErrRequestBodyTooLarge
}
