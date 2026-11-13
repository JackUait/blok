//go:build conformance

package main

import (
	"strconv"
	"strings"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
	"github.com/JackUait/blok/packages/server/go/v2/blokserver/collabstore"
)

const conformanceOriginPrefix = "http://127.0.0.1:"

const conformanceRequirement = "must be exactly http://127.0.0.1:PORT with a port from 1 to 65535 and no userinfo, path, query, or fragment"

type conformanceArguments struct {
	origin  string
	port    int
	journal bool
	// restoreGuards is CollabEnforceRestoreGuards.
	restoreGuards bool
	// restoreTrashesPages is CollabRestoreTrashesPages.
	restoreTrashesPages bool
	// recordNotes keeps record notes in memory.
	recordNotes bool
	// stampAuthority is CollabStampAuthority.
	stampAuthority bool
	// keepAlive is CollabKeepAliveInterval, when set.
	keepAlive *time.Duration
	// fileBytes is FileBytesEnabled, and fileBytesMax FileBytesMaxBytes.
	fileBytes    bool
	fileBytesMax *int64
	// filesCORS is FilesCORS.
	filesCORS bool
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
		if argument == "--conformance-restore-guards" {
			parsed.restoreGuards = true
			continue
		}
		if argument == "--conformance-restore-trashes-pages" {
			parsed.restoreTrashesPages = true
			continue
		}
		if argument == "--conformance-record-notes" {
			parsed.recordNotes = true
			continue
		}
		if argument == "--conformance-stamp-authority" {
			parsed.stampAuthority = true
			continue
		}
		if argument == "--conformance-file-bytes" {
			parsed.fileBytes = true
			continue
		}
		if argument == "--conformance-files-cors" {
			parsed.filesCORS = true
			continue
		}
		if text, ok := strings.CutPrefix(argument, "--conformance-file-bytes-max-bytes="); ok {
			bytes, err := strconv.ParseInt(text, 10, 64)
			if err != nil || !isDigits(text) {
				return nil, parsed, "--conformance-file-bytes-max-bytes must be a whole number of bytes (got " + csQuote(text) + ")"
			}
			parsed.fileBytesMax = &bytes
			continue
		}
		if text, ok := strings.CutPrefix(argument, "--conformance-keep-alive-ms="); ok {
			milliseconds, err := strconv.Atoi(text)
			if err != nil || !isDigits(text) {
				return nil, parsed, "--conformance-keep-alive-ms must be a whole number of milliseconds (got " + csQuote(text) + ")"
			}
			parsed.keepAlive = new(time.Duration(milliseconds) * time.Millisecond)
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

// applyConformanceOptions sets what the flags change before New.
func applyConformanceOptions(options *blokserver.Options, parsed conformanceArguments) {
	if parsed.keepAlive != nil {
		options.CollabKeepAliveInterval = parsed.keepAlive
	}
	options.CollabEnforceRestoreGuards = parsed.restoreGuards
	options.CollabRestoreTrashesPages = parsed.restoreTrashesPages
	options.CollabStampAuthority = parsed.stampAuthority
	// Only ever on: the host flags may have opened them already.
	options.FileBytesEnabled = options.FileBytesEnabled || parsed.fileBytes
	options.FilesCORS = options.FilesCORS || parsed.filesCORS
	if parsed.fileBytesMax != nil {
		options.FileBytesMaxBytes = parsed.fileBytesMax
	}
	if parsed.recordNotes {
		options.CollabRecordNotes = collabstore.NewMemoryRecordNotes()
	}
}

// applyConformance wires the parsed flags into the server.
func applyConformance(server *blokserver.Server, parsed conformanceArguments) {
	if parsed.origin != "" {
		server.UseConformanceOrigin(parsed.origin, parsed.port)
	}
	if parsed.journal {
		server.UseConformanceJournal()
	}
}
