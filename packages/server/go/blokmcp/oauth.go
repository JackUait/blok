package blokmcp

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// JWKS timings, as Node's verifier.
const (
	jwksTTL             = 10 * time.Minute
	missRefetchCooldown = 30 * time.Second
	jwksFetchTimeout    = 10 * time.Second
)

// invalidToken is a refused access token; its message is the
// error_description.
type invalidToken struct{ message string }

func (e *invalidToken) Error() string { return e.message }

func invalid(message string) error { return &invalidToken{message} }

// lenientBase64URL is Node's Buffer.from(text, 'base64url'): characters
// outside the alphabet are skipped, and decoding stops at padding.
func lenientBase64URL(text string) []byte {
	var clean strings.Builder
	for _, r := range text {
		switch {
		case r == '=':
			goto done
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			clean.WriteRune(r)
		case r == '+':
			clean.WriteRune('-')
		case r == '/':
			clean.WriteRune('_')
		}
	}
done:
	encoded := clean.String()
	if len(encoded)%4 == 1 {
		encoded = encoded[:len(encoded)-1]
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil
	}
	return decoded
}

func decodeJWTPart(part string) (map[string]any, error) {
	var value map[string]any
	if json.Unmarshal([]byte(decodeUTF8(lenientBase64URL(part))), &value) != nil || value == nil {
		return nil, invalid("Malformed token")
	}
	return value, nil
}

type signingKey struct {
	key any
	alg *string
}

// tokenInfo is a verified access token.
type tokenInfo struct {
	principal string
	scopes    []string
}

// jwtVerifier is Node's createJwtVerifier: Blok's own JWT rules over a
// cached JWKS.
type jwtVerifier struct {
	issuer, audience, jwksURL string
	now                       func() time.Time

	mu              sync.Mutex
	keys            map[string]signingKey
	fetchedAt       time.Time
	failedAt        time.Time
	lastMissRefetch time.Time
	pending         chan struct{}
}

func newJWTVerifier(auth Auth) *jwtVerifier {
	return &jwtVerifier{issuer: auth.Issuer, audience: auth.Audience, jwksURL: auth.JWKSURL, now: time.Now, keys: map[string]signingKey{}}
}

func bigFrom(field any) *big.Int {
	text, _ := field.(string)
	bytes := lenientBase64URL(text)
	if len(bytes) == 0 {
		return nil
	}
	return new(big.Int).SetBytes(bytes)
}

// toSigningKey reads one JWK; nil when it is not a usable public key.
func toSigningKey(jwk map[string]any) *signingKey {
	// RFC 7517 §4.2: a key published for encryption must not verify.
	if use, has := jwk["use"]; has && use != "sig" {
		return nil
	}
	var alg *string
	if text, ok := jwk["alg"].(string); ok {
		alg = &text
	}
	switch jwk["kty"] {
	case "RSA":
		n, e := bigFrom(jwk["n"]), bigFrom(jwk["e"])
		if n == nil || e == nil || !e.IsInt64() || e.Int64() > math.MaxInt32 {
			return nil
		}
		return &signingKey{key: &rsa.PublicKey{N: n, E: int(e.Int64())}, alg: alg}
	case "EC":
		curve, _ := jwk["crv"].(string)
		x, y := bigFrom(jwk["x"]), bigFrom(jwk["y"])
		var c elliptic.Curve
		switch curve {
		case "P-256":
			c = elliptic.P256()
		case "P-384":
			c = elliptic.P384()
		case "P-521":
			c = elliptic.P521()
		default:
			return nil
		}
		if x == nil || y == nil {
			return nil
		}
		return &signingKey{key: &ecdsa.PublicKey{Curve: c, X: x, Y: y}, alg: alg}
	}
	return nil
}

func (v *jwtVerifier) load(ctx context.Context) error {
	failed := func() error {
		v.mu.Lock()
		v.failedAt = v.now()
		v.mu.Unlock()
		return invalid("Signing keys unavailable")
	}
	answer, err := fetch(ctx, jwksFetchTimeout, http.MethodGet, v.jwksURL, nil, nil)
	if err != nil || answer.status < 200 || answer.status > 299 {
		return failed()
	}
	// Maps, not structs: a struct decode would also take "KEYS".
	var body map[string]json.RawMessage
	var listed []json.RawMessage
	if json.Unmarshal(answer.body, &body) != nil || (body["keys"] != nil && json.Unmarshal(body["keys"], &listed) != nil) {
		return failed()
	}
	keys := map[string]signingKey{}
	for _, raw := range listed {
		var jwk map[string]any
		if json.Unmarshal(raw, &jwk) != nil {
			continue
		}
		kid, ok := jwk["kid"].(string)
		if !ok {
			continue
		}
		if key := toSigningKey(jwk); key != nil {
			keys[kid] = *key
		}
	}
	// A set with no usable key would refuse every token.
	if len(keys) == 0 {
		return failed()
	}
	v.mu.Lock()
	v.keys = keys
	v.fetchedAt = v.now()
	v.mu.Unlock()
	return nil
}

