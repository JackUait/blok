//go:build conformance

package main

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/blokserver"
)

func TestConformanceFlagsOpenFileBytesAndFilesCORS(t *testing.T) {
	rest, parsed, failure := parseConformanceArguments([]string{
		"--conformance-file-bytes", "--conformance-file-bytes-max-bytes=2048", "--conformance-files-cors", "--listen", "x",
	})
	if failure != "" || len(rest) != 2 {
		t.Fatalf("rest %q, failure %q", rest, failure)
	}
	var options blokserver.Options
	applyConformanceOptions(&options, parsed)
	if !options.FileBytesEnabled || !options.FilesCORS || options.FileBytesMaxBytes == nil || *options.FileBytesMaxBytes != 2048 {
		t.Fatalf("options %+v", options)
	}
}

func TestConformanceFileBytesCapMustBeANumber(t *testing.T) {
	_, _, failure := parseConformanceArguments([]string{"--conformance-file-bytes-max-bytes=lots"})
	if failure != `--conformance-file-bytes-max-bytes must be a whole number of bytes (got "lots")` {
		t.Fatalf("failure %q", failure)
	}
}

// The conformance flags only ever turn these on: a host flag stays.
func TestConformanceFlagsKeepTheHostFileBytesFlags(t *testing.T) {
	_, parsed, failure := parseConformanceArguments(nil)
	if failure != "" {
		t.Fatal(failure)
	}
	options := blokserver.Options{FileBytesEnabled: true, FilesCORS: true}
	applyConformanceOptions(&options, parsed)
	if !options.FileBytesEnabled || !options.FilesCORS {
		t.Fatalf("options %+v", options)
	}
}
