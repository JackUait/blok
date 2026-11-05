package outbound

import (
	"context"
	"strconv"
	"strings"
	"testing"
)

// Measured on the C# fetcher (macOS, SecPolicyCreateSSL) with a trusted
// certificate naming each host: a label that starts or ends with '-', a
// label past 63 bytes, and an all-numeric last label are refused at TLS.
// On Linux, .NET's IdnMapping refuses the same hyphen and length cases.
func TestRefusesAtTLSTheHostNamesDotNetRefuses(t *testing.T) {
	for _, c := range []struct {
		host string
		ok   bool
	}{
		{"ok.example", true},
		{"a_b.example", true},
		{"ab--cd.example", true},
		{"xn--zz.example", true},
		{"a.1b.example", true},
		{"1.2.3.example", true},
		{"a.-b.example", false},
		{"foo-.example", false},
		{"-a.example", false},
		{"x.123", false},
		{strings.Repeat("a", 64) + ".example", false},
	} {
		t.Run(c.host, func(t *testing.T) {
			pki := newPKI(t, c.host, nil)
			o := startTLSOrigin(t, pki.leaf, nil)
			f := loopbackFetcher(c.host, o.port, pki.pool)
			response, err := f.Get(context.Background(), "https://"+c.host+":"+strconv.Itoa(o.port)+"/", testLimits)
			if c.ok {
				if err != nil {
					t.Fatal(err)
				}
				response.Release()
				return
			}
			if err == nil {
				response.Release()
				t.Fatal("fetched")
			}
			wantBlocked(t, err)
		})
	}
}
