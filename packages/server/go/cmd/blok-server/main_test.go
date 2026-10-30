package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// syncBuffer lets the test read stderr while run writes it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func freePort(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met within 5s")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHelpPrintsUsageAndExitsZero(t *testing.T) {
	for _, flag := range []string{"--help", "-h", "-help"} {
		var stderr bytes.Buffer
		code := run(context.Background(), []string{flag}, &stderr)

		if code != 0 {
			t.Fatalf("%s: exit %d", flag, code)
		}
		if stderr.String() != usage {
			t.Fatalf("%s: stderr = %q", flag, stderr.String())
		}
	}
}

// The C# host owns the usage text; this keeps the Go copy in lockstep.
func TestUsageMatchesTheCSharpHost(t *testing.T) {
	source, err := os.ReadFile("../../../dotnet/Blok.Server.Host/HostArguments.cs")
	if errors.Is(err, os.ErrNotExist) {
		t.Skip("C# source is not beside this module")
	}
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "internal const string Usage =")
	open := strings.Index(text[start:], `"""`) + start + 3
	end := strings.Index(text[open:], `"""`) + open
	lines := strings.Split(text[open:end], "\n")[1:]
	indent := lines[len(lines)-1]
	for i, line := range lines {
		lines[i] = strings.TrimPrefix(line, indent)
	}
	// A C# raw string drops the newline before its closing quotes.
	want := strings.Join(lines[:len(lines)-1], "\n")

	if usage != want {
		t.Fatalf("usage drifted from HostArguments.Usage:\n%q\nwant\n%q", usage, want)
	}
}

