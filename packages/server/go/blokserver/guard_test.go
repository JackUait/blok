package blokserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokserver/ticket"
)

const guardSecret = "s3cret-value-at-least-32-chars-long!"

func ticketServer(t *testing.T) *Server {
	t.Helper()
	o := DefaultOptions()
	o.Auth = "ticket"
	o.Secret = guardSecret
	o.AllowedOrigins = []string{"https://app.example.com"}
	o.StorageDirectory = t.TempDir()
	o.PublicURL = "/files"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func pass(t *testing.T, write bool, doc *string) string {
	t.Helper()
	token, err := ticket.Mint(guardSecret, ticket.Claims{User: "u1", Doc: doc, Write: write}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// BlokServerRequestGuardTests: every guarded route that is not GET needs a
// write pass.
func TestGuardRefusesAReadOnlyPassOnAWriteRoute(t *testing.T) {
	s := ticketServer(t)
	request := httptest.NewRequest("POST", "/delete", strings.NewReader(`{"url":"x"}`))
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Authorization", "Bearer "+pass(t, false, nil))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	body, _ := io.ReadAll(recorder.Result().Body)
	if recorder.Code != http.StatusForbidden || string(body) != "write access required\n" ||
		recorder.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Fatalf("%d %q %v", recorder.Code, body, recorder.Header())
	}
}

// The doc claim is not checked on the HTTP routes, and the verified pass is
// on the request context for the handlers.
func TestGuardIgnoresTheDocClaimAndSetsTheUser(t *testing.T) {
	s := ticketServer(t)
	other := "other-doc"
	request := httptest.NewRequest("GET", "/health", nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Authorization", "Bearer "+pass(t, true, &other))
	recorder := httptest.NewRecorder()
	guarded, ok := s.guard(recorder, request, true)
	if !ok {
		t.Fatalf("refused: %d", recorder.Code)
	}
	user, found := UserFrom(guarded.Context())
	if !found || user != (User{ID: "u1", Name: "u1", Doc: "other-doc", Write: true, Authenticated: true}) {
		t.Fatalf("%v %+v", found, user)
	}
}
