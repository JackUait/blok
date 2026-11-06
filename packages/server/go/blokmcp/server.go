package blokmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// Version, when set, is the server version clients see. Empty means the
// bundle's: the release rebuilds it from the version it bumps everywhere.
var Version = ""

// surface is mcpSurface's answer: what a client sees before any open.
type surface struct {
	Tools            json.RawMessage `json:"tools"`
	Instructions     string          `json:"instructions"`
	Prompts          json.RawMessage `json:"prompts"`
	ContractRevision struct {
		Stored string `json:"stored"`
		Live   string `json:"live"`
	} `json:"contractRevision"`
	LiveUnavailableCommands json.RawMessage `json:"liveUnavailableCommands"`
}

// Server is one MCP server: its handles, its document source and the
// bundle every MCP rule runs in. Serve it over stdio with ServeStdio or
// over HTTP with Handler.
type Server struct {
	options  Options
	version  string
	bundle   bundle
	surface  surface
	flags    map[string]any
	source   docSource
	handles  *handleRegistry[session]
	idleMs   float64
	idleJSON json.Number

	stopOnce sync.Once
	stopped  chan struct{}

	roomMu       sync.Mutex
	roomCommands map[string]bool

	// liveFields are the rich-text fields a live room's converter reads.
	liveFields *convert.RichTextFields
}

// New builds a Server. The bundle loads into its own engine pool.
func New(options Options) (*Server, error) {
	pool, err := newPool(1)
	if err != nil {
		return nil, err
	}
	return newServer(options, pool)
}

func newServer(options Options, runtime invoker) (*Server, error) {
	b := bundle{runtime: runtime}
	s := &Server{options: options, bundle: b, stopped: make(chan struct{})}
	ctx := context.Background()
	if err := s.checkOptions(ctx); err != nil {
		return nil, err
	}
	s.flags = map[string]any{
		"sync":    options.live(),
		"source":  options.Source != nil,
		"uploads": false,
	}
	if options.PageTitles != "" {
		s.flags["pageTitles"] = options.PageTitles
	}
	if options.Comments != nil && !*options.Comments {
		s.flags["comments"] = false
	}
	if len(options.Manifest) > 0 {
		s.flags["manifest"] = options.Manifest
	}
	if len(options.Overrides) > 0 {
		s.flags["overrides"] = options.Overrides
	}
	if options.RichTextFields != nil {
		s.flags["richTextFields"] = options.RichTextFields
	}
	if options.Schema != "" {
		s.flags["schema"] = options.Schema
	}
	s.idleJSON = json.Number(fmt.Sprint(defaultHandleIdleMs))
	if options.HandleIdleMs != "" {
		s.flags["handleIdleMs"] = options.HandleIdleMs
		s.idleJSON = options.HandleIdleMs
	}
	if _, err := b.call(ctx, "mcpSurface", s.flags, &s.surface); err != nil {
		return nil, err
	}
	s.version = Version
	if s.version == "" {
		// The version op answers a bare string.
		version, err := runtime.Invoke(ctx, "version", "{}", nil)
		if err != nil {
			return nil, err
		}
		s.version = version
	}
	if options.Source != nil {
		if options.Source.Kind == "files" {
			s.source = newFilesSource(options.Source.Dir, b)
		} else {
			s.source = newEndpointSource(options.Source)
		}
	}
	if options.live() {
		fields, err := s.richTextFieldsOf(ctx)
		if err != nil {
			return nil, err
		}
		s.liveFields = fields
	}
	s.idleMs = numberOr(options.HandleIdleMs, defaultHandleIdleMs)
	s.handles = newHandleRegistry[session](s.idleMs, int(numberOr(options.MaxHandlesPerPrincipal, defaultMaxHandlesPerPrincipal)))
	go s.sweepLoop()
	return s, nil
}

// checkOptions is Node's checkOptionSafety, run where createBlokMcpServer
// runs it.
func (s *Server) checkOptions(ctx context.Context) error {
	written, err := marshal(s.options)
	if err != nil {
		return err
	}
	var options map[string]json.RawMessage
	if err := json.Unmarshal(written, &options); err != nil {
		return err
	}
	if s.options.Authorize != nil {
		options["authorize"] = json.RawMessage("true")
	}
	var answer struct {
		Error *string `json:"error"`
	}
	if _, err := s.bundle.call(ctx, "mcpCheckOptions", map[string]any{"options": options}, &answer); err != nil {
		return err
	}
	if answer.Error != nil {
		return &ConfigError{Message: *answer.Error}
	}
	return nil
}

// ConfigError is a refused option; the CLI prints it and exits 2.
type ConfigError struct{ Message string }

func (e *ConfigError) Error() string { return e.Message }

// sweepLoop expires idle handles every min(idle, 30 s), as Node does.
func (s *Server) sweepLoop() {
	every := time.Duration(min(s.idleMs, 30_000) * float64(time.Millisecond))
	ticker := time.NewTicker(max(every, time.Millisecond))
	defer ticker.Stop()
	for {
		select {
		case <-s.stopped:
			return
		case <-ticker.C:
			s.handles.sweep(func(sess session) { sess.close() })
		}
	}
}

// closeWithin is Close, given up after wait: the stop's whole drain is
// bounded, as Node's is.
func (s *Server) closeWithin(wait time.Duration) {
	closed := make(chan struct{})
	go func() {
		s.Close()
		close(closed)
	}()
	timer := time.NewTimer(max(wait, 0))
	defer timer.Stop()
	select {
	case <-closed:
	case <-timer.C:
	}
}

// Close closes every handle after its running call.
func (s *Server) Close() {
	s.stopOnce.Do(func() {
		close(s.stopped)
		s.handles.closeAll(func(sess session) { sess.close() })
	})
}

// mcpFlags is the session input's mcp object: the surface flags plus the
// handle's mode and write.
func (s *Server) mcpFlags(mode string, write bool) map[string]any {
	flags := maps.Clone(s.flags)
	flags["mode"] = mode
	flags["write"] = write
	return flags
}

// answerOf runs an operation that answers {answer}.
func (s *Server) answerOf(ctx context.Context, op string, input any) (json.RawMessage, error) {
	var out struct {
		Answer json.RawMessage `json:"answer"`
	}
	if _, err := s.bundle.call(ctx, op, input, &out); err != nil {
		return nil, err
	}
	if len(out.Answer) == 0 {
		return nil, fmt.Errorf("blok-mcp: %s answered no answer", op)
	}
	return out.Answer, nil
}

func (s *Server) executeAnswer(ctx context.Context, input map[string]any) (json.RawMessage, error) {
	return s.answerOf(ctx, "mcpExecuteAnswer", input)
}

func (s *Server) errorAnswer(ctx context.Context, tool string, failure *surfaceErr) (json.RawMessage, error) {
	return s.answerOf(ctx, "mcpErrorAnswer", map[string]any{"tool": tool, "helper": failure.Helper, "error": failure.errorJSON()})
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "blok-mcp: "+format+"\n", args...)
}
