//go:build !conformance

package main

import (
	"flag"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

type conformanceSettings struct{}

func registerConformanceFlags(*flag.FlagSet, *serverConfig) {}

func applyConformanceOrigin(serverConfig, *fetchguard.Config, *fetchguard.Config) {}
