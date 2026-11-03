package blokserver

import (
	"context"
	"net/http"
)

type requestTimeoutLiftKey struct{}

// WithRequestTimeoutLift is for a host that cuts each request off at a
// deadline: lift must stop that deadline for this request. blok-server
// clears the read deadline too only when ContentLength is 0; a request with
// a body (or an unknown length) keeps it, because net/http drains an unread
// body after the handler. GET /sync/{doc} calls it before anything else, as
// DisableRequestTimeout does in C#; without it the door's hook and join run
// under the host's deadline.
func WithRequestTimeoutLift(ctx context.Context, lift func()) context.Context {
	return context.WithValue(ctx, requestTimeoutLiftKey{}, lift)
}

// LiftRequestTimeout calls the lift a host put in ctx, if any.
func LiftRequestTimeout(ctx context.Context) {
	if lift, ok := ctx.Value(requestTimeoutLiftKey{}).(func()); ok {
		lift()
	}
}

func withoutRequestTimeout(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		LiftRequestTimeout(r.Context())
		next.ServeHTTP(w, r)
	})
}
