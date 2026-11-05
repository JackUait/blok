package synchttp

import (
	"context"
	"net/http"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/auth"
)

type tenantKey struct{}

// tenantHook decides on a value the host's middleware put in the request
// context, as a C# policy reads any claim of the principal.
type tenantHook struct{}

func (tenantHook) CanReadDocument(ctx context.Context, _ auth.User, _ string) (bool, error) {
	return ctx.Value(tenantKey{}) == "acme", nil
}

func (tenantHook) CanWriteDocument(ctx context.Context, _ auth.User, _ string) (bool, error) {
	return ctx.Value(tenantKey{}) == "acme", nil
}

// SyncEndpoint's recheck asks with accepted.User, the handshake's own
// principal, so a policy sees the host's claims there too.
func TestTheRecheckSeesWhatTheHostAttachedToTheRequest(t *testing.T) {
	app := synStart(t, synOptions{policy: tenantHook{}, wrap: func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tenantKey{}, "acme")))
		})
	}})
	client := app.open(t)
	if got := synSyncedText(t, client); got != "seeded" {
		t.Fatalf("admitted: %q", got)
	}

	closed, err := app.manager.RecheckAccess(context.Background(), synDoc)
	if err != nil || closed != 0 {
		t.Fatalf("RecheckAccess = %d, %v; the host's value was lost", closed, err)
	}
}
