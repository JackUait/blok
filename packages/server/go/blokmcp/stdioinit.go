package blokmcp

import (
	"context"
	"encoding/json"
	"slices"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// legacyVersions are the versions Node's initialize answers with as asked;
// any other gets the first.
var legacyVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"}

// ownInitialize is the id of the initialize stdio sends the SDK itself.
const ownInitialize = "blok-mcp/initialize"

// stdioPeer is what Node's server knows of its stdio client. Node
// answers a call sent before initialize and every initialize, the latest
// naming the client; the Go SDK refuses both. So the SDK gets one
// initialize (the client's first, or its own before the first other
// call), and stdio answers the later ones from that answer.
type stdioPeer struct {
	mu sync.Mutex
	// params is the latest initialize the client sent; nil before one.
	params *mcp.InitializeParams
	// ready: the SDK took an initialize. first is its answer.
	ready   bool
	first   map[string]json.RawMessage
	asked   *jsonrpc.ID
	askedBy *mcp.InitializeParams
	// settled closes once the SDK answered the initialize it took.
	settled chan struct{}
	// pending is the call read while the SDK took its own initialize.
	pending *jsonrpc.Request
	tracker *callTracker
}

// signal is a stdio call's cancel signal (see callTracker.withSignal).
func (c *stdioPeer) signal(token string) context.Context {
	if c == nil {
		return nil
	}
	return c.tracker.signal(token)
}

func (c *stdioPeer) initializeParams() *mcp.InitializeParams {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.params
}

func (c *stdioPeer) takePending() *jsonrpc.Request {
	c.mu.Lock()
	defer c.mu.Unlock()
	pending := c.pending
	c.pending = nil
	return pending
}

// read turns a request into the one the SDK gets: nil when stdio answered
// it, the SDK's own initialize when a call comes first.
func (c *stdioPeer) read(ctx context.Context, out mcp.Connection, request *jsonrpc.Request) *jsonrpc.Request {
	if !request.IsCall() || request.Method == "ping" {
		return request
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if request.Method != "initialize" {
		if c.ready || c.asked != nil {
			return request
		}
		own, _ := jsonrpc.MakeID(ownInitialize)
		c.asked, c.settled = &own, make(chan struct{})
		c.pending = request
		params, _ := json.Marshal(map[string]any{"protocolVersion": legacyVersions[0], "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "", "version": ""}})
		return &jsonrpc.Request{ID: own, Method: "initialize", Params: params}
	}
	var params mcp.InitializeParams
	if json.Unmarshal(request.Params, &params) != nil {
		return request
	}
	// The SDK reads on while it answers an initialize: wait for that answer,
	// or this one would reach the SDK as a second.
	for c.asked != nil {
		settled := c.settled
		c.mu.Unlock()
		select {
		case <-settled:
		case <-ctx.Done():
			c.mu.Lock()
			return request
		}
		c.mu.Lock()
	}
	if !c.ready {
		c.asked, c.askedBy, c.settled = &request.ID, &params, make(chan struct{})
		return request
	}
	members := make(map[string]json.RawMessage, len(c.first))
	for key, value := range c.first {
		members[key] = value
	}
	version := legacyVersions[0]
	if slices.Contains(legacyVersions, params.ProtocolVersion) {
		version = params.ProtocolVersion
	}
	members["protocolVersion"] = quoted(version)
	result, err := json.Marshal(members)
	if err != nil {
		return request
	}
	c.params = &params
	_ = out.Write(ctx, &jsonrpc.Response{ID: request.ID, Result: result})
	return nil
}

// answered keeps the SDK's answer to the initialize it took; it says
// whether the answer goes to the client (the SDK's own does not).
func (c *stdioPeer) answered(response *jsonrpc.Response) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.asked == nil || *c.asked != response.ID {
		return true
	}
	own := response.ID.Raw() == ownInitialize
	if response.Error == nil {
		c.ready = true
		_ = json.Unmarshal(response.Result, &c.first)
		if !own {
			c.params = c.askedBy
		}
	}
	close(c.settled)
	c.asked, c.askedBy, c.settled = nil, nil, nil
	return !own
}
