//go:build !conformance

package fetchguard

import "net/url"

type conformanceSettings struct{}

func validateConformanceURL(Config, *url.URL) error { return nil }
