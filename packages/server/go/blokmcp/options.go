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
	// filters listings (write false). An error denies.
	Authorize AuthorizeFunc `json:"-"`

	// Rooms, when set, opens live handles on the rooms of this process:
	// pass blokserver.Server.AgentExecutor() of a server with collaboration
	// on. Live handles then need no Sync, ticket or socket.
	Rooms *blokagent.Executor `json:"-"`
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

// live says whether documents live in rooms: a remote sync service, or
// this process's own rooms.
func (o *Options) live() bool { return o.Sync != nil || o.Rooms != nil }
