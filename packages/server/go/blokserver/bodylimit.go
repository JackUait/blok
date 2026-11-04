package blokserver

import (
	"context"
	"errors"
)

// ErrRequestBodyTooLarge is a body read over a host's cap. A route that set
// the cap with SetRequestBodyLimit answers it itself, as UploadEndpoint
// catches Kestrel's 413; for any other route the host has answered 413.
var ErrRequestBodyTooLarge = errors.New("request body over the host's cap")

// ErrRequestBodyTooSlow is a body read under a host's minimum data rate,
// Kestrel's MinRequestBodyDataRate. The host ends the read with a read
// deadline, which also cancels the request context; a route that set the cap
// still answers it, as UploadEndpoint catches it as an IOException.
var ErrRequestBodyTooSlow = errors.New("request body under the host's minimum data rate")

type requestBodyLimitKey struct{}

// WithRequestBodyLimit is for a host that caps request bodies, as Kestrel's
// MaxRequestBodySize does: set must change the cap for this request. POST
// /upload calls it with MaxUploadBytes before it reads, as UploadEndpoint
// sets IHttpMaxRequestBodySizeFeature.
func WithRequestBodyLimit(ctx context.Context, set func(int64)) context.Context {
	return context.WithValue(ctx, requestBodyLimitKey{}, set)
}

// SetRequestBodyLimit calls the setter a host put in ctx, if any.
func SetRequestBodyLimit(ctx context.Context, limit int64) {
	if set, ok := ctx.Value(requestBodyLimitKey{}).(func(int64)); ok {
		set(limit)
	}
}
