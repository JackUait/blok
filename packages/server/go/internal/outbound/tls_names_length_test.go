package outbound

import (
	"strings"
	"testing"
)

// rustls's DnsName: at most 253 bytes, a trailing dot included.
func TestTheTLSNameRuleCountsATrailingDot(t *testing.T) {
	name := strings.Repeat(strings.Repeat("a", 63)+".", 3) + strings.Repeat("b", 61)
	if len(name) != 253 || !tlsHostName(name) {
		t.Fatalf("a 253-byte name: %d %v", len(name), tlsHostName(name))
	}
	if tlsHostName(name + ".") {
		t.Fatal("253 bytes and a dot passed")
	}
}
