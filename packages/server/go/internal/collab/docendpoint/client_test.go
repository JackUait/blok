package docendpoint

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

const lineage = "00112233445566778899aabbccddeeff"

type recorded struct {
	method, url, body string
	header            http.Header
}

// recorder is RequestRecorder: it logs each request, then answers it.
type recorder struct {
	mu       sync.Mutex
	requests []recorded
	respond  func(*http.Request) (*http.Response, error)
}

func (r *recorder) RoundTrip(request *http.Request) (*http.Response, error) {
	var body []byte
	if request.Body != nil {
		body, _ = io.ReadAll(request.Body)
	}
	r.mu.Lock()
	r.requests = append(r.requests, recorded{request.Method, request.URL.String(), string(body), request.Header.Clone()})
	r.mu.Unlock()
	return r.respond(request)
}

func answer(status int, body string, length bool) *http.Response {
	response := &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body)), ContentLength: -1}
	if length {
		response.ContentLength = int64(len(body))
	}
	return response
}

func jsonAnswer(body string) func(*http.Request) (*http.Response, error) {
	return func(*http.Request) (*http.Response, error) { return answer(200, body, true), nil }
}

type setup struct {
	endpoint, authorization string
	timeout                 time.Duration
	maxResponseBytes        int64
}

func client(t *testing.T, r *recorder, s setup) *Client {
	if s.endpoint == "" {
		s.endpoint = "https://app.example.com/api/docs"
	}
	if s.authorization == "" {
		s.authorization = "Bearer secret"
	} else if s.authorization == "-" {
		s.authorization = ""
	}
	if s.timeout == 0 {
		s.timeout = 30 * time.Second
	}
	endpoint, ok := dotnet.ParseAbsoluteURI(s.endpoint)
	if !ok {
		t.Fatal(s.endpoint)
	}
	return New(Options{Endpoint: endpoint, Authorization: s.authorization, RequestTimeout: s.timeout, MaxResponseBytes: s.maxResponseBytes}, r)
}

