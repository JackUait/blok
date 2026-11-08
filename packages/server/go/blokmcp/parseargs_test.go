package blokmcp

import (
	"errors"
	"testing"
)

func TestParseArgsReadsTheBlokMcpFlagsWithTheirHooks(t *testing.T) {
	options, err := ParseArgs([]string{"--source", "files:/docs", "--authorize", "http://127.0.0.1:9/authorize", "--http", "127.0.0.1:0"}, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if options.Source == nil || options.Source.Dir != "/docs" || options.Authorize == nil || options.Transport.Kind != "http" {
		t.Fatalf("options: %+v", options)
	}
}

func TestParseArgsRefusesABadFlagAsAConfigError(t *testing.T) {
	_, err := ParseArgs([]string{"--nope"}, map[string]string{})
	var refused *ConfigError
	if !errors.As(err, &refused) || refused.Message == "" {
		t.Fatalf("got %v", err)
	}
}
