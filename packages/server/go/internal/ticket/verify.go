// Package ticket verifies the HS256 access pass ticket mode accepts. It
// reads the payload the way C#'s TicketVerifier does with System.Text.Json:
// case-sensitive names, the last repeat wins, write must be a JSON boolean
// and exp a JSON integer.
package ticket

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// HeaderSegment is the only JWT header accepted, byte for byte.
const HeaderSegment = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"

// Claims are what a verified pass carries; a missing string is "".
type Claims struct {
	User  string
	Doc   string
	Write bool
	Exp   int64
}

// Verify checks the pass against secret at now.
func Verify(secret, token string, now time.Time) (Claims, bool) {
	if secret == "" {
		return Claims{}, false
	}
	segments := strings.Split(token, ".")
	if len(segments) != 3 || segments[0] == "" || segments[1] == "" || segments[2] == "" {
		return Claims{}, false
	}
	signature, ok := decodeBase64URL(segments[2])
	if segments[0] != HeaderSegment || !ok {
		return Claims{}, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(segments[0] + "." + segments[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return Claims{}, false
	}
	payload, ok := decodeBase64URL(segments[1])
	if !ok {
		return Claims{}, false
	}
	claims, ok := readPayload(payload)
	if !ok || claims.Exp <= now.Unix() {
		return Claims{}, false
	}
	return claims, true
}

// decodeBase64URL takes only the URL alphabet, so Go's habit of skipping
// CR and LF cannot accept a pass C# refuses. Non-zero trailing bits pass,
// as they do in C#.
func decodeBase64URL(value string) ([]byte, bool) {
	if len(value)%4 == 1 {
		return nil, false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' || c == '-' || c == '_') {
			return nil, false
		}
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return decoded, err == nil
}

func readPayload(payload []byte) (Claims, bool) {
	node, err := jsjson.ParseNode(payload, jsjson.Options{})
	if err != nil || node.Kind != jsjson.KindObject {
		return Claims{}, false
	}
	var claims Claims
	for _, member := range node.Members {
		key, err := member.Key()
		if err != nil {
			continue
		}
		value := member.Value
		switch key.String() {
		case "user", "doc":
			text := ""
			switch value.Kind {
			case jsjson.KindNull:
			case jsjson.KindString:
				decoded, err := value.Text()
				if err != nil {
					return Claims{}, false
				}
				text = decoded.String()
			default:
				return Claims{}, false
			}
			if key.String() == "user" {
				claims.User = text
			} else {
				claims.Doc = text
			}
		case "write":
			if value.Kind != jsjson.KindTrue && value.Kind != jsjson.KindFalse {
				return Claims{}, false
			}
			claims.Write = value.Kind == jsjson.KindTrue
		case "exp":
			raw := string(value.Raw())
			if value.Kind != jsjson.KindNumber || strings.ContainsAny(raw, ".eE") {
				return Claims{}, false
			}
			exp, err := strconv.ParseInt(raw, 10, 64)
			if err != nil {
				return Claims{}, false
			}
			claims.Exp = exp
		}
	}
	return claims, true
}
