package jsruntime

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"time"

	"github.com/dop251/goja"
)

// Limits, as C# JintBlokRuntime sets them.
const (
	DefaultTimeout = 10 * time.Second
	// MinimumTimeout catches a host that passed milliseconds meaning seconds.
	MinimumTimeout = 100 * time.Millisecond
	// DefaultMemoryBudget bounds live heap growth during a call (guard.go).
	// Twice C#'s 512 MiB allocation budget, which counts something else: a
	// 3 MiB data URL to Markdown, which C# converts under 512 MiB, grew
	// goja's live heap by up to 562 MiB (measured).
	DefaultMemoryBudget int64 = 1 << 30
	// MinimumMemoryBudget is C#'s floor. Loading the bundle from a compiled
	// program allocated 6 MiB (measured), so 8 MiB still loads.
	MinimumMemoryBudget int64 = 8 << 20
	// MaxCallStackSize stops runaway recursion before it eats the heap.
	// Measured frames per nesting level of an outline: about 3 for plain text
	// and Markdown, 8 for HTML, so 10000 converts about 1200 levels to HTML.
	// Jint's native-stack guard stopped HTML between 800 and 1000 levels.
	MaxCallStackSize = 10000
)

// Kind says why a call failed. The values match C# BlokConversionFailure.
type Kind int

// The kinds of Failure.
const (
	KindUnknown Kind = iota
	KindInvalidDocument
	KindTimedOut
	KindDocumentTooLarge
)

// Failure is a call the bundle could not finish. A caller's own cancellation
// is never a Failure: Invoke returns ctx.Err() for it.
type Failure struct {
	Kind Kind
	Err  error
}

func (f *Failure) Error() string {
	if f.Err == nil {
		return fmt.Sprintf("jsruntime: failure %d", f.Kind)
	}
	return fmt.Sprintf("jsruntime: failure %d: %v", f.Kind, f.Err)
}

func (f *Failure) Unwrap() error { return f.Err }

// StartupCause says which limit a bundle load ran past.
type StartupCause int

// The causes of a StartupError.
const (
	StartupFailed StartupCause = iota
	StartupTimedOut
	StartupOverBudget
)

// StartupError is a pool whose engines could not load the bundle.
type StartupError struct {
	Cause   StartupCause
	Message string
	Err     error
}

func (e *StartupError) Error() string { return e.Message }

func (e *StartupError) Unwrap() error { return e.Err }

// ConstraintError is a limit below its floor, named by its Options field.
type ConstraintError struct {
	Param string
	Value string
	Floor string
}

func (e *ConstraintError) Error() string {
	return fmt.Sprintf("jsruntime: %s is %s, below the floor of %s", e.Param, e.Value, e.Floor)
}

// Options configure a Pool. Zero values take the defaults.
type Options struct {
	// PoolSize bounds concurrent calls; callers wait for a free engine.
	// 0 means max(1, min(NumCPU, 4)), as C#.
	PoolSize int
	// Timeout is the default wall-clock budget of one call and of each load.
	Timeout time.Duration
	// MemoryBudget is the heap growth one call may cause. Approximate: see guard.go.
	MemoryBudget int64
}

// ValidateConstraints refuses a timeout or budget below its floor. Zero means
// the default and passes.
func ValidateConstraints(timeout time.Duration, budget int64) error {
	if budget != 0 && budget < MinimumMemoryBudget {
		return &ConstraintError{Param: "MemoryBudget", Value: fmt.Sprint(budget), Floor: fmt.Sprint(MinimumMemoryBudget)}
	}
	if timeout != 0 && timeout < MinimumTimeout {
		return &ConstraintError{Param: "Timeout", Value: timeout.String(), Floor: MinimumTimeout.String()}
	}
	return nil
}

// Pool is a fixed set of engines with the bundle loaded.
type Pool struct {
	engines chan *Runtime
	timeout time.Duration
	budget  int64
	load    func() (*Runtime, error)
}

// NewPool builds every engine up front from the embedded bundle.
func NewPool(options Options) (*Pool, error) {
	if err := ValidateConstraints(options.Timeout, options.MemoryBudget); err != nil {
		return nil, err
	}
	if options.PoolSize < 0 {
		return nil, &ConstraintError{Param: "PoolSize", Value: fmt.Sprint(options.PoolSize), Floor: "1"}
	}
	size := options.PoolSize
	if size == 0 {
		size = max(1, min(runtime.NumCPU(), 4))
	}
	program, err := compiled()
	if err != nil {
		return nil, &StartupError{Message: "Could not load Blok's runtime bundle into an engine.", Err: err}
	}
	return newPool(program, size, options.Timeout, options.MemoryBudget)
}

func newPoolFromSource(source string, size int, timeout time.Duration, budget int64) (*Pool, error) {
	program, err := compile("pool.js", source)
	if err != nil {
		return nil, &StartupError{Message: "Could not load Blok's runtime bundle into an engine.", Err: err}
	}
	return newPool(program, size, timeout, budget)
}

func newPool(program *goja.Program, size int, timeout time.Duration, budget int64) (*Pool, error) {
	if size < 1 {
		return nil, &ConstraintError{Param: "PoolSize", Value: fmt.Sprint(size), Floor: "1"}
	}
	if budget < 0 {
		return nil, &ConstraintError{Param: "MemoryBudget", Value: fmt.Sprint(budget), Floor: "1"}
	}
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	if budget == 0 {
		budget = DefaultMemoryBudget
	}
	p := &Pool{engines: make(chan *Runtime, size), timeout: timeout, budget: budget}
	p.load = func() (*Runtime, error) { return loadGuarded(program, p.timeout, p.budget) }
	for range size {
		engine, err := p.load()
		if err != nil {
			return nil, err
		}
		p.engines <- engine
	}
	return p, nil
}

