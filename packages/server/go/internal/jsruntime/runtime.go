// Package jsruntime runs the Blok server runtime bundle in goja.
package jsruntime

import (
	_ "embed"
	"errors"
	"fmt"
	"sync"

	"github.com/dop251/goja"
)

// The bundle C# embeds too. scripts/build-server-runtime.mjs writes this
// committed copy; a vitest law fails when it drifts from a fresh build.
//
//go:embed blok-server-runtime.js
var bundle string

// ErrPending means the bundle's promise had not settled when the call returned.
var ErrPending = errors.New("jsruntime: promise still pending after the call")

// JSError is a JavaScript error thrown or rejected by the bundle.
type JSError struct {
	Name    string
	Message string
}

func (e *JSError) Error() string { return e.Name + ": " + e.Message }

// Runtime is one goja engine with the bundle loaded. It is not safe for
// concurrent use.
type Runtime struct {
	vm     *goja.Runtime
	invoke goja.Callable
}

var compiled = sync.OnceValues(func() (*goja.Program, error) {
	return compile("blok-server-runtime.js", bundle)
})

func compile(name, source string) (*goja.Program, error) {
	return goja.Compile(name, source, false)
}

// New builds an engine from the embedded bundle. The bundle is compiled once
// per process.
func New() (*Runtime, error) {
	program, err := compiled()
	if err != nil {
		return nil, fmt.Errorf("jsruntime: compile bundle: %w", err)
	}
	return fromProgram(program)
}

func newFromSource(name, source string) (*Runtime, error) {
	program, err := compile(name, source)
	if err != nil {
		return nil, err
	}
	return fromProgram(program)
}

func fromProgram(program *goja.Program) (*Runtime, error) {
	return fromVM(newVM(), program)
}

func newVM() *goja.Runtime {
	vm := goja.New()
	vm.SetMaxCallStackSize(MaxCallStackSize)
	return vm
}

func fromVM(vm *goja.Runtime, program *goja.Program) (*Runtime, error) {
	if _, err := vm.RunProgram(program); err != nil {
		return nil, fmt.Errorf("jsruntime: load bundle: %w", err)
	}
	invoke, ok := goja.AssertFunction(vm.Get("blokServerInvoke"))
	if !ok {
		return nil, errors.New("jsruntime: bundle does not define blokServerInvoke")
	}
	return &Runtime{vm: vm, invoke: invoke}, nil
}

// ErrNotAString means the bundle answered with something other than a
// primitive string. C# (Jint AsString) throws on it and replaces the engine.
var ErrNotAString = errors.New("jsruntime: the bundle did not answer with a string")

// Invoke runs one operation of the bundle and returns its string result.
func (r *Runtime) Invoke(op, inputJSON string) (string, error) {
	value, err := r.invoke(goja.Undefined(), r.vm.ToValue(op), r.vm.ToValue(inputJSON))
	if err != nil {
		var exception *goja.Exception
		if errors.As(err, &exception) {
			return "", r.jsError(exception.Value())
		}
		return "", err
	}
	// goja runs the job queue before the outermost call returns, so an
	// async op has settled by now unless it waits on something external.
	if promise, ok := value.Export().(*goja.Promise); ok {
		switch promise.State() {
		case goja.PromiseStateFulfilled:
			value = promise.Result()
		case goja.PromiseStateRejected:
			return "", r.jsError(promise.Result())
		default:
			return "", ErrPending
		}
	}
	if !goja.IsString(value) {
		return "", ErrNotAString
	}
	return value.String(), nil
}

// jsError reads name and message as C# does (Get, then ToString). Either
// read can be missing or run a throwing getter or toString; a name that
// cannot be read is "", which classifies as Unknown.
func (r *Runtime) jsError(value goja.Value) *JSError {
	object, ok := value.(*goja.Object)
	if !ok {
		return &JSError{Name: "Error", Message: value.String()}
	}
	read := func(key string) string {
		var text string
		if r.vm.Try(func() {
			text = "undefined"
			if field := object.Get(key); field != nil {
				text = field.String()
			}
		}) != nil {
			return ""
		}
		return text
	}
	return &JSError{Name: read("name"), Message: read("message")}
}
