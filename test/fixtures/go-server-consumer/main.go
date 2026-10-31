// Command blok-server-consumer is a Go host that mounts Blok under its own
// prefix and its own authentication, as a library consumer would.
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/JackUait/blok/packages/server/go/blokdocs"
	"github.com/JackUait/blok/packages/server/go/blokserver"
)

const prefix = "/api/blok"

func main() {
	listen := flag.String("listen", "127.0.0.1:4000", "address to listen on")
	flag.Parse()

	if err := convertOnce(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	options := blokserver.DefaultOptions()
	options.AllowedOrigins = []string{"https://app.example.test"}
	options.UnfurlEnabled = true
	options.Version = "package-fixture"
	server, err := blokserver.New(options)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	mux.Handle(prefix+"/", requireUser(server.Handler(prefix)))
	if err := http.ListenAndServe(*listen, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// convertOnce proves the embedded document runtime loads in a consumer build.
func convertOnce() error {
	converter, err := blokdocs.New(blokdocs.Options{PoolSize: 1})
	if err != nil {
		return err
	}
	const document = `{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b>"}}]}`
	converted, err := converter.ToMarkdown(context.Background(), document)
	if err != nil {
		return err
	}
	if converted.Markdown != "Ships **today**" {
		return fmt.Errorf("unexpected markdown %q", converted.Markdown)
	}
	return nil
}

// requireUser stands in for the host's own authentication. C# marks health
// and CORS preflights AllowAnonymous, so a host that requires a user must
// let those two through itself.
func requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anonymous := r.Method == http.MethodOptions || strings.TrimPrefix(r.URL.Path, prefix) == "/health"
		if !anonymous && r.Header.Get("X-Test-User") == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
