//go:build conformance

package main

import (
	"strconv"
	"strings"

	"github.com/JackUait/blok/packages/server/go/blokserver"
)

const conformanceOriginPrefix = "http://127.0.0.1:"

const conformanceRequirement = "must be exactly http://127.0.0.1:PORT with a port from 1 to 65535 and no userinfo, path, query, or fragment"

type conformanceArguments struct {
	origin  string
	port    int
	journal bool
}

// parseConformanceArguments is ConformanceArguments.Parse: it takes its two
// flags out of args, at any place before "--", before the host parses the rest.
func parseConformanceArguments(args []string) ([]string, conformanceArguments, string) {
	var parsed conformanceArguments
	filtered := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		argument := args[i]
		if argument == "--" {
			filtered = append(filtered, args[i:]...)
			break
		}
		if argument == "--conformance-journal" || argument == "-conformance-journal" {
			parsed.journal = true
			continue
		}
		var value string
		switch {
		case argument == "--conformance-origin" || argument == "-conformance-origin":
			if i+1 >= len(args) {
				return nil, parsed, "flag needs an argument: -conformance-origin"
			}
			i++
			value = args[i]
		case strings.HasPrefix(argument, "--conformance-origin="):
			value = argument[len("--conformance-origin="):]
		case strings.HasPrefix(argument, "-conformance-origin="):
			value = argument[len("-conformance-origin="):]
		default:
			filtered = append(filtered, argument)
			continue
		}
		portText := ""
		if strings.HasPrefix(value, conformanceOriginPrefix) {
			portText = value[len(conformanceOriginPrefix):]
		}
		port, err := strconv.Atoi(portText)
		if err != nil || !isDigits(portText) || port < 1 || port > 65535 || value != conformanceOriginPrefix+strconv.Itoa(port) {
			return nil, parsed, conformanceRequirement + " (got " + csQuote(value) + ")"
		}
		parsed.origin, parsed.port = value, port
	}
	return filtered, parsed, ""
}

func isDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s != ""
}

// applyConformance wires the parsed flags into the server.
func applyConformance(server *blokserver.Server, parsed conformanceArguments) {
	if parsed.origin != "" {
		server.UseConformanceOrigin(parsed.origin, parsed.port)
	}
}
