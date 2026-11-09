package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// CallerIdentity is who the host says makes a call.
type CallerIdentity struct {
	// Principal names the caller. Empty means signed in without a name,
	// which Blok refuses.
	Principal string
	// Scopes, when not nil, are checked as Blok's blok.read and blok.write.
	// Nil skips Blok's scope checks: the host owns auth.
	Scopes []string
}

// EmbedOptions are the host's hooks for Blok on its own server.
type EmbedOptions struct {
	// Caller says who makes one Blok tools/call; nil means anonymous. When
	// Caller is nil, Blok reads req.Extra.TokenInfo (set by the SDK's
	// auth.RequireBearerToken): UserID names the caller, its scopes are
	// ignored, and no TokenInfo is anonymous.
	Caller func(ctx context.Context, req *mcp.CallToolRequest) (*CallerIdentity, error)
	// AnonymousPrincipal, when set, serves anonymous callers as this one
	// principal: they share its handles and its handle cap. Empty refuses
	// them.
	AnonymousPrincipal string
}

const (
	anonymousCaller = "Blok needs a signed-in caller."
	unnamedCaller   = "Blok needs a named caller (sub or NameIdentifier)."
	// callFailed is all a host's client sees of an unexpected error: its
	// text may name the host's internals.
	callFailed = "Blok could not run this call."
)

// Attached is Blok's tools and prompts for a host's own MCP server. Build
// it once with Embed, then Attach it to every server the host makes (one
// per request over stateless HTTP): the handles live here, not in a server.
type Attached struct {
	server  *Server
	embed   EmbedOptions
	tools   []json.RawMessage
	prompts []json.RawMessage
	// toolNames and promptNames keep the bundle's order.
	toolNames   []string
	promptNames []string
	asks        atomic.Int64
	closeOnce   sync.Once
}

// Embed builds Blok from the same Options as the standalone server. The
// host owns the transport and sign-in: Options.Transport is not served,
// and Auth "oauth" and Principal are refused. Authorize is required,
// except for live rooms only with a ticket URL and no source.
func Embed(options Options, embed EmbedOptions) (*Attached, error) {
	pool, err := newPool(1)
	if err != nil {
		return nil, err
	}
	return embedWith(options, embed, pool)
}

func embedWith(options Options, embed EmbedOptions, runtime invoker) (*Attached, error) {
	if options.Auth.Kind == "oauth" {
		return nil, &ConfigError{Message: "Blok's own OAuth is for the standalone server; on a host server the host signs callers in (set EmbedOptions.Caller)"}
	}
	if options.Principal != nil {
		return nil, &ConfigError{Message: "principal names the standalone caller; on a host server use EmbedOptions.Caller, or AnonymousPrincipal"}
	}
	// Blok cannot see the host's transport, so it treats every caller as
	// remote, as over HTTP.
	hostDecides := options.Tickets != nil && options.Tickets.Kind == "url" && !options.hasSource()
	if options.Authorize == nil && !hostDecides {
		return nil, &ConfigError{Message: "Blok on a host server needs a per-document check: pass authorize (--authorize), or serve live rooms only with --ticket-url and no source"}
	}
	options.Auth = Auth{Kind: "none"}
	if options.Transport.Kind == "" {
		options.Transport = Transport{Kind: "stdio"}
	}
	// A loopback listen keeps the bind rules out; the host owns its address.
	checked := options
	checked.Transport = Transport{Kind: "http", Listen: "127.0.0.1:0"}
	server, err := buildServer(options, checked, runtime)
	if err != nil {
		return nil, err
	}
	attached := &Attached{server: server, embed: embed}
	if attached.tools, attached.toolNames, err = namedEntries(server.surface.Tools); err == nil {
		attached.prompts, attached.promptNames, err = namedEntries(server.surface.Prompts)
	}
	if err != nil {
		server.Close()
		return nil, err
	}
	return attached, nil
}

func namedEntries(list json.RawMessage) ([]json.RawMessage, []string, error) {
	var entries []json.RawMessage
	if err := json.Unmarshal(list, &entries); err != nil {
		return nil, nil, err
	}
	names := make([]string, len(entries))
	for index, entry := range entries {
		var named struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(entry, &named); err != nil {
			return nil, nil, err
		}
		names[index] = named.Name
	}
	return entries, names, nil
}

// Instructions is Blok's primer. The host puts it into its own server's
// instructions (mcp.ServerOptions.Instructions); Blok never sets them.
func (a *Attached) Instructions() string { return a.server.surface.Instructions }

// ToolNames are Blok's tool names.
func (a *Attached) ToolNames() []string { return append([]string(nil), a.toolNames...) }

// PromptNames are Blok's prompt names.
func (a *Attached) PromptNames() []string { return append([]string(nil), a.promptNames...) }

// Version is Blok's version.
func (a *Attached) Version() string { return a.server.version }

