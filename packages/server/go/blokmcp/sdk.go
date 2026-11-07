package blokmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync/atomic"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	modernVersion = "2026-07-28"
	// rawResponsesKey carries a tools/call's inputResponses past the SDK,
	// which refuses a reply that is not an elicit result (see wire.go).
	rawResponsesKey = "blok/inputResponses"
	// maxAsks bounds the 2025 stdio fallback; the bundle allows one question
	// per call.
	maxAsks = 3
)

// identity says who calls: the principal and OAuth scopes (nil without
// OAuth).
type identity struct {
	principal string
	scopes    []string
}

// rawResult is a result written from raw JSON members. The SDK adds _meta.
type rawResult struct {
	mcp.ResultBase
	members map[string]json.RawMessage
}

func (r *rawResult) MarshalJSON() ([]byte, error) {
	members := r.members
	if len(r.Meta) > 0 {
		meta, err := json.Marshal(map[string]any(r.Meta))
		if err != nil {
			return nil, err
		}
		members = map[string]json.RawMessage{"_meta": meta}
		for key, value := range r.members {
			members[key] = value
		}
	}
	return json.Marshal(members)
}

func quoted(text string) json.RawMessage {
	written, _ := marshal(text)
	return written
}

// isModern says whether a request follows the 2026-07-28 per-request
// protocol: its _meta names the version.
func isModern(req mcp.Request) bool {
	params := req.GetParams()
	// A request sent with no params holds a typed nil pointer.
	if params == nil || reflect.ValueOf(params).IsNil() {
		return false
	}
	_, ok := params.GetMeta()[mcp.MetaKeyProtocolVersion]
	return ok
}

// listAnswerResult is a list answer; a 2026 one also carries Node's cache fields.
func listAnswerResult(req mcp.Request, key string, items json.RawMessage) *rawResult {
	members := map[string]json.RawMessage{key: items}
	if isModern(req) {
		members["resultType"] = quoted("complete")
		members["ttlMs"] = json.RawMessage("0")
		members["cacheScope"] = quoted("private")
	}
	return &rawResult{members: members}
}

// completeResult is a call answer from an object of members.
func completeResult(req mcp.Request, object json.RawMessage) (*rawResult, error) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(object, &members); err != nil {
		return nil, err
	}
	if isModern(req) {
		members["resultType"] = quoted("complete")
	}
	return &rawResult{members: members}, nil
}

// newSDKServer builds the SDK server for one connection (stdio) or one
// request (HTTP). Every Blok method is answered in middleware from the
// bundle's raw JSON, so the SDK's own tool and prompt types never reshape
// an answer.
func (s *Server) newSDKServer(who identity) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "blok-mcp", Version: s.version}, &mcp.ServerOptions{
		Instructions: s.surface.Instructions,
		Capabilities: &mcp.ServerCapabilities{Tools: &mcp.ToolCapabilities{}, Prompts: &mcp.PromptCapabilities{}},
		SetCacheable: func(_ context.Context, _ mcp.Request, c *mcp.Cacheable) {
			c.TTLMs = 0
			c.CacheScope = "private"
		},
	})
	var asks atomic.Int64
	server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			switch method {
			case "tools/list":
				return listAnswerResult(req, "tools", s.surface.Tools), nil
			case "prompts/list":
				return listAnswerResult(req, "prompts", s.surface.Prompts), nil
			case "prompts/get":
				return internalError(s.getPrompt(ctx, req))
			case "tools/call":
				return internalError(s.callTool(ctx, req, who, &asks))
			case "initialize":
				result, err := next(ctx, method, req)
				if initialized, ok := result.(*mcp.InitializeResult); ok && err == nil {
					// Node's SDK still accepts 2024-10-07 and echoes it.
					if params, ok := req.GetParams().(*mcp.InitializeParams); ok && params.ProtocolVersion == "2024-10-07" {
						initialized.ProtocolVersion = params.ProtocolVersion
					}
				}
				return result, err
			case "server/discover":
				result, err := next(ctx, method, req)
				if discovered, ok := result.(*mcp.DiscoverResult); ok && err == nil {
					discovered.SupportedVersions = []string{modernVersion}
				}
				return result, err
			case "initialized", "notifications/initialized", "ping", "notifications/cancelled":
			default:
				// Node registers no other method.
				if strings.HasPrefix(method, "notifications/") {
					return nil, nil
				}
				return nil, &jsonrpc.Error{Code: jsonrpc.CodeMethodNotFound, Message: "Method not found"}
			}
			return next(ctx, method, req)
		}
	})
	return server
}

// internalError answers a failure that is not a JSON-RPC error as -32603,
// as Node's SDK does; the Go SDK would send code 0.
func internalError(result mcp.Result, err error) (mcp.Result, error) {
	var wire *jsonrpc.Error
	if err == nil || errors.As(err, &wire) {
		return result, err
	}
	return nil, &jsonrpc.Error{Code: jsonrpc.CodeInternalError, Message: err.Error()}
}

