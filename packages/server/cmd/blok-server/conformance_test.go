//go:build conformance

package main

import (
	"reflect"
	"testing"

	"github.com/JackUait/blok/packages/server/internal/fetchguard"
)

func TestConformanceOriginAllowsOneExactLoopbackOrigin(t *testing.T) {
	const origin = "http://127.0.0.1:43123"

	got, err := parseConformanceOrigin(origin)
	if err != nil {
		t.Fatalf("parseConformanceOrigin(%q): %v", origin, err)
	}
	if got != "127.0.0.1:43123" {
		t.Fatalf("address = %q, want 127.0.0.1:43123", got)
	}

	cfg, err := parseArgs([]string{"--conformance-origin", origin}, noEnv)
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	page, media := fetchguard.Config{}, fetchguard.Config{}
	applyConformanceOrigin(cfg, &page, &media)

	want := []string{"127.0.0.1:43123"}
	if !reflect.DeepEqual(page.TestOnlyAllowedAddrs, want) {
		t.Fatalf("page allowed addresses = %q, want %q", page.TestOnlyAllowedAddrs, want)
	}
	if !reflect.DeepEqual(media.TestOnlyAllowedAddrs, want) {
		t.Fatalf("media allowed addresses = %q, want %q", media.TestOnlyAllowedAddrs, want)
	}
}

func TestConformanceOriginRejectsEveryBroaderOrMalformedInput(t *testing.T) {
	for _, origin := range []string{
		"",
		"https://127.0.0.1:43123",
		"http://localhost:43123",
		"http://127.0.0.2:43123",
		"http://0.0.0.0:43123",
		"http://[::1]:43123",
		"http://127.0.0.1",
		"http://127.0.0.1:0",
		"http://127.0.0.1:65536",
		"http://user@127.0.0.1:43123",
		"http://127.0.0.1:43123/",
		"http://127.0.0.1:43123?query",
		"http://127.0.0.1:43123#fragment",
		"http://127.0.0.1:43123,http://127.0.0.1:43124",
	} {
		t.Run(origin, func(t *testing.T) {
			if _, err := parseConformanceOrigin(origin); err == nil {
				t.Fatalf("parseConformanceOrigin(%q) succeeded, want a refusal", origin)
			}
		})
	}
}
