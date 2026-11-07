package blokmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsruntime"
)

// invoker runs one bundle operation; a *jsruntime.Pool is one.
type invoker interface {
	Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error)
}

// bundle calls the shared runtime's mcp* operations. Their output is kept as
// raw JSON, so a document's bytes and key order pass through untouched.
type bundle struct{ runtime invoker }

// callTimeout bounds one bundle call. Node has none; a batch on a big
// document can take seconds.
var callTimeout = 60 * time.Second

func newPool(size int) (*jsruntime.Pool, error) {
	timeout := callTimeout
	return jsruntime.NewPool(jsruntime.Options{PoolSize: &size, Timeout: &timeout})
}

// marshal writes JSON without HTML escaping; the bundle reads either form.
func marshal(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return rawLineSeparators(bytes.TrimRight(buffer.Bytes(), "\n")), nil
}

// rawLineSeparators turns the \u2028 and \u2029 escapes Go's encoder
// always writes back into the characters, as JSON.stringify writes them. An
// escape whose backslash is itself escaped is text and stays.
func rawLineSeparators(written []byte) []byte {
	if !bytes.Contains(written, []byte(`\u202`)) {
		return written
	}
	out := make([]byte, 0, len(written))
	for i := 0; i < len(written); i++ {
		if written[i] != '\\' {
			out = append(out, written[i])
			continue
		}
		if i+5 < len(written) && string(written[i+1:i+5]) == "u202" && (written[i+5] == '8' || written[i+5] == '9') {
			if written[i+5] == '8' {
				out = append(out, "\u2028"...)
			} else {
				out = append(out, "\u2029"...)
			}
			i += 5
			continue
		}
		// Any other escape is two bytes or \uXXXX; copy its backslash and
		// the next byte together so an escaped backslash is never read as
		// the start of an escape.
		out = append(out, written[i])
		if i+1 < len(written) {
			out = append(out, written[i+1])
			i++
		}
	}
	return out
}

// call runs op on input and decodes the answer into out (a pointer), unless
// out is nil. The raw answer is returned too.
func (b bundle) call(ctx context.Context, op string, input any, out any) (json.RawMessage, error) {
	written, err := marshal(input)
	if err != nil {
		return nil, err
	}
	answer, err := b.runtime.Invoke(ctx, op, string(finiteJSON(written)), nil)
	if err != nil {
		// The engine's stack means nothing to a caller: a limit is named.
		var failure *jsruntime.Failure
		if errors.As(err, &failure) {
			switch failure.Kind {
			case jsruntime.KindTimedOut:
				return nil, fmt.Errorf("blok-mcp: the document took longer than %d s to process; it may be too large.", int(callTimeout.Seconds()))
			case jsruntime.KindDocumentTooLarge:
				return nil, errors.New("blok-mcp: the document is too large to process.")
			}
		}
		return nil, fmt.Errorf("blok-mcp: bundle operation %s failed: %w", op, err)
	}
	raw := json.RawMessage(answer)
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return nil, fmt.Errorf("blok-mcp: bundle operation %s answered unreadable JSON: %w", op, err)
		}
	}
	return raw, nil
}
