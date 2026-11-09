package blokmcp

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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

// --handle-store files: makes its directory at start, after the option
// checks: never while parsing, and never for a start that is refused.
func TestTheFilesHandleStoreDirectoryIsMadeAfterTheOptionChecks(t *testing.T) {
	docs := t.TempDir()
	dir := filepath.Join(t.TempDir(), "handles")
	refused, err := ParseArgs([]string{"--source", "files:" + docs, "--handle-store", "files:" + dir, "--http", "0.0.0.0:0"}, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("parsing made the directory: %v", err)
	}
	var config *ConfigError
	if _, err := New(refused); !errors.As(err, &config) {
		t.Fatalf("New: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("a refused start made the directory: %v", err)
	}
	options, err := ParseArgs([]string{"--source", "files:" + docs, "--handle-store", "files:" + dir}, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(options)
	if err != nil {
		t.Fatal(err)
	}
	server.Close()
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Fatalf("start did not make the directory: %v", err)
	}
}

// A directory the store refuses stops the start as a *ConfigError.
func TestARefusedFilesHandleStoreStopsTheStart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	options, err := ParseArgs([]string{"--source", "files:" + t.TempDir(), "--handle-store", "files:" + file}, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	var config *ConfigError
	if _, err := New(options); !errors.As(err, &config) || !strings.Contains(config.Message, "--handle-store directory "+file+" must be a directory") {
		t.Fatalf("New: %v", err)
	}
}
