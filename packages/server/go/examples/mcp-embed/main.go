// Command mcp-embed serves Blok's MCP tools on a host's own MCP server.
//
// This host has its own serverInfo ("host-example"), its own instructions,
// one tool (host_echo) and one prompt (host_hello). It adds Blok's blok_*
// tools and prompts with blokmcp.Embed and Attach, configured by the same
// flags and env as blok-mcp (blokmcp.ParseArgs).
//
//	go run ./examples/mcp-embed --source files:./docs --authorize <url> [--http 127.0.0.1:0]
//
// Signing in is the host's job; this example fakes it:
//
//	HTTP   X-Example-User: <name> signs the caller in as <name>, as an
//	       auth.TokenInfo whose UserID Blok reads by default.
//	       X-Example-Signed-In: true without X-Example-User signs them in
//	       without a name. Neither header: anonymous.
//	       X-Example-Scopes: a,b puts scopes on the token; Blok ignores them.
//	stdio  the one local user, "local".
//
// Blok refuses anonymous and unnamed callers unless
// --example-allow-anonymous is given.
//
// Example flags (every other flag goes to Blok):
//
//	--example-host-tool <name>             the host tool's name (default host_echo)
//	--example-host-prompt <name>           the host prompt's name (default host_hello)
//	--example-allow-anonymous <principal>  serve anonymous callers as this principal
//	--example-source endpoint:<url>        your own document store, as
//	                                       Options.DocumentSource (see source.go;
//	                                       not with --source)
//	--example-caller-error <text>          the caller hook fails with this text,
//	                                       to show what a client sees of a host
//	                                       bug: -32603 with fixed words
//	--example-caller-scopes <a,b>          the caller hook gives exactly these
//	                                       scopes, which Blok checks ("" is
//	                                       none); without it scopes are nil
//	                                       and Blok checks none
//
// The HTTP side keeps only what an example needs: no Origin/Host checks and
// no body cap of its own. Those, like OAuth, belong to your server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokmcp"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const name = "host-example"

var exampleFlags = map[string]bool{
	"--example-host-tool": true, "--example-host-prompt": true, "--example-allow-anonymous": true, "--example-source": true,
	"--example-caller-error": true, "--example-caller-scopes": true,
}

// startError stops the example at start with exit code 2.
type startError struct{ message string }

func (e *startError) Error() string { return e.message }

// splitArgs splits this example's own flags from the blok-mcp ones. Each
// example flag takes a value.
func splitArgs(argv []string) (map[string]string, []string, error) {
	example := map[string]string{}
	var blok []string
	for index := 0; index < len(argv); index++ {
		arg := argv[index]
		if !exampleFlags[arg] {
			blok = append(blok, arg)
			continue
		}
		if index+1 >= len(argv) || strings.HasPrefix(argv[index+1], "--") {
			return nil, nil, &startError{arg + " needs a value"}
		}
		example[strings.TrimPrefix(arg, "--example-")] = argv[index+1]
		index++
	}
	return example, blok, nil
}

func valueOr(example map[string]string, key, fallback string) string {
	if value, ok := example[key]; ok {
		return value
	}
	return fallback
}

// hostServer is the host's own server for one connection or request.
func hostServer(example map[string]string, blok *blokmcp.Attached) (*mcp.Server, error) {
	server := mcp.NewServer(&mcp.Implementation{Name: name, Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: "Host instructions.\n\n" + blok.Instructions(),
		// logging is the host's own capability: Blok must keep it.
		Capabilities: &mcp.ServerCapabilities{Logging: &mcp.LoggingCapabilities{}},
	})
	server.AddTool(&mcp.Tool{
		Name:        valueOr(example, "host-tool", "host_echo"),
		Description: "Echoes the text back.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}}}`),
	}, func(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var args map[string]any
		_ = json.Unmarshal(req.Params.Arguments, &args)
		text := ""
		if value, ok := args["text"]; ok && value != nil {
			text = fmt.Sprint(value)
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil
	})
	server.AddPrompt(&mcp.Prompt{Name: valueOr(example, "host-prompt", "host_hello"), Description: "Says hello."},
		func(context.Context, *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{Messages: []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: "Hello from the host."}}}}, nil
		})
	if err := blok.Attach(server); err != nil {
		return nil, err
	}
	return server, nil
}

// signedIn is the fake sign-in: the token the SDK's bearer check would
// have verified, or nil for an anonymous caller.
func signedIn(r *http.Request) *auth.TokenInfo {
	var scopes []string
	for _, scope := range strings.Split(r.Header.Get("X-Example-Scopes"), ",") {
		if scope = strings.TrimSpace(scope); scope != "" {
			scopes = append(scopes, scope)
		}
	}
	// The SDK's bearer check refuses a token without a future expiry.
	expires := time.Now().Add(time.Hour)
	if user := r.Header.Get("X-Example-User"); user != "" {
		return &auth.TokenInfo{UserID: user, Scopes: scopes, Expiration: expires}
	}
	if r.Header.Get("X-Example-Signed-In") == "true" {
		return &auth.TokenInfo{Expiration: expires}
	}
	return nil
}

