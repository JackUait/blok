package blokmcp

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// callTracker follows the client's requests on one stdio connection. Node's
// SDK sends no answer to a request the client cancelled, so its answer is
// dropped here. A stop waits for the requests still running.
type callTracker struct {
	mu        sync.Mutex
	idle      *sync.Cond
	running   map[jsonrpc.ID]bool
	cancelled map[jsonrpc.ID]bool
}

func newCallTracker() *callTracker {
	tracker := &callTracker{running: map[jsonrpc.ID]bool{}, cancelled: map[jsonrpc.ID]bool{}}
	tracker.idle = sync.NewCond(&tracker.mu)
	return tracker
}

func (t *callTracker) read(message jsonrpc.Message) {
	request, ok := message.(*jsonrpc.Request)
	if !ok {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if request.IsCall() {
		t.running[request.ID] = true
		return
	}
	if request.Method != "notifications/cancelled" {
		return
	}
	var params struct {
		RequestID any `json:"requestId"`
	}
	if json.Unmarshal(request.Params, &params) != nil {
		return
	}
	id, err := jsonrpc.MakeID(params.RequestID)
	// Only a request still running can be cancelled, as in Node's SDK.
	if err == nil && t.running[id] {
		t.cancelled[id] = true
	}
}

// answer says whether a message goes out: an answer to a cancelled request
// does not.
func (t *callTracker) answer(message jsonrpc.Message) bool {
	response, ok := message.(*jsonrpc.Response)
	if !ok {
		return true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	cancelled := t.cancelled[response.ID]
	delete(t.running, response.ID)
	delete(t.cancelled, response.ID)
	if len(t.running) == 0 {
		t.idle.Broadcast()
	}
	return !cancelled
}

// waitIdle waits until no request runs, or until the deadline.
func (t *callTracker) waitIdle(deadline time.Time) {
	timer := time.AfterFunc(time.Until(deadline), func() {
		t.mu.Lock()
		t.idle.Broadcast()
		t.mu.Unlock()
	})
	defer timer.Stop()
	t.mu.Lock()
	defer t.mu.Unlock()
	for len(t.running) > 0 && time.Now().Before(deadline) {
		t.idle.Wait()
	}
}

type trackedTransport struct {
	inner   mcp.Transport
	tracker *callTracker
}

func (t trackedTransport) Connect(ctx context.Context) (mcp.Connection, error) {
	connection, err := t.inner.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return trackedConnection{connection, t.tracker}, nil
}

type trackedConnection struct {
	mcp.Connection
	tracker *callTracker
}

func (c trackedConnection) Read(ctx context.Context) (jsonrpc.Message, error) {
	message, err := c.Connection.Read(ctx)
	if err == nil {
		c.tracker.read(message)
	}
	return message, err
}

func (c trackedConnection) Write(ctx context.Context, message jsonrpc.Message) error {
	if !c.tracker.answer(message) {
		return nil
	}
	return c.Connection.Write(ctx, message)
}
