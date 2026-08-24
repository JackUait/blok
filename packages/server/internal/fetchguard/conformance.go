//go:build conformance

package fetchguard

import (
	"fmt"
	"net/url"
)

type conformanceSettings struct {
	allowedOrigin string
}

func AllowConformanceOrigin(cfg *Config, origin, address string) {
	cfg.allowedOrigin = origin
	cfg.TestOnlyAllowedAddrs = []string{address}
}

func validateConformanceURL(cfg Config, target *url.URL) error {
	if cfg.allowedOrigin == "" {
		return nil
	}
	if target.User != nil || target.Scheme+"://"+target.Host != cfg.allowedOrigin {
		return fmt.Errorf("%w: URL origin does not match the conformance fixture", ErrBlockedAddress)
	}

	return nil
}
