// Package auth holds the caller identity the request guard sets and the
// handlers read. It is internal so blokserver and the collab handlers share
// one type; blokserver re-exports it.
package auth

import "context"

// User is the caller of one request. In ticket mode the guard builds it from
// the verified pass; a host's own middleware may set it with WithUser.
type User struct {
	ID   string
	Name string
	// Doc is the one document the pass names, "" when it names none.
	Doc           string
	Write         bool
	Authenticated bool
}

type userKey struct{}

// WithUser returns ctx carrying u.
func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, userKey{}, u)
}

// UserFrom returns the user ctx carries.
func UserFrom(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(userKey{}).(User)
	return u, ok
}

// Authorization narrows document access: IBlokAuthorization. It is consulted
// on the document routes only, never on upload, unfurl or delete.
type Authorization interface {
	CanReadDocument(ctx context.Context, u User, documentID string) (bool, error)
	CanWriteDocument(ctx context.Context, u User, documentID string) (bool, error)
}
