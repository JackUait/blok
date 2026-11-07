package blokmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const endpointTimeout = 30 * time.Second

// endpointSource is Node's createEndpointSource: the host's document routes,
// plus an optional list route only MCP uses.
type endpointSource struct {
	url     string
	auth    string
	listURL *string
	timeout time.Duration
}

func newEndpointSource(source *Source) *endpointSource {
	return &endpointSource{url: source.URL, auth: source.EndpointAuth, listURL: source.List, timeout: endpointTimeout}
}

func (s *endpointSource) documentForm() string { return "compact" }
func (s *endpointSource) lists() bool          { return s.listURL != nil }

func endpointUnavailable(what string) *surfaceErr {
	return surfaceError("SOURCE_UNAVAILABLE", "The document endpoint "+what+".")
}

// encodeURIComponent is JS's: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( )
// is percent-encoded as UTF-8.
func encodeURIComponent(text string) string {
	const unreserved = "-_.!~*'()"
	var out strings.Builder
	for _, b := range []byte(text) {
		if b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || strings.IndexByte(unreserved, b) >= 0 {
			out.WriteByte(b)
			continue
		}
		fmt.Fprintf(&out, "%%%02X", b)
	}
	return out.String()
}

// formEncode is URLSearchParams' serializer for one name or value.
func formEncode(text string) string {
	var out strings.Builder
	for _, b := range []byte(text) {
		switch {
		case b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || strings.IndexByte("*-._", b) >= 0:
			out.WriteByte(b)
		case b == ' ':
			out.WriteByte('+')
		default:
			fmt.Fprintf(&out, "%%%02X", b)
		}
	}
	return out.String()
}

// urlFor refuses "." and "..", which the URL parser would resolve as path
// steps to other host routes.
func urlFor(base, documentID string) (string, error) {
	if documentID == "" || documentID == "." || documentID == ".." {
		return "", surfaceError("INVALID_ARGS", fmt.Sprintf("%q is not a document id.", documentID))
	}
	return strings.TrimSuffix(base, "/") + "/" + encodeURIComponent(documentID), nil
}

func (s *endpointSource) call(ctx context.Context, method, url string, header http.Header, body []byte) (*fetched, error) {
	answer, err := fetchAnswer(ctx, s.timeout, method, url, header, body)
	if err != nil {
		return nil, endpointUnavailable("could not be reached")
	}
	return answer, nil
}

// text is Node's textOf: the body, or the error of one that broke off.
func (answer *fetched) text() ([]byte, error) {
	if answer.bodyErr != nil {
		return nil, endpointUnavailable("dropped the connection while answering")
	}
	return answer.body, nil
}

// isRecordJSON reads raw as a JSON object, keeping each member raw.
func isRecordJSON(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	trimmed := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(trimmed, "{") {
		return nil, false
	}
	var record map[string]json.RawMessage
	if json.Unmarshal(raw, &record) != nil {
		return nil, false
	}
	return record, true
}

func isArrayJSON(raw json.RawMessage) bool {
	return strings.HasPrefix(strings.TrimSpace(string(raw)), "[")
}

func assertDocumentShape(raw json.RawMessage, where string) error {
	record, ok := isRecordJSON(raw)
	if ok {
		if blocks, has := record["blocks"]; has && isArrayJSON(blocks) {
			return nil
		}
	}
	return surfaceError("SOURCE_UNAVAILABLE", where+` is not a Blok document: expected an object with a "blocks" array.`)
}

func (s *endpointSource) load(ctx context.Context, documentID string) (*loaded, error) {
	url, err := urlFor(s.url, documentID)
	if err != nil {
		return nil, err
	}
	answer, err := s.call(ctx, http.MethodGet, url, http.Header{"Authorization": {s.auth}}, nil)
	if err != nil {
		return nil, err
	}
	if answer.status != http.StatusOK {
		return nil, endpointUnavailable(fmt.Sprintf("answered %d for %s", answer.status, documentID))
	}
	text, err := answer.text()
	if err != nil {
		return nil, err
	}
	if textNestsDeeperThan(decodeUTF8(text), maxJSONDepth) {
		return nil, endpointUnavailable(fmt.Sprintf("answered JSON nested deeper than %d levels for %s", maxJSONDepth, documentID))
	}
	body := json.RawMessage(finiteJSON([]byte(decodeUTF8(text))))
	if !json.Valid(body) {
		return nil, endpointUnavailable("answered non-JSON for " + documentID)
	}
	if strings.TrimSpace(string(body)) == "null" {
		return &loaded{document: emptyDocument, missing: true}, nil
	}
	if record, ok := isRecordJSON(body); ok {
		data, hasData := record["data"]
		if _, hasBlocks := record["blocks"]; hasData && !hasBlocks {
			var version *string
			var text string
			if json.Unmarshal(record["version"], &text) == nil && isStringJSON(record["version"]) {
				version = &text
			}
			if strings.TrimSpace(string(data)) == "null" {
				return &loaded{document: emptyDocument, version: version, missing: true}, nil
			}
			if err := assertDocumentShape(data, documentID); err != nil {
				return nil, err
			}
			return &loaded{document: data, version: version}, nil
		}
	}
	if err := assertDocumentShape(body, documentID); err != nil {
		return nil, err
	}
	return &loaded{document: body}, nil
}