func loadGuarded(program *goja.Program, timeout time.Duration, budget int64) (*Runtime, error) {
	vm := newVM()
	g := arm(vm, timeout, budget, nil)
	engine, err := fromVM(vm, program)
	g.disarm()
	if err == nil {
		return engine, nil
	}
	var interrupted *goja.InterruptedError
	if errors.As(err, &interrupted) {
		switch interrupted.Value() {
		case interruptBudget:
			return nil, &StartupError{
				Cause: StartupOverBudget,
				Message: fmt.Sprintf("Loading Blok's runtime bundle into an engine grew the heap past the %d-byte "+
					"memory budget this runtime was created with. Loading runs under the same budget as a "+
					"conversion, so raise MemoryBudget: the default is %d bytes (1 GiB), and %d bytes is "+
					"the floor this package accepts at all.", budget, DefaultMemoryBudget, MinimumMemoryBudget),
				Err: err,
			}
		case interruptTimeout:
			return nil, &StartupError{
				Cause: StartupTimedOut,
				Message: fmt.Sprintf("Loading Blok's runtime bundle into an engine ran past the %s timeout this "+
					"runtime was created with. Loading runs under the same timeout as a conversion, so raise "+
					"Timeout: the default is %s, and %s is the floor this package accepts at all.",
					timeout, DefaultTimeout, MinimumTimeout),
				Err: err,
			}
		}
	}
	return nil, &StartupError{Message: "Could not load Blok's runtime bundle into an engine.", Err: err}
}

// Invoke runs one operation on a free engine, waiting for one if all are
// busy. timeout 0 uses the pool's; any other value must be at least
// MinimumTimeout. Errors are a *Failure, a *ConstraintError, or ctx.Err().
func (p *Pool) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	if timeout < 0 || (timeout > 0 && timeout < MinimumTimeout) {
		return "", &ConstraintError{Param: "timeout", Value: timeout.String(), Floor: MinimumTimeout.String()}
	}
	if timeout == 0 {
		timeout = p.timeout
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	var engine *Runtime
	select {
	case engine = <-p.engines:
	case <-ctx.Done():
		return "", ctx.Err()
	}

	result, reusable, err := engine.guardedInvoke(ctx, op, input, timeout, p.budget)
	if !reusable {
		// A slot that is not refilled is lost for good, so a failed rebuild
		// puts the spent engine back.
		if fresh, loadErr := p.load(); loadErr == nil {
			engine = fresh
		}
	}
	// Never blocks: the channel holds exactly the engines taken from it.
	p.engines <- engine
	return result, err
}

// guardedInvoke runs one call under the deadline, the memory watchdog and ctx.
// reusable is false when the engine stopped mid-execution.
func (r *Runtime) guardedInvoke(ctx context.Context, op, input string, timeout time.Duration, budget int64) (result string, reusable bool, err error) {
	g := arm(r.vm, timeout, budget, ctx.Done())
	result, err = r.safeInvoke(op, input)
	g.disarm()
	if err == nil {
		return result, true, nil
	}

	var interrupted *goja.InterruptedError
	var overflow *goja.StackOverflowError
	var jsErr *JSError
	var panicked *panicError
	switch {
	case errors.As(err, &interrupted):
		switch interrupted.Value() {
		case interruptTimeout:
			return "", false, &Failure{Kind: KindTimedOut, Err: err}
		case interruptBudget:
			return "", false, &Failure{Kind: KindDocumentTooLarge, Err: err}
		case interruptCancel:
			return "", false, ctx.Err()
		}
		return "", false, &Failure{Kind: KindUnknown, Err: err}
	// C#'s stack guard throws a JS RangeError and keeps the engine; goja's
	// overflow unwinds cleanly too (measured: the next call runs).
	case errors.As(err, &overflow):
		return "", true, &Failure{Kind: KindUnknown, Err: err}
	case errors.As(err, &jsErr):
		return "", true, &Failure{Kind: classify(jsErr.Name), Err: err}
	// No event loop: a promise pending now can never settle. The engine itself
	// finished, so it is kept.
	case errors.Is(err, ErrPending):
		return "", true, &Failure{Kind: KindUnknown, Err: err}
	// C# AsString throws and its catch-all replaces the engine.
	case errors.Is(err, ErrNotAString):
		return "", false, &Failure{Kind: KindUnknown, Err: err}
	case errors.As(err, &panicked):
		return "", false, &Failure{Kind: KindUnknown, Err: err}
	}
	return "", false, &Failure{Kind: KindUnknown, Err: err}
}

// classify reads a JS error's name as C# does: only SyntaxError (from
// JSON.parse) and TypeError (from the input readers) blame the document.
func classify(name string) Kind {
	if name == "SyntaxError" || name == "TypeError" {
		return KindInvalidDocument
	}
	return KindUnknown
}

type panicError struct{ value any }

func (e *panicError) Error() string { return fmt.Sprintf("jsruntime: engine panicked: %v", e.value) }

func (r *Runtime) safeInvoke(op, input string) (result string, err error) {
	defer func() {
		if value := recover(); value != nil {
			err = &panicError{value: value}
		}
	}()
	return r.Invoke(op, input)
}
