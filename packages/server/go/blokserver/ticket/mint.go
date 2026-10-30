// Package ticket mints the access pass a ticket-mode server verifies, like
// C#'s BlokTicket.Create. A pass minted here verifies on the C# server and the
// other way round, and the same claims mint the same bytes.
package ticket

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/ticket"
)

const header = ticket.HeaderSegment

// MinimumSecretLength is the shortest secret, in UTF-16 code units.
const MinimumSecretLength = 32

// DefaultTTLSeconds is the lifetime a zero TTLSeconds stands for.
const DefaultTTLSeconds = 300

// Claims say who a pass is for and how long it lives.
type Claims struct {
	// User is your own user id. An empty id still verifies, but /sync closes
	// such a pass with 4401.
	User string
	// Doc is the one document the pass may open; nil leaves the claim out.
	Doc *string
	// Write lets the holder write.
	Write bool
	// TTLSeconds is the lifetime in whole seconds; 0 means DefaultTTLSeconds.
	TTLSeconds int64
}

// Mint returns a pass for c, signed with secret, that expires TTLSeconds after now.
func Mint(secret string, c Claims, now time.Time) (string, error) {
	if len(jsjson.FromString(secret)) < MinimumSecretLength {
		return "", fmt.Errorf("the secret must be at least %d characters", MinimumSecretLength)
	}
	ttl := c.TTLSeconds
	if ttl == 0 {
		ttl = DefaultTTLSeconds
	}
	if ttl < 1 {
		return "", errors.New("the lifetime must be at least one second")
	}
	// C# refuses a lone surrogate; invalid UTF-8 is Go's form of it.
	if !utf8.ValidString(c.User) || c.Doc != nil && !utf8.ValidString(*c.Doc) {
		return "", errors.New("user and doc must be valid UTF-8")
	}
	exp := now.Unix() + ttl
	if exp < now.Unix() {
		return "", errors.New("the expiry overflows")
	}
	payload := []byte(`{"user":`)
	payload = jsjson.AppendQuoted(payload, jsjson.FromString(c.User))
	if c.Doc != nil {
		payload = append(payload, `,"doc":`...)
		payload = jsjson.AppendQuoted(payload, jsjson.FromString(*c.Doc))
	}
	payload = append(payload, `,"write":`...)
	payload = strconv.AppendBool(payload, c.Write)
	payload = append(payload, `,"exp":`...)
	payload = strconv.AppendInt(payload, exp, 10)
	payload = append(payload, '}')
	input := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	return input + "." + base64.RawURLEncoding.EncodeToString(sign(secret, input)), nil
}

func sign(secret, input string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input))
	return mac.Sum(nil)
}
