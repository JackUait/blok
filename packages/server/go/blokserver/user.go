package blokserver

import (
	"context"

	"github.com/JackUait/blok/packages/server/go/v2/internal/auth"
)

// User is the caller of one request.
type User = auth.User

// Authorization narrows document access, like IBlokAuthorization: it may
// only refuse what the ticket would allow.
type Authorization = auth.Authorization

// HistoryReadAuthorizer, HistoryWindower and HistoryHolder are optional:
// an Authorization that also implements one is asked by the history routes.
// See internal/auth for what each decides.
type (
	HistoryReadAuthorizer = auth.HistoryReadAuthorizer
	HistoryWindower       = auth.HistoryWindower
	HistoryHolder         = auth.HistoryHolder
)

// WithUser returns ctx carrying u, for a host's own auth middleware.
func WithUser(ctx context.Context, u User) context.Context { return auth.WithUser(ctx, u) }

// UserFrom returns the user the request carries. In ticket mode the guard
// sets it from the verified pass.
func UserFrom(ctx context.Context) (User, bool) { return auth.UserFrom(ctx) }
