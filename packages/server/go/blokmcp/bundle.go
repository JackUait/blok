package blokmcp

import (
	"bytes"
	"context"
	"encoding/json"
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
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// call runs op on input and decodes the answer into out (a pointer), unless
// out is nil. The raw answer is returned too.
func (b bundle) call(ctx context.Context, op string, input any, out any) (json.RawMessage, error) {
	written, err := marshal(input)
	if err != nil {
		return nil, err
	}
	answer, err := b.runtime.Invoke(ctx, op, string(written), nil)
	if err != nil {
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
