package blokmcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	options Options
	version string
	bundle  bundle
	surface surface
	flags   map[string]any
	source  docSource
	handles *handleRegistry[session]
	// shared keeps stored handles in Options.HandleStore; nil without one.
	shared *sharedHandles
	// turns orders stdio calls on each handle (see handleLines).
	turns    *handleLines
	idleMs   float64
	idleJSON json.Number

	stopOnce sync.Once
	stopped  chan struct{}

	// calls counts the tool calls running, so a stop can wait for them.
	callsMu   sync.Mutex
	callsIdle *sync.Cond
	calls     int

	roomMu       sync.Mutex
	roomCommands map[string]bool

	// liveFields are the rich-text fields a live room's converter reads.
	liveFields *convert.RichTextFields
	// localFiles reads upload paths under Uploads.Root.
	localFiles *localReader
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
	return buildServer(options, options, runtime)
}

// buildServer checks checked (the options as the safety rules see them)
// and serves options.
func buildServer(options, checked Options, runtime invoker) (*Server, error) {
	b := bundle{runtime: runtime}
	s := &Server{options: options, bundle: b, stopped: make(chan struct{})}
	s.callsIdle = sync.NewCond(&s.callsMu)
	ctx := context.Background()
	if err := s.checkOptions(ctx, checked); err != nil {
		return nil, err
	}
	if store, ok := options.HandleStore.(opener); ok {
		if err := store.open(); err != nil {
			return nil, err
		}
	}
	s.flags = map[string]any{
		"sync":    options.live(),
		"source":  options.hasSource(),
		"uploads": options.Uploads != nil,
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
	switch {
	case options.DocumentSource != nil:
		s.source = &customSource{host: options.DocumentSource}
	case options.Source == nil:
	case options.Source.Kind == "files":
		s.source = newFilesSource(options.Source.Dir, b)
	default:
		// Any other kind has always been an endpoint.
		s.source = newEndpointSource(options.Source)
	}
	if options.Uploads != nil && options.Uploads.Root != "" {
		reader, err := newLocalReader(options.Uploads.Root)
		if err != nil {
			return nil, err
		}
		s.localFiles = reader
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
	s.turns = newHandleLines()
	s.handles.lines = s.turns
	if options.HandleStore != nil {
		s.shared = &sharedHandles{server: s, store: options.HandleStore, lanes: map[string]*sharedLane{}}
		s.shared.sweepCtx, s.shared.stopSweeps = context.WithCancel(context.Background())
	}
	// The timers are read here, not in the goroutine: tests swap them.
	go s.sweepLoop(storeSweepEvery, storeSweepTimeout)
	return s, nil
}

// checkOptions is Node's checkOptionSafety, run where createBlokMcpServer
// runs it.
func (s *Server) checkOptions(ctx context.Context, checked Options) error {
	if checked.DocumentSource != nil && checked.Source != nil {
		return &ConfigError{Message: "DocumentSource cannot be combined with Source: give one document source"}
	}
	written, err := marshal(checked)
	if err != nil {
		return err
	}
	var options map[string]json.RawMessage
	if err := json.Unmarshal(written, &options); err != nil {
		return err
	}
	if checked.CreatePage != nil && checked.Rooms != nil {
		return &ConfigError{Message: "CreatePage works in stored mode only: it cannot be used with Rooms"}
	}
	if checked.Authorize != nil {
		options["authorize"] = json.RawMessage("true")
	}
	if checked.CreatePage != nil {
		options["createPage"] = json.RawMessage("true")
	}
	// HandleStore is not sent: the bundle checks only that a store has its
	// ops, which the Go interface type already guarantees.
	if checked.Uploads != nil {
		options["uploads"], _ = marshal(checked.Uploads.checkJSON())
	}
	// The field is json:"-", so without this the bundle would see no source
	// and waive the per-document check (--ticket-url with no --authorize).
	if checked.DocumentSource != nil {
		options["source"] = json.RawMessage(`{"kind":"custom"}`)
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
func (s *Server) sweepLoop(storeEvery, sweepTimeout time.Duration) {
	every := time.Duration(min(s.idleMs, 30_000) * float64(time.Millisecond))
	ticker := time.NewTicker(max(every, time.Millisecond))
	defer ticker.Stop()
	// A store's expired records go on their own timer.
	var storeSweeps <-chan time.Time
	if s.shared != nil {
		storeTicker := time.NewTicker(storeEvery)
		defer storeTicker.Stop()
		storeSweeps = storeTicker.C
	}
	for {
		select {
		case <-s.stopped:
			return
		case <-ticker.C:
			s.handles.sweep(func(sess session) { sess.close() })
		case <-storeSweeps:
			s.shared.startSweep(sweepTimeout)
		}
	}
}

// drain is Node's stop work: later opens are refused, every handle closes
// after its running call, and every tool call ends, until the deadline.
// The transport still serves meanwhile, so each answer goes out.
func (s *Server) drain(deadline time.Time) {
	closed := make(chan struct{})
	go func() {
		s.Close()
		close(closed)
	}()
	timer := time.AfterFunc(time.Until(deadline), func() {
		s.callsMu.Lock()
		s.callsIdle.Broadcast()
		s.callsMu.Unlock()
	})
	defer timer.Stop()
	select {
	case <-closed:
	case <-time.After(time.Until(deadline)):
		return
	}
	s.callsMu.Lock()
	defer s.callsMu.Unlock()
	for s.calls > 0 && time.Now().Before(deadline) {
		s.callsIdle.Wait()
	}
}

// track counts a tool call until done runs.
func (s *Server) track() (done func()) {
	s.callsMu.Lock()
	s.calls++
	s.callsMu.Unlock()
	return func() {
		s.callsMu.Lock()
		s.calls--
		if s.calls == 0 {
			s.callsIdle.Broadcast()
		}
		s.callsMu.Unlock()
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
		if s.shared != nil {
			s.shared.wait()
		}
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

// logOutput is stderr: stdout carries the protocol. Tests swap it.
var logOutput io.Writer = os.Stderr

func logf(format string, args ...any) {
	fmt.Fprintf(logOutput, "blok-mcp: "+format+"\n", args...)
}
