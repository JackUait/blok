package ticket_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/ticket"
)

const secret = "s3cret-value-at-least-32-chars-long!"

// The one header the service accepts, byte for byte.
const wireHeader = `{"alg":"HS256","typ":"JWT"}`

func TestRoundTrip(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, err := ticket.Sign(secret, ticket.Claims{User: "u1", Doc: "doc-42", Write: true, Exp: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	claims, err := ticket.Verify(secret, token, now)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.User != "u1" || claims.Doc != "doc-42" || !claims.Write {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestRejectsATamperedPayload(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	parts := strings.Split(token, ".")
	parts[1] = "eyJ1c2VyIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9" // {"user":"admin","exp":9999999999}

	if _, err := ticket.Verify(secret, strings.Join(parts, "."), now); err == nil {
		t.Fatal("err = nil, want a signature failure")
	}
}

func TestRejectsAWrongSecret(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	if _, err := ticket.Verify("another-secret-that-is-long-enough!!", token, now); err == nil {
		t.Fatal("err = nil, want a signature failure")
	}
}

func TestRejectsAnExpiredPass(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(-time.Second).Unix()})

	if _, err := ticket.Verify(secret, token, now); err == nil {
		t.Fatal("err = nil, want an expiry failure")
	}
}

// "alg": "none" is the oldest JWT hole there is. It must not be honoured.
func TestRejectsTheNoneAlgorithm(t *testing.T) {
	// {"alg":"none","typ":"JWT"} . {"user":"admin","exp":9999999999} . (empty)
	token := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9."

	if _, err := ticket.Verify(secret, token, time.Unix(1_700_000_000, 0)); err == nil {
		t.Fatal("err = nil, want a rejection")
	}
}

// --- beyond the plan's five cases ---

// forge assembles a correctly signed token from arbitrary header and payload
// JSON, so a test can present what an honest signer never would.
func forge(key, headerJSON, payloadJSON string) string {
	return forgeSegments(key, b64(headerJSON), b64(payloadJSON))
}

// forgeSegments signs already-encoded segments, so a test can hand Verify a
// segment that is not valid base64url at all.
func forgeSegments(key, encodedHeader, encodedPayload string) string {
	signing := encodedHeader + "." + encodedPayload
	h := hmac.New(sha256.New, []byte(key))
	h.Write([]byte(signing))

	return signing + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func b64(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

// The token bytes are a cross-language contract: blokTicket() in
// packages/server/src/ticket.ts must mint exactly this for the same input, and
// the Go integration tests read passes minted by it. This vector was computed
// in Node, independently of the code under test. If it fails, the wire format
// moved and every JS-minted pass in the wild stops verifying.
func TestSignMatchesTheJavaScriptSigner(t *testing.T) {
	const want = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
		"eyJ1c2VyIjoidTEiLCJkb2MiOiJkb2MtNDIiLCJ3cml0ZSI6dHJ1ZSwiZXhwIjoxNzAwMDAwMzAwfQ." +
		"wQSPUp1wT4B9xmuh0a9CRe2mn4ypK5OYwc-KFNs2eBY"

	got, err := ticket.Sign(secret, ticket.Claims{User: "u1", Doc: "doc-42", Write: true, Exp: 1_700_000_300})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if got != want {
		t.Fatalf("token =\n\t%s\nwant\n\t%s", got, want)
	}
}

// Both of these are valid JWT headers by the spec, both say HS256, and both are
// refused: the header is compared as bytes and never parsed. Do not "fix" this
// into a JSON parse of alg — reading the algorithm out of the token is the
// whole family of algorithm-confusion holes, and this comparison is what makes
// them unreachable.
func TestRefusesAByteDifferentButSemanticallyEqualHeader(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	payload := `{"user":"u1","write":false,"exp":1700000300}`

	for name, headerJSON := range map[string]string{
		"reordered keys": `{"typ":"JWT","alg":"HS256"}`,
		"whitespace":     `{"alg": "HS256", "typ": "JWT"}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ticket.Verify(secret, forge(secret, headerJSON, payload), now)
			if !errors.Is(err, ticket.ErrSignature) {
				t.Fatalf("err = %v, want ErrSignature", err)
			}
		})
	}
}

// The plan's alg:none token also carries an empty signature, so the emptiness
// check alone would refuse it; this one is well-formed throughout, which pins
// the rejection to the algorithm rather than to that accident. It is refused
// twice over — the header never matches, and the signature is never skipped
// for "none" the way a header-driven verifier skips it — so the byte-different
// header test above, not this one, is what makes deleting that comparison red.
func TestRefusesTheNoneAlgorithmCarryingANonEmptySignature(t *testing.T) {
	token := b64(`{"alg":"none","typ":"JWT"}`) + "." + b64(`{"user":"admin","exp":9999999999}`) + "." + b64("junk")

	_, err := ticket.Verify(secret, token, time.Unix(1_700_000_000, 0))
	if !errors.Is(err, ticket.ErrSignature) {
		t.Fatalf("err = %v, want ErrSignature", err)
	}
}

func TestRefusesEmptySegments(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	encodedHeader := b64(wireHeader)

	for name, token := range map[string]string{
		"all empty":        "..",
		"empty payload":    "a..c",
		"empty header":     ".b.c",
		"empty signature":  "a.b.",
		"real header only": encodedHeader + "..",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ticket.Verify(secret, token, now)
			if !errors.Is(err, ticket.ErrMalformed) {
				t.Fatalf("err = %v, want ErrMalformed", err)
			}
		})
	}
}

func TestRefusesAWrongNumberOfSegments(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	signed, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})

	for name, token := range map[string]string{
		"empty":           "",
		"one segment":     "abc",
		"two segments":    "abc.def",
		"four segments":   signed + "." + b64("extra"),
		"trailing dot":    signed + ".",
		"many separators": strings.Repeat(".", 12),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ticket.Verify(secret, token, now)
			if !errors.Is(err, ticket.ErrMalformed) {
				t.Fatalf("err = %v, want ErrMalformed", err)
			}
		})
	}
}

// A signature of the wrong length is decodable base64url, so it reaches the
// comparison. hmac.Equal takes differing lengths without complaint; == on the
// decoded bytes would not compile.
func TestRefusesASignatureOfTheWrongLength(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Add(time.Minute).Unix()})
	parts := strings.Split(token, ".")

	for name, sig := range map[string]string{
		"one byte":  b64("x"),
		"truncated": parts[2][:20],
		"too long":  parts[2] + b64("padding-past-32-bytes"),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ticket.Verify(secret, parts[0]+"."+parts[1]+"."+sig, now)
			if !errors.Is(err, ticket.ErrSignature) {
				t.Fatalf("err = %v, want ErrSignature", err)
			}
		})
	}
}

// exp is refused at equality, not after it: a pass is dead the second it names.
func TestExpiryBoundaryRefusesAtTheExactSecond(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	expired, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Unix()})
	if _, err := ticket.Verify(secret, expired, now); !errors.Is(err, ticket.ErrExpired) {
		t.Fatalf("exp == now: err = %v, want ErrExpired", err)
	}

	alive, _ := ticket.Sign(secret, ticket.Claims{User: "u1", Exp: now.Unix() + 1})
	if _, err := ticket.Verify(secret, alive, now); err != nil {
		t.Fatalf("exp == now+1: err = %v, want a valid pass", err)
	}
}

// Exp zero-values to 0, and 0 is always in the past, so a pass that never
// expires cannot be minted by leaving exp out.
func TestRefusesAPassWithNoExpiryAtAll(t *testing.T) {
	token := forge(secret, `{"alg":"HS256","typ":"JWT"}`, `{"user":"u1"}`)

	_, err := ticket.Verify(secret, token, time.Unix(1_700_000_000, 0))
	if !errors.Is(err, ticket.ErrExpired) {
		t.Fatalf("err = %v, want ErrExpired", err)
	}
}

func TestRefusesAPayloadThatIsNotAnObject(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	for name, payload := range map[string]string{
		"string": `"hello"`,
		"array":  `[1,2]`,
		"number": `123`,
		"bool":   `true`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ticket.Verify(secret, forge(secret, wireHeader, payload), now)
			if !errors.Is(err, ticket.ErrMalformed) {
				t.Fatalf("err = %v, want ErrMalformed", err)
			}
		})
	}

	// json.Unmarshal accepts null into a struct and leaves it zero-valued, so
	// this one is refused by the exp floor rather than by the parse.
	t.Run("null", func(t *testing.T) {
		_, err := ticket.Verify(secret, forge(secret, wireHeader, `null`), now)
		if !errors.Is(err, ticket.ErrExpired) {
			t.Fatalf("err = %v, want ErrExpired", err)
		}
	})
}

func TestRefusesAPayloadThatIsNotBase64(t *testing.T) {
	token := forgeSegments(secret, b64(wireHeader), "not!base64url")

	_, err := ticket.Verify(secret, token, time.Unix(1_700_000_000, 0))
	if !errors.Is(err, ticket.ErrMalformed) {
		t.Fatalf("err = %v, want ErrMalformed", err)
	}
}

func TestIgnoresUnknownClaims(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	payload := `{"user":"u1","doc":"doc-42","write":true,"exp":1700000300,"role":"admin","iss":"someone"}`

	claims, err := ticket.Verify(secret, forge(secret, wireHeader, payload), now)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.User != "u1" || claims.Doc != "doc-42" || !claims.Write {
		t.Fatalf("claims = %+v", claims)
	}
}

// An empty secret is not a weak key, it is no key: everyone knows it, so
// everyone can mint a pass. config.Validate enforces the 32-character floor,
// but a Config that never reached Validate would otherwise fail open here.
func TestRefusesAnEmptySecret(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	token := forge("", wireHeader, `{"user":"u1","write":true,"exp":1700000300}`)

	if _, err := ticket.Verify("", token, now); !errors.Is(err, ticket.ErrNoSecret) {
		t.Fatalf("verify: err = %v, want ErrNoSecret", err)
	}
	if _, err := ticket.Sign("", ticket.Claims{User: "u1", Exp: 1_700_000_300}); !errors.Is(err, ticket.ErrNoSecret) {
		t.Fatalf("sign: err = %v, want ErrNoSecret", err)
	}
}
