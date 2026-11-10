// Package auth holds the caller identity the request guard sets and the
// handlers read. It is internal so blokserver and the collab handlers share
// one type; blokserver re-exports it.
package auth

import (
	"context"
	"time"
)

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

// HistoryReadAuthorizer is an optional Authorization hook: may this caller
// read the document's version history? Asked on the history list, a version
// read, its changes, history/at, history/changes, restore and
// restore/preview, only after CanReadDocument (and CanWriteDocument on a
// restore) said yes; a restore reads the version it writes. A delete is
// decided by the write gate. Without it, history is readable to whoever can
// read the document. A host that wraps its Authorization in another type
// must implement it on the wrapper too, or it is not found and every
// history read is allowed. The in-process agent asks it too, with a
// user named by the person it acts for, else by the agent.
type HistoryReadAuthorizer interface {
	CanReadHistory(ctx context.Context, u User, documentID string) (bool, error)
}

// HistoryWindower is an optional Authorization hook: how far back this caller
// may see the document's history. Nil is the whole history. A point older
// than now minus the window is hidden, never deleted: reading it, its
// changes, history/at resolving to it, a before naming it, a restore to it
// and its preview answer 404 {"reason":"retention"}; the list and the range
// leave it out. A negative window counts as zero. It is not asked on delete.
// The in-process agent asks it too, as for HistoryReadAuthorizer.
type HistoryWindower interface {
	HistoryWindow(ctx context.Context, u User, documentID string) (*time.Duration, error)
}

// HistoryHolder is an optional Authorization hook: is this lineage held, so
// that DELETE /sync/{doc}/history/{lineage} answers 409 {"reason":"held"}?
// Asked before anything else about the lineage. Blok stores no bookmarks: a
// host that keeps named versions as (lineage, sequence) pairs holds their
// lineages here. A document purge does not ask.
type HistoryHolder interface {
	IsHistoryHeld(ctx context.Context, documentID, lineage string) (bool, error)
}
