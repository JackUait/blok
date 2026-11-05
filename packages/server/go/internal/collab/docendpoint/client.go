// Package docendpoint is the collab server's client for the host's document
// endpoint (C# DocEndpointClient): GET seeds a room, PUT exports it.
package docendpoint

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Headers the endpoint reads and writes.
const (
	VersionHeader  = "Blok-Doc-Version"
	LineageHeader  = "Blok-Doc-Lineage"
	SequenceHeader = "Blok-Doc-Sequence"
)

const (
	// DefaultMaxResponseBytes caps an answer body.
	DefaultMaxResponseBytes = 64 << 20
	errorBodyPrefixBytes    = 512
	// JSONMaxDepth is YDocConverter.JsonMaxDepth, both ways.
	JSONMaxDepth = 512
)

// connectTimeout is SocketsHttpHandler.ConnectTimeout. A var so tests can
// lower it.
var connectTimeout = 10 * time.Second

// Options configure a Client. Endpoint is the operator's URL, already parsed.
type Options struct {
	Endpoint         *dotnet.URI
	Authorization    string
	RequestTimeout   time.Duration // 0 means none
	MaxResponseBytes int64         // 0 means DefaultMaxResponseBytes
}

// Loaded is what a GET answered: the document (nil for none) and its version.
type Loaded struct {
	Data    *jsjson.Node
	Version *string
}

// Projection names the lineage and committed sequence a PUT's JSON includes.
type Projection struct {
	Lineage        string
	ServerSequence uint64
}

// Error is C#'s DocEndpointException. StatusCode is 0 when there was no answer status.
type Error struct {
	Message    string
	StatusCode int
	Err        error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Err }

// ArgumentError is a doc id the client refuses before sending (C# ArgumentException).
type ArgumentError struct{ Message string }

func (e *ArgumentError) Error() string { return e.Message }

// Client reaches only the operator-configured endpoint, and follows no redirect.
type Client struct {
	options Options
	http    *http.Client
}

