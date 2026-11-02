package journal

import (
	"errors"
	"fmt"
)

// ErrFenceLost is CollabOperationFenceLostException: another process took
// the document, so this session may no longer write or answer.
var ErrFenceLost = errors.New("collab: the operation-store session no longer holds the document fence")

// ErrClosed is ObjectDisposedException: the session was closed.
var ErrClosed = errors.New("collab: the operation-store session is closed")

// ArgumentError is C#'s ArgumentException (OutOfRange: ArgumentOutOfRangeException),
// with C#'s message and without .NET's parameter suffix.
type ArgumentError struct {
	Message    string
	OutOfRange bool
}

func (e *ArgumentError) Error() string { return e.Message }

func argumentf(format string, args ...any) error {
	return &ArgumentError{Message: fmt.Sprintf(format, args...)}
}

func outOfRangef(format string, args ...any) error {
	return &ArgumentError{Message: fmt.Sprintf(format, args...), OutOfRange: true}
}

// InvalidOperationError is C#'s InvalidOperationException: a caller error,
// such as appending to a document that was never seeded.
type InvalidOperationError struct{ Message string }

func (e *InvalidOperationError) Error() string { return e.Message }
