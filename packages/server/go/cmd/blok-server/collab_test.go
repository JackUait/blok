package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

// runUntilListening starts the host and stops it once it is listening; the
// returned stderr holds everything written before the stop.
func runUntilListening(t *testing.T, args []string, getenv func(string) string) string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stderr := &syncBuffer{}
	done := make(chan int, 1)
	go func() { done <- run(ctx, append([]string{"--listen", freePort(t)}, args...), getenv, stderr) }()
	waitFor(t, func() bool { return strings.Contains(stderr.String(), " listening on ") })
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit %d: %s", code, stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return after cancel")
	}
	return stderr.String()
}

// Go twins of HostProcessTests.WarnsWhenTheDocEndpointAuthComesFromTheFlag
// and ReadsTheDocEndpointAuthFromTheEnvironmentWithoutWarning (H20).
func TestTheDocEndpointAuthWarnsOnlyWhenItComesFromTheFlag(t *testing.T) {
	collab := []string{"--collab", "--doc-endpoint", "https://app.example.com/api/blok-docs", "--storage-dir", "", "--collab-dir", t.TempDir()}

	fromFlag := runUntilListening(t, append(collab, "--doc-endpoint-auth", "Bearer app-token"), noEnv)
	if !strings.Contains(fromFlag, "warning: --doc-endpoint-auth puts the credential in this machine's process list") {
		t.Fatalf("no warning from the flag: %q", fromFlag)
	}

	fromEnvironment := runUntilListening(t, collab, func(name string) string {
		if name == "BLOK_DOC_ENDPOINT_AUTH" {
			return "Bearer environment-token"
		}
		return ""
	})
	listening := strings.Index(fromEnvironment, " listening on ")
	if strings.Contains(fromEnvironment[:listening], "--doc-endpoint-auth") {
		t.Fatalf("the environment warned: %q", fromEnvironment)
	}
}
