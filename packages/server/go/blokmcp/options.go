package blokmcp

import (
	"context"
	"encoding/json"

	"github.com/JackUait/blok/packages/server/go/v2/blokagent"
)

// Options configure a Server. Their JSON form is what the bundle's
// mcpParseArgs answers, so the CLI decodes into this type directly.
type Options struct {
	Transport Transport `json:"transport"`
	Auth      Auth      `json:"auth"`
	// Sync is the remote sync service's base URL, for live handles.
	Sync    *Sync    `json:"sync,omitempty"`
	Tickets *Tickets `json:"tickets,omitempty"`
	Source  *Source  `json:"source,omitempty"`
	// PageTitles is "off" (default) or "page-map".
	PageTitles     string              `json:"pageTitles,omitempty"`
	RichTextFields map[string][]string `json:"richTextFields,omitempty"`
	// Schema is "envelope", "full" or "mixed" (default).
	Schema string `json:"schema,omitempty"`
	// HandleIdleMs and MaxHandlesPerPrincipal keep the JS number as written.
	HandleIdleMs           json.Number `json:"handleIdleMs,omitempty"`
	MaxHandlesPerPrincipal json.Number `json:"maxHandlesPerPrincipal,omitempty"`
	// Principal is the caller when auth is none. Default "local".
	Principal *string `json:"principal,omitempty"`
	// Comments false turns the agent's comment commands off.
	Comments *bool `json:"comments,omitempty"`
	// Manifest and Overrides are validated custom-tools and overrides files.
	Manifest  json.RawMessage `json:"manifest,omitempty"`
	Overrides json.RawMessage `json:"overrides,omitempty"`

	// Authorize, when set, decides every open and every handle call, and
	// filters listings (write false). An error fails the call with -32603
	// and its text, as Node does; on a host server (Embed) the text is
	// logged and the client gets fixed words.
	Authorize AuthorizeFunc `json:"-"`

	// AgentActor, when set, builds the session's actor from the principal
	// and the cleaned client name. The ticket "user" must equal its ID.
	// Blocks the agent writes name OnBehalfOf in createdBy/lastEditedBy and
	// ID in createdWith/lastEditedWith; without OnBehalfOf the ID is named
	// alone. Presence shows Name as given. Nil uses the default actor,
	// whose OnBehalfOf is the principal.
	AgentActor func(principal, clientName string) Actor `json:"-"`

	// DocumentSource, when set, loads and saves stored documents through
	// the host's own store, acting for the caller that opened each handle.
	// It cannot be combined with Source, and counts as a source in every
	// safety check.
	DocumentSource DocumentSource `json:"-"`

	// CreatePage, when set, makes the document of each page block the
	// agent inserts (stored mode with PageTitles "page-map" and a source;
	// with Sync, Rooms or no source it is refused at start). It gets the
	// open document, the handle's opener and a suggested id, and answers
	// the new page id: 1-512 code points, valid UTF-8, no control
	// characters, not "." or "..". Return ErrPageRefused to refuse (the
	// insert fails with FORBIDDEN). Any other error, or an id that breaks
	// those rules, is logged; the agent sees SOURCE_UNAVAILABLE, or, after
	// earlier pages of the batch, ORPHANED_SIDE_EFFECT listing them. Blok
	// asks no Authorize about the new id and saves nothing to it: the host
	// owns it. Undo, redo and delete never call it.
	CreatePage func(ctx context.Context, request blokagent.PageCreateRequest) (string, error) `json:"-"`

	// HandleStore, when set, keeps stored-mode handles where every process
	// sharing it can serve them (see HandleStore). Nil keeps them in this
	// process's memory, as before. Live handles always stay in this
	// process; the per-principal cap counts both.
	HandleStore HandleStore `json:"-"`

	// Uploads, when set, lets the agent upload files through the host's
	// own uploader.
	Uploads *Uploads `json:"-"`

	// Rooms, when set, opens live handles on the rooms of this process:
	// pass blokserver.Server.AgentExecutor() of a server with collaboration
	// on. Live handles then need no Sync, ticket or socket.
	Rooms *blokagent.Executor `json:"-"`
}

// Actor is an agent actor (kind "agent").
type Actor struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	OnBehalfOf *string `json:"onBehalfOf,omitempty"`
	Color      *string `json:"color,omitempty"`
}

// AuthorizeFunc answers whether principal may use documentID, for writing
// when write is true.
type AuthorizeFunc func(ctx context.Context, principal, documentID string, write bool) (bool, error)

// Transport is stdio, or HTTP on Listen (host:port).
type Transport struct {
	Kind   string `json:"kind"`
	Listen string `json:"listen"`
	Public bool   `json:"public,omitempty"`
}

// Auth is "none", or "oauth" with the issuer, audience and JWKS URL.
type Auth struct {
	Kind     string `json:"kind"`
	Issuer   string `json:"issuer,omitempty"`
	Audience string `json:"audience,omitempty"`
	JWKSURL  string `json:"jwksUrl,omitempty"`
}

// Sync is the sync service and the Origin sent to it.
type Sync struct {
	URL    string  `json:"url"`
	Origin *string `json:"origin,omitempty"`
}

// Tickets is "secret" (Secret signs) or "url" (URL mints, HostToken pays).
type Tickets struct {
	Kind      string `json:"kind"`
	Secret    string `json:"secret,omitempty"`
	URL       string `json:"url,omitempty"`
	HostToken string `json:"hostToken,omitempty"`
}

// Source is "files" (Dir) or "endpoint" (URL, EndpointAuth, optional List).
type Source struct {
	Kind         string  `json:"kind"`
	Dir          string  `json:"dir,omitempty"`
	URL          string  `json:"url,omitempty"`
	EndpointAuth string  `json:"endpointAuth,omitempty"`
	List         *string `json:"list,omitempty"`
}

const (
	defaultHandleIdleMs           = 600_000
	defaultMaxHandlesPerPrincipal = 8
	defaultPrincipal              = "local"
)

func (o *Options) principal() string {
	if o.Principal != nil {
		return *o.Principal
	}
	return defaultPrincipal
}

func numberOr(n json.Number, fallback float64) float64 {
	if n == "" {
		return fallback
	}
	value, err := n.Float64()
	if err != nil {
		return fallback
	}
	return value
}

// hasSource says whether stored documents have a source: Source or a
// host's DocumentSource.
func (o *Options) hasSource() bool { return o.Source != nil || o.DocumentSource != nil }

// live says whether documents live in rooms: a remote sync service, or
// this process's own rooms.
func (o *Options) live() bool { return o.Sync != nil || o.Rooms != nil }
