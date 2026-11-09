package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func allowAll(context.Context, string, string, bool) (bool, error) { return true, nil }

func embedOptions(t *testing.T) Options {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return Options{Source: &Source{Kind: "files", Dir: dir}, Authorize: allowAll}
}

func newBlok(t *testing.T, options Options, embed EmbedOptions) *Attached {
	t.Helper()
	blok, err := Embed(options, embed)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(blok.Close)
	return blok
}

// hostServer is a host's own server: one tool, one prompt, its own
// instructions and the logging capability.
func hostServer(blok *Attached, tool, prompt string) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "host-example", Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: "Host instructions.\n\n" + blok.Instructions(),
		Capabilities: &mcp.ServerCapabilities{Logging: &mcp.LoggingCapabilities{}},
	})
	if tool != "" {
		server.AddTool(&mcp.Tool{Name: tool, InputSchema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}}}`)},
			func(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				var args struct{ Text string }
				_ = json.Unmarshal(req.Params.Arguments, &args)
				return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: args.Text}}}, nil
			})
	}
	if prompt != "" {
		server.AddPrompt(&mcp.Prompt{Name: prompt}, func(context.Context, *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: "Hello from the host."}}}}, nil
		})
	}
	return server
}

func connect(t *testing.T, server *mcp.Server) *mcp.ClientSession {
	t.Helper()
	clientSide, serverSide := mcp.NewInMemoryTransports()
	if _, err := server.Connect(context.Background(), serverSide, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "Desktop", Version: "1"}, nil).Connect(context.Background(), clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func attachedHost(t *testing.T, embed EmbedOptions) (*Attached, *mcp.ClientSession) {
	t.Helper()
	blok := newBlok(t, embedOptions(t), embed)
	server := hostServer(blok, "host_echo", "host_hello")
	if err := blok.Attach(server); err != nil {
		t.Fatal(err)
	}
	return blok, connect(t, server)
}

func as(principal string) EmbedOptions {
	return EmbedOptions{Caller: func(context.Context, *mcp.CallToolRequest) (*CallerIdentity, error) {
		return &CallerIdentity{Principal: principal}, nil
	}}
}

func callBlok(t *testing.T, session *mcp.ClientSession, name string, arguments map[string]any) (map[string]any, error) {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil {
		return nil, err
	}
	content, _ := json.Marshal(result.StructuredContent)
	var out map[string]any
	_ = json.Unmarshal(content, &out)
	text, ok := result.Content[0].(*mcp.TextContent)
	if !ok || !sameJSON(t, text.Text, string(content)) {
		t.Fatalf("%s: the text content is not the structured content: %#v", name, result.Content)
	}
	return out, nil
}

func wireError(err error) *jsonrpc.Error {
	var wire *jsonrpc.Error
	if errors.As(err, &wire) {
		return wire
	}
	return nil
}

func TestAttachedExposesBloksSurfaceForTheHost(t *testing.T) {
	blok := newBlok(t, embedOptions(t), EmbedOptions{})
	standalone, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: embedOptions(t).Source})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(standalone.Close)
	if blok.Instructions() != standalone.surface.Instructions || blok.Instructions() == "" || blok.Version() != standalone.version {
		t.Fatalf("instructions %q version %q", blok.Instructions(), blok.Version())
	}
	if !slices.Contains(blok.ToolNames(), "blok_open") || !slices.Contains(blok.PromptNames(), "improve") {
		t.Fatalf("tools %v prompts %v", blok.ToolNames(), blok.PromptNames())
	}
}

func TestAttachKeepsTheHostsIdentityAndServesBothSurfaces(t *testing.T) {
	blok, session := attachedHost(t, as("alice"))
	init := session.InitializeResult()
	if init.ServerInfo.Name != "host-example" || init.Instructions != "Host instructions.\n\n"+blok.Instructions() ||
		init.Capabilities.Logging == nil || init.Capabilities.Tools == nil || init.Capabilities.Prompts == nil {
		t.Fatalf("initialize: %+v", init)
	}
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	slices.Sort(names)
	want := append([]string{"host_echo"}, blok.ToolNames()...)
	slices.Sort(want)
	if !slices.Equal(names, want) {
		t.Fatalf("tools %v, want %v", names, want)
	}
	prompts, err := session.ListPrompts(context.Background(), nil)
	if err != nil || len(prompts.Prompts) != len(blok.PromptNames())+1 {
		t.Fatalf("prompts %v %v", prompts, err)
	}
	echoed, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "host_echo", Arguments: map[string]any{"text": "hi"}})
	if err != nil || echoed.Content[0].(*mcp.TextContent).Text != "hi" {
		t.Fatalf("host_echo: %v %v", echoed, err)
	}
	hello, err := session.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: "host_hello"})
	if err != nil || hello.Messages[0].Content.(*mcp.TextContent).Text != "Hello from the host." {
		t.Fatalf("host_hello: %v %v", hello, err)
	}
	if _, err := session.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: "improve"}); wireError(err) == nil ||
		wireError(err).Message != "Prompt improve needs the selection argument." {
		t.Fatalf("improve: %v", err)
	}
	if _, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "nope"}); wireError(err) == nil || wireError(err).Code != jsonrpc.CodeInvalidParams {
		t.Fatalf("nope: %v", err)
	}
	opened, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc", "write": true})
	if err != nil || opened["mode"] != "stored" {
		t.Fatalf("open: %v %v", opened, err)
	}
	ran, err := callBlok(t, session, "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "T"}}}})
	if err != nil || ran["ok"] != true {
		t.Fatalf("execute: %v %v", ran, err)
	}
}

func TestAttachAddsToolsAndPromptsCapabilitiesAHostLacks(t *testing.T) {
	blok := newBlok(t, embedOptions(t), as("alice"))
	server := hostServer(blok, "", "")
	if err := blok.Attach(server); err != nil {
		t.Fatal(err)
	}
	init := connect(t, server).InitializeResult()
	if init.Capabilities.Tools == nil || init.Capabilities.Prompts == nil || init.Capabilities.Logging == nil {
		t.Fatalf("capabilities: %+v", init.Capabilities)
	}
}

func TestAHostNameBlokServesStopsAttach(t *testing.T) {
	blok := newBlok(t, embedOptions(t), EmbedOptions{})
	for _, clash := range [][2]string{{"blok_open", "host_hello"}, {"host_echo", "improve"}} {
		err := blok.Attach(hostServer(blok, clash[0], clash[1]))
		name := clash[0]
		if name == "host_echo" {
			name = clash[1]
		}
		if err == nil || !strings.Contains(err.Error(), "Blok already serves "+name) {
			t.Fatalf("%v: %v", clash, err)
		}
	}
}

func TestAHostToolAddedAfterAttachThatClashesFailsTheList(t *testing.T) {
	blok := newBlok(t, embedOptions(t), EmbedOptions{})
	server := hostServer(blok, "host_echo", "")
	if err := blok.Attach(server); err != nil {
		t.Fatal(err)
	}
	server.AddTool(&mcp.Tool{Name: "blok_read", InputSchema: json.RawMessage(`{"type":"object"}`)},
		func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return &mcp.CallToolResult{}, nil
		})
	_, err := connect(t, server).ListTools(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "Blok already serves blok_read") {
		t.Fatalf("list: %v", err)
	}
}

func TestAnonymousAndUnnamedCallersAreRefused(t *testing.T) {
	cases := []struct {
		who  *CallerIdentity
		want string
	}{
		{nil, "Blok needs a signed-in caller."},
		{&CallerIdentity{}, "Blok needs a named caller (sub or NameIdentifier)."},
	}
	for _, c := range cases {
		_, session := attachedHost(t, EmbedOptions{Caller: func(context.Context, *mcp.CallToolRequest) (*CallerIdentity, error) { return c.who, nil }})
		_, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc"})
		if wire := wireError(err); wire == nil || wire.Code != jsonrpc.CodeInvalidRequest || wire.Message != c.want {
			t.Fatalf("%v: %v", c.who, err)
		}
		if _, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "host_echo", Arguments: map[string]any{"text": "x"}}); err != nil {
			t.Fatalf("host_echo: %v", err)
		}
	}
}

func TestAnAnonymousPrincipalServesAnonymousCallers(t *testing.T) {
	var principals []string
	options := embedOptions(t)
	options.Authorize = func(_ context.Context, principal, _ string, _ bool) (bool, error) {
		principals = append(principals, principal)
		return true, nil
	}
	blok := newBlok(t, options, EmbedOptions{AnonymousPrincipal: "guest"})
	server := hostServer(blok, "host_echo", "")
	if err := blok.Attach(server); err != nil {
		t.Fatal(err)
	}
	if opened, err := callBlok(t, connect(t, server), "blok_open", map[string]any{"documentId": "doc"}); err != nil || opened["handle"] == nil {
		t.Fatalf("open: %v %v", opened, err)
	}
	if !slices.Equal(principals, []string{"guest"}) {
		t.Fatalf("authorize saw %v", principals)
	}
}

func TestAHandleIsBoundToItsOpener(t *testing.T) {
	who := "alice"
	blok := newBlok(t, embedOptions(t), EmbedOptions{Caller: func(context.Context, *mcp.CallToolRequest) (*CallerIdentity, error) {
		return &CallerIdentity{Principal: who}, nil
	}})
	server := hostServer(blok, "", "")
	if err := blok.Attach(server); err != nil {
		t.Fatal(err)
	}
	session := connect(t, server)
	opened, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc"})
	if err != nil {
		t.Fatal(err)
	}
	who = "bob"
	read, err := callBlok(t, session, "blok_read", map[string]any{"handle": opened["handle"]})
	if code, _ := errorCodeOf(read); err != nil || code != "UNKNOWN_HANDLE" {
		t.Fatalf("bob read: %v %v", read, err)
	}
}

func TestEmbedRefusesStandaloneOnlyOptions(t *testing.T) {
	principal := "someone"
	cases := map[string]struct {
		options Options
		want    string
	}{
		"oauth":     {Options{Auth: Auth{Kind: "oauth"}, Authorize: allowAll}, "Blok's own OAuth is for the standalone server"},
		"principal": {Options{Principal: &principal, Authorize: allowAll}, "principal names the standalone caller"},
		"authorize": {Options{Source: &Source{Kind: "files", Dir: t.TempDir()}}, "Blok on a host server needs a per-document check"},
		"custom": {Options{DocumentSource: newMemorySource(nil), Tickets: &Tickets{Kind: "url", URL: "http://127.0.0.1:9/t", HostToken: "x"},
			Sync: &Sync{URL: "ws://127.0.0.1:9/sync"}}, "Blok on a host server needs a per-document check"},
	}
	for name, c := range cases {
		_, err := Embed(c.options, EmbedOptions{})
		var refused *ConfigError
		if !errors.As(err, &refused) || !strings.HasPrefix(refused.Message, c.want) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	// The host decides per room: live only, no source, no authorize.
	blok, err := Embed(Options{Tickets: &Tickets{Kind: "url", URL: "http://127.0.0.1:9/t", HostToken: "x"}, Sync: &Sync{URL: "ws://127.0.0.1:9/sync"}}, EmbedOptions{})
	if err != nil {
		t.Fatal(err)
	}
	blok.Close()
}

// Over HTTP the default caller is the SDK's TokenInfo: UserID names it, and
// its scopes are not Blok's to check.
func TestTheDefaultCallerIsTheTokenUser(t *testing.T) {
	var principals []string
	options := embedOptions(t)
	options.Authorize = func(_ context.Context, principal, _ string, _ bool) (bool, error) {
		principals = append(principals, principal)
		return true, nil
	}
	blok := newBlok(t, options, EmbedOptions{})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		server := hostServer(blok, "host_echo", "")
		if err := blok.Attach(server); err != nil {
			t.Error(err)
		}
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true})
	verify := func(_ context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
		return &auth.TokenInfo{UserID: token, Scopes: []string{"other"}, Expiration: timeFar}, nil
	}
	front := httptest.NewServer(auth.RequireBearerToken(verify, nil)(handler))
	t.Cleanup(front.Close)
	transport := &mcp.StreamableClientTransport{Endpoint: front.URL, HTTPClient: &http.Client{Transport: bearer{"alice"}}}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "Desktop", Version: "1"}, nil).Connect(context.Background(), transport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	opened, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc", "write": true})
	if err != nil || opened["handle"] == nil {
		t.Fatalf("open: %v %v", opened, err)
	}
	ran, err := callBlok(t, session, "blok_execute", map[string]any{"handle": opened["handle"],
		"commands": []any{map[string]any{"name": "doc.setTitle", "args": map[string]any{"title": "T"}}}})
	if err != nil || ran["ok"] != true {
		t.Fatalf("execute: %v %v", ran, err)
	}
	if len(principals) == 0 || principals[0] != "alice" {
		t.Fatalf("authorize saw %v", principals)
	}
}

type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

var timeFar = time.Now().Add(time.Hour)

// An unexpected error on a host server (here the host's own caller hook) is
// logged in full and answered -32603 with fixed words, never its text.
func TestAnUnexpectedErrorIsLoggedAndAnsweredWithFixedWords(t *testing.T) {
	var log strings.Builder
	previous := logOutput
	logOutput = &log
	t.Cleanup(func() { logOutput = previous })
	_, session := attachedHost(t, EmbedOptions{Caller: func(context.Context, *mcp.CallToolRequest) (*CallerIdentity, error) {
		return nil, errors.New("secret-host-failure")
	}})
	_, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc"})
	if wire := wireError(err); wire == nil || wire.Code != jsonrpc.CodeInternalError || wire.Message != "Blok could not run this call." {
		t.Fatalf("err %v", err)
	}
	if !strings.Contains(log.String(), "secret-host-failure") {
		t.Fatalf("log %q", log.String())
	}
	if _, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "host_echo", Arguments: map[string]any{"text": "x"}}); err != nil {
		t.Fatalf("host_echo: %v", err)
	}
}

// promptFails runs the real engine but fails Blok's prompts.
type promptFails struct{ real invoker }

func (p promptFails) Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error) {
	if op == "mcpPrompt" {
		return "", errors.New("secret-prompt-failure")
	}
	return p.real.Invoke(ctx, op, input, timeout)
}

// An unexpected prompts/get error gets the same fixed words as a tool call.
func TestAnUnexpectedPromptErrorIsAnsweredWithFixedWords(t *testing.T) {
	var log strings.Builder
	previous := logOutput
	logOutput = &log
	t.Cleanup(func() { logOutput = previous })
	pool, err := newPool(1)
	if err != nil {
		t.Fatal(err)
	}
	blok, err := embedWith(embedOptions(t), as("alice"), promptFails{real: pool})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(blok.Close)
	if len(blok.promptNames) == 0 {
		t.Fatal("Blok serves no prompts")
	}
	server := hostServer(blok, "", "")
	if err := blok.Attach(server); err != nil {
		t.Fatal(err)
	}
	session := connect(t, server)
	_, err = session.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: blok.promptNames[0]})
	if wire := wireError(err); wire == nil || wire.Code != jsonrpc.CodeInternalError || wire.Message != "Blok could not run this call." {
		t.Fatalf("err %v", err)
	}
	if !strings.Contains(log.String(), "secret-prompt-failure") {
		t.Fatalf("log %q", log.String())
	}
}

// A caller hook's scopes are checked as the standalone server checks
// OAuth scopes: [] allows nothing, blok.read allows reads only.
func TestCallerScopesAreCheckedAsStandaloneScopes(t *testing.T) {
	standalone, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: embedOptions(t).Source})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(standalone.Close)
	expected := func(scopes []string, tool string, arguments map[string]any) map[string]any {
		who, err := standalone.actorFor(context.Background(), "alice", nil)
		if err != nil {
			t.Fatal(err)
		}
		who.scopes = scopes
		written, _ := json.Marshal(arguments)
		ran, err := standalone.dispatch(context.Background(), &toolCall{name: tool, arguments: written, caller: who})
		if err != nil {
			t.Fatal(err)
		}
		return structured(t, ran.answer)
	}
	for _, scopes := range [][]string{{}, {"blok.read"}} {
		_, session := attachedHost(t, EmbedOptions{Caller: func(context.Context, *mcp.CallToolRequest) (*CallerIdentity, error) {
			return &CallerIdentity{Principal: "alice", Scopes: scopes}, nil
		}})
		read, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc"})
		if err != nil {
			t.Fatal(err)
		}
		write, err := callBlok(t, session, "blok_open", map[string]any{"documentId": "doc", "write": true})
		if err != nil {
			t.Fatal(err)
		}
		if len(scopes) == 0 {
			if code := errorCode(read); code == "" || !reflect.DeepEqual(read, expected(scopes, "blok_open", map[string]any{"documentId": "doc"})) {
				t.Fatalf("[] read %v", read)
			}
		} else if _, ok := read["handle"].(string); !ok {
			t.Fatalf("blok.read read %v", read)
		}
		if code := errorCode(write); code == "" || !reflect.DeepEqual(write, expected(scopes, "blok_open", map[string]any{"documentId": "doc", "write": true})) {
			t.Fatalf("%v write %v", scopes, write)
		}
	}
}
