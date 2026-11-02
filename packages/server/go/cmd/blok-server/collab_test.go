package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
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

// H34: the host gives the drain C#'s 30 s (HostCollab.ShutdownTimeout), so a
// doc endpoint that takes 2 s to save still gets the room's last state.
func TestTheShutdownDrainOutlastsASlowDocEndpoint(t *testing.T) {
	saved := make(chan string, 4)
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, "null")
			return
		}
		body, _ := io.ReadAll(r.Body)
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusNoContent)
		saved <- string(body)
	}))
	defer endpoint.Close()

	ctx, cancel := context.WithCancel(context.Background())
	stderr := &syncBuffer{}
	done := make(chan int, 1)
	listen := freePort(t)
	go func() {
		done <- run(ctx, []string{"--listen", listen, "--auth", "none", "--collab", "--doc-endpoint", endpoint.URL,
			"--storage-dir", "", "--collab-dir", t.TempDir()}, noEnv, stderr)
	}()
	waitFor(t, func() bool { return strings.Contains(stderr.String(), " listening on ") })

	edit, _ := http.NewRequest(http.MethodPost, "http://"+listen+"/sync/doc/edit",
		strings.NewReader(`{"ops":[{"op":"insert","id":"a","block":{"type":"paragraph","data":{"text":"kept"}}}]}`))
	edit.Header.Set("Content-Type", "application/json")
	edit.Header.Set("Blok-Idempotency-Key", "k1")
	response, err := http.DefaultClient.Do(edit)
	if err != nil || response.StatusCode != http.StatusNoContent {
		t.Fatalf("edit: %v %v", response, err)
	}
	response.Body.Close()

	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit %d: %s", code, stderr.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run did not return")
	}
	if strings.Contains(stderr.String(), "the shutdown drain did not complete") {
		t.Fatalf("the drain was cut short: %s", stderr.String())
	}
	select {
	case body := <-saved:
		if !strings.Contains(body, `"kept"`) {
			t.Fatalf("saved %s", body)
		}
	default:
		t.Fatal("the endpoint never finished a save")
	}
}
