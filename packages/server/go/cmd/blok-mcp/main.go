// Command blok-mcp is Blok's MCP server, the Go port of @bloklabs/mcp. It
// takes the same flags and environment variables.
package main

import (
	"os"
	"strings"

	"github.com/JackUait/blok/packages/server/go/v2/blokmcp"
)

// version is stamped at build time: -ldflags "-X main.version=1.2.3".
var version = ""

func main() {
	// stdout carries the protocol, so stray writes go to stderr.
	protocol := os.Stdout
	os.Stdout = os.Stderr
	if version != "" {
		blokmcp.Version = version
	}
	env := map[string]string{}
	for _, entry := range os.Environ() {
		name, value, _ := strings.Cut(entry, "=")
		env[name] = value
	}
	os.Exit(blokmcp.RunCLI(os.Args[1:], env, os.Stdin, protocol))
}