func isStringJSON(raw json.RawMessage) bool {
	return strings.HasPrefix(strings.TrimSpace(string(raw)), `"`)
}

func (s *endpointSource) save(ctx context.Context, documentID string, text []byte, ifVersion *string) (*string, error) {
	url, err := urlFor(s.url, documentID)
	if err != nil {
		return nil, err
	}
	header := http.Header{"Authorization": {s.auth}, "Content-Type": {"application/json"}}
	if ifVersion != nil {
		header["Blok-Doc-Version"] = []string{*ifVersion}
	}
	answer, err := s.call(ctx, http.MethodPut, url, header, text)
	if err != nil {
		return nil, err
	}
	if answer.status == http.StatusConflict {
		return nil, surfaceError("DOCUMENT_CHANGED", "Someone saved this document since you opened it. Read it again, then retry.")
	}
	if answer.status < 200 || answer.status > 299 {
		return nil, endpointUnavailable(fmt.Sprintf("refused the save with %d", answer.status))
	}
	reply, err := answer.text()
	if err != nil {
		return nil, err
	}
	if len(reply) == 0 {
		return ifVersion, nil
	}
	if record, ok := isRecordJSON(clampDepth([]byte(decodeUTF8(reply)), messageDepthLimit)); ok && isStringJSON(record["version"]) {
		var version string
		if json.Unmarshal(record["version"], &version) == nil {
			return &version, nil
		}
	}
	return ifVersion, nil
}

func (s *endpointSource) list(ctx context.Context, request listRequest) (*sourceListing, error) {
	var params []string
	if request.Query != nil {
		params = append(params, "query="+formEncode(*request.Query))
	}
	if request.Cursor != nil {
		params = append(params, "cursor="+formEncode(*request.Cursor))
	}
	params = append(params, "limit="+strconv.Itoa(request.Limit))
	answer, err := s.call(ctx, http.MethodGet, *s.listURL+"?"+strings.Join(params, "&"), http.Header{"Authorization": {s.auth}}, nil)
	if err != nil {
		return nil, err
	}
	if answer.status != http.StatusOK {
		return nil, endpointUnavailable(fmt.Sprintf("list answered %d", answer.status))
	}
	text, err := answer.text()
	if err != nil {
		return nil, err
	}
	if textNestsDeeperThan(decodeUTF8(text), maxJSONDepth) {
		return nil, endpointUnavailable(fmt.Sprintf("answered JSON nested deeper than %d levels for the list", maxJSONDepth))
	}
	body := json.RawMessage(decodeUTF8(text))
	if !json.Valid(body) {
		return nil, endpointUnavailable("answered non-JSON for the list")
	}
	record, ok := isRecordJSON(body)
	if !ok || !isArrayJSON(record["documents"]) {
		return nil, endpointUnavailable(`list answered without a "documents" array`)
	}
	var documents []json.RawMessage
	_ = json.Unmarshal(record["documents"], &documents)
	listing := &sourceListing{Documents: []listedDocument{}}
	for _, raw := range documents {
		doc, isRecord := isRecordJSON(raw)
		if !isRecord || !isStringJSON(doc["id"]) {
			continue
		}
		var entry listedDocument
		_ = json.Unmarshal(doc["id"], &entry.ID)
		if isStringJSON(doc["title"]) {
			var title string
			_ = json.Unmarshal(doc["title"], &title)
			entry.Title = &title
		}
		listing.Documents = append(listing.Documents, entry)
	}
	if isStringJSON(record["nextCursor"]) {
		var cursor string
		_ = json.Unmarshal(record["nextCursor"], &cursor)
		listing.NextCursor = &cursor
	}
	return listing, nil
}
