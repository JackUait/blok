package ticket

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/ticket"
)

// The passes C# reads in TicketVerifierTests, BlokTicketTests,
// BlokServerRequestGuardTests and SyncTestSupport. Tokens live only in this
// file: gitleaks allows them there and nowhere else.
const ticketsPath = "../../../../../test/unit/server-conformance/fixtures/tickets.json"

// Every pass in the fixture expires at this second; C# mints them with it
// as the TTL from the Unix epoch.
const fixtureExp = 4_102_444_800

type ticketsFixture struct {
	Secret                   string `json:"secret"`
	Compatible               string `json:"compatible"`
	DocMismatch              string `json:"docMismatch"`
	Expired                  string `json:"expired"`
	Malformed                string `json:"malformed"`
	NoncanonicalHeaderTicket string `json:"noncanonicalHeaderTicket"`
	ReadOnly                 string `json:"readOnly"`
	Tampered                 string `json:"tampered"`
	UserTwo                  string `json:"userTwo"`
}

func loadTickets(t *testing.T) ticketsFixture {
	t.Helper()
	data, err := os.ReadFile(ticketsPath)
	if err != nil {
		t.Fatal(err)
	}
	var f ticketsFixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	if f.Secret == "" || f.Compatible == "" {
		t.Fatal("tickets.json lost its secret or its compatible pass")
	}
	return f
}

var fixedNow = time.Unix(1_700_000_000, 0)

// Twin of TicketVerifierTests.AcceptsTheFixedCompatibleTicket and the claims
// the guard and sync tests read from the other passes.
func TestVerifiesTheSharedTicketPasses(t *testing.T) {
	f := loadTickets(t)
	for _, c := range []struct {
		name  string
		token string
		want  ticket.Claims
	}{
		{"compatible", f.Compatible, ticket.Claims{User: "u1", Doc: "doc-42", Write: true, Exp: fixtureExp}},
		{"docMismatch", f.DocMismatch, ticket.Claims{User: "u1", Doc: "other-doc", Write: true, Exp: fixtureExp}},
		{"readOnly", f.ReadOnly, ticket.Claims{User: "u1", Doc: "doc-42", Write: false, Exp: fixtureExp}},
		{"userTwo", f.UserTwo, ticket.Claims{User: "u2", Doc: "doc-42", Write: true, Exp: fixtureExp}},
	} {
		claims, valid := ticket.Verify(f.Secret, c.token, fixedNow)
		if !valid || claims != c.want {
			t.Errorf("%s: %v %+v, want %+v", c.name, valid, claims, c.want)
		}
	}
}

// Twin of TicketVerifierTests.RejectsTheFixedInvalidTickets and
// RejectsAnEmptyOrWrongSecret.
func TestRefusesTheSharedInvalidTicketPasses(t *testing.T) {
	f := loadTickets(t)
	for name, token := range map[string]string{
		"malformed":                f.Malformed,
		"expired":                  f.Expired,
		"tampered":                 f.Tampered,
		"noncanonicalHeaderTicket": f.NoncanonicalHeaderTicket,
		"padded signature":         f.Compatible + "=",
		"over-long signature":      f.Compatible + "AAAA",
	} {
		if _, valid := ticket.Verify(f.Secret, token, fixedNow); valid {
			t.Errorf("%s verified", name)
		}
	}
	for _, secret := range []string{"", "a-different-secret-with-at-least-32-characters"} {
		if _, valid := ticket.Verify(secret, f.Compatible, fixedNow); valid {
			t.Errorf("secret %q verified the compatible pass", secret)
		}
	}
}

// Twin of BlokTicketTests.MintsTheFixturePassesByteForByte.
func TestMintsTheSharedTicketPassesByteForByte(t *testing.T) {
	f := loadTickets(t)
	doc := func(id string) *string { return &id }
	for name, c := range map[string]struct {
		claims Claims
		want   string
	}{
		"compatible":  {Claims{User: "u1", Doc: doc("doc-42"), Write: true}, f.Compatible},
		"docMismatch": {Claims{User: "u1", Doc: doc("other-doc"), Write: true}, f.DocMismatch},
		"readOnly":    {Claims{User: "u1", Doc: doc("doc-42")}, f.ReadOnly},
		"userTwo":     {Claims{User: "u2", Doc: doc("doc-42"), Write: true}, f.UserTwo},
	} {
		ttl := int64(fixtureExp)
		c.claims.TTLSeconds = &ttl
		got, err := Mint(f.Secret, c.claims, time.Unix(0, 0))
		if err != nil || got != c.want {
			t.Errorf("%s: %q %v, want %q", name, got, err, c.want)
		}
	}
}
