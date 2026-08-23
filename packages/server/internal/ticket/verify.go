package ticket

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrMalformed = errors.New("ticket: malformed")
	ErrSignature = errors.New("ticket: signature does not match")
	ErrExpired   = errors.New("ticket: expired")
	ErrNoSecret  = errors.New("ticket: no secret configured")
)

type Claims struct {
	User  string `json:"user"`
	Doc   string `json:"doc,omitempty"`
	Write bool   `json:"write"`
	Exp   int64  `json:"exp"`
}

// header is fixed, not parsed. Accepting an algorithm from the token is how
// "alg": "none" forgeries succeed; there is exactly one algorithm here.
const header = `{"alg":"HS256","typ":"JWT"}`

var enc = base64.RawURLEncoding

func Sign(secret string, c Claims) (string, error) {
	// An empty secret is not a weak key, it is no key: the HMAC over it is
	// still perfectly consistent, so a pass forged by anyone at all verifies.
	// The length policy is config.minSecretLen; this is only the fail-closed
	// floor for a Config that never reached config.Validate.
	if secret == "" {
		return "", ErrNoSecret
	}

	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	signing := enc.EncodeToString([]byte(header)) + "." + enc.EncodeToString(payload)

	return signing + "." + enc.EncodeToString(mac(secret, signing)), nil
}

func Verify(secret, token string, now time.Time) (Claims, error) {
	if secret == "" {
		return Claims{}, ErrNoSecret
	}

	// Split never returns fewer than one part, and DecodeString accepts "", so
	// without the emptiness test an empty segment reaches the HMAC and comes
	// back as a forged signature rather than as the malformed token it is.
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return Claims{}, ErrMalformed
	}
	if parts[0] != enc.EncodeToString([]byte(header)) {
		return Claims{}, ErrSignature
	}

	sig, err := enc.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	if !hmac.Equal(sig, mac(secret, parts[0]+"."+parts[1])) {
		return Claims{}, ErrSignature
	}

	raw, err := enc.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrMalformed
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return Claims{}, ErrMalformed
	}
	if claims.Exp <= now.Unix() {
		return Claims{}, ErrExpired
	}

	return claims, nil
}

func mac(secret, signing string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(signing))

	return h.Sum(nil)
}
