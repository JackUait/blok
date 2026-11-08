package main

/*
 * --example-source endpoint:<url>: a blokmcp.DocumentSource that keeps
 * documents on a small HTTP store. A real host reads and writes its own
 * database here. The shared conformance suite
 * (test/unit/mcp-conformance/fixtures/embed.json) records this exact wire,
 * so every port's embed example speaks it byte for byte:
 *
 *   <base>  <url> with one trailing "/" removed.
 *   <id>    the document id, percent-encoded as JS encodeURIComponent does:
 *           every UTF-8 byte is %XX (upper-case hex) except A-Z a-z 0-9 and
 *           - _ . ! ~ * ' ( ). Blok never passes "", "." or "..".
 *   Every request carries the caller, values sent as given:
 *     Blok-Caller: <caller.Principal>
 *     Blok-Caller-Client: <caller.ClientName>
 *     Blok-Caller-Actor: <caller.Actor.ID>
 *     Blok-Caller-On-Behalf-Of: <caller.Actor.OnBehalfOf>   left out when nil
 *
 *   load  GET <base>/<id>
 *         200 body exactly `null`  -> never saved: Load answers nil.
 *         200 any other JSON body  -> documentText and version as given. A
 *                                     documentText that is not a string is a
 *                                     plain error; a version that is not a
 *                                     string is "". documentText is never
 *                                     parsed here, so Blok's own parser
 *                                     reads it.
 *   save  PUT <base>/<id>
 *         Content-Type: application/json; the body is documentText, byte for byte.
 *         Blok-If-Version: <ifVersion>, left out when ifVersion is nil.
 *         200 JSON body            -> its version as given ("" when absent).
 *   list  GET <base>?limit=<n>&query=<q>&cursor=<c>
 *         In that order; query and cursor left out when nil; values
 *         form-encoded as URLSearchParams does: space is "+", every other
 *         UTF-8 byte is %XX except A-Z a-z 0-9 and * - . _.
 *         200 JSON body            -> its documents and nextCursor.
 *
 *   Any other answer, on every route:
 *     409 -> SourceChanged      503 -> SourceUnavailable
 *     403 -> SourceForbidden    422 -> SourceInvalidID
 *     with the body's JSON "message" when that is a string, else "" (Blok's
 *     own words). Every other status, a 200 body that is not JSON, or a
 *     network error: a plain error, which Blok logs and shows the agent as
 *     SOURCE_UNAVAILABLE.
 */

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/JackUait/blok/packages/server/go/v2/blokmcp"
)

var refusals = map[int]blokmcp.SourceErrorKind{
	http.StatusConflict:            blokmcp.SourceChanged,
	http.StatusServiceUnavailable:  blokmcp.SourceUnavailable,
	http.StatusForbidden:           blokmcp.SourceForbidden,
	http.StatusUnprocessableEntity: blokmcp.SourceInvalidID,
}

type exampleSource struct{ base string }

// listingSource adds List, so Blok lists through the store.
type listingSource struct{ *exampleSource }

func newExampleSource(url string) blokmcp.DocumentSource {
	return listingSource{&exampleSource{base: strings.TrimSuffix(url, "/")}}
}

func callerHeaders(header http.Header, caller blokmcp.DocumentCaller) {
	header.Set("Blok-Caller", caller.Principal)
	header.Set("Blok-Caller-Client", caller.ClientName)
	header.Set("Blok-Caller-Actor", caller.Actor.ID)
	if caller.Actor.OnBehalfOf != nil {
		header.Set("Blok-Caller-On-Behalf-Of", *caller.Actor.OnBehalfOf)
	}
}

