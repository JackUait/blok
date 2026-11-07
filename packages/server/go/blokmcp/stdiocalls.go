package blokmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"sync/atomic"
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
	// closed: the transport is closed, so nothing more goes out.
	closed bool
	// lines orders the calls on each handle; booked are the turn tokens of
	// each id's calls not answered yet, open how many of them are open.
	lines  *handleLines
	booked map[jsonrpc.ID][]string
	open   map[jsonrpc.ID]int
	// The Go SDK refuses an id still in use; Node's answers it again. A
	// reused id runs under an alias (alias to the client's id), and
	// latest is the id a cancel of the client's id reaches, as Node's
	// SDK keeps only the newest request per id.
	// calls are the running requests that are tools/call. Once stdin
	// ended, their answers are dropped, as Node's transport closes there.
	calls     map[jsonrpc.ID]bool
	stdinDone bool
	inUse     map[jsonrpc.ID]int
	aliases   map[jsonrpc.ID]jsonrpc.ID
	latest    map[jsonrpc.ID]jsonrpc.ID
}

// closeTransport drops every later message, as Node's closed transport
// refuses to send, and ends the wait for running requests.
func (t *callTracker) closeTransport() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	clear(t.running)
	t.dropBookedLocked()
	t.idle.Broadcast()
}

func (t *callTracker) dropBooked() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.dropBookedLocked()
}

// dropBookedLocked lets go of every turn no call claimed: those calls
// will never run.
func (t *callTracker) dropBookedLocked() {
	for _, tokens := range t.booked {
		for _, token := range tokens {
			t.lines.drop(token)
		}
	}
	clear(t.booked)
	clear(t.open)
}

// book takes a call's place on its handle as stdio reads it. One id can
// come twice (Node runs both, in order), so each place has its own token.
func (t *callTracker) book(id jsonrpc.ID, handle string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	token := t.lines.book(handle)
	t.booked[id] = append(t.booked[id], token)
	t.open[id]++
	return token
}

// ended: one request with this id was answered. Its unclaimed places go
// once every request with it has, so a call the SDK never ran cannot hold
// the line.
func (t *callTracker) ended(id jsonrpc.ID) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.endedLocked(id)
}

func (t *callTracker) endedLocked(id jsonrpc.ID) {
	if t.open[id] == 0 {
		return
	}
	t.open[id]--
	if t.open[id] > 0 {
		return
	}
	for _, token := range t.booked[id] {
		t.lines.drop(token)
	}
	delete(t.booked, id)
	delete(t.open, id)
}

func newCallTracker() *callTracker {
	tracker := &callTracker{running: map[jsonrpc.ID]bool{}, cancelled: map[jsonrpc.ID]bool{},
		lines: newHandleLines(), booked: map[jsonrpc.ID][]string{}, open: map[jsonrpc.ID]int{},
		calls: map[jsonrpc.ID]bool{}, inUse: map[jsonrpc.ID]int{}, aliases: map[jsonrpc.ID]jsonrpc.ID{}, latest: map[jsonrpc.ID]jsonrpc.ID{}}
	tracker.idle = sync.NewCond(&tracker.mu)
	return tracker
}

