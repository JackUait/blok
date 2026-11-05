package outbound

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// ResponseHeadsMatchTheFixture: the origin sends the case's response, and
// the answer is what Get makes of it. Each char of a response is one byte
// on the wire; {PAD:n} is n 'a' bytes.
func TestResponseHeadsMatchTheFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../../test/unit/server-conformance/fixtures/outbound-response-heads.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Response string `json:"response"`
		} `json:"cases"`
		Answers []string `json:"answers"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != len(fixture.Answers) || len(fixture.Cases) == 0 {
		t.Fatalf("%d cases, %d answers", len(fixture.Cases), len(fixture.Answers))
	}
	pad := regexp.MustCompile(`\{PAD:(\d+)\}`)
	for i, c := range fixture.Cases {
		wire := pad.ReplaceAllStringFunc(c.Response, func(m string) string {
			n, _ := strconv.Atoi(pad.FindStringSubmatch(m)[1])
			return strings.Repeat("a", n)
		})
		if got := fetchResponse(t, latin1(wire)); got != fixture.Answers[i] {
			t.Errorf("%q: got %q, C# %q", c.Response, got, fixture.Answers[i])
		}
	}
}

// bytesAsChars reads each byte as one char, as C#'s Latin-1 strings hold
// them.
func bytesAsChars(s string) string {
	runes := make([]rune, len(s))
	for i := 0; i < len(s); i++ {
		runes[i] = rune(s[i])
	}
	return string(runes)
}

func fetchResponse(t *testing.T, wire []byte) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				buffer := make([]byte, 4096)
				_, _ = conn.Read(buffer)
				_, _ = conn.Write(wire)
			}()
		}
	}()
	port := listener.Addr().(*net.TCPAddr).Port
	start := "http://127.0.0.1:" + strconv.Itoa(port)
	f := NewFetcher(ExactOriginPolicy{Origin: start, Port: port})
	response, err := f.Get(context.Background(), start+"/", Limits{Timeout: 2 * time.Second, MaxBytes: 1024, MaxRedirects: 3})
	if err != nil {
		for name, failure := range map[string]Failure{
			"BlockedDestination": Blocked, "TooManyRedirects": TooManyRedirects,
			"ResponseTooLarge": TooLarge, "TimedOut": TimedOut,
		} {
			if IsFailure(err, failure) {
				return name
			}
		}
		return err.Error()
	}
	defer response.Release()
	return bytesAsChars(strconv.Itoa(response.StatusCode) + " ct=" + response.ContentType +
		" x=" + strings.Join(response.Header.Values("X-Probe"), "|") + " b=" + string(response.Body))
}
