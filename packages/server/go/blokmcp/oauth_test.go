package blokmcp

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type testKeys struct {
	rsa *rsa.PrivateKey
	ec  *ecdsa.PrivateKey
}

func raw(n *big.Int, size int) string {
	bytes := n.FillBytes(make([]byte, size))
	return base64.RawURLEncoding.EncodeToString(bytes)
}

func jwksServer(t *testing.T, keys testKeys) *httptest.Server {
	t.Helper()
	set := map[string]any{"keys": []map[string]any{
		{"kty": "RSA", "kid": "rsa-1", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(keys.rsa.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(keys.rsa.E)).Bytes())},
		{"kty": "EC", "kid": "ec-1", "alg": "ES256", "crv": "P-256", "x": raw(keys.ec.X, 32), "y": raw(keys.ec.Y, 32)},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(set)
	}))
	t.Cleanup(server.Close)
	return server
}

func sign(t *testing.T, keys testKeys, header, claims map[string]any) string {
	t.Helper()
	head, _ := json.Marshal(header)
	body, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(head) + "." + base64.RawURLEncoding.EncodeToString(body)
	digest := sha256.Sum256([]byte(input))
	var signature []byte
	if header["alg"] == "ES256" {
		r, s, err := ecdsa.Sign(rand.Reader, keys.ec, digest[:])
		if err != nil {
			t.Fatal(err)
		}
		signature = append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	} else {
		var err error
		if signature, err = rsa.SignPKCS1v15(rand.Reader, keys.rsa, crypto.SHA256, digest[:]); err != nil {
			t.Fatal(err)
		}
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func TestVerifiesBloksAccessTokenRules(t *testing.T) {
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	keys := testKeys{rsaKey, ecKey}
	jwks := jwksServer(t, keys)
	verifier := newJWTVerifier(Auth{Kind: "oauth", Issuer: "https://issuer.test", Audience: "https://mcp.test/mcp", JWKSURL: jwks.URL})
	claims := func(extra map[string]any) map[string]any {
		out := map[string]any{"iss": "https://issuer.test", "aud": "https://mcp.test/mcp", "sub": "alice", "scope": "blok.read", "exp": time.Now().Unix() + 60}
		for key, value := range extra {
			if value == nil {
				delete(out, key)
			} else {
				out[key] = value
			}
		}
		return out
	}
	rs := map[string]any{"alg": "RS256", "kid": "rsa-1", "typ": "at+jwt"}
	cases := []struct {
		name    string
		header  map[string]any
		claims  map[string]any
		refused string
	}{
		{"RS256", rs, claims(nil), ""},
		{"ES256", map[string]any{"alg": "ES256", "kid": "ec-1", "typ": "application/AT+JWT"}, claims(nil), ""},
		{"an ID token", map[string]any{"alg": "RS256", "kid": "rsa-1", "typ": "JWT"}, claims(nil), "Not an access token"},
		{"a key of the other algorithm", map[string]any{"alg": "RS256", "kid": "ec-1", "typ": "at+jwt"}, claims(nil), "Signing key does not match the token algorithm"},
		{"no exp", rs, claims(map[string]any{"exp": nil}), "Token expired"},
		{"a reserved sub", rs, claims(map[string]any{"sub": "client:x"}), "Reserved subject"},
		{"an empty sub", rs, claims(map[string]any{"sub": ""}), "Malformed subject"},
		{"another audience", rs, claims(map[string]any{"aud": []string{"https://x.test"}}), "Token not issued for this server"},
	}
	for _, c := range cases {
		info, err := verifier.verify(context.Background(), sign(t, keys, c.header, c.claims))
		switch {
		case c.refused == "" && (err != nil || info.principal != "alice"):
			t.Errorf("%s: %v", c.name, err)
		case c.refused != "" && (err == nil || err.Error() != c.refused):
			t.Errorf("%s: got %v, want %q", c.name, err, c.refused)
		}
	}
	info, err := verifier.verify(context.Background(), sign(t, keys, rs, claims(map[string]any{"sub": nil, "client_id": "app-1"})))
	if err != nil || info.principal != "client:app-1" {
		t.Fatalf("a client token: %v %v", info, err)
	}
}

// A client that hangs up mid-fetch must not cool the JWKS down for everyone.
func TestACancelledJWKSFetchDoesNotRefuseTheNextToken(t *testing.T) {
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	keys := testKeys{rsaKey, ecKey}
	jwks := jwksServer(t, keys)
	verifier := newJWTVerifier(Auth{Kind: "oauth", Issuer: "https://issuer.test", Audience: "https://mcp.test/mcp", JWKSURL: jwks.URL})
	token := sign(t, keys, map[string]any{"alg": "RS256", "kid": "rsa-1", "typ": "at+jwt"},
		map[string]any{"iss": "https://issuer.test", "aud": "https://mcp.test/mcp", "sub": "alice", "exp": time.Now().Unix() + 60})
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, _ = verifier.verify(cancelled, token)
	if _, err := verifier.verify(context.Background(), token); err != nil {
		t.Fatalf("the next token was refused: %v", err)
	}
}
