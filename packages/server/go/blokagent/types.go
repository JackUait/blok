// Package blokagent runs agent command batches on saved Blok documents, as
// the C# Blok.Server.Agent executor does: the planning and the edits run in
// Blok's own JavaScript bundle, and this package carries the host's side of
// the wire, the page callbacks and the session steps.
//
// Every request and answer is written the way System.Text.Json writes it, so
// a Go host sends and stores the same bytes as a C# host. The shared fixture
// test/unit/server-conformance/fixtures/agent/host.json pins that.
//
// Live rooms need collaboration, which this package does not carry yet:
// ExecuteInRoom answers COMMAND_UNAVAILABLE, as a C# executor built without
// rooms does.
package blokagent

import "context"

// Actor is the agent a batch runs as.
type Actor struct {
	// ID is used for attribution (lastEditedBy).
	ID string
	// Name is the display name.
	Name string
	// OnBehalfOf is the person the agent acts for, if any.
	OnBehalfOf *string
}

// Execution is the answer to one batch.
type Execution struct {
	// ResultJSON is the AgentResult.
	ResultJSON string
	// DocumentJSON is the document to save. It is nil unless the batch
	// succeeded.
	DocumentJSON *string
	// Revision is the stored content hash, or "" when the result has none.
	Revision string
	// askJSON is the question a person must answer before the batch runs;
	// nothing was applied. Read through internal/agentbridge.
	askJSON *string
}

// Options are the host's agent options. The zero value is C#'s
// `new BlokAgentOptions()`, and a nil *Options is the same.
type Options struct {
	// PageTitles opts in to writing target page titles and icons.
	PageTitles bool
	// PageTarget resolves target pages when PageTitles is set. A target that
	// is also a PageCreator lets agents insert page blocks.
	PageTarget PageTarget
	// CustomToolsJSON is a BlokCustomToolsFile, nil for none.
	CustomToolsJSON *string
	// OverridesJSON is ManifestOverrides, nil for none.
	OverridesJSON *string
	// DisableBuiltInComments turns the comment commands off, for hosts whose
	// editors keep comments in their own system. C#'s BuiltInComments is
	// true by default; this is its inverse, so the zero value matches.
	DisableBuiltInComments bool
	// mcpJSON and approvalJSON are the bundle's mcp and approval inputs,
	// set only by blokmcp through internal/agentbridge.
	mcpJSON      *string
	approvalJSON *string
}

// PageTarget finds the document behind a page id, for an agent that renames
// a page or sets its icon.
type PageTarget interface {
	// Resolve returns nil when the page is not found or this actor may not
	// write it.
	Resolve(ctx context.Context, pageID string, actor Actor) (PageLocation, error)
}

// PageCreator is a PageTarget that also creates the document for a new
// sub-page. Deleting a page block never calls the host.
type PageCreator interface {
	PageTarget
	// Create returns the new page id, or "" when this actor may not create
	// a page; the batch then fails with FORBIDDEN.
	Create(ctx context.Context, actor Actor) (string, error)
}

// PageCreateRequest is what a PageCreatorFor learns about a new sub-page.
type PageCreateRequest struct {
	// Actor is the agent that inserts the page block.
	Actor Actor
	// ParentDocumentID is the document the page block goes into: the room's
	// document id, or "" when the executor does not know it (Execute).
	ParentDocumentID string
	// Principal is the person the MCP server serves; "" outside MCP.
	Principal string
	// SuggestedPageID is an id Blok minted. Use it or answer your own.
	SuggestedPageID string
}

// PageCreatorFor is an optional part of a PageCreator. When the page
// target implements it, CreateFor is called instead of Create, with the
// parent document. As Create: "" means this actor may not create a page.
type PageCreatorFor interface {
	CreateFor(ctx context.Context, request PageCreateRequest) (string, error)
}

// PageLocation is a StoredPage or a RoomPage.
type PageLocation interface{ pageLocation() }

// StoredPage is a page document the host loads and saves.
type StoredPage struct {
	Load func(ctx context.Context) (string, error)
	Save func(ctx context.Context, documentJSON string) error
}

// RoomPage is a page document in a live room.
type RoomPage struct{ DocID string }

func (StoredPage) pageLocation() {}
func (RoomPage) pageLocation()   {}
