//go:build darwin

package sectrust

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/sectrust/trustfixture"
)

func verdict(ok bool) string {
	if ok {
		return "accept"
	}
	return "refuse"
}

func eachChain(t *testing.T, check func(trustfixture.Case, trustfixture.Chain) (string, string)) {
	t.Helper()
	cases, err := trustfixture.Load(trustfixture.Path)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		chain, err := trustfixture.Build(c)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		if got, want := check(c, chain); got != want {
			t.Errorf("%s: got %s, C# %s", c.Name, got, want)
		}
	}
}

// C#'s MacOsCertificateTrust, measured on the fixture's chains.
func TestGuardedTrustsTheChainsCSharpTrusts(t *testing.T) {
	eachChain(t, func(c trustfixture.Case, chain trustfixture.Chain) (string, string) {
		return verdict(Guarded(chain.Sent, c.Host, [][]byte{chain.Root.Raw})), c.Guarded
	})
}

// SslStream with HttpClient's defaults, measured on the same chains.
func TestOperatorTrustsTheChainsCSharpTrusts(t *testing.T) {
	eachChain(t, func(c trustfixture.Case, chain trustfixture.Chain) (string, string) {
		return verdict(Operator(chain.Sent, c.Host, [][]byte{chain.Root.Raw})), c.Operator
	})
}