func (t *callTracker) read(message jsonrpc.Message) {
	request, ok := message.(*jsonrpc.Request)
	if !ok {
		return
	}
	if request.IsCall() {
		t.alias(request)
	}
	if request.IsCall() && request.Method == "tools/call" {
		request.Params = t.withTurn(request.ID, request.Params)
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if request.IsCall() {
		t.running[request.ID] = true
		if request.Method == "tools/call" {
			t.calls[request.ID] = true
		}
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
	if newest, ok := t.latest[id]; ok {
		id = newest
	}
	// Only a request still running can be cancelled, as in Node's SDK.
	if err == nil && t.running[id] {
		t.cancelled[id] = true
	}
}

// alias gives a request whose id is still in use an id of its own.
func (t *callTracker) alias(request *jsonrpc.Request) {
	t.mu.Lock()
	defer t.mu.Unlock()
	client := request.ID
	if t.inUse[client] > 0 {
		own, err := jsonrpc.MakeID("blok-mcp/reused/" + newHandleID())
		if err == nil {
			t.aliases[own] = client
			request.ID = own
		}
	}
	t.inUse[client]++
	t.latest[client] = request.ID
}

// clientID is the id the client sent for a request.
func (t *callTracker) clientID(id jsonrpc.ID) jsonrpc.ID {
	t.mu.Lock()
	defer t.mu.Unlock()
	if client, ok := t.aliases[id]; ok {
		return client
	}
	return id
}

// turnKey carries a call's turn token in its _meta, to callTool. A
// client's own value is removed.
const turnKey = "blok/turn"

// withTurn books a call's place when its arguments name a handle (exact
// keys, as Node reads them) and puts the token in its _meta.
func (t *callTracker) withTurn(id jsonrpc.ID, params json.RawMessage) json.RawMessage {
	members, ok := isRecordJSON(params)
	if !ok {
		return params
	}
	var meta map[string]json.RawMessage
	if raw, has := members["_meta"]; has && json.Unmarshal(raw, &meta) != nil {
		return params
	}
	_, hadKey := meta[turnKey]
	delete(meta, turnKey)
	arguments, _ := isRecordJSON(members["arguments"])
	var handle string
	if json.Unmarshal(arguments["handle"], &handle) != nil || !isStringJSON(arguments["handle"]) {
		if !hadKey {
			return params
		}
	} else {
		if meta == nil {
			meta = map[string]json.RawMessage{}
		}
		meta[turnKey] = quoted(t.book(id, handle))
	}
	members["_meta"], _ = json.Marshal(meta)
	written, err := json.Marshal(members)
	if err != nil {
		return params
	}
	return written
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
	return !t.closed && !t.cancelled[response.ID] && !(t.stdinDone && t.calls[response.ID])
}

// stdinEnded waits, up to the deadline, for the answers of the requests
// already read that are not tools/call: Node answers those before it sees
// stdin end, and its tools/call answers come after and are dropped.
func (t *callTracker) stdinEnded(deadline time.Time) {
	timer := time.AfterFunc(time.Until(deadline), func() {
		t.mu.Lock()
		t.idle.Broadcast()
		t.mu.Unlock()
	})
	defer timer.Stop()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stdinDone = true
	for len(t.running) > len(t.calls) && time.Now().Before(deadline) {
		t.idle.Wait()
	}
}

// answered ends a request once its answer is written or dropped.
func (t *callTracker) answered(message jsonrpc.Message) {
	response, ok := message.(*jsonrpc.Response)
	if !ok {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.running, response.ID)
	delete(t.cancelled, response.ID)
	delete(t.calls, response.ID)
	t.endedLocked(response.ID)
	client, aliased := t.aliases[response.ID]
	if !aliased {
		client = response.ID
	}
	delete(t.aliases, response.ID)
	if t.inUse[client] > 0 {
		if t.inUse[client]--; t.inUse[client] == 0 {
			delete(t.inUse, client)
			delete(t.latest, client)
		}
	}
	t.idle.Broadcast()
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
	} else if errors.Is(err, io.EOF) {
		c.tracker.stdinEnded(time.Now().Add(stopDrain))
	}
	return message, err
}

func (c trackedConnection) Write(ctx context.Context, message jsonrpc.Message) error {
	response, isResponse := message.(*jsonrpc.Response)
	var own jsonrpc.ID
	if isResponse {
		own = response.ID
	}
	defer func() {
		if isResponse {
			response.ID = own
		}
		c.tracker.answered(message)
	}()
	if !c.tracker.answer(message) {
		return nil
	}
	if isResponse {
		response.ID = c.tracker.clientID(own)
	}
	return c.Connection.Write(ctx, message)
}

// stdioMaxBuffer is Node's SDK STDIO_DEFAULT_MAX_BUFFER_SIZE: the bytes of a
// message not yet ended that its ReadBuffer holds.
const stdioMaxBuffer = 10 * 1024 * 1024

// cappedStdin is Node's ReadBuffer check on stdin: when the unended bytes
// plus a new chunk pass the cap, the transport closes. Nothing more is
// read as a message and nothing more is answered; the rest of stdin is
// read and dropped until it ends, which ends the session as Node's stdin
// end does. Node logs nothing.
type cappedStdin struct {
	in      io.ReadCloser
	tracker *callTracker
	pending int
	over    atomic.Bool
}

func (c *cappedStdin) Read(p []byte) (int, error) {
	if c.over.Load() {
		return 0, c.drain()
	}
	n, err := c.in.Read(p)
	if c.pending+n > stdioMaxBuffer {
		c.over.Store(true)
		c.tracker.closeTransport()
		return 0, c.drain()
	}
	if at := bytes.LastIndexByte(p[:n], '\n'); at >= 0 {
		c.pending = n - at - 1
	} else {
		c.pending += n
	}
	return n, err
}

func (c *cappedStdin) drain() error {
	_, err := io.Copy(io.Discard, c.in)
	if err == nil {
		err = io.EOF
	}
	return err
}

func (c *cappedStdin) Close() error { return c.in.Close() }
