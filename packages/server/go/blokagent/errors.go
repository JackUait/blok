package blokagent

import (
	"errors"
	"strings"

	"github.com/JackUait/blok/packages/server/go/blokdocs"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// Errors are what C# throws; a batch the bundle refuses is never an error,
// it is an Execution whose result has ok false. A runtime failure is a
// *blokdocs.ConversionError, and a caller's own cancellation is ctx.Err().

// JSONError is input or a runtime answer that is not JSON, where C# throws
// JsonException.
type JSONError struct{ Err error }

func (e *JSONError) Error() string { return "blokagent: not JSON: " + e.Err.Error() }

func (e *JSONError) Unwrap() error { return e.Err }

// ArgumentError is input the caller got wrong, as C# ArgumentException.
// Message has no " (Parameter '…')" suffix.
type ArgumentError struct {
	Param   string
	Message string
}

func (e *ArgumentError) Error() string { return e.Message }

// InvalidOperationError is an answer the host could not use, as C#
// InvalidOperationException. The shipped bundle never gives one.
type InvalidOperationError struct{ Message string }

func (e *InvalidOperationError) Error() string { return e.Message }

func noAnswer(what string) error {
	return &InvalidOperationError{Message: "The Blok runtime returned no " + what + "."}
}

// fromJSON turns a jsjson read or write failure into what C# throws there.
func fromJSON(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, jsjson.ErrDuplicate):
		// jsjson carries .NET's own message after its prefix.
		_, message, _ := strings.Cut(err.Error(), jsjson.ErrDuplicate.Error()+": ")
		return &ArgumentError{Param: "key", Message: message}
	case errors.Is(err, jsjson.ErrLoneSurrogate):
		return &InvalidOperationError{Message: "Cannot read incomplete UTF-16 JSON text as string with missing low surrogate."}
	}
	return &JSONError{Err: err}
}

func fromRuntime(err error) error {
	var failure *jsruntime.Failure
	if errors.As(err, &failure) {
		return &blokdocs.ConversionError{Reason: blokdocs.Reason(failure.Kind), Err: failure}
	}
	return err
}
