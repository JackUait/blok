//go:build conformance

package main

import (
	"flag"
	"fmt"
	"net"
	"net/url"
	"strconv"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

type conformanceSettings struct {
	allowedAddr   string
	allowedOrigin string
}

func registerConformanceFlags(fs *flag.FlagSet, cfg *serverConfig) {
	fs.Func("conformance-origin", "test-only exact loopback origin allowed for conformance fixtures", func(raw string) error {
		address, err := parseConformanceOrigin(raw)
		if err != nil {
			return err
		}

		cfg.allowedAddr = address
		cfg.allowedOrigin = raw

		return nil
	})
}

func parseConformanceOrigin(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Hostname() != "127.0.0.1" ||
		parsed.Path != "" || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery ||
		parsed.Fragment != "" || parsed.RawFragment != "" {
		return "", conformanceOriginError(raw)
	}

	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return "", conformanceOriginError(raw)
	}

	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	if parsed.Host != address || parsed.String() != raw {
		return "", conformanceOriginError(raw)
	}

	return address, nil
}

func conformanceOriginError(raw string) error {
	return fmt.Errorf("must be exactly http://127.0.0.1:PORT with a port from 1 to 65535 and no userinfo, path, query, or fragment (got %q)", raw)
}

func applyConformanceOrigin(cfg serverConfig, page, media *fetchguard.Config) {
	if cfg.allowedAddr == "" {
		return
	}

	fetchguard.AllowConformanceOrigin(page, cfg.allowedOrigin, cfg.allowedAddr)
	fetchguard.AllowConformanceOrigin(media, cfg.allowedOrigin, cfg.allowedAddr)
}
