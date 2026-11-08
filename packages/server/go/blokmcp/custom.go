package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// DocumentCaller is who a host's document source acts for: the caller that
// opened the handle (a listing acts for the caller that lists).
type DocumentCaller struct {
	Principal  string
	ClientName string
	// Scopes is nil when the caller came without scopes.
	Scopes []string
	Actor  Actor
}

// StoredDocument is a stored document as the host keeps it.
type StoredDocument struct {
	// DocumentText is the document as JSON text. Blok parses it the way the
	// endpoint source does: a repeated key keeps its last value, a lone
	// surrogate reads as U+FFFD, and more than 48 levels of nesting is refused.
	DocumentText string
	// Version must not be empty for a stored document.
	Version string
}

// DocumentSource is the host's own document store, set as
// Options.DocumentSource. Return a *SourceError to refuse with a code; any
// other error is logged in full and the agent sees SOURCE_UNAVAILABLE.
type DocumentSource interface {
	// Load answers nil for a document never saved.
	Load(ctx context.Context, caller DocumentCaller, documentID string) (*StoredDocument, error)
	// Save stores compact JSON. A nil ifVersion means "must not exist yet";
	// any other value must equal the stored version, else refuse with
	// SourceChanged. It answers the new, non-empty version.
	Save(ctx context.Context, caller DocumentCaller, documentID, documentText string, ifVersion *string) (string, error)
}

// DocumentLister is a DocumentSource that lists. Blok still asks Authorize
// about every listed id.
type DocumentLister interface {
	List(ctx context.Context, caller DocumentCaller, request ListRequest) (*DocumentList, error)
}

// ListRequest is one page of a listing.
type ListRequest struct {
	Query  *string
	Cursor *string
	Limit  int
}

// DocumentList is one page of documents.
type DocumentList struct {
	Documents  []ListedDocument
	NextCursor *string
}

// ListedDocument is one listed document.
type ListedDocument struct {
	ID    string
	Title *string
}

// SourceErrorKind says why a DocumentSource refused.
type SourceErrorKind string

const (
	// SourceChanged: the document changed since it was read (DOCUMENT_CHANGED).
	SourceChanged SourceErrorKind = "changed"
	// SourceUnavailable: the store cannot answer now (SOURCE_UNAVAILABLE).
	SourceUnavailable SourceErrorKind = "unavailable"
	// SourceForbidden: the host does not allow this (FORBIDDEN).
	SourceForbidden SourceErrorKind = "forbidden"
	// SourceInvalidID: the host does not accept this id (INVALID_ARGS).
	SourceInvalidID SourceErrorKind = "invalidId"
)

// SourceError is a DocumentSource's refusal. The agent sees AgentMessage,
// or Blok's own words when it is blank: keep paths, hosts and secrets out
// of it. Wrapped SourceErrors are found too.
type SourceError struct {
	Kind         SourceErrorKind
	AgentMessage string
	Err          error
}

func (e *SourceError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	if e.AgentMessage != "" {
		return e.AgentMessage
	}
	return string(e.Kind)
}

func (e *SourceError) Unwrap() error { return e.Err }

var sourceCodes = map[SourceErrorKind]string{
	SourceChanged:     "DOCUMENT_CHANGED",
	SourceUnavailable: "SOURCE_UNAVAILABLE",
	SourceForbidden:   "FORBIDDEN",
	SourceInvalidID:   "INVALID_ARGS",
}

// sourceFailed is each op's generic words; every port answers with them.
var sourceFailed = map[string]string{
	"load": "The host could not load this document. Try again.",
	"save": "The host could not save this document, so nothing was saved. Try again.",
	"list": "The host could not list documents. Try again.",
}

func sourceFallback(kind SourceErrorKind, op string) string {
	switch kind {
	case SourceChanged:
		return "Someone saved this document since you opened it. Read it again, then retry."
	case SourceForbidden:
		return "The host does not allow this."
	case SourceInvalidID:
		return "The host does not accept this document id."
	}
	return sourceFailed[op]
}

// The host may have written it: "nothing was saved" would make the agent
// repeat its batch.
const savedWithoutVersion = "The host may have saved this document but did not say which version. Read it before you retry."

// customSource is the host's DocumentSource behind Blok's checks and
// words. Unbound (caller nil) it is only the marker the server keeps; each
// handle binds its opener's caller with forCaller.
type customSource struct {
	host   DocumentSource
	caller *DocumentCaller
}

func (c *customSource) forCaller(who *caller) docSource {
	return &customSource{host: c.host, caller: documentCallerOf(who)}
}

func documentCallerOf(who *caller) *DocumentCaller {
	var actor Actor
	_ = json.Unmarshal(who.actor, &actor)
	return &DocumentCaller{Principal: who.principal, ClientName: who.clientName, Scopes: who.scopes, Actor: actor}
}

