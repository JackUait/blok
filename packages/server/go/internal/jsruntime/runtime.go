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

// Invoke runs one operation of the bundle and returns its string result.
func (r *Runtime) Invoke(op, inputJSON string) (string, error) {
	value, err := r.invoke(goja.Undefined(), r.vm.ToValue(op), r.vm.ToValue(inputJSON))
	if err != nil {
		var exception *goja.Exception
		if errors.As(err, &exception) {
			return "", jsError(exception.Value())
		}
		return "", err
	}
	// goja runs the job queue before the outermost call returns, so an
	// async op has settled by now unless it waits on something external.
	if promise, ok := value.Export().(*goja.Promise); ok {
		switch promise.State() {
		case goja.PromiseStateFulfilled:
			return promise.Result().String(), nil
		case goja.PromiseStateRejected:
			return "", jsError(promise.Result())
		default:
			return "", ErrPending
		}
	}
	return value.String(), nil
}

func jsError(value goja.Value) *JSError {
	if object, ok := value.(*goja.Object); ok {
		return &JSError{Name: object.Get("name").String(), Message: object.Get("message").String()}
	}
	return &JSError{Name: "Error", Message: value.String()}
}