// New builds a client. A nil transport is DocEndpointClient.CreateHandler:
// a 10 s connect timeout, and a pooled connection retired after 5 minutes
// so a DNS change at the endpoint is picked up. It asks for no
// compression, and the cap counts the raw body.
func New(options Options, transport http.RoundTripper) *Client {
	if transport == nil {
		transport = dotnet.NewSocketsTransport(dotnet.SocketsOptions{
			ConnectTimeout:           connectTimeout,
			PooledConnectionLifetime: 5 * time.Minute,
		})
	}
	if options.MaxResponseBytes == 0 {
		options.MaxResponseBytes = DefaultMaxResponseBytes
	}
	return &Client{
		options: options,
		http: &http.Client{
			Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Load GETs the document. The body may be bare OutputData, a {data, version}
// envelope (data may be null), or null.
func (c *Client) Load(ctx context.Context, docID string) (*Loaded, error) {
	url, err := c.urlFor(docID)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header["Accept"] = []string{"application/json"}
	body, err := c.send(ctx, request)
	if err != nil {
		return nil, err
	}
	return parseLoaded(body)
}

// Save PUTs the bare document and returns the version the endpoint answers with, if any.
func (c *Client) Save(ctx context.Context, docID string, outputData any, version *string, projection *Projection) (*string, error) {
	url, err := c.urlFor(docID)
	if err != nil {
		return nil, err
	}
	body, err := Serialize(outputData)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header["Content-Type"] = []string{"application/json; charset=utf-8"}
	if version != nil {
		request.Header[VersionHeader] = []string{*version}
	}
	if projection != nil {
		request.Header[LineageHeader] = []string{projection.Lineage}
		request.Header[SequenceHeader] = []string{strconv.FormatUint(projection.ServerSequence, 10)}
	}
	answer, err := c.send(ctx, request)
	if err != nil {
		return nil, err
	}
	return parseSavedVersion(answer), nil
}

// urlFor is {endpoint}/{escaped id}, refused unless it is still exactly one
// segment after URI normalisation (which collapses "." and "..").
func (c *Client) urlFor(docID string) (string, error) {
	if docID == "" {
		return "", &ArgumentError{"The value cannot be an empty string. (Parameter 'docId')"}
	}
	base := strings.TrimRight(c.options.Endpoint.AbsoluteURI, "/")
	raw := base + "/" + escapeDataString(docID)
	parsed, ok := dotnet.ParseAbsoluteURI(raw)
	if !ok || parsed.AbsoluteURI != raw {
		return "", &ArgumentError{fmt.Sprintf("collab: the document id \"%s\" does not address a single path segment. (Parameter 'docId')", docID)}
	}
	return raw, nil
}

// escapeDataString is Uri.EscapeDataString: every UTF-8 byte outside the
// RFC 3986 unreserved set as uppercase %XX.
func escapeDataString(s string) string {
	// A Go string is bytes; .NET first reads the id as UTF-16, so invalid
	// UTF-8 is escaped as U+FFFD, as its encoder writes it.
	s = jsjson.FromString(s).String()
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '-' || c == '.' || c == '_' || c == '~' || '0' <= c && c <= '9' || 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' {
			b.WriteByte(c)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", c)
	}
	return b.String()
}

func (c *Client) timedOut(method string, err error) error {
	return &Error{Message: fmt.Sprintf("collab: the doc endpoint %s timed out after %ss.", method, seconds(c.options.RequestTimeout)), Err: err}
}

// seconds is TotalSeconds.ToString("0.###").
func seconds(d time.Duration) string {
	text := strconv.FormatFloat(d.Seconds(), 'f', 3, 64)
	text = strings.TrimRight(text, "0")
	return strings.TrimSuffix(text, ".")
}

func (c *Client) send(ctx context.Context, request *http.Request) ([]byte, error) {
	// An empty value makes net/http send no User-Agent, as C# sends none.
	request.Header["User-Agent"] = []string{""}
	// Refused, not dropped: a stray newline from a shell-quoted secret would
	// otherwise send every request unauthenticated.
	if auth := c.options.Authorization; auth != "" {
		if strings.ContainsAny(auth, "\r\n") {
			return nil, &Error{Message: "collab: the doc endpoint Authorization value cannot be sent as a header (a stray newline?)."}
		}
		request.Header["Authorization"] = []string{auth}
	}
	timeout := ctx
	if c.options.RequestTimeout > 0 {
		var cancel context.CancelFunc
		timeout, cancel = context.WithTimeout(ctx, c.options.RequestTimeout)
		defer cancel()
	}
	response, err := c.http.Do(request.WithContext(timeout))
	if err != nil {
		// A connect or handshake timeout is an OperationCanceledException
		// in C#, so it reads as timed out too.
		var netError net.Error
		if ctx.Err() == nil && (timeout.Err() != nil || errors.As(err, &netError) && netError.Timeout()) {
			return nil, c.timedOut(request.Method, err)
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	defer response.Body.Close()
	// The status decides before any body is read: an error body is never
	// buffered, only its head goes into the message.
	if response.StatusCode < 200 || response.StatusCode > 299 {
		prefix := readErrorPrefix(response.Body)
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &Error{Message: fmt.Sprintf("collab: the doc endpoint %s returned %d%s", request.Method, response.StatusCode, prefix), StatusCode: response.StatusCode}
	}
	body, err := c.readCapped(response, request.Method)
	if err != nil {
		var endpoint *Error
		if errors.As(err, &endpoint) {
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if timeout.Err() != nil {
			return nil, c.timedOut(request.Method, err)
		}
		return nil, err
	}
	return body, nil
}

// readErrorPrefix is the first 512 bytes, decoded, with whitespace runs
// folded to one space; a read failure leaves what was read.
func readErrorPrefix(body io.Reader) string {
	buffer := make([]byte, errorBodyPrefixBytes)
	read, _ := io.ReadFull(body, buffer)
	text := strings.Join(strings.Fields(jsjson.FromString(string(buffer[:read])).String()), " ")
	if text == "" {
		return "."
	}
	return ": " + text
}

func (c *Client) readCapped(response *http.Response, method string) ([]byte, error) {
	limit := c.options.MaxResponseBytes
	if response.ContentLength > limit {
		return nil, tooLarge(method, limit)
	}
	var buffer bytes.Buffer
	chunk := make([]byte, 81920)
	for {
		n, err := response.Body.Read(chunk)
		if int64(buffer.Len())+int64(n) > limit {
			return nil, tooLarge(method, limit)
		}
		buffer.Write(chunk[:n])
		if err == io.EOF {
			return buffer.Bytes(), nil
		}
		if err != nil {
			return nil, err
		}
	}
}

func tooLarge(method string, limit int64) error {
	return &Error{Message: fmt.Sprintf("collab: the doc endpoint %s answer is too large (over %d bytes).", method, limit)}
}

func readJSON(body []byte) (*jsjson.Node, error) {
	return jsjson.ParseNode(body, jsjson.Options{MaxDepth: JSONMaxDepth, RefuseDuplicates: true})
}

func member(object *jsjson.Node, key string) (*jsjson.Node, bool, error) {
	for _, m := range object.Members {
		name, err := m.Key()
		if err != nil {
			return nil, false, err
		}
		if slices.Equal(name, jsjson.FromString(key)) {
			return m.Value, true, nil
		}
	}
	return nil, false, nil
}

func parseLoaded(body []byte) (*Loaded, error) {
	root, err := readJSON(body)
	if err != nil {
		return nil, &Error{Message: "collab: the doc endpoint did not answer with JSON.", Err: err}
	}
	if root.Kind == jsjson.KindNull {
		return &Loaded{}, nil
	}
	if root.Kind != jsjson.KindObject {
		return nil, &Error{Message: "collab: the doc endpoint answered with JSON that is not an object."}
	}
	data, enveloped, err := member(root, "data")
	if err != nil {
		return nil, &Error{Message: "collab: the doc endpoint did not answer with JSON.", Err: err}
	}
	if !enveloped {
		return &Loaded{Data: root}, nil
	}
	if data.Kind == jsjson.KindNull {
		data = nil
	} else if data.Kind != jsjson.KindObject {
		return nil, &Error{Message: "collab: the doc endpoint envelope carries data that is not an object."}
	}
	version, err := versionOf(root)
	if err != nil {
		return nil, err
	}
	return &Loaded{Data: data, Version: version}, nil
}

func parseSavedVersion(body []byte) *string {
	if len(body) == 0 {
		return nil
	}
	root, err := readJSON(body)
	if err != nil || root.Kind != jsjson.KindObject {
		return nil
	}
	version, err := versionOf(root)
	if err != nil {
		return nil
	}
	return version
}

// versionOf is a string as is, or a number the way .NET formats a double.
func versionOf(envelope *jsjson.Node) (*string, error) {
	value, ok, err := member(envelope, "version")
	if err != nil {
		return nil, &Error{Message: "collab: the doc endpoint did not answer with JSON.", Err: err}
	}
	if !ok {
		return nil, nil
	}
	switch value.Kind {
	case jsjson.KindNull, jsjson.KindArray, jsjson.KindObject:
		return nil, nil
	case jsjson.KindString:
		text, err := value.Text()
		if err != nil {
			return nil, &Error{Message: "collab: the doc endpoint version must be a string or a number.", Err: err}
		}
		version := text.String()
		return &version, nil
	case jsjson.KindNumber:
		number, err := strconv.ParseFloat(string(value.Raw()), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return nil, err
		}
		version := dotnet.FormatDouble(number)
		return &version, nil
	}
	return nil, &Error{Message: "collab: the doc endpoint version must be a string or a number."}
}

// Serialize writes JS values the way JsonSerializer writes a JsonNode with
// the default encoder: escapes as Utf8JsonWriter, numbers as .NET formats
// them, and refused past depth 512.
func Serialize(value any) ([]byte, error) {
	out, err := appendNET(nil, value, 0)
	if err != nil {
		return nil, &Error{Message: fmt.Sprintf("collab: the document is nested too deeply to send (over %d levels).", JSONMaxDepth), Err: err}
	}
	return out, nil
}

var errTooDeep = errors.New("docendpoint: nested past the writer's depth")

func appendNET(dst []byte, value any, depth int) ([]byte, error) {
	switch value := value.(type) {
	case nil:
		return append(dst, "null"...), nil
	case bool:
		return strconv.AppendBool(dst, value), nil
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return append(dst, "null"...), nil
		}
		return append(dst, dotnet.FormatDouble(value)...), nil
	case int64:
		return strconv.AppendInt(dst, value, 10), nil
	case jsjson.Str:
		return jsjson.AppendQuoted(dst, value), nil
	case []any:
		if depth >= JSONMaxDepth {
			return nil, errTooDeep
		}
		dst = append(dst, '[')
		for i, item := range value {
			if i > 0 {
				dst = append(dst, ',')
			}
			var err error
			if dst, err = appendNET(dst, item, depth+1); err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	case *jsjson.Object:
		if depth >= JSONMaxDepth {
			return nil, errTooDeep
		}
		dst = append(dst, '{')
		for i, m := range value.Members() {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = jsjson.AppendQuoted(dst, m.Key)
			dst = append(dst, ':')
			var err error
			if dst, err = appendNET(dst, m.Value, depth+1); err != nil {
				return nil, err
			}
		}
		return append(dst, '}'), nil
	}
	return nil, fmt.Errorf("docendpoint: %T has no JSON form", value)
}
