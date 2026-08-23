//go:build integration

package fetchguard_test

import (
	"context"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

// nip.io resolves 10-0-0-1.nip.io to 10.0.0.1: a public hostname pointing at a
// private address. Validating the hostname instead of the resolved IP passes
// this. Needs live DNS, which is why it sits behind the integration tag.
func TestRejectsPublicHostnameResolvingToPrivateAddress(t *testing.T) {
	c := fetchguard.New(fetchguard.Config{Timeout: 5 * time.Second, MaxBytes: 1 << 20, MaxRedirects: 3})

	_, err := c.Get(context.Background(), "http://10-0-0-1.nip.io/")
	assertBlocked(t, err, &addressGate)
}

// The same trick aimed at the cloud metadata address.
func TestRejectsPublicHostnameResolvingToMetadataAddress(t *testing.T) {
	c := fetchguard.New(fetchguard.Config{Timeout: 5 * time.Second, MaxBytes: 1 << 20, MaxRedirects: 3})

	_, err := c.Get(context.Background(), "http://169-254-169-254.nip.io/latest/meta-data/")
	assertBlocked(t, err, &addressGate)
}
