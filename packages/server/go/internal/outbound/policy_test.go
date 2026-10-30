package outbound

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
)

// Captured from GuardedOutboundPolicy by OutboundPolicyFixtureTests. The
// conformance build swaps the policy, so this is the only oracle for it.
const policyFixture = "../../../../../test/unit/server-conformance/fixtures/outbound-policy.json"

type verdict struct {
	Allowed bool    `json:"allowed"`
	URL     string  `json:"url"`
	Host    string  `json:"host"`
	Port    int     `json:"port"`
	Literal *string `json:"literal"`
}

func TestPolicyMatchesTheCSharpFixture(t *testing.T) {
	data, err := os.ReadFile(policyFixture)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		IPs      []string    `json:"ips"`
		URLs     []string    `json:"urls"`
		Relative [][2]string `json:"relative"`
		Answers  struct {
			IPs      []bool    `json:"ips"`
			URLs     []verdict `json:"urls"`
			Relative []verdict `json:"relative"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy{}
	for i, ip := range fixture.IPs {
		address, ok := dotnet.ParseIP(ip)
		if !ok {
			t.Fatalf("%s does not parse", ip)
		}
		if got := policy.AddressAllowed(address); got != fixture.Answers.IPs[i] {
			t.Errorf("%s: allowed %v, want %v", ip, got, fixture.Answers.IPs[i])
		}
	}
	check := func(label string, target Target, err error, want verdict) {
		got := verdict{Allowed: err == nil}
		if err == nil {
			got.URL, got.Host, got.Port = target.URL.AbsoluteURI, target.Host, target.Port
			if target.Literal.IsValid() {
				literal := target.Literal.String()
				got.Literal = &literal
			}
		}
		same := got.Allowed == want.Allowed && got.URL == want.URL && got.Host == want.Host && got.Port == want.Port &&
			(got.Literal == nil) == (want.Literal == nil)
		if same && got.Literal != nil {
			gotAddress, _ := dotnet.ParseIP(*got.Literal)
			wantAddress, _ := dotnet.ParseIP(*want.Literal)
			same = gotAddress == wantAddress
		}
		if !same {
			t.Errorf("%s: %+v, want %+v", label, got, want)
		}
	}
	for i, url := range fixture.URLs {
		target, err := policy.Validate(url, nil)
		check(url, target, err, fixture.Answers.URLs[i])
	}
	for i, pair := range fixture.Relative {
		base, _ := dotnet.ParseAbsoluteURI(pair[0])
		target, err := policy.Validate(pair[1], base)
		check(pair[0]+" + "+pair[1], target, err, fixture.Answers.Relative[i])
	}
}
