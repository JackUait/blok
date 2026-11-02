package synchttp

import (
	"net/http"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
)

// The other collab routes share these with the sync door.

// IsSingleSegment is SyncEndpoint.IsSingleSegment.
func IsSingleSegment(doc string) bool { return isSingleSegment(doc) }

// Refuse is SyncEndpoint.RefuseAsync: a plain-text answer, streamed.
func Refuse(w http.ResponseWriter, status int, body string) { refuse(w, status, body) }

// DeriveActor is SyncHandshake.DeriveActor.
func DeriveActor(ticketUser string, u auth.User, has bool) string {
	return deriveActor(ticketUser, u, has)
}
