// Package jsruntime runs the Blok server runtime bundle in goja.
package jsruntime

import (
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/dop251/goja"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
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
	installLocaleCompare(vm)
	installJSONParseDepth(vm)
	return vm
}

// maxJSONDepth is Jint's Options.Json.MaxParseDepth default, which C# keeps:
// its JSON.parse refuses a 65th nested array or object, wherever the text
// came from.
const maxJSONDepth = 64

// jsonParseWrapper takes the engine's JSON.parse and a scan that answers the
// UTF-16 index of the first bracket nested past the cap, or -1. A method, so
// it is named "parse", has length 2, and is no constructor.
const jsonParseWrapper = `(function (parse, tooDeepAt, SyntaxErrorType) {
  const wrapped = {
    parse(text, reviver) {
      const source = ` + "`${text}`" + `;
      const at = tooDeepAt(source);
      if (at >= 0) {
        throw new SyntaxErrorType('Max. depth level of JSON reached at position ' + at);
      }
      return parse(source, reviver);
    },
  }.parse;
  Object.defineProperty(JSON, 'parse', { value: wrapped, writable: true, enumerable: false, configurable: true });
})`

func installJSONParseDepth(vm *goja.Runtime) {
	install, err := vm.RunString(jsonParseWrapper)
	if err != nil {
		panic(err)
	}
	call, _ := goja.AssertFunction(install)
	tooDeep := func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(jsonTooDeepAt(call.Argument(0).String()))
	}
	parse := vm.Get("JSON").ToObject(vm).Get("parse")
	if _, err := call(goja.Undefined(), parse, vm.ToValue(tooDeep), vm.Get("SyntaxError")); err != nil {
		panic(err)
	}
}

// jsonTooDeepAt scans brackets outside strings. It does not check the rest
// of the syntax: JSON.parse still does, and both fail as SyntaxError.
func jsonTooDeepAt(text string) int {
	depth, index := 0, 0
	inString, escaped := false, false
	for _, r := range text {
		switch {
		case inString:
			if escaped {
				escaped = false
			} else if r == '\\' {
				escaped = true
			} else if r == '"' {
				inString = false
			}
		case r == '"':
			inString = true
		case r == '[' || r == '{':
			depth++
			if depth > maxJSONDepth {
				return index
			}
		case (r == ']' || r == '}') && depth > 0:
			depth--
		}
		if r >= 0x10000 {
			index += 2
		} else {
			index++
		}
	}
	return -1
}

// installLocaleCompare is goja's localeCompare (NFD, then x/text's root
// collator) with U+FFFD read as U+FFFF. x/text puts U+FFFD among the
// symbols; ICU (C#, Rust, browsers) sorts it after every other char, which
// x/text gives U+FFFF. A lone surrogate reaches it as U+FFFD.
func installLocaleCompare(vm *goja.Runtime) {
	collator := collate.New(language.Und)
	text := func(value goja.Value) string {
		return strings.ReplaceAll(norm.NFD.String(value.String()), "\ufffd", "\uffff")
	}
	compare := func(call goja.FunctionCall) goja.Value {
		if goja.IsUndefined(call.This) || goja.IsNull(call.This) {
			panic(vm.NewTypeError("String.prototype.localeCompare called on null or undefined"))
		}
		this := text(call.This.ToString())
		that := text(call.Argument(0).ToString())
		return vm.ToValue(collator.CompareString(this, that))
	}
	prototype := vm.Get("String").ToObject(vm).Get("prototype").ToObject(vm)
	if err := prototype.DefineDataProperty("localeCompare", vm.ToValue(compare), goja.FLAG_TRUE, goja.FLAG_FALSE, goja.FLAG_TRUE); err != nil {
		panic(err)
	}
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