func node(t *testing.T, text string) any {
	value, err := jsjson.Parse([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func ptr(s string) *string { return &s }

func endpointError(t *testing.T, err error) *Error {
	var e *Error
	if !errors.As(err, &e) {
		t.Fatalf("not an endpoint error: %v", err)
	}
	return e
}

var bg = context.Background()

// Twins of DocEndpointClientTests.
func TestLoadGetsTheDocumentUrlWithTheAuthorizationVerbatim(t *testing.T) {
	r := &recorder{respond: jsonAnswer(`{"blocks":[]}`)}
	if _, err := client(t, r, setup{endpoint: "https://app.example.com/api/docs/", authorization: "Bearer abc def"}).Load(bg, "doc 1/x"); err != nil {
		t.Fatal(err)
	}
	if len(r.requests) != 1 {
		t.Fatal(len(r.requests))
	}
	got := r.requests[0]
	if got.method != "GET" || got.url != "https://app.example.com/api/docs/doc%201%2Fx" || got.header.Get("Authorization") != "Bearer abc def" || got.header.Get("Accept") != "application/json" {
		t.Fatalf("%+v", got)
	}
}

func TestLoadOmitsTheAuthorizationHeaderWhenNoneIsConfigured(t *testing.T) {
	r := &recorder{respond: jsonAnswer(`{"blocks":[]}`)}
	if _, err := client(t, r, setup{authorization: "-"}).Load(bg, "doc"); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.requests[0].header["Authorization"]; ok {
		t.Fatal("sent")
	}
}

func TestRefusesAnAuthorizationValueTheHeaderCannotCarry(t *testing.T) {
	for _, auth := range []string{"Bearer secret\n", "Bearer\r\nsecret"} {
		r := &recorder{respond: jsonAnswer(`{"blocks":[]}`)}
		_, err := client(t, r, setup{authorization: auth}).Load(bg, "doc")
		if !strings.Contains(endpointError(t, err).Message, "Authorization") || len(r.requests) != 0 {
			t.Fatal(err)
		}
	}
}

func TestLoadReadsABareOutputDataDocument(t *testing.T) {
	r := &recorder{respond: jsonAnswer(`{"time":1,"blocks":[{"id":"a"}],"version":"2.31.0"}`)}
	loaded, err := client(t, r, setup{}).Load(bg, "doc")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Data == nil || loaded.Data.Kind != jsjson.KindObject || loaded.Version != nil {
		t.Fatalf("%+v", loaded)
	}
}

func TestLoadReadsAPersistedDocumentEnvelope(t *testing.T) {
	for body, version := range map[string]*string{
		`{"data":{"blocks":[{"id":"a"}]},"version":"v7"}`: ptr("v7"),
		`{"data":{"blocks":[{"id":"a"}]},"version":42}`:   ptr("42"),
		`{"data":{"blocks":[{"id":"a"}]},"version":1e21}`: ptr("1E+21"),
		`{"data":{"blocks":[{"id":"a"}]}}`:                nil,
	} {
		loaded, err := client(t, &recorder{respond: jsonAnswer(body)}, setup{}).Load(bg, "doc")
		if err != nil {
			t.Fatal(err)
		}
		if loaded.Data == nil || (version == nil) != (loaded.Version == nil) || (version != nil && *version != *loaded.Version) {
			t.Fatalf("%s: %+v", body, loaded)
		}
	}
}

func TestLoadReadsANullDocumentAsAnEmptySeed(t *testing.T) {
	for body, version := range map[string]*string{`{"data":null,"version":"v1"}`: ptr("v1"), `null`: nil} {
		loaded, err := client(t, &recorder{respond: jsonAnswer(body)}, setup{}).Load(bg, "doc")
		if err != nil || loaded.Data != nil || (version == nil) != (loaded.Version == nil) {
			t.Fatalf("%s: %+v %v", body, loaded, err)
		}
	}
}

func TestLoadRejectsANonSuccessStatus(t *testing.T) {
	for _, status := range []int{404, 401, 500, 302} {
		r := &recorder{respond: func(*http.Request) (*http.Response, error) {
			response := answer(status, "nope", true)
			// No redirect is followed.
			response.Header.Set("Location", "https://elsewhere.example.com/doc")
			return response, nil
		}}
		_, err := client(t, r, setup{}).Load(bg, "doc")
		e := endpointError(t, err)
		if e.StatusCode != status || !strings.Contains(e.Message, strconv.Itoa(status)) || len(r.requests) != 1 {
			t.Fatal(e)
		}
	}
}

func TestAnErrorStatusIsReportedWithAPrefixOfItsBodyWithoutBufferingIt(t *testing.T) {
	body := strings.Repeat("x", 600) + "\r\nEND"
	r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(500, body, true), nil }}
	_, err := client(t, r, setup{maxResponseBytes: 128}).Load(bg, "doc")
	e := endpointError(t, err)
	if e.StatusCode != 500 || !strings.Contains(e.Message, strings.Repeat("x", 512)) || strings.Contains(e.Message, strings.Repeat("x", 513)) || strings.Contains(e.Message, "END") {
		t.Fatal(e.Message)
	}
}

func TestAnErrorBodyIsFlattenedToOneLineInTheMessage(t *testing.T) {
	r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(502, "upstream\r\n  down", true), nil }}
	_, err := client(t, r, setup{}).Load(bg, "doc")
	if e := endpointError(t, err); e.Message != "collab: the doc endpoint GET returned 502: upstream down" {
		t.Fatal(e.Message)
	}
	r = &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(502, " \n", true), nil }}
	_, err = client(t, r, setup{}).Load(bg, "doc")
	if e := endpointError(t, err); e.Message != "collab: the doc endpoint GET returned 502." {
		t.Fatal(e.Message)
	}
}