func TestUnknownFlagPrintsErrorThenUsageAndExitsTwo(t *testing.T) {
	var stderr bytes.Buffer
	code := run(context.Background(), []string{"--not-a-real-flag"}, &stderr)

	if code != 2 {
		t.Fatalf("exit %d", code)
	}
	want := "flag provided but not defined: -not-a-real-flag\n" + usage
	if stderr.String() != want {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestMissingFlagValueExitsTwo(t *testing.T) {
	var stderr bytes.Buffer
	code := run(context.Background(), []string{"--listen"}, &stderr)

	if code != 2 || !strings.HasPrefix(stderr.String(), "flag needs an argument: -listen\n") {
		t.Fatalf("exit %d, stderr %q", code, stderr.String())
	}
}

func TestListenDefault(t *testing.T) {
	options, code := parseArguments([]string{}, io.Discard)

	if code != -1 || options.listen != "127.0.0.1:4000" || options.auth != "none" {
		t.Fatalf("code %d, options %+v", code, options)
	}
}

func TestListenAcceptsEveryFlagSpelling(t *testing.T) {
	for _, args := range [][]string{
		{"--listen", "127.0.0.1:5000"},
		{"-listen", "127.0.0.1:5000"},
		{"--listen=127.0.0.1:5000"},
		{"-listen=127.0.0.1:5000"},
	} {
		options, code := parseArguments(args, io.Discard)
		if code != -1 || options.listen != "127.0.0.1:5000" {
			t.Fatalf("%v: code %d, listen %q", args, code, options.listen)
		}
	}
}

func TestBareBooleanFlagsParse(t *testing.T) {
	_, code := parseArguments([]string{"--no-unfurl", "--collab", "--collab-journal"}, io.Discard)

	if code != -1 {
		t.Fatalf("code %d", code)
	}
}

func TestBindAddressMatchesTheCSharpHost(t *testing.T) {
	cases := map[string]string{
		":4000":          "0.0.0.0:4000",
		"127.0.0.1:4000": "127.0.0.1:4000",
		"[::1]:4000":     "[::1]:4000",
	}
	for listen, want := range cases {
		if got := bindAddress(listen); got != want {
			t.Fatalf("%q: got %q, want %q", listen, got, want)
		}
	}
}

func TestMalformedListenRefusesToStart(t *testing.T) {
	cases := map[string]string{
		"localhost":       "blok-server refused to start: listen tcp: address localhost: missing port in address\n",
		"localhost:65536": "blok-server refused to start: listen tcp: address 65536: invalid port\n",
	}
	for listen, want := range cases {
		var stderr bytes.Buffer
		code := run(context.Background(), []string{"--listen", listen}, &stderr)

		if code != 1 || stderr.String() != want {
			t.Fatalf("%q: exit %d, stderr %q", listen, code, stderr.String())
		}
	}
}

func TestLostBindRefusesToStart(t *testing.T) {
	owner, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()

	var stderr bytes.Buffer
	code := run(context.Background(), []string{"--listen", owner.Addr().String()}, &stderr)

	if code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.HasPrefix(stderr.String(), "blok-server refused to start: ") ||
		!strings.Contains(stderr.String(), "address already in use") ||
		strings.Contains(stderr.String(), " listening on ") {
		t.Fatalf("stderr %q", stderr.String())
	}
}

func TestListeningLineComesAfterBindAndHealthAnswers(t *testing.T) {
	address := freePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	stderr := &syncBuffer{}
	done := make(chan int, 1)

	go func() { done <- run(ctx, []string{"--listen", address}, stderr) }()

	waitFor(t, func() bool { return strings.Contains(stderr.String(), " listening on ") })

	// The line is written only after bind, so the port answers at once.
	response, err := http.Get("http://" + address + "/health")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()

	want := "blok-server dev listening on " + address + " (--auth none)\n"
	if stderr.String() != want {
		t.Fatalf("stderr %q, want %q", stderr.String(), want)
	}
	if response.StatusCode != 200 || string(body) != "{\"status\":\"ok\",\"version\":\"dev\"}\n" {
		t.Fatalf("health %d %q", response.StatusCode, body)
	}

	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit %d", code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("run did not return within 2s of cancel")
	}
}

func request(t *testing.T, method, path string) *http.Response {
	t.Helper()
	recorder := httptest.NewRecorder()
	newHandler().ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
	return recorder.Result()
}

func TestHealthWire(t *testing.T) {
	get := request(t, "GET", "/health")
	body, _ := io.ReadAll(get.Body)
	if get.StatusCode != 200 ||
		get.Header.Get("Content-Type") != "application/json" ||
		string(body) != "{\"status\":\"ok\",\"version\":\"dev\"}\n" {
		t.Fatalf("GET %d %q %q", get.StatusCode, get.Header.Get("Content-Type"), body)
	}

	head := request(t, "HEAD", "/health")
	headBody, _ := io.ReadAll(head.Body)
	if head.StatusCode != 200 || head.Header.Get("Content-Type") != "application/json" || len(headBody) != 0 {
		t.Fatalf("HEAD %d %q %q", head.StatusCode, head.Header.Get("Content-Type"), headBody)
	}

	post := request(t, "POST", "/health")
	postBody, _ := io.ReadAll(post.Body)
	if post.StatusCode != 405 ||
		post.Header.Get("Allow") != "GET, HEAD" ||
		post.Header.Get("Content-Type") != "text/plain; charset=utf-8" ||
		string(postBody) != "Method Not Allowed\n" {
		t.Fatalf("POST %d %q %q", post.StatusCode, post.Header, postBody)
	}

	missing := request(t, "GET", "/missing")
	missingBody, _ := io.ReadAll(missing.Body)
	if missing.StatusCode != 404 ||
		missing.Header.Get("Content-Type") != "text/plain; charset=utf-8" ||
		string(missingBody) != "404 page not found\n" {
		t.Fatalf("missing %d %q", missing.StatusCode, missingBody)
	}
}

func TestHealthReportsTheStampedVersion(t *testing.T) {
	saved := version
	version = "1.2.3"
	defer func() { version = saved }()

	response := request(t, "GET", "/health")
	body, _ := io.ReadAll(response.Body)
	if string(body) != "{\"status\":\"ok\",\"version\":\"1.2.3\"}\n" {
		t.Fatalf("body %q", body)
	}
}

// buildBinary builds the real command, so signals and -ldflags are tested
// on a process like the one the conformance runner starts.
func buildBinary(t *testing.T, args ...string) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "blok-server")
	build := exec.Command("go", append(append([]string{"build"}, args...), "-o", binary, ".")...)
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		t.Fatal(err)
	}
	return binary
}

func startBinary(t *testing.T, binary, address string) (*exec.Cmd, *syncBuffer) {
	t.Helper()
	stderr := &syncBuffer{}
	command := exec.Command(binary, "--listen", address)
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill() })
	waitFor(t, func() bool { return strings.Contains(stderr.String(), " listening on ") })
	return command, stderr
}

func TestBinaryExitsWithinTwoSecondsOfSIGTERM(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the binary")
	}
	command, _ := startBinary(t, buildBinary(t), freePort(t))

	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()

	select {
	case err := <-exited:
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			t.Fatalf("exit %d", exitError.ExitCode())
		}
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not exit within 2s of SIGTERM")
	}
}

func TestBinaryVersionComesFromLdflags(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the binary")
	}
	address := freePort(t)
	_, stderr := startBinary(t, buildBinary(t, "-ldflags", "-X main.version=9.8.7"), address)

	if !strings.HasPrefix(stderr.String(), "blok-server 9.8.7 listening on ") {
		t.Fatalf("stderr %q", stderr.String())
	}
	response, err := http.Get("http://" + address + "/health")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if string(body) != "{\"status\":\"ok\",\"version\":\"9.8.7\"}\n" {
		t.Fatalf("body %q", body)
	}
}
