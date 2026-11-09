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
	"time"
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
	Manifest    *string `json:"manifest"`
	Overrides   *string `json:"overrides"`
	Authorize   *string `json:"authorize"`
	CreatePage  *string `json:"createPage"`
	HandleStore *string `json:"handleStore"`
}

// ParseArgs reads args and env as the blok-mcp command does, with the
// --authorize and --create-page hooks and the manifest files loaded: the Options an embedding
// host passes to Embed. A refused flag is a *ConfigError. A --handle-store
// files: directory is made and checked when New or Embed starts, which
// answers a refused one as a *ConfigError; a host that wraps that store
// skips the start check, and a refused directory then fails each call.
func ParseArgs(args []string, env map[string]string) (Options, error) {
	pool, err := newPool(1)
	if err != nil {
		return Options{}, err
	}
	options, err := parseArgs(bundle{runtime: pool}, args, env)
	var config *configError
	if errors.As(err, &config) {
		return Options{}, &ConfigError{Message: config.message}
	}
	return options, err
}

func parseArgs(engine bundle, args []string, env map[string]string) (Options, error) {
	var parsed struct {
		OK *struct {
			Options json.RawMessage `json:"options"`
			Files   parsedFiles     `json:"files"`
		} `json:"ok"`
		Error *string `json:"error"`
	}
	if _, err := engine.call(context.Background(), "mcpParseArgs", map[string]any{"argv": args, "env": env}, &parsed); err != nil {
		return Options{}, err
	}
	if parsed.Error != nil {
		return Options{}, &configError{*parsed.Error}
	}
	var options Options
	if err := json.Unmarshal(parsed.OK.Options, &options); err != nil {
		return Options{}, err
	}
	files := parsed.OK.Files
	var err error
	if files.Authorize != nil {
		hook, err := loadAuthorize(*files.Authorize)
		if err != nil {
			return Options{}, err
		}
		options.Authorize = hook
	}
	if files.CreatePage != nil {
		// The bundle already refused anything but an http(s) URL.
		options.CreatePage = CreatePageWebhook(*files.CreatePage)
	}
	if files.HandleStore != nil {
		// Made at start, after the option checks: a refused start leaves
		// no directory behind.
		options.HandleStore = &filesStoreAt{dir: *files.HandleStore}
	}
	if files.Manifest != nil {
		if options.Manifest, err = configFile(engine, "manifest", *files.Manifest); err != nil {
			return Options{}, err
		}
	}
	if files.Overrides != nil {
		if options.Overrides, err = configFile(engine, "overrides", *files.Overrides); err != nil {
			return Options{}, err
		}
	}
	return options, nil
}

func serveCLI(args []string, env map[string]string, stdin io.ReadCloser, stdout io.WriteCloser) error {
	pool, err := newPool(1)
	if err != nil {
		return err
	}
	options, err := parseArgs(bundle{runtime: pool}, args, env)
	if err != nil {
		return err
	}
	server, err := newServer(options, pool)
	if err != nil {
		return err
	}
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	stopping := make(chan time.Time, 1)
	go func() {
		select {
		case <-signals:
			// The first signal stops once. Node then drops its listeners, so a
			// second one kills the process at once.
			signal.Reset(syscall.SIGINT, syscall.SIGTERM)
			stopping <- time.Now()
			stop()
		case <-ctx.Done():
		}
	}()
	if options.Transport.Kind == "http" {
		err = server.ListenAndServe(ctx, func(url string) {
			fmt.Fprintf(os.Stderr, "blok-mcp: listening on %s/mcp\n", url)
		})
	} else {
		err = server.ServeStdio(ctx, stdin, stdout)
	}
	since := time.Now()
	select {
	case since = <-stopping:
	default:
	}
	server.closeWithin(stopDrain - time.Since(since))
	return err
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
	// Node's readFile words a folder this way; Go's read differs per OS.
	if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
		return nil, errors.New("EISDIR: illegal operation on a directory, read")
	}
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
