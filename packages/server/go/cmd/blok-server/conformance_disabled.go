//go:build !conformance

package main

import "github.com/JackUait/blok/packages/server/go/v2/blokserver"

type conformanceArguments struct{}

// The ordinary binary has no conformance flags; the host parser refuses them.
func parseConformanceArguments(args []string) ([]string, conformanceArguments, string) {
	return args, conformanceArguments{}, ""
}

func applyConformanceOptions(*blokserver.Options, conformanceArguments) {}

func applyConformance(*blokserver.Server, conformanceArguments) {}