// refresh shares one fetch among concurrent callers.
func (v *jwtVerifier) refresh(ctx context.Context) {
	v.mu.Lock()
	if v.pending != nil {
		wait := v.pending
		v.mu.Unlock()
		<-wait
		return
	}
	done := make(chan struct{})
	v.pending = done
	v.mu.Unlock()
	// The fetch is shared, so no one caller's cancellation may fail it;
	// it has its own timeout, as Node's.
	_ = v.load(context.WithoutCancel(ctx))
	v.mu.Lock()
	v.pending = nil
	v.mu.Unlock()
	close(done)
}

func (v *jwtVerifier) coolingDown() bool {
	return !v.failedAt.IsZero() && v.now().Sub(v.failedAt) < missRefetchCooldown
}

func (v *jwtVerifier) keyFor(ctx context.Context, kid string) (signingKey, error) {
	v.mu.Lock()
	stale := v.fetchedAt.IsZero() || v.now().Sub(v.fetchedAt) > jwksTTL
	cooling := v.coolingDown()
	v.mu.Unlock()
	// A failed refresh keeps the keys already trusted.
	if stale && !cooling {
		v.refresh(ctx)
	}
	v.mu.Lock()
	_, known := v.keys[kid]
	pending := v.pending
	missRefetch := !known && pending == nil && !v.coolingDown() &&
		(v.lastMissRefetch.IsZero() || v.now().Sub(v.lastMissRefetch) >= missRefetchCooldown)
	if missRefetch {
		v.lastMissRefetch = v.now()
	}
	v.mu.Unlock()
	// A miss may mean the issuer rotated keys.
	if !known {
		if pending != nil {
			<-pending
		} else if missRefetch {
			v.refresh(ctx)
		}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	key, ok := v.keys[kid]
	if !ok {
		if len(v.keys) == 0 {
			return signingKey{}, invalid("Signing keys unavailable")
		}
		return signingKey{}, invalid("Unknown signing key")
	}
	return key, nil
}

// fitsAlg: the header alg must match the key type, or an ES256 key could
// check an "RS256" token.
func fitsAlg(key any, alg string) bool {
	switch typed := key.(type) {
	case *rsa.PublicKey:
		return alg == "RS256"
	case *ecdsa.PublicKey:
		return alg == "ES256" && typed.Curve == elliptic.P256()
	}
	return false
}

func verifySignature(key any, alg string, data, signature []byte) bool {
	digest := sha256.Sum256(data)
	if alg == "ES256" {
		public, _ := key.(*ecdsa.PublicKey)
		if public == nil || len(signature) != 64 {
			return false
		}
		r, s := new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])
		return ecdsa.Verify(public, digest[:], r, s)
	}
	public, _ := key.(*rsa.PublicKey)
	return public != nil && rsa.VerifyPKCS1v15(public, crypto.SHA256, digest[:], signature) == nil
}