func (s *Server) getPrompt(ctx context.Context, req mcp.Request) (mcp.Result, error) {
	params, _ := req.GetParams().(*mcp.GetPromptParams)
	input := map[string]any{"name": "", "arguments": map[string]string{}}
	if params != nil {
		input["name"] = params.Name
		if params.Arguments != nil {
			input["arguments"] = params.Arguments
		}
	}
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int64  `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if _, err := s.bundle.call(ctx, "mcpPrompt", input, &out); err != nil {
		return nil, err
	}
	if out.Error != nil {
		return nil, &jsonrpc.Error{Code: out.Error.Code, Message: out.Error.Message}
	}
	return completeResult(req, out.Result)
}

// rawClientName is the envelope's clientInfo.name, else initialize's.
func rawClientName(req *mcp.CallToolRequest) *string {
	if req.Params != nil {
		if info, ok := req.Params.GetMeta()[mcp.MetaKeyClientInfo].(map[string]any); ok {
			if name, ok := info["name"].(string); ok {
				return &name
			}
			return nil
		}
	}
	if req.Session != nil {
		if init := req.Session.InitializeParams(); init != nil && init.ClientInfo != nil {
			name := init.ClientInfo.Name
			return &name
		}
	}
	return nil
}

// clientCapabilities is the envelope's clientCapabilities, else
// initialize's, as JSON; null when there are none.
func clientCapabilities(req *mcp.CallToolRequest) json.RawMessage {
	if req.Params != nil {
		if declared, ok := req.Params.GetMeta()[mcp.MetaKeyClientCapabilities]; ok {
			written, _ := marshal(declared)
			return written
		}
	}
	if req.Session != nil {
		if init := req.Session.InitializeParams(); init != nil && init.Capabilities != nil {
			written, _ := marshal(init.Capabilities)
			return written
		}
	}
	return json.RawMessage("null")
}

func (s *Server) callTool(ctx context.Context, req mcp.Request, who identity, asks *atomic.Int64) (mcp.Result, error) {
	call, ok := req.(*mcp.CallToolRequest)
	if !ok || call.Params == nil {
		return nil, &jsonrpc.Error{Code: jsonrpc.CodeInvalidParams, Message: "Invalid params"}
	}
	// A stdio call waits for the calls read before it on its handle.
	if token, ok := call.Params.GetMeta()[turnKey].(string); ok {
		if turn := s.turns.claim(token); turn != nil {
			turn.wait()
			defer turn.release()
		}
	}
	caller, err := s.actorFor(ctx, who.principal, rawClientName(call))
	if err != nil {
		return nil, err
	}
	caller.scopes = who.scopes
	approval := map[string]any{"capabilities": clientCapabilities(call), "clientName": caller.clientName}
	if replies, sent := call.Params.GetMeta()[rawResponsesKey]; sent {
		raw, _ := marshal(replies)
		approval["replies"] = acceptedReplies(raw)
	}
	modern := isModern(req)
	for round := 0; ; round++ {
		result, err := s.dispatch(ctx, &toolCall{name: call.Params.Name, arguments: call.Params.Arguments, caller: caller, approval: approval})
		if err != nil {
			if unknown, ok := err.(*errUnknownToolName); ok {
				return nil, &jsonrpc.Error{Code: jsonrpc.CodeInvalidParams, Message: unknown.message}
			}
			return nil, err
		}
		if result.ask == nil {
			return toolResult(req, result.answer)
		}
		question := map[string]any{"message": result.ask.Message, "requestedSchema": result.ask.RequestedSchema, "mode": "form"}
		if modern {
			// Nothing was applied; the client asks its person and calls again.
			inputRequests, _ := marshal(map[string]any{result.ask.Key: map[string]any{"method": "elicitation/create", "params": question}})
			return &rawResult{members: map[string]json.RawMessage{"resultType": quoted("input_required"), "inputRequests": inputRequests}}, nil
		}
		if round >= maxAsks {
			return nil, fmt.Errorf("blok-mcp: the approval was asked %d times in one call", maxAsks)
		}
		// A 2025 client answers elicitation/create inside the call.
		answer, elicitErr := call.Session.Elicit(ctx, &mcp.ElicitParams{
			Meta:            mcp.Meta{"progressToken": asks.Add(1) - 1},
			Mode:            "form",
			Message:         result.ask.Message,
			RequestedSchema: result.ask.RequestedSchema,
		})
		if elicitErr != nil {
			text, _ := marshal([]map[string]string{{"type": "text", "text": elicitErr.Error()}})
			return &rawResult{members: map[string]json.RawMessage{"content": text, "isError": json.RawMessage("true")}}, nil
		}
		reply, _ := marshal(answer)
		approval["replies"] = map[string]json.RawMessage{result.ask.Key: reply}
	}
}

// toolResult is Node's tools/call answer: the text content is
// JSON.stringify(structuredContent).
func toolResult(req mcp.Request, answer json.RawMessage) (*rawResult, error) {
	var parts struct {
		StructuredContent json.RawMessage `json:"structuredContent"`
		IsError           bool            `json:"isError"`
	}
	if err := json.Unmarshal(answer, &parts); err != nil {
		return nil, err
	}
	content, _ := marshal([]map[string]string{{"type": "text", "text": string(parts.StructuredContent)}})
	isError, _ := marshal(parts.IsError)
	members := map[string]json.RawMessage{"content": content, "structuredContent": parts.StructuredContent, "isError": isError}
	if isModern(req) {
		members["resultType"] = quoted("complete")
	}
	return &rawResult{members: members}, nil
}
