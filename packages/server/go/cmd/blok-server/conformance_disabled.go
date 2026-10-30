//go:build !conformance

package main

import "github.com/JackUait/blok/packages/server/go/blokserver"

type conformanceArguments struct{}

// The ordinary binary has no conformance flags; the host parser refuses them.
func parseConformanceArguments(args []string) ([]string, conformanceArguments, string) {
	return args, conformanceArguments{}, ""
}

func applyConformance(*blokserver.Server, conformanceArguments) {}
