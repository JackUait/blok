package blokmcp

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The sync server's version list is read with exact keys, as JSON.parse
// reads it, and an entry that is not an object is skipped.
func TestVersionsOfReadsExactKeys(t *testing.T) {
	versions, err := versionsOf([]byte(`{"versions":[{"lineage":"a","sequence":1},7],"VERSIONS":[],` +
		`"lineages":[3,{"lineage":"a","current":true}],"LINEAGES":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	written, _ := json.Marshal(versions)
	if string(written) != `[{"actors":[],"savedAt":null,"startedAt":null,"version":"a:1"}]` {
		t.Fatalf("read %s", written)
	}
}

// The host's ticket answer is read by its exact "ticket" key.
func TestATicketAnswerIsReadWithExactKeys(t *testing.T) {
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"user":"agent","doc":"doc"}`))
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"ticket":"h.`+claims+`.s","TICKET":"other"}`)
	}))
	t.Cleanup(host.Close)
	server := &Server{}
	pass, _, err := server.fetchTicket(context.Background(), &Tickets{Kind: "url", URL: host.URL, HostToken: "t"}, "doc", true, &caller{principal: "alice"}, "agent")
	if err != nil || pass != "h."+claims+".s" {
		t.Fatalf("got %q, %v", pass, err)
	}
}

// The JWKS is read by its exact "keys" key.
func TestAJWKSIsReadWithExactKeys(t *testing.T) {
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	keys := testKeys{rsaKey, ecKey}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"keys":[{"kty":"RSA","kid":"rsa-1","alg":"RS256","n":"`+
			base64.RawURLEncoding.EncodeToString(rsaKey.N.Bytes())+`","e":"`+
			base64.RawURLEncoding.EncodeToString(big.NewInt(int64(rsaKey.E)).Bytes())+`"}],"KEYS":[]}`)
	}))
	t.Cleanup(jwks.Close)
	verifier := newJWTVerifier(Auth{Kind: "oauth", Issuer: "https://issuer.test", Audience: "https://mcp.test/mcp", JWKSURL: jwks.URL})
	token := sign(t, keys, map[string]any{"alg": "RS256", "kid": "rsa-1", "typ": "at+jwt"},
		map[string]any{"iss": "https://issuer.test", "aud": "https://mcp.test/mcp", "sub": "alice", "scope": "blok.read", "exp": time.Now().Unix() + 60})
	if info, err := verifier.verify(context.Background(), token); err != nil || info.principal != "alice" {
		t.Fatalf("got %v, %v", info, err)
	}
}
