package blokmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"

	"golang.org/x/text/encoding/unicode"
)

// loaded is a source's answer to load.
type loaded struct {
	// document is the stored document's JSON, as the bundle reads it.
	document json.RawMessage
	version  *string
	missing  bool
}

type listRequest struct {
	Query  *string `json:"query,omitempty"`
	Cursor *string `json:"cursor,omitempty"`
	Limit  int     `json:"limit"`
}

type listedDocument struct {
	ID    string  `json:"id"`
	Title *string `json:"title"`
}

type sourceListing struct {
	Documents  []listedDocument `json:"documents"`
	NextCursor *string          `json:"nextCursor"`
}

// docSource is Node's DocumentSource. Its refusals are *surfaceErr.
type docSource interface {
	load(ctx context.Context, documentID string) (*loaded, error)
	// save stores text, the bytes documentForm asks the bundle for.
	save(ctx context.Context, documentID string, text []byte, ifVersion *string) (*string, error)
	// documentForm is the bundle's documentText form: "file" or "compact".
	documentForm() string
	// lists says whether list works.
	lists() bool
	list(ctx context.Context, request listRequest) (*sourceListing, error)
}

var emptyDocument = json.RawMessage(`{"blocks":[]}`)

// decodeUTF8 is Node's Buffer#toString('utf-8'): a bad sequence becomes
// U+FFFD by the WHATWG rules.
func decodeUTF8(bytes []byte) string {
	text, err := unicode.UTF8.NewDecoder().Bytes(bytes)
	if err != nil {
		return string(bytes)
	}
	return string(text)
}

func bytesReader(body []byte) io.Reader { return bytes.NewReader(body) }