// Close waits for calls in flight, up to the standalone stop's bound, and
// closes every handle. Later opens are refused.
func (a *Attached) Close() {
	a.closeOnce.Do(func() { a.server.drain(time.Now().Add(stopDrain)) })
}

func (a *Attached) ownsTool(name string) bool   { return slices.Contains(a.toolNames, name) }
func (a *Attached) ownsPrompt(name string) bool { return slices.Contains(a.promptNames, name) }

// Attach serves Blok's tools and prompts on server, next to the host's
// own, through a receiving middleware: it never changes the host's
// serverInfo, instructions, handlers or wire, and only adds the tools and
// prompts capabilities when they are missing. Call it after the host's
// own AddTool and AddPrompt: it lists them once, through an in-memory
// session the host's middleware also sees, and refuses a name Blok
// serves. A clashing tool or prompt added later fails the list instead.
// Blok's tools are not registered with AddTool, so the SDK neither
// validates their arguments nor enforces their Mcp-Param headers.
func (a *Attached) Attach(server *mcp.Server) error {
	tools, prompts, err := hostNames(server)
	if err != nil {
		return fmt.Errorf("blok-mcp: could not list the host's tools and prompts: %w", err)
	}
	if err := a.clash(tools, prompts); err != nil {
		return err
	}
	server.AddReceivingMiddleware(a.middleware)
	return nil
}

func (a *Attached) clash(tools, prompts []string) error {
	var taken []string
	for _, name := range tools {
		if a.ownsTool(name) {
			taken = append(taken, name)
		}
	}
	for _, name := range prompts {
		if a.ownsPrompt(name) {
			taken = append(taken, name)
		}
	}
	if len(taken) > 0 {
		return &ConfigError{Message: "Blok already serves " + strings.Join(taken, ", ") + ": rename the host's tool or prompt"}
	}
	return nil
}

// hostNames lists the host's tools and prompts before Blok is attached.
func hostNames(server *mcp.Server) (tools, prompts []string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	clientSide, serverSide := mcp.NewInMemoryTransports()
	served, err := server.Connect(ctx, serverSide, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = served.Close() }()
	session, err := mcp.NewClient(&mcp.Implementation{Name: "blok-attach", Version: "1"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = session.Close() }()
	capabilities := session.InitializeResult().Capabilities
	if capabilities != nil && capabilities.Tools != nil {
		for tool, err := range session.Tools(ctx, nil) {
			if err != nil {
				return nil, nil, err
			}
			tools = append(tools, tool.Name)
		}
	}
	if capabilities != nil && capabilities.Prompts != nil {
		for prompt, err := range session.Prompts(ctx, nil) {
			if err != nil {
				return nil, nil, err
			}
			prompts = append(prompts, prompt.Name)
		}
	}
	return tools, prompts, nil
}

func (a *Attached) middleware(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		switch method {
		case "initialize":
			result, err := next(ctx, method, req)
			if initialized, ok := result.(*mcp.InitializeResult); ok && err == nil {
				initialized.Capabilities = withBlokCapabilities(initialized.Capabilities)
			}
			return result, err
		case "server/discover":
			result, err := next(ctx, method, req)
			if discovered, ok := result.(*mcp.DiscoverResult); ok && err == nil {
				discovered.Capabilities = withBlokCapabilities(discovered.Capabilities)
			}
			return result, err
		case "tools/list":
			return a.listTools(ctx, method, req, next)
		case "prompts/list":
			return a.listPrompts(ctx, method, req, next)
		case "tools/call":
			if call, ok := req.(*mcp.CallToolRequest); ok && call.Params != nil && a.ownsTool(call.Params.Name) {
				return hidden(a.callTool(ctx, call))
			}
		case "prompts/get":
			if get, ok := req.(*mcp.GetPromptRequest); ok && get.Params != nil && a.ownsPrompt(get.Params.Name) {
				return hidden(a.server.getPrompt(ctx, req))
			}
		}
		return next(ctx, method, req)
	}
}

func withBlokCapabilities(capabilities *mcp.ServerCapabilities) *mcp.ServerCapabilities {
	if capabilities == nil {
		capabilities = &mcp.ServerCapabilities{}
	}
	if capabilities.Tools == nil {
		capabilities.Tools = &mcp.ToolCapabilities{}
	}
	if capabilities.Prompts == nil {
		capabilities.Prompts = &mcp.PromptCapabilities{}
	}
	return capabilities
}

func (a *Attached) listTools(ctx context.Context, method string, req mcp.Request, next mcp.MethodHandler) (mcp.Result, error) {
	result, err := next(ctx, method, req)
	host, ok := result.(*mcp.ListToolsResult)
	if err != nil || !ok {
		return result, err
	}
	names := make([]string, len(host.Tools))
	for index, tool := range host.Tools {
		names[index] = tool.Name
	}
	if err := a.clash(names, nil); err != nil {
		return nil, &jsonrpc.Error{Code: jsonrpc.CodeInternalError, Message: err.Error()}
	}
	params, _ := req.GetParams().(*mcp.ListToolsParams)
	if params != nil && params.Cursor != "" {
		return host, nil
	}
	return &mergedTools{ListToolsResult: host, blok: a.tools}, nil
}