func TestLoadRejectsAMalformedBody(t *testing.T) {
	for _, body := range []string{``, `{not json`, `[]`, `"text"`, `{"data":"text"}`, `{"data":{},"version":true}`} {
		_, err := client(t, &recorder{respond: jsonAnswer(body)}, setup{}).Load(bg, "doc")
		if e := endpointError(t, err); e.StatusCode != 0 {
			t.Fatal(e)
		}
	}
}

func TestSavePutsTheBareDocumentWithTheVersionHeader(t *testing.T) {
	r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(204, "", true), nil }}
	document := node(t, `{"time":5,"blocks":[{"id":"a","type":"paragraph","data":{}}]}`)
	if _, err := client(t, r, setup{authorization: "Token xyz"}).Save(bg, "doc-1", document, ptr("v7"), nil); err != nil {
		t.Fatal(err)
	}
	got := r.requests[0]
	if got.method != "PUT" || got.url != "https://app.example.com/api/docs/doc-1" || got.header.Get("Authorization") != "Token xyz" ||
		got.header.Get(VersionHeader) != "v7" || !strings.HasPrefix(got.header.Get("Content-Type"), "application/json") ||
		got.body != `{"time":5,"blocks":[{"id":"a","type":"paragraph","data":{}}]}` {
		t.Fatalf("%+v", got)
	}
}

func TestSaveOmitsTheVersionHeaderWhenNoVersionIsKnown(t *testing.T) {
	r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(200, "", true), nil }}
	if _, err := client(t, r, setup{}).Save(bg, "doc", node(t, `{"blocks":[]}`), nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.requests[0].header[VersionHeader]; ok {
		t.Fatal("sent")
	}
}

func TestProjectionCarriesLineageAndServerSequence(t *testing.T) {
	r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(204, "", true), nil }}
	c := client(t, r, setup{})
	document := node(t, `{"blocks":[]}`)
	if _, err := c.Save(bg, "doc", document, ptr("v7"), &Projection{lineage, ^uint64(0)}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Save(bg, "doc", document, ptr("v7"), nil); err != nil {
		t.Fatal(err)
	}
	stamped, unstamped := r.requests[0].header, r.requests[1].header
	if stamped.Get(LineageHeader) != lineage || stamped.Get(SequenceHeader) != "18446744073709551615" || stamped.Get(VersionHeader) != "v7" {
		t.Fatal(stamped)
	}
	if _, ok := unstamped[LineageHeader]; ok {
		t.Fatal(unstamped)
	}
	if _, ok := unstamped[SequenceHeader]; ok || unstamped.Get(VersionHeader) != "v7" {
		t.Fatal(unstamped)
	}
}

func TestSaveReturnsTheVersionTheEndpointAnswersWithIfAny(t *testing.T) {
	for body, want := range map[string]*string{`{"version":"v8"}`: ptr("v8"), `{"version":9}`: ptr("9"), `{"ok":true}`: nil, ``: nil, `not json`: nil, `{"version":true}`: nil} {
		version, err := client(t, &recorder{respond: jsonAnswer(body)}, setup{}).Save(bg, "doc", node(t, `{"blocks":[]}`), ptr("v7"), nil)
		if err != nil || (want == nil) != (version == nil) || (want != nil && *want != *version) {
			t.Fatalf("%q: %v %v", body, version, err)
		}
	}
}

func TestSaveRejectsANonSuccessStatus(t *testing.T) {
	for _, status := range []int{409, 502} {
		r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(status, "", true), nil }}
		_, err := client(t, r, setup{}).Save(bg, "doc", node(t, `{"blocks":[]}`), nil, nil)
		if e := endpointError(t, err); e.StatusCode != status {
			t.Fatal(e)
		}
	}
}

func hang(request *http.Request) (*http.Response, error) {
	<-request.Context().Done()
	return nil, request.Context().Err()
}

