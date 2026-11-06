package blokmcp

import (
	"encoding/json"
	"errors"
	"fmt"
)

// surfaceErr is Node's McpSurfaceError: a model-fixable refusal the host
// raises. It is answered through mcpErrorAnswer with Helper deciding
// retryable.
type surfaceErr struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
	// Helper is "surface" (Node's surfaceError), "failure" or "as-is".
	Helper string `json:"-"`
	// Raw, when set, is the whole error object to send as is.
	Raw []byte `json:"-"`
}

func (e *surfaceErr) Error() string { return e.Message }

func surfaceError(code, message string) *surfaceErr {
	return &surfaceErr{Code: code, Message: message, Helper: "surface"}
}

func failureError(code, message string) *surfaceErr {
	return &surfaceErr{Code: code, Message: message, Helper: "failure"}
}

func asSurface(err error) (*surfaceErr, bool) {
	var failure *surfaceErr
	ok := errors.As(err, &failure)
	return failure, ok
}

func unknownHandle() *surfaceErr {
	return surfaceError("UNKNOWN_HANDLE", "No open document has this handle. It may have expired; call blok_open again.")
}

func handleLimit(max int) *surfaceErr {
	return surfaceError("HANDLE_LIMIT", fmt.Sprintf("You already have %d open documents. Close one with blok_close.", max))
}

// errorJSON is the error object mcpErrorAnswer reads.
func (e *surfaceErr) errorJSON() json.RawMessage {
	if e.Raw != nil {
		return e.Raw
	}
	written, _ := marshal(e)
	return written
}