// withSignIn puts a signed-in caller's token into the request, through the
// SDK's own bearer check, so Blok's default caller reads it.
func withSignIn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := signedIn(r)
		if token == nil {
			next.ServeHTTP(w, r)
			return
		}
		verify := func(context.Context, string, *http.Request) (*auth.TokenInfo, error) { return token, nil }
		r = r.Clone(r.Context())
		r.Header.Set("Authorization", "Bearer example")
		auth.RequireBearerToken(verify, nil)(next).ServeHTTP(w, r)
	})
}

func serveHTTP(ctx context.Context, listen string, build func() (*mcp.Server, error)) (func(context.Context), error) {
	sdk := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		server, err := build()
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
			return nil
		}
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true, DisableLocalhostProtection: true})
	mux := http.NewServeMux()
	mux.Handle("/mcp", withSignIn(sdk))
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return nil, err
	}
	address, _ := listener.Addr().(*net.TCPAddr)
	host := address.IP.String()
	if address.IP.To4() == nil {
		host = "[" + host + "]"
	}
	fmt.Fprintf(os.Stderr, "%s: listening on http://%s:%s/mcp\n", name, host, strconv.Itoa(address.Port))
	server := &http.Server{Handler: mux}
	go func() { _ = server.Serve(listener) }()
	return func(ctx context.Context) { _ = server.Shutdown(ctx) }, nil
}

// callerHook is the example's caller hook; nil over HTTP keeps Blok's
// default, which reads the SDK's TokenInfo.
func callerHook(example map[string]string, stdio bool) func(context.Context, *mcp.CallToolRequest) (*blokmcp.CallerIdentity, error) {
	if text, ok := example["caller-error"]; ok {
		return func(context.Context, *mcp.CallToolRequest) (*blokmcp.CallerIdentity, error) {
			return nil, errors.New(text)
		}
	}
	list, scoped := example["caller-scopes"]
	// nil, not [], without the flag: [] would refuse every call.
	var scopes []string
	if scoped {
		scopes = []string{}
		for _, scope := range strings.Split(list, ",") {
			if scope = strings.TrimSpace(scope); scope != "" {
				scopes = append(scopes, scope)
			}
		}
	}
	if stdio {
		// stdio has one local user.
		return func(context.Context, *mcp.CallToolRequest) (*blokmcp.CallerIdentity, error) {
			return &blokmcp.CallerIdentity{Principal: "local", Scopes: scopes}, nil
		}
	}
	if !scoped {
		return nil
	}
	return func(_ context.Context, req *mcp.CallToolRequest) (*blokmcp.CallerIdentity, error) {
		// No token is anonymous, as with the default caller.
		if req.Extra == nil || req.Extra.TokenInfo == nil {
			return nil, nil
		}
		return &blokmcp.CallerIdentity{Principal: req.Extra.TokenInfo.UserID, Scopes: scopes}, nil
	}
}

func run() error {
	example, blokArgs, err := splitArgs(os.Args[1:])
	if err != nil {
		return err
	}
	env := map[string]string{}
	for _, entry := range os.Environ() {
		if key, value, ok := strings.Cut(entry, "="); ok {
			env[key] = value
		}
	}
	options, err := blokmcp.ParseArgs(blokArgs, env)
	if err != nil {
		return err
	}
	if spec, ok := example["source"]; ok {
		url, isEndpoint := strings.CutPrefix(spec, "endpoint:")
		if !isEndpoint {
			return &startError{fmt.Sprintf("--example-source must be endpoint:<url>, got %q", spec)}
		}
		if options.Source != nil {
			return &startError{"--example-source cannot be combined with --source"}
		}
		options.DocumentSource = newExampleSource(url)
	}
	stdio := options.Transport.Kind != "http"
	embed := blokmcp.EmbedOptions{AnonymousPrincipal: example["allow-anonymous"], Caller: callerHook(example, stdio)}
	blok, err := blokmcp.Embed(options, embed)
	if err != nil {
		return err
	}
	build := func() (*mcp.Server, error) { return hostServer(example, blok) }
	// Over HTTP a server is built per request, so check the names once
	// before serving.
	first, err := build()
	if err != nil {
		blok.Close()
		return &startError{err.Error()}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if stdio {
		err := first.Run(ctx, &mcp.StdioTransport{})
		// Blok first: it waits for calls in flight.
		blok.Close()
		if err != nil && ctx.Err() == nil && !errors.Is(err, context.Canceled) {
			return err
		}
		return nil
	}
	shutdown, err := serveHTTP(ctx, options.Transport.Listen, build)
	if err != nil {
		blok.Close()
		return err
	}
	<-ctx.Done()
	blok.Close()
	shutdown(context.Background())
	return nil
}

func main() {
	err := run()
	if err == nil {
		return
	}
	fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
	var start *startError
	var config *blokmcp.ConfigError
	if errors.As(err, &start) || errors.As(err, &config) {
		os.Exit(2)
	}
	os.Exit(1)
}
