package room

import (
	"context"
	"errors"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// isTransient is CollabTransientException.
func isTransient(err error) bool {
	var transient *convert.TransientError
	return errors.As(err, &transient)
}

// isCancellation is OperationCanceledException, which a timeout is too.
func isCancellation(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// isEditRefusal is CollabEditException.
func isEditRefusal(err error) (*convert.EditError, bool) {
	var refusal *convert.EditError
	ok := errors.As(err, &refusal)
	return refusal, ok
}

func itoa(n int) string { return strconv.Itoa(n) }