func (a *Attached) listPrompts(ctx context.Context, method string, req mcp.Request, next mcp.MethodHandler) (mcp.Result, error) {
	result, err := next(ctx, method, req)
	host, ok := result.(*mcp.ListPromptsResult)
	if err != nil || !ok {
		return result, err
	}
	names := make([]string, len(host.Prompts))
	for index, prompt := range host.Prompts {
		names[index] = prompt.Name
	}
	if err := a.clash(nil, names); err != nil {
		return nil, &jsonrpc.Error{Code: jsonrpc.CodeInternalError, Message: err.Error()}
	}
	params, _ := req.GetParams().(*mcp.ListPromptsParams)
	if params != nil && params.Cursor != "" {
		return host, nil
	}
	return &mergedPrompts{ListPromptsResult: host, blok: a.prompts}, nil
}

// mergedTools is the host's tools/list page with Blok's raw entries after
// its own. Embedding keeps the SDK's hooks (resultType, _meta) on the
// host's result.
type mergedTools struct {
	*mcp.ListToolsResult
	blok []json.RawMessage
}

func (m *mergedTools) MarshalJSON() ([]byte, error) {
	return withEntries(m.ListToolsResult, "tools", m.blok)
}

type mergedPrompts struct {
	*mcp.ListPromptsResult
	blok []json.RawMessage
}

func (m *mergedPrompts) MarshalJSON() ([]byte, error) {
	return withEntries(m.ListPromptsResult, "prompts", m.blok)
}

// withEntries writes host with blok appended to its key array. Blok's
// entries go as written, so their schemas stay the standalone ones.
func withEntries(host any, key string, blok []json.RawMessage) ([]byte, error) {
	written, err := json.Marshal(host)
	if err != nil {
		return nil, err
	}
	var members map[string]json.RawMessage
	if err := json.Unmarshal(written, &members); err != nil {
		return nil, err
	}
	var entries []json.RawMessage
	if raw, ok := members[key]; ok && string(raw) != "null" {
		if err := json.Unmarshal(raw, &entries); err != nil {
			return nil, err
		}
	}
	entries = append(entries, blok...)
	if members[key], err = marshal(entries); err != nil {
		return nil, err
	}
	return marshal(members)
}

// hidden, for Blok's tools/call and prompts/get, passes Blok's own protocol
// errors on. Any other error (the host's caller hook, a host source,
// creator or store, Blok's own) is logged in full and answered -32603 with
// fixed words. The standalone server keeps
// internalError, which sends the text.
func hidden(result mcp.Result, err error) (mcp.Result, error) {
	var wire *jsonrpc.Error
	if err == nil || errors.As(err, &wire) {
		return result, err
	}
	logf("a Blok call failed: %v", err)
	return nil, &jsonrpc.Error{Code: jsonrpc.CodeInternalError, Message: callFailed}
}

// callTool answers one Blok tools/call as the standalone server does.
func (a *Attached) callTool(ctx context.Context, call *mcp.CallToolRequest) (mcp.Result, error) {
	who, err := a.identify(ctx, call)
	if err != nil {
		return nil, err
	}
	meta := call.Params.GetMeta()
	// These keys are the standalone transports' own; a host's client
	// must not set them.
	delete(meta, signalKey)
	delete(meta, turnKey)
	delete(meta, rawResponsesKey)
	if call.Params.InputResponses != nil {
		replies, err := marshal(call.Params.InputResponses)
		if err != nil {
			return nil, err
		}
		if meta == nil {
			meta = mcp.Meta{}
		}
		meta[rawResponsesKey] = json.RawMessage(replies)
	}
	call.Params.SetMeta(meta)
	return a.server.callTool(ctx, call, who, &a.asks)
}

func (a *Attached) identify(ctx context.Context, call *mcp.CallToolRequest) (identity, error) {
	var who *CallerIdentity
	if a.embed.Caller != nil {
		var err error
		if who, err = a.embed.Caller(ctx, call); err != nil {
			return identity{}, err
		}
	} else if call.Extra != nil && call.Extra.TokenInfo != nil {
		who = &CallerIdentity{Principal: call.Extra.TokenInfo.UserID}
	}
	if who == nil {
		if a.embed.AnonymousPrincipal == "" {
			return identity{}, &jsonrpc.Error{Code: jsonrpc.CodeInvalidRequest, Message: anonymousCaller}
		}
		return identity{principal: a.embed.AnonymousPrincipal}, nil
	}
	if who.Principal == "" {
		return identity{}, &jsonrpc.Error{Code: jsonrpc.CodeInvalidRequest, Message: unnamedCaller}
	}
	return identity{principal: who.Principal, scopes: who.Scopes}, nil
}
