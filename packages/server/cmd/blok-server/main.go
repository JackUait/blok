package main

import (
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/JackUait/blok/packages/server/internal/config"
	"github.com/JackUait/blok/packages/server/internal/httpapi"
)

// version is stamped at build time via -ldflags.
var version = "dev"

func main() {
	var (
		listen   = flag.String("listen", "127.0.0.1:4000", "address to listen on")
		auth     = flag.String("auth", "none", "access mode: none, proxy, or ticket")
		secret   = flag.String("secret", "", "shared secret for --auth ticket")
		origins  = flag.String("allow-origin", "", "comma-separated origins allowed to call this service")
		storage  = flag.String("storage-dir", "./blok-uploads", "directory for uploaded files")
		noUnfurl = flag.Bool("no-unfurl", false, "disable link previews entirely")
	)
	flag.Parse()

	cfg := config.Config{
		Listen:         *listen,
		Auth:           config.AuthMode(*auth),
		Secret:         *secret,
		AllowedOrigins: splitOrigins(*origins),
		StorageDir:     *storage,
		UnfurlDisabled: *noUnfurl,
	}

	if err := config.Validate(cfg); err != nil {
		log.Fatalf("blok-server refused to start: %v", err)
	}

	log.Printf("blok-server %s listening on %s (--auth %s)", version, cfg.Listen, cfg.Auth)

	if err := http.ListenAndServe(cfg.Listen, httpapi.New(httpapi.Options{Version: version})); err != nil {
		log.Fatal(err)
	}
}

// splitOrigins drops blank entries so a trailing comma cannot leave "" in the
// allowlist, where it would match a request that sent no Origin at all. An
// empty flag yields a nil slice, which is what the ticket interlock refuses.
func splitOrigins(csv string) []string {
	var out []string

	for _, origin := range strings.Split(csv, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			out = append(out, origin)
		}
	}

	return out
}
