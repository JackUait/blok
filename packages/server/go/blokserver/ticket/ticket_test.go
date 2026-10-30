package ticket

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/ticket"
)

// Captured from TicketVerifier and BlokTicket by TicketFixtureTests.
const fixturePath = "../../../../../test/unit/server-conformance/fixtures/tickets-extended.json"

type answer struct {
	Valid  bool   `json:"valid"`
	User   string `json:"user"`
	Doc    string `json:"doc"`
	Write  bool   `json:"write"`
	Exp    int64  `json:"exp"`
	Token  string `json:"token"`
	Throws string `json:"throws"`
}

type fixture struct {
	Secret   string `json:"secret"`
	Now      int64  `json:"now"`
	Payloads []struct {
		Payload string `json:"payload"`
		Answer  answer `json:"answer"`
	} `json:"payloads"`
	Tokens []struct {
		Token  string `json:"token"`
		Answer answer `json:"answer"`
	} `json:"tokens"`
	EmptySecret       string `json:"emptySecret"`
	EmptySecretAnswer answer `json:"emptySecretAnswer"`
	Mints             []struct {
		Secret string  `json:"secret"`
		User   string  `json:"user"`
		Doc    *string `json:"doc"`
		Write  bool    `json:"write"`
		TTL    int64   `json:"ttl"`
		Answer answer  `json:"answer"`
	} `json:"mints"`
}

func load(t *testing.T) fixture {
	t.Helper()
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func check(t *testing.T, label string, claims ticket.Claims, valid bool, want answer) {
	t.Helper()
	got := answer{Valid: valid}
	if valid {
		got.User, got.Doc, got.Write, got.Exp = claims.User, claims.Doc, claims.Write, claims.Exp
	}
	if want.Throws != "" {
		t.Fatalf("%s: C# threw %s", label, want.Throws)
	}
	if got != want {
		t.Errorf("%s: %+v, want %+v", label, got, want)
	}
}

func TestVerifyMatchesTheCSharpFixture(t *testing.T) {
	f := load(t)
	now := time.Unix(f.Now, 0)
	for _, c := range f.Payloads {
		input := header + "." + base64.RawURLEncoding.EncodeToString([]byte(c.Payload))
		token := input + "." + base64.RawURLEncoding.EncodeToString(sign(f.Secret, input))
		claims, valid := ticket.Verify(f.Secret, token, now)
		check(t, c.Payload, claims, valid, c.Answer)
	}
	for _, c := range f.Tokens {
		claims, valid := ticket.Verify(f.Secret, c.Token, now)
		check(t, c.Token, claims, valid, c.Answer)
	}
	claims, valid := ticket.Verify("", f.EmptySecret, now)
	check(t, "empty secret", claims, valid, f.EmptySecretAnswer)
}

func TestMintMatchesTheCSharpFixture(t *testing.T) {
	f := load(t)
	now := time.Unix(f.Now, 0)
	for _, c := range f.Mints {
		// Go has no unset field: a zero TTL means the 300-second default,
		// where C# refuses an explicit 0.
		if c.TTL == 0 {
			continue
		}
		token, err := Mint(c.Secret, Claims{User: c.User, Doc: c.Doc, Write: c.Write, TTLSeconds: c.TTL}, now)
		if (err != nil) != (c.Answer.Throws != "") || token != c.Answer.Token {
			t.Errorf("%q: %q %v, want %+v", c.User, token, err, c.Answer)
		}
	}
}

func TestMintZeroTTLUsesTheDefault(t *testing.T) {
	now := time.Unix(1700000000, 0)
	token, err := Mint("s3cret-value-at-least-32-chars-long!", Claims{User: "u"}, now)
	if err != nil {
		t.Fatal(err)
	}
	claims, valid := ticket.Verify("s3cret-value-at-least-32-chars-long!", token, now)
	if !valid || claims.Exp != 1700000000+DefaultTTLSeconds {
		t.Fatalf("%v %+v", valid, claims)
	}
}

func TestMintRefusesInvalidUTF8(t *testing.T) {
	if _, err := Mint("s3cret-value-at-least-32-chars-long!", Claims{User: "\xff"}, time.Now()); err == nil {
		t.Fatal("minted a pass for invalid UTF-8")
	}
}
