package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

// webhook is Node's test for an http(s) authorize hook; anything else is a
// module path. Case-sensitive on purpose: HTTP:// is a path in Node too.
var webhook = regexp.MustCompile(`^https?://`)

type configError struct{ message string }

func (e *configError) Error() string { return e.message }

// RunCLI is the blok-mcp command: it parses args and env as Node's
// blok-mcp does, then serves stdio on stdin and stdout, or HTTP. It returns
// the exit code: 2 for a refused option.
func RunCLI(args []string, env map[string]string, stdin io.ReadCloser, stdout io.WriteCloser) int {
	err := serveCLI(args, env, stdin, stdout)
	if err == nil {
		return 0
	}
	var config *configError
	var refused *ConfigError
	switch {
	case errors.As(err, &config):
		fmt.Fprintf(os.Stderr, "blok-mcp: %s\n", config.message)
		return 2
	case errors.As(err, &refused):
		fmt.Fprintf(os.Stderr, "blok-mcp: %s\n", refused.Message)
		return 2
	}
	fmt.Fprintf(os.Stderr, "blok-mcp: %v\n", err)
	return 1
}

type parsedFiles struct {
	Manifest  *string `json:"manifest"`
	Overrides *string `json:"overrides"`
	Authorize *string `json:"authorize"`
}

func serveCLI(args []string, env map[string]string, stdin io.ReadCloser, stdout io.WriteCloser) error {
	pool, err := newPool(1)
	if err != nil {
		return err
	}
	engine := bundle{runtime: pool}
	var parsed struct {
		OK *struct {
			Options json.RawMessage `json:"options"`
			Files   parsedFiles     `json:"files"`
		} `json:"ok"`
		Error *string `json:"error"`
	}
	if _, err := engine.call(context.Background(), "mcpParseArgs", map[string]any{"argv": args, "env": env}, &parsed); err != nil {
		return err
	}
	if parsed.Error != nil {
		return &configError{*parsed.Error}
	}
	var options Options
	if err := json.Unmarshal(parsed.OK.Options, &options); err != nil {
		return err
	}
	files := parsed.OK.Files
	if files.Authorize != nil {
		hook, err := loadAuthorize(*files.Authorize)
		if err != nil {
			return err
		}
		options.Authorize = hook
	}
	if files.Manifest != nil {
		if options.Manifest, err = configFile(engine, "manifest", *files.Manifest); err != nil {
			return err
		}
	}
	if files.Overrides != nil {
		if options.Overrides, err = configFile(engine, "overrides", *files.Overrides); err != nil {
			return err
		}
	}
	server, err := newServer(options, pool)
	if err != nil {
		return err
	}
	defer server.Close()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if options.Transport.Kind == "http" {
		return server.ListenAndServe(ctx, func(url string) {
			fmt.Fprintf(os.Stderr, "blok-mcp: listening on %s/mcp\n", url)
		})
	}
	return server.ServeStdio(ctx, stdin, stdout)
}

func loadAuthorize(spec string) (AuthorizeFunc, error) {
	if webhook.MatchString(spec) {
		return Webhook(spec), nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	path := spec
	if !filepath.IsAbs(path) {
		path = filepath.Join(cwd, spec)
	}
	path = filepath.Clean(path)
	if _, err := os.Stat(path); err != nil {
		return nil, &configError{fmt.Sprintf("--authorize %s: no module at %s", spec, path)}
	}
	return nil, &configError{fmt.Sprintf("--authorize %s: this build cannot load a JavaScript module; give an http(s) webhook URL", spec)}
}

// configFile reads and validates a --manifest or --manifest-overrides file.
func configFile(engine bundle, kind, path string) (json.RawMessage, error) {
	bytes, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, &configError{fmt.Sprintf("Cannot read \"%s\": no such file", path)}
	}
	if err != nil {
		return nil, err
	}
	text := []byte(strings.ToValidUTF8(string(bytes), "�"))
	var value json.RawMessage
	if err := json.Unmarshal(text, &value); err != nil {
		return nil, &configError{fmt.Sprintf("Invalid JSON in \"%s\": %v", path, err)}
	}
	var checked struct {
		Value json.RawMessage `json:"value"`
		Error *string         `json:"error"`
	}
	if _, err := engine.call(context.Background(), "mcpConfigFile", map[string]any{"kind": kind, "value": value}, &checked); err != nil {
		return nil, err
	}
	if checked.Error != nil {
		return nil, &configError{*checked.Error}
	}
	return checked.Value, nil
}
