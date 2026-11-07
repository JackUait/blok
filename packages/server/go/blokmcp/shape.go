package blokmcp

import (
	"encoding/json"
	"net/http"
	"strings"
)

// notAMessage is Node's SDK's answer to a message it cannot read.
const notAMessage = "Bad Request: the request body is not a valid JSON-RPC message"

// isMessage is false for a message whose params, or params._meta, is not
// an object: Node's SDK drops it (no answer on stdio, 400 over HTTP).
// Keys are exact, as JSON.parse reads them.
func isMessage(members map[string]json.RawMessage) bool {
	raw, has := members["params"]
	if !has {
		return true
	}
	params, ok := isRecordJSON(raw)
	if !ok {
		return false
	}
	meta, has := params["_meta"]
	if !has {
		return true
	}
	_, ok = isRecordJSON(meta)
	return ok
}

type zodIssue struct {
	Expected string   `json:"expected"`
	Code     string   `json:"code"`
	Path     []string `json:"path"`
	Message  string   `json:"message"`
}

// toolsCallRefusal is the -32602 message Node's SDK gives a tools/call with
// no params, or a bad name or arguments; "" when it passes.
func toolsCallRefusal(params json.RawMessage) string {
	var issues []zodIssue
	issue := func(expected, received string, path ...string) {
		issues = append(issues, zodIssue{expected, "invalid_type", append([]string{"params"}, path...),
			"Invalid input: expected " + expected + ", received " + received})
	}
	call, ok := isRecordJSON(params)
	switch {
	case len(params) == 0:
		issue("object", "undefined")
	case !ok:
		issue("object", zodType(params))
	default:
		if name, has := call["name"]; !has {
			issue("string", "undefined", "name")
		} else if !isStringJSON(name) {
			issue("string", zodType(name), "name")
		}
		if arguments, has := call["arguments"]; has {
			if _, isObject := isRecordJSON(arguments); !isObject {
				issue("record", zodType(arguments), "arguments")
			}
		}
	}
	if len(issues) == 0 {
		return ""
	}
	written, _ := json.MarshalIndent(issues, "", "  ")
	return "Invalid tools/call request: " + string(written)
}

// zodType is zod's name for a JSON value's type.
func zodType(raw json.RawMessage) string {
	switch text := strings.TrimSpace(string(raw)); {
	case text == "null":
		return "null"
	case strings.HasPrefix(text, "{"):
		return "object"
	case strings.HasPrefix(text, "["):
		return "array"
	case strings.HasPrefix(text, `"`):
		return "string"
	case text == "true" || text == "false":
		return "boolean"
	}
	return "number"
}

// refusedBody is Node's SDK's answer to a single message it refuses before
// any handler (see isMessage, toolsCallRefusal); nil when it passes.
func refusedBody(body []byte) *recorder {
	members, ok := isRecordJSON(body)
	if !ok {
		return nil
	}
	id, hasID := members["id"]
	if !hasID {
		id = json.RawMessage("null")
	}
	answer := &recorder{header: http.Header{}}
	if !isMessage(members) {
		written, _ := marshal(map[string]any{"jsonrpc": "2.0", "error": map[string]any{"code": -32600, "message": notAMessage}, "id": id})
		answer.header.Set("Content-Type", "application/json")
		answer.status = http.StatusBadRequest
		answer.body.Write(written)
		return answer
	}
	var method string
	if !hasID || json.Unmarshal(members["method"], &method) != nil || method != "tools/call" {
		return nil
	}
	refusal := toolsCallRefusal(members["params"])
	if refusal == "" {
		return nil
	}
	written, _ := marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32602, "message": refusal}})
	answer.header.Set("Content-Type", "text/event-stream")
	answer.status = http.StatusOK
	answer.body.WriteString("event: message\ndata: ")
	answer.body.Write(written)
	answer.body.WriteString("\n\n")
	return answer
}
