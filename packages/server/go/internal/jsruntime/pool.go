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
	// MaxCallStackSize stops runaway recursion before it eats the heap. It is
	// set for HTML, about 8 frames an outline level: 19500 converts 2436
	// levels, where C# stops at 2400 on its allocation budget (both
	// measured). Markdown, about 3 frames a level, reaches 6498 levels, past
	// C#'s 1454.
	MaxCallStackSize = 19500
	// PlainTextCallStackSize is the cap of the plain-text readers, about 3
	// frames a level: it converts 11164 levels, where C# converts 11049
	// once warm and 6750 on a cold first call (all measured).
	PlainTextCallStackSize = 33500
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
// Error is C#'s ArgumentOutOfRangeException message, word for word: C#'s
// parameter name and values in .NET's format.
type ConstraintError struct {
	Param string
	Value string
	Floor string
	text  string
}

func (e *ConstraintError) Error() string { return e.text }

// refusal is ThrowIfLessThan's message for name, value and floor as .NET
// prints them.
func refusal(param, name, value, floor string) *ConstraintError {
	return &ConstraintError{Param: param, Value: value, Floor: floor,
		text: fmt.Sprintf("%s ('%s') must be greater than or equal to '%s'. (Parameter '%s')\nActual value was %s.", name, value, floor, name, value)}
}

func durationRefusal(param string, value time.Duration) *ConstraintError {
	return refusal(param, "timeout", timeSpan(value), timeSpan(MinimumTimeout))
}

// timeSpan is TimeSpan.ToString(), the "c" format: [-][d.]hh:mm:ss[.fffffff].
// A TimeSpan counts 100 ns ticks, so the nanoseconds under a tick are cut.
func timeSpan(d time.Duration) string {
	ticks := int64(d / 100)
	sign := ""
	if ticks < 0 {
		sign = "-"
	}
	// Negate as unsigned: the smallest int64 has no positive twin.
	t := uint64(ticks)
	if ticks < 0 {
		t = -t
	}
	const second, day = 10_000_000, 864_000_000_000
	days, rest := t/day, t%day
	out := sign
	if days > 0 {
		out += fmt.Sprintf("%d.", days)
	}
	out += fmt.Sprintf("%02d:%02d:%02d", rest/(3600*second), rest/(60*second)%60, rest/second%60)
	if fraction := rest % second; fraction != 0 {
		out += fmt.Sprintf(".%07d", fraction)
	}
	return out
}

// Options configure a Pool. Zero values take the defaults.
type Options struct {
	// PoolSize bounds concurrent calls; callers wait for a free engine.
	// nil means max(1, min(NumCPU, 4)); under 1 is refused, as C#.
	PoolSize *int
	// Timeout is the default wall-clock budget of one call and of each load.
	// nil means 10 s; under MinimumTimeout, 0 too, is refused, as C#.
	Timeout *time.Duration
	// MemoryBudget is the heap growth one call may cause. Approximate: see
	// guard.go. nil means 1 GiB; under MinimumMemoryBudget, 0 too, is
	// refused, as C#.
	MemoryBudget *int64
}

// ValidateConstraints refuses a timeout or budget below its floor. nil means
// the default and passes.
func ValidateConstraints(timeout *time.Duration, budget *int64) error {
	if budget != nil && *budget < MinimumMemoryBudget {
		return refusal("MemoryBudget", "allocationBudgetBytes", fmt.Sprint(*budget), fmt.Sprint(MinimumMemoryBudget))
	}
	if timeout != nil && *timeout < MinimumTimeout {
		return durationRefusal("Timeout", *timeout)
	}
	return nil
}

// ValidatePoolSize refuses a pool size under 1. nil means the default.
func ValidatePoolSize(size *int) error {
	if size != nil && *size < 1 {
		return refusal("PoolSize", "poolSize", fmt.Sprint(*size), "1")
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
	if err := ValidatePoolSize(options.PoolSize); err != nil {
		return nil, err
	}
	size := max(1, min(runtime.NumCPU(), 4))
	if options.PoolSize != nil {
		size = *options.PoolSize
	}
	program, err := compiled()
	if err != nil {
		return nil, &StartupError{Message: "Could not load Blok's runtime bundle into an engine.", Err: err}
	}
	// newPool reads 0 as the default.
	var timeout time.Duration
	if options.Timeout != nil {
		timeout = *options.Timeout
	}
	var budget int64
	if options.MemoryBudget != nil {
		budget = *options.MemoryBudget
	}
	return newPool(program, size, timeout, budget)
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
		return nil, refusal("PoolSize", "poolSize", fmt.Sprint(size), "1")
	}
	if budget < 0 {
		// The constructor's own check, under C#'s name for it.
		return nil, refusal("MemoryBudget", "budget", fmt.Sprint(budget), "1")
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
				Message: fmt.Sprintf("Loading Blok's runtime bundle into an engine grew the live heap past the %d-byte "+
					"memory budget this runtime was created with. Loading runs under the same memory budget as a "+
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
// busy. A nil timeout uses the pool's; any other value, 0 too, must be at
// least MinimumTimeout. Errors are a *Failure, a *ConstraintError, or
// ctx.Err().
func (p *Pool) Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error) {
	limit := p.timeout
	if timeout != nil {
		if *timeout < MinimumTimeout {
			return "", durationRefusal("timeout", *timeout)
		}
		limit = *timeout
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

	result, reusable, err := engine.guardedInvoke(ctx, op, input, limit, p.budget)
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
	r.vm.SetMaxCallStackSize(callStackSize(op))
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
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
	// C#'s stack guard throws a JS RangeError that finally blocks see, and
	// keeps the engine. goja's overflow skips every finally, so the bundle's
	// state is left mid-call and the next document could nest less deep:
	// the engine goes.
	case errors.As(err, &overflow):
		return "", false, &Failure{Kind: KindUnknown, Err: err}
	case errors.As(err, &jsErr):
		return "", true, &Failure{Kind: classify(jsErr.Name), Err: err}
	// No event loop: a promise pending now can never settle. As in C#, the
	// wait ends at the caller's cancel or the call timeout, whichever comes
	// first, so one request cannot hold an engine for good. Either way the
	// engine is replaced.
	case errors.Is(err, ErrPending):
		select {
		case <-ctx.Done():
			return "", false, ctx.Err()
		case <-deadline.C:
			return "", false, &Failure{Kind: KindTimedOut, Err: err}
		}
	// C# AsString throws and its catch-all replaces the engine.
	case errors.Is(err, ErrNotAString):
		return "", false, &Failure{Kind: KindUnknown, Err: err}
	case errors.As(err, &panicked):
		return "", false, &Failure{Kind: KindUnknown, Err: err}
	}
	return "", false, &Failure{Kind: KindUnknown, Err: err}
}

// callStackSize is the frame cap of one call. An engine serves every op, so
// it is set on each call.
func callStackSize(op string) int {
	if op == "blocksToPlainText" || op == "blocksToPlainTextWithReport" {
		return PlainTextCallStackSize
	}
	return MaxCallStackSize
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