func TestRequestsGiveUpAfterTheConfiguredTimeout(t *testing.T) {
	_, err := client(t, &recorder{respond: hang}, setup{timeout: 200 * time.Millisecond}).Load(bg, "doc")
	if e := endpointError(t, err); e.Message != "collab: the doc endpoint GET timed out after 0.2s." || e.StatusCode != 0 {
		t.Fatal(e.Message)
	}
}

func TestACallerCancellationStopsTheRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(bg)
	time.AfterFunc(50*time.Millisecond, cancel)
	_, err := client(t, &recorder{respond: hang}, setup{}).Load(ctx, "doc")
	var e *Error
	if !errors.Is(err, context.Canceled) || errors.As(err, &e) {
		t.Fatal(err)
	}
}

func TestLoadRejectsADocIdThatIsNotOneOrdinarySegment(t *testing.T) {
	for _, id := range []string{"", ".", ".."} {
		r := &recorder{respond: jsonAnswer(`{"blocks":[]}`)}
		_, err := client(t, r, setup{}).Load(bg, id)
		var argument *ArgumentError
		if !errors.As(err, &argument) || len(r.requests) != 0 {
			t.Fatalf("%q: %v", id, err)
		}
	}
}

func TestSaveRejectsADotSegmentDocIdBeforeSending(t *testing.T) {
	r := &recorder{respond: jsonAnswer(`{}`)}
	_, err := client(t, r, setup{}).Save(bg, "..", &jsjson.Object{}, nil, nil)
	var argument *ArgumentError
	if !errors.As(err, &argument) || len(r.requests) != 0 {
		t.Fatal(err)
	}
}

func TestAnAcceptedDocIdStaysOneEscapedSegment(t *testing.T) {
	for id, want := range map[string]string{
		"doc 1/x": "https://app.example.com/api/docs/doc%201%2Fx",
		"a.b":     "https://app.example.com/api/docs/a.b",
		"...":     "https://app.example.com/api/docs/...",
		"a?b#c":   "https://app.example.com/api/docs/a%3Fb%23c",
		"../x":    "https://app.example.com/api/docs/..%2Fx",
		"%2e":     "https://app.example.com/api/docs/%252e",
		"%2E%2e":  "https://app.example.com/api/docs/%252E%252e",
		"é~":      "https://app.example.com/api/docs/%C3%A9~",
	} {
		r := &recorder{respond: jsonAnswer(`{"blocks":[]}`)}
		if _, err := client(t, r, setup{}).Load(bg, id); err != nil {
			t.Fatalf("%q: %v", id, err)
		}
		if r.requests[0].url != want {
			t.Errorf("%q: %s", id, r.requests[0].url)
		}
	}
}

func TestLoadRefusesAResponseLargerThanTheCap(t *testing.T) {
	body := `{"blocks":[],"pad":"` + strings.Repeat("x", 4096) + `"}`
	for _, declared := range []bool{true, false} {
		r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(200, body, declared), nil }}
		_, err := client(t, r, setup{maxResponseBytes: 1024}).Load(bg, "doc")
		if e := endpointError(t, err); e.Message != "collab: the doc endpoint GET answer is too large (over 1024 bytes)." {
			t.Fatal(e.Message)
		}
	}
}

func TestLoadAcceptsAResponseAtTheCap(t *testing.T) {
	body := `{"blocks":[]}`
	for _, declared := range []bool{true, false} {
		r := &recorder{respond: func(*http.Request) (*http.Response, error) { return answer(200, body, declared), nil }}
		if loaded, err := client(t, r, setup{maxResponseBytes: int64(len(body))}).Load(bg, "doc"); err != nil || loaded.Data == nil {
			t.Fatal(err)
		}
	}
}

func deepJSON(depth int) string {
	return strings.Repeat(`{"a":`, depth) + "1" + strings.Repeat("}", depth)
}

