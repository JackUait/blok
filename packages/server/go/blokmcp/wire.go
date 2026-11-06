package blokmcp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// liftInputResponses moves a tools/call's inputResponses into _meta, raw.
// The SDK decodes them into typed replies and refuses the whole request
// when one is not an elicit result; Node hands them to the approver, which
// asks again.
func liftInputResponses(params json.RawMessage) json.RawMessage {
	var members map[string]json.RawMessage
	if json.Unmarshal(params, &members) != nil {
		return params
	}
	responses, ok := members["inputResponses"]
	if !ok {
		return params
	}
	delete(members, "inputResponses")
	var meta map[string]json.RawMessage
	if raw, has := members["_meta"]; has && json.Unmarshal(raw, &meta) != nil {
		return params
	}
	if meta == nil {
		meta = map[string]json.RawMessage{}
	}
	meta[rawResponsesKey] = responses
	members["_meta"], _ = json.Marshal(meta)
	written, err := json.Marshal(members)
	if err != nil {
		return params
	}
	return written
}

// fixIncoming applies the request rewrites both transports need.
func fixIncoming(message jsonrpc.Message) {
	if request, ok := message.(*jsonrpc.Request); ok && request.Method == "tools/call" {
		request.Params = liftInputResponses(request.Params)
	}
}

// fixOutgoing words "method not found" as Node's SDK does, whatever the
// SDK's reason.
func fixOutgoing(message jsonrpc.Message) {
	response, ok := message.(*jsonrpc.Response)
	if !ok || response.Error == nil {
		return
	}
	var wire *jsonrpc.Error
	if errors.As(response.Error, &wire) && wire.Code == jsonrpc.CodeMethodNotFound {
		response.Error = &jsonrpc.Error{Code: wire.Code, Message: "Method not found"}
	}
}

// fixedTransport wraps a transport's connection with the rewrites.
type fixedTransport struct{ inner mcp.Transport }

func (t fixedTransport) Connect(ctx context.Context) (mcp.Connection, error) {
	connection, err := t.inner.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return fixedConnection{connection}, nil
}

type fixedConnection struct{ mcp.Connection }

func (c fixedConnection) Read(ctx context.Context) (jsonrpc.Message, error) {
	message, err := c.Connection.Read(ctx)
	if err == nil {
		fixIncoming(message)
	}
	return message, err
}

func (c fixedConnection) Write(ctx context.Context, message jsonrpc.Message) error {
	fixOutgoing(message)
	return c.Connection.Write(ctx, message)
}

// acceptedReplies is Node's SDK partitionInputResponses: only bare reply
// objects count. A wrapped {method}/{result} entry, or anything that is not
// an object, is dropped, so the approver asks again.
func acceptedReplies(raw json.RawMessage) map[string]json.RawMessage {
	accepted := map[string]json.RawMessage{}
	entries, ok := isRecordJSON(raw)
	if !ok {
		return accepted
	}
	for key, entry := range entries {
		members, isObject := isRecordJSON(entry)
		if !isObject {
			continue
		}
		_, hasMethod := members["method"]
		_, hasResult := members["result"]
		if !hasMethod && !hasResult {
			accepted[key] = entry
		}
	}
	return accepted
}
