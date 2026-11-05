package blokserver

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// Same names and seeding as http-host-contract.test.ts: the golden names
// files by these keys.
var goldenFiles = map[string]string{
	"text":        "0123456789abcdef0123456789abcdef.txt",
	"empty":       "fedcba9876543210fedcba9876543210.txt",
	"missing":     "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt",
	"directory":   "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.txt",
	"unreadable":  "cccccccccccccccccccccccccccccccc.txt",
	"unknownType": "dddddddddddddddddddddddddddddddd.blokunknown",
	"ivf":         "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.ivf",
	"dotFile":     ".env",
	"plainName":   "config.json",
	"uploadTemp":  ".blok-upload-0123456789abcdef0123456789abcdef",
}

type localFileGolden struct {
	Name     string                     `json:"name"`
	Method   string                     `json:"method"`
	File     string                     `json:"file"`
	Headers  map[string]json.RawMessage `json:"headers"`
	Response struct {
		Status  int                 `json:"status"`
		Headers map[string][]string `json:"headers"`
		Body    string              `json:"body"`
	} `json:"response"`
}

var boundaryPattern = regexp.MustCompile(`boundary=([0-9a-f]+)`)

// The C# answers for ranges, preconditions and failures, replayed in
// process so `go test` covers serveFile without the Node harness.
func TestLocalFilesMatchTheConformanceGolden(t *testing.T) {
	raw, err := os.ReadFile("../../../../test/unit/server-conformance/fixtures/local-file-responses.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []localFileGolden
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 100 {
		t.Fatalf("the golden has %d cases", len(cases))
	}
	directory := seedGoldenStorage(t)
	o := DefaultOptions()
	o.StorageDirectory = directory
	o.PublicURL = "https://uploads.example.com/files/"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(s.Handler(""))
	defer server.Close()
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	for _, c := range cases {
		// Root reads a mode-000 file.
		if c.File == "unreadable" && os.Getuid() == 0 {
			continue
		}
		request, err := http.NewRequest(c.Method, server.URL+"/files/"+goldenFiles[c.File], nil)
		if err != nil {
			t.Fatal(err)
		}
		for name, value := range c.Headers {
			var lines []string
			if json.Unmarshal(value, &lines) != nil {
				var line string
				if err := json.Unmarshal(value, &line); err != nil {
					t.Fatalf("%s: header %s: %v", c.Name, name, err)
				}
				lines = []string{line}
			}
			for _, line := range lines {
				request.Header.Add(name, line)
			}
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		content, err := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		body := string(content)
		headers := map[string][]string{}
		for name, values := range response.Header {
			if name != "Date" {
				headers[strings.ToLower(name)] = values
			}
		}
		// Go's client moves it out of Header.
		if len(response.TransferEncoding) > 0 {
			headers["transfer-encoding"] = response.TransferEncoding
		}
		if match := boundaryPattern.FindStringSubmatch(strings.Join(headers["content-type"], "")); match != nil {
			body = strings.ReplaceAll(body, match[1], "<boundary>")
			for name, values := range headers {
				for i := range values {
					values[i] = strings.ReplaceAll(values[i], match[1], "<boundary>")
				}
				headers[name] = values
			}
		}
		want := c.Response.Headers
		if response.StatusCode != c.Response.Status || body != c.Response.Body || !reflect.DeepEqual(headers, want) {
			t.Errorf("%s:\n got %d %v %q\nwant %d %v %q", c.Name,
				response.StatusCode, sortedHeaders(headers), body, c.Response.Status, sortedHeaders(want), c.Response.Body)
		}
	}
}

func seedGoldenStorage(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	write := func(key, content string) string {
		path := filepath.Join(directory, goldenFiles[key])
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	// The half second must not show: Last-Modified truncates to the second.
	modified := time.Date(2026, 1, 2, 3, 4, 5, 500_000_000, time.UTC)
	for _, key := range []string{"text", "ivf", "unknownType", "empty"} {
		content := "0123456789abcdefghij"
		if key == "empty" {
			content = ""
		}
		if err := os.Chtimes(write(key, content), modified, modified); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range []string{"dotFile", "plainName", "uploadTemp"} {
		write(key, "0123456789abcdefghij")
	}
	unreadable := write("unreadable", "0123456789abcdefghij")
	if err := os.Chmod(unreadable, 0); err != nil {
		t.Fatal(err)
	}
	// TempDir's cleanup cannot remove a mode-000 file on every platform.
	t.Cleanup(func() { _ = os.Chmod(unreadable, 0o600) })
	if err := os.Mkdir(filepath.Join(directory, goldenFiles["directory"]), 0o700); err != nil {
		t.Fatal(err)
	}
	return directory
}

func sortedHeaders(h map[string][]string) []string {
	var lines []string
	for name, values := range h {
		lines = append(lines, name+": "+strings.Join(values, " | "))
	}
	sort.Strings(lines)
	return lines
}

// The golden has no range whose end is exactly the file size; one past the
// last byte must clamp like any end beyond it.
func TestARangeEndingAtTheFileSizeClampsToTheLastByte(t *testing.T) {
	o := DefaultOptions()
	o.StorageDirectory = seedGoldenStorage(t)
	o.PublicURL = "https://uploads.example.com/files/"
	s, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/files/"+goldenFiles["text"], nil)
	request.Header.Set("Range", "bytes=10-20")
	recorder := httptest.NewRecorder()
	s.Handler("").ServeHTTP(recorder, request)
	if got := recorder.Header().Get("Content-Range"); got != "bytes 10-19/20" {
		t.Fatalf("Content-Range %q, want bytes 10-19/20", got)
	}
	if recorder.Code != http.StatusPartialContent || recorder.Body.String() != "abcdefghij" ||
		recorder.Header().Get("Content-Length") != "10" {
		t.Fatalf("got %d %q, Content-Length %q", recorder.Code, recorder.Body.String(), recorder.Header().Get("Content-Length"))
	}
}
