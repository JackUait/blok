package outbound

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// RedirectLocationsMatchTheFixture: a 302 with the listed Location lines,
// and what Get makes of it. Each char of a location is one byte on the
// wire; PORT is the origin's port.
func TestRedirectLocationsMatchTheFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../../test/unit/server-conformance/fixtures/outbound-redirect-locations.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Locations []string `json:"locations"`
		} `json:"cases"`
		Answers []string `json:"answers"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != len(fixture.Answers) || len(fixture.Cases) == 0 {
		t.Fatalf("%d cases, %d answers", len(fixture.Cases), len(fixture.Answers))
	}
	for i, c := range fixture.Cases {
		if got := fetchRedirect(t, c.Locations); got != fixture.Answers[i] {
			t.Errorf("%q: got %q, C# %q", c.Locations, got, fixture.Answers[i])
		}
	}
}

// latin1 writes each char as one byte, as C#'s Encoding.Latin1 does.
func latin1(s string) []byte {
	out := make([]byte, 0, len(s))
	for _, r := range s {
		out = append(out, byte(r))
	}
	return out
}

func fetchRedirect(t *testing.T, locations []string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	portText := strconv.Itoa(port)
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
				n, _ := conn.Read(buffer)
				head := "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
				if strings.HasPrefix(string(buffer[:n]), "GET /start ") {
					head = "HTTP/1.1 302 Found\r\n"
					for _, location := range locations {
						head += "Location: " + strings.ReplaceAll(location, "PORT", portText) + "\r\n"
					}
					head += "Content-Length: 0\r\nConnection: close\r\n\r\n"
				}
				_, _ = conn.Write(latin1(head))
			}()
		}
	}()
	start := "http://127.0.0.1:" + portText
	f := NewFetcher(ExactOriginPolicy{Origin: start, Port: port})
	response, err := f.Get(context.Background(), start+"/start", Limits{Timeout: 2 * time.Second, MaxBytes: 1024, MaxRedirects: 3})
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
	if response.StatusCode == 302 {
		return "302"
	}
	return strconv.Itoa(response.StatusCode) + " " + strings.ReplaceAll(strings.TrimPrefix(response.FinalURL, start), portText, "PORT")
}