// hostFailed logs a host bug or a plain error in full; the agent gets
// generic words.
func hostFailed(op string, documentID *string, what any, message string) error {
	where := ""
	if documentID != nil {
		where = fmt.Sprintf(" %q", *documentID)
	}
	logf("the host document source failed to %s%s: %v", op, where, what)
	return surfaceError("SOURCE_UNAVAILABLE", message)
}

func (c *customSource) refused(op string, documentID *string, err error) error {
	var refusal *SourceError
	if !errors.As(err, &refusal) {
		return hostFailed(op, documentID, err, sourceFailed[op])
	}
	code, known := sourceCodes[refusal.Kind]
	if !known {
		return hostFailed(op, documentID, err, sourceFailed[op])
	}
	message := refusal.AgentMessage
	if strings.TrimSpace(message) == "" {
		message = sourceFallback(refusal.Kind, op)
	}
	return surfaceError(code, message)
}

// checkedID is the endpoint source's id rule, so every host gets the same
// ids whatever it does with them.
func checkedID(documentID string) error {
	if documentID == "" || documentID == "." || documentID == ".." {
		return surfaceError("INVALID_ARGS", `"`+documentID+`" is not a document id.`)
	}
	return nil
}

func (c *customSource) bound() error {
	if c.caller == nil {
		return errors.New("blok-mcp: a host document source is used only through forCaller")
	}
	return nil
}

func (c *customSource) documentForm() string { return "compact" }

func (c *customSource) lists() bool {
	_, ok := c.host.(DocumentLister)
	return ok
}

// checkedDocument is the endpoint source's text path: depth on the text,
// then JSON, then the shape. The bundle parses the text itself, so a
// repeated key keeps its last value and a lone surrogate reads as U+FFFD.
func checkedDocument(documentID, text string) (json.RawMessage, error) {
	where := `The host's document "` + documentID + `"`
	text = decodeUTF8([]byte(text))
	if textNestsDeeperThan(text, maxJSONDepth) {
		return nil, surfaceError("SOURCE_UNAVAILABLE", fmt.Sprintf("%s nests deeper than %d levels of objects and arrays.", where, maxJSONDepth))
	}
	body := json.RawMessage(finiteJSON([]byte(text)))
	if !json.Valid(body) {
		return nil, surfaceError("SOURCE_UNAVAILABLE", where+" is not JSON.")
	}
	if err := assertDocumentShape(body, where); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *customSource) load(ctx context.Context, documentID string) (*loaded, error) {
	if err := c.bound(); err != nil {
		return nil, err
	}
	if err := checkedID(documentID); err != nil {
		return nil, err
	}
	stored, err := c.host.Load(ctx, *c.caller, documentID)
	if err != nil {
		return nil, c.refused("load", &documentID, err)
	}
	if stored == nil {
		return &loaded{document: emptyDocument, missing: true}, nil
	}
	if stored.Version == "" {
		return nil, hostFailed("load", &documentID, "it answered a document without a version", sourceFailed["load"])
	}
	document, err := checkedDocument(documentID, stored.DocumentText)
	if err != nil {
		return nil, err
	}
	version := stored.Version
	return &loaded{document: document, version: &version}, nil
}

func (c *customSource) save(ctx context.Context, documentID string, text []byte, ifVersion *string) (*string, error) {
	if err := c.bound(); err != nil {
		return nil, err
	}
	if err := checkedID(documentID); err != nil {
		return nil, err
	}
	version, err := c.host.Save(ctx, *c.caller, documentID, string(text), ifVersion)
	if err != nil {
		return nil, c.refused("save", &documentID, err)
	}
	if version == "" {
		return nil, hostFailed("save", &documentID, "it answered without a version", savedWithoutVersion)
	}
	return &version, nil
}

func (c *customSource) list(ctx context.Context, request listRequest) (*sourceListing, error) {
	if err := c.bound(); err != nil {
		return nil, err
	}
	lister, ok := c.host.(DocumentLister)
	if !ok {
		return nil, errors.New("blok-mcp: the host document source does not list")
	}
	answer, err := lister.List(ctx, *c.caller, ListRequest{Query: request.Query, Cursor: request.Cursor, Limit: request.Limit})
	if err != nil {
		return nil, c.refused("list", nil, err)
	}
	if answer == nil {
		return nil, hostFailed("list", nil, `list answered without a "documents" array`, sourceFailed["list"])
	}
	listing := &sourceListing{Documents: []listedDocument{}, NextCursor: answer.NextCursor}
	for _, doc := range answer.Documents {
		listing.Documents = append(listing.Documents, listedDocument{ID: doc.ID, Title: doc.Title})
	}
	return listing, nil
}
