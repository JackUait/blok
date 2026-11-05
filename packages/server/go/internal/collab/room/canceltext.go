package room

import (
	"context"
	"errors"
)

// errorText is err as C# prints error.Message at a room log line. .NET words
// a cancellation by when it came: HttpClient, SemaphoreSlim and channels
// say "A task was canceled." when the token was already cancelled as the
// call began, and "The operation was canceled." when it was cancelled
// during the call (DocEndpointClientTests.ACancelledSaveReadsAsDotNetsCancelText).
// A timeout is a cancel during the call. With ctx given, only a cancel of
// ctx itself counts; a store's own timeout keeps its own text. With no ctx,
// only a bare cancel counts: a store that wraps one in its own error keeps
// its own text, as C#'s error.Message does.
func errorText(err error, ctx context.Context, cancelledBefore bool) string {
	cancel := errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
	if ctx == nil {
		cancel = err == context.Canceled || err == context.DeadlineExceeded
	}
	if !cancel || (ctx != nil && ctx.Err() == nil) {
		return err.Error()
	}
	if cancelledBefore {
		return "A task was canceled."
	}
	return "The operation was canceled."
}
