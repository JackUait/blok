// Package blokdocs converts saved Blok documents with Blok's own JavaScript,
// as the C# Blok.Server.Documents package does: Markdown, HTML and plain text
// out, Markdown and HTML in, translation texts, page indexes and id remaps.
//
// A Converter runs the embedded runtime bundle on a pool of goja engines.
// Requests are built and answers re-serialized the way System.Text.Json does,
// so a Go host stores the same bytes a C# host stores. Two shared fixtures
// under test/unit/server-conformance/fixtures/documents pin that.
package blokdocs

import (
	"context"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// Floors a host may not go below, as C# BlokDocuments publishes them.
const (
	MinimumMemoryBudget = jsruntime.MinimumMemoryBudget
	MinimumTimeout      = jsruntime.MinimumTimeout
)

// Options configure New. Zero values take the defaults.
type Options struct {
	// PoolSize bounds concurrent conversions. 0 means max(1, min(NumCPU, 4)).
	PoolSize int
	// Timeout is the wall-clock budget of one conversion. 0 means 10 s.
	//
	// It is not a hard bound: goja checks it between JavaScript
	// instructions, so a long native builtin (a backtracking regex) overruns
	// it by seconds.
	Timeout time.Duration
	// MemoryBudget is the live heap growth one conversion may cause. 0 means
	// 1 GiB.
	//
	// Approximate, unlike C#'s per-engine allocation count: it is the whole
	// process's live heap as of the last GC, read every millisecond, so
	// concurrent conversions add up.
	MemoryBudget int64
}

// StartupError is an engine that could not load the bundle at New.
type StartupError = jsruntime.StartupError

// ConstraintError is a limit below its floor.
type ConstraintError = jsruntime.ConstraintError

// The causes of a StartupError.
const (
	StartupFailed     = jsruntime.StartupFailed
	StartupTimedOut   = jsruntime.StartupTimedOut
	StartupOverBudget = jsruntime.StartupOverBudget
)

// invoker is the runtime seam; tests put a fake behind it.
type invoker interface {
	Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error)
}

// New builds a converter over a fresh engine pool. Building one is
// expensive, so hold it for the life of the process.
func New(options Options) (*Converter, error) {
	pool, err := jsruntime.NewPool(jsruntime.Options{
		PoolSize:     options.PoolSize,
		Timeout:      options.Timeout,
		MemoryBudget: options.MemoryBudget,
	})
	if err != nil {
		return nil, err
	}
	return newConverter(pool), nil
}

func newConverter(runtime invoker) *Converter {
	return &Converter{runtime: runtime}
}