// call answers a 200's JSON body, or the refusal or error any other answer is.
func (s *exampleSource) call(ctx context.Context, method, target string, caller blokmcp.DocumentCaller, body []byte, header map[string]string) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, err
	}
	callerHeaders(request.Header, caller)
	for key, value := range header {
		request.Header.Set(key, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	text, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusOK {
		if !json.Valid(text) {
			return nil, fmt.Errorf("the document store answered non-JSON: %s", text)
		}
		return text, nil
	}
	kind, known := refusals[response.StatusCode]
	if !known {
		return nil, fmt.Errorf("the document store answered %d: %s", response.StatusCode, text)
	}
	var refusal struct {
		Message any `json:"message"`
	}
	_ = json.Unmarshal(text, &refusal)
	message, _ := refusal.Message.(string)
	return nil, &blokmcp.SourceError{Kind: kind, AgentMessage: message}
}

func (s *exampleSource) urlOf(documentID string) string {
	return s.base + "/" + encodeURIComponent(documentID)
}

func (s *exampleSource) Load(ctx context.Context, caller blokmcp.DocumentCaller, documentID string) (*blokmcp.StoredDocument, error) {
	body, err := s.call(ctx, http.MethodGet, s.urlOf(documentID), caller, nil, nil)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(body)) == "null" {
		return nil, nil
	}
	var answer struct {
		DocumentText any `json:"documentText"`
		Version      any `json:"version"`
	}
	_ = json.Unmarshal(body, &answer)
	text, ok := answer.DocumentText.(string)
	if !ok {
		return nil, fmt.Errorf("the document store answered no documentText string: %s", body)
	}
	version, _ := answer.Version.(string)
	return &blokmcp.StoredDocument{DocumentText: text, Version: version}, nil
}

func (s *exampleSource) Save(ctx context.Context, caller blokmcp.DocumentCaller, documentID, documentText string, ifVersion *string) (string, error) {
	header := map[string]string{"Content-Type": "application/json"}
	if ifVersion != nil {
		header["Blok-If-Version"] = *ifVersion
	}
	body, err := s.call(ctx, http.MethodPut, s.urlOf(documentID), caller, []byte(documentText), header)
	if err != nil {
		return "", err
	}
	var answer struct {
		Version any `json:"version"`
	}
	_ = json.Unmarshal(body, &answer)
	version, _ := answer.Version.(string)
	return version, nil
}

func (s listingSource) List(ctx context.Context, caller blokmcp.DocumentCaller, request blokmcp.ListRequest) (*blokmcp.DocumentList, error) {
	params := []string{"limit=" + strconv.Itoa(request.Limit)}
	if request.Query != nil {
		params = append(params, "query="+formEncode(*request.Query))
	}
	if request.Cursor != nil {
		params = append(params, "cursor="+formEncode(*request.Cursor))
	}
	body, err := s.call(ctx, http.MethodGet, s.base+"?"+strings.Join(params, "&"), caller, nil, nil)
	if err != nil {
		return nil, err
	}
	var answer struct {
		Documents  any `json:"documents"`
		NextCursor any `json:"nextCursor"`
	}
	_ = json.Unmarshal(body, &answer)
	entries, ok := answer.Documents.([]any)
	if !ok {
		return nil, fmt.Errorf(`the document store listed without a "documents" array: %s`, body)
	}
	list := &blokmcp.DocumentList{Documents: []blokmcp.ListedDocument{}}
	for _, entry := range entries {
		doc, _ := entry.(map[string]any)
		id, isString := doc["id"].(string)
		if !isString {
			continue
		}
		listed := blokmcp.ListedDocument{ID: id}
		if title, ok := doc["title"].(string); ok {
			listed.Title = &title
		}
		list.Documents = append(list.Documents, listed)
	}
	if cursor, ok := answer.NextCursor.(string); ok {
		list.NextCursor = &cursor
	}
	return list, nil
}

// encodeURIComponent is JS's: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( )
// is percent-encoded as UTF-8.
func encodeURIComponent(text string) string {
	var out strings.Builder
	for _, b := range []byte(text) {
		if isAlphanumeric(b) || strings.IndexByte("-_.!~*'()", b) >= 0 {
			out.WriteByte(b)
			continue
		}
		fmt.Fprintf(&out, "%%%02X", b)
	}
	return out.String()
}

// formEncode is URLSearchParams' serializer for one value.
func formEncode(text string) string {
	var out strings.Builder
	for _, b := range []byte(text) {
		switch {
		case isAlphanumeric(b) || strings.IndexByte("*-._", b) >= 0:
			out.WriteByte(b)
		case b == ' ':
			out.WriteByte('+')
		default:
			fmt.Fprintf(&out, "%%%02X", b)
		}
	}
	return out.String()
}

func isAlphanumeric(b byte) bool {
	return b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' || b >= '0' && b <= '9'
}