// 512 levels pass both ways and 513 do not (probed against .NET 10).
func TestTheDepthLimitIs512BothWays(t *testing.T) {
	for _, depth := range []int{100, 512} {
		if loaded, err := client(t, &recorder{respond: jsonAnswer(deepJSON(depth))}, setup{}).Load(bg, "doc"); err != nil || loaded.Data == nil {
			t.Fatalf("load %d: %v", depth, err)
		}
		r := &recorder{respond: jsonAnswer(`{}`)}
		if _, err := client(t, r, setup{}).Save(bg, "doc", node(t, deepJSON(depth)), nil, nil); err != nil || !strings.Contains(r.requests[0].body, `"a"`) {
			t.Fatalf("save %d: %v", depth, err)
		}
	}
	if _, err := client(t, &recorder{respond: jsonAnswer(deepJSON(513))}, setup{}).Load(bg, "doc"); err == nil {
		t.Fatal("load 513")
	}
	r := &recorder{respond: jsonAnswer(`{}`)}
	value := any(1.0)
	for range 513 {
		object := &jsjson.Object{}
		object.Set(jsjson.FromString("a"), value)
		value = object
	}
	if _, err := client(t, r, setup{}).Save(bg, "doc", value, nil, nil); err == nil || len(r.requests) != 0 {
		t.Fatal("save 513")
	}
}

func TestLoadRejectsAnAnswerWithDuplicateJsonKeys(t *testing.T) {
	_, err := client(t, &recorder{respond: jsonAnswer(`{"data":{"a":1},"data":{"a":2}}`)}, setup{}).Load(bg, "doc")
	endpointError(t, err)
}

// Utf8JsonWriter's default encoder and .NET number text (probed).
func TestSerializeWritesWhatSystemTextJsonWrites(t *testing.T) {
	object := &jsjson.Object{}
	object.Set(jsjson.FromString("x"), 1e21)
	tenth, fifth := 0.1, 0.2 // variables: a constant sum is exactly 0.3
	object.Set(jsjson.FromString("y"), tenth+fifth)
	object.Set(jsjson.FromString("z"), int64(5))
	object.Set(jsjson.FromString("s"), jsjson.FromString("\u00e9<>&'+`\u2028"))
	got, err := Serialize(object)
	if err != nil {
		t.Fatal(err)
	}
	if want := "{\"x\":1E+21,\"y\":0.30000000000000004,\"z\":5,\"s\":\"\\u00E9\\u003C\\u003E\\u0026\\u0027\\u002B\\u0060\\u2028\"}"; string(got) != want {
		t.Fatalf("%s", got)
	}
}

func TestSecondsAreWrittenLikeDotnet(t *testing.T) {
	for d, want := range map[time.Duration]string{200 * time.Millisecond: "0.2", 30 * time.Second: "30", 1234560 * time.Microsecond: "1.235", 500 * time.Microsecond: "0.001"} {
		if got := seconds(d); got != want {
			t.Errorf("%v: %s", d, got)
		}
	}
}

// C#'s HttpClient sends only Host and Accept on a GET (probed): no
// User-Agent and no Accept-Encoding, so the cap counts the raw body.
func TestTheDefaultTransportSendsOnlyWhatCSharpSends(t *testing.T) {
	var got http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		w.Write([]byte(`{"blocks":[]}`))
	}))
	defer server.Close()
	endpoint, _ := dotnet.ParseAbsoluteURI(server.URL + "/docs")
	c := New(Options{Endpoint: endpoint, RequestTimeout: 5 * time.Second}, nil)
	if _, err := c.Load(bg, "a"); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["User-Agent"]; ok {
		t.Errorf("User-Agent %q", got.Get("User-Agent"))
	}
	if _, ok := got["Accept-Encoding"]; ok {
		t.Errorf("Accept-Encoding %q", got.Get("Accept-Encoding"))
	}
	if got.Get("Accept") != "application/json" {
		t.Error(got)
	}
}