func (v *jwtVerifier) verify(ctx context.Context, token string) (*tokenInfo, error) {
	parts := strings.Split(token, ".")
	header, err := decodeJWTPart(parts[0])
	if err != nil {
		return nil, err
	}
	var body string
	if len(parts) > 1 {
		body = parts[1]
	}
	claims, err := decodeJWTPart(body)
	if err != nil {
		return nil, err
	}
	alg, _ := header["alg"].(string)
	kid, kidIsString := header["kid"].(string)
	if (alg != "RS256" && alg != "ES256") || !kidIsString || len(parts) != 3 {
		return nil, invalid("Unsupported token")
	}
	// RFC 7515 §4.1.11: no critical extension is understood here.
	if _, has := header["crit"]; has {
		return nil, invalid("Unsupported critical header")
	}
	// RFC 9068 §4: an ID token must not pass as an access token.
	typ, _ := header["typ"].(string)
	if typ = strings.ToLower(typ); typ != "at+jwt" && typ != "application/at+jwt" {
		return nil, invalid("Not an access token")
	}
	key, err := v.keyFor(ctx, kid)
	if err != nil {
		return nil, err
	}
	if (key.alg != nil && *key.alg != alg) || !fitsAlg(key.key, alg) {
		return nil, invalid("Signing key does not match the token algorithm")
	}
	if !verifySignature(key.key, alg, []byte(parts[0]+"."+parts[1]), lenientBase64URL(parts[2])) {
		return nil, invalid("Bad signature")
	}
	nowS := math.Floor(float64(v.now().UnixMilli()) / 1000)
	if issuer, _ := claims["iss"].(string); claims["iss"] == nil || issuer != v.issuer {
		return nil, invalid("Wrong issuer")
	}
	audiences, isList := claims["aud"].([]any)
	if !isList {
		audiences = []any{claims["aud"]}
	}
	matched := false
	for _, audience := range audiences {
		if text, ok := audience.(string); ok && text == v.audience {
			matched = true
		}
	}
	// RFC 8707: the token must be issued for this server.
	if !matched {
		return nil, invalid("Token not issued for this server")
	}
	exp, expIsNumber := claims["exp"].(float64)
	if !expIsNumber || exp <= nowS {
		return nil, invalid("Token expired")
	}
	if nbf, ok := claims["nbf"].(float64); ok && nbf > nowS {
		return nil, invalid("Token not valid yet")
	}
	scopes := []string{}
	if scope, ok := claims["scope"].(string); ok {
		for _, item := range strings.Split(scope, " ") {
			if item != "" {
				scopes = append(scopes, item)
			}
		}
	} else if list, ok := claims["scp"].([]any); ok {
		for _, item := range list {
			if text, ok := item.(string); ok {
				scopes = append(scopes, text)
			}
		}
	}
	// A sub in the client: namespace, or none at all, would share handles
	// with a client.
	sub, subIsString := claims["sub"].(string)
	if _, has := claims["sub"]; has && (!subIsString || sub == "") {
		return nil, invalid("Malformed subject")
	}
	if strings.HasPrefix(sub, "client:") {
		return nil, invalid("Reserved subject")
	}
	clientID := ""
	for _, name := range []string{"client_id", "azp", "sub"} {
		if text, ok := claims[name].(string); ok && text != "" {
			clientID = text
			break
		}
	}
	if clientID == "" {
		return nil, invalid("Token names no subject or client")
	}
	principal := sub
	if principal == "" {
		principal = "client:" + clientID
	}
	return &tokenInfo{principal: principal, scopes: scopes}, nil
}

// bearerGate is Node's requireBearerAuth over Blok's verifier: 401 for a
// missing or refused token, 403 without blok.read.
func (v *jwtVerifier) gate(w http.ResponseWriter, r *http.Request, metadataURL string) (*tokenInfo, bool) {
	refuse := func(status int, code, description string) {
		w.Header()["Www-Authenticate"] = []string{`Bearer error="` + code + `", error_description="` + description +
			`", scope="blok.read", resource_metadata="` + metadataURL + `"`}
		w.Header()["Content-Type"] = []string{"application/json"}
		w.WriteHeader(status)
		body, _ := marshal(map[string]string{"error": code, "error_description": description})
		_, _ = w.Write(body)
	}
	header := r.Header.Get("Authorization")
	if header == "" {
		refuse(http.StatusUnauthorized, "invalid_token", "Missing Authorization header")
		return nil, false
	}
	parts := strings.Split(header, " ")
	token := ""
	if len(parts) > 1 {
		token = parts[1]
	}
	if strings.ToLower(parts[0]) != "bearer" || token == "" {
		refuse(http.StatusUnauthorized, "invalid_token", "Invalid Authorization header format, expected 'Bearer TOKEN'")
		return nil, false
	}
	info, err := v.verify(r.Context(), token)
	if err != nil {
		var refused *invalidToken
		if errors.As(err, &refused) {
			refuse(http.StatusUnauthorized, "invalid_token", refused.message)
			return nil, false
		}
		w.WriteHeader(http.StatusInternalServerError)
		return nil, false
	}
	for _, scope := range info.scopes {
		if scope == "blok.read" {
			return info, true
		}
	}
	refuse(http.StatusForbidden, "insufficient_scope", "Insufficient scope")
	return nil, false
}
