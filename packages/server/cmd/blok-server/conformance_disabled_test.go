//go:build !conformance

package main

import "testing"

func TestOrdinaryBuildDoesNotExposeTheConformanceOriginFlag(t *testing.T) {
	if _, err := parseArgs([]string{"--conformance-origin", "http://127.0.0.1:43123"}, noEnv); err == nil {
		t.Fatal("ordinary build accepted --conformance-origin")
	}
}
