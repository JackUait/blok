package blokdocs

import (
	"fmt"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// Reason says why a conversion could not finish. The values match C#
// BlokConversionFailure.
type Reason int

// The reasons of a ConversionError.
const (
	// Unknown is anything the runtime could not place, the stack limit included.
	Unknown Reason = iota
	// InvalidDocument is input that is not a usable document: not JSON, JSON
	// nested past 64 levels on an envelope operation, a lone-surrogate escape
	// on one, or no blocks array.
	InvalidDocument
	// TimedOut is a conversion that ran past its timeout.
	TimedOut
	// DocumentTooLarge is a conversion that ran past its memory budget.
	DocumentTooLarge
)

func (r Reason) String() string {
	switch r {
	case InvalidDocument:
		return "InvalidDocument"
	case TimedOut:
		return "TimedOut"
	case DocumentTooLarge:
		return "DocumentTooLarge"
	}
	return "Unknown"
}

// ConversionError is a conversion that failed. Branch on Reason; the message
// is fixed per reason. A caller's own cancellation is never one: the
// methods return ctx.Err() for it.
type ConversionError struct {
	Reason Reason
	Err    error
}

func (e *ConversionError) Error() string {
	switch e.Reason {
	case InvalidDocument:
		return "This is not a usable Blok document."
	case TimedOut:
		return "Converting this document ran past the runtime's timeout."
	case DocumentTooLarge:
		return "Converting this document ran past the runtime's per-call allocation budget."
	}
	return "The Blok runtime could not convert this document."
}

func (e *ConversionError) Unwrap() error { return e.Err }

// ArgumentError is input the caller got wrong, as C# ArgumentException.
// Param names the argument; Error is the message without .NET's
// " (Parameter '…')" suffix.
type ArgumentError interface {
	error
	Param() string
}

// NullArgumentError is a nil map or list where C# throws
// ArgumentNullException. The check runs before the document is read.
type NullArgumentError struct{ Name string }

func (e *NullArgumentError) Error() string { return "Value cannot be null." }

// Param names the nil argument.
func (e *NullArgumentError) Param() string { return e.Name }

// TextCountError is a translation list whose length does not match the
// document's translatable strings.
type TextCountError struct {
	// Expected and Received are the runtime's numbers as written.
	Expected, Received string
}

func (e *TextCountError) Error() string {
	return fmt.Sprintf("This document yields %s translatable strings, but %s were given.", e.Expected, e.Received)
}

// Param is "texts".
func (e *TextCountError) Param() string { return "texts" }

// UnmappedIDsError is id maps that do not cover a page document.
type UnmappedIDsError struct {
	MissingBlockIDs   []string
	DuplicateBlockIDs []string
	IdlessBlocks      int
}

func (e *UnmappedIDsError) Error() string {
	quoted := func(ids []string) string {
		parts := make([]string, len(ids))
		for i, id := range ids {
			parts[i] = `"` + id + `"`
		}
		return strings.Join(parts, ", ")
	}
	var parts []string
	if len(e.MissingBlockIDs) > 0 {
		parts = append(parts, "No new id for "+quoted(e.MissingBlockIDs))
	}
	if len(e.DuplicateBlockIDs) > 0 {
		parts = append(parts, "More than one block maps to "+quoted(e.DuplicateBlockIDs))
	}
	if e.IdlessBlocks > 0 {
		parts = append(parts, fmt.Sprintf("%d block(s) without an id", e.IdlessBlocks))
	}
	return strings.Join(parts, "; ") + "."
}

// Param is "blockIds".
func (e *UnmappedIDsError) Param() string { return "blockIds" }

// AnswerError is a runtime answer the host could not read: C#'s
// InvalidOperationException, or its JsonException when NotJSON is set.
// The shipped bundle never gives one.
type AnswerError struct {
	Message string
	NotJSON bool
	Err     error
}

func (e *AnswerError) Error() string {
	if e.NotJSON {
		return "The Blok runtime answered with JSON the host could not read."
	}
	return e.Message
}

func (e *AnswerError) Unwrap() error { return e.Err }

// ErrNoVersion is a bundle built without the VERSION define.
var ErrNoVersion = &AnswerError{Message: "The embedded Blok runtime reports no version; it was built without the VERSION define."}

func noAnswer(what string) *AnswerError {
	return &AnswerError{Message: "The Blok runtime returned no " + what + "."}
}

func notJSON(err error) *AnswerError { return &AnswerError{NotJSON: true, Err: err} }

// fromRuntime turns a pool failure into a ConversionError. Context errors
// and constraint errors pass through unchanged.
func fromRuntime(err error) error {
	if failure, ok := err.(*jsruntime.Failure); ok {
		return &ConversionError{Reason: Reason(failure.Kind), Err: failure}
	}
	return err
}
