package blokmcp

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
)

const protocolVersionMetaKey = "io.modelcontextprotocol/protocolVersion"

// nodeMethods are the requests Node's server answers; any other gets
// -32601. The Go SDK refuses an unknown name with a 400 instead.
var nodeMethods = map[string]bool{"initialize": true, "ping": true, "tools/list": true, "tools/call": true, "prompts/list": true, "prompts/get": true, "server/discover": true}

// rpcError is Node's createJsonErrorResponse: a JSON-RPC error answer.
func rpcError(status int, code int64, message string, id json.RawMessage) *recorder {
	if id == nil {
		id = json.RawMessage("null")
	}
	written, _ := marshal(map[string]any{"jsonrpc": "2.0", "error": map[string]any{"code": code, "message": message}, "id": id})
	answer := &recorder{header: http.Header{}, status: status}
	answer.header.Set("Content-Type", "application/json")
	answer.body.Write(written)
	return answer
}

// isJSONContentType is Node's isJsonContentType: the media type, without
// parameters, is application/json.
func isJSONContentType(header string) bool {
	essence, _, _ := strings.Cut(header, ";")
	return strings.EqualFold(strings.Trim(essence, " \t"), "application/json")
}

// acceptsBoth is Node's Accept test: a substring check for both types.
func acceptsBoth(r *http.Request) bool {
	accept := strings.Join(r.Header.Values("Accept"), ", ")
	return strings.Contains(accept, "application/json") && strings.Contains(accept, "text/event-stream")
}

// hasEnvelopeClaim says whether a message's params._meta names a protocol
// version: such a request follows the 2026 per-request protocol.
func hasEnvelopeClaim(message json.RawMessage) bool {
	members, _ := isRecordJSON(message)
	params, _ := isRecordJSON(members["params"])
	meta, _ := isRecordJSON(params["_meta"])
	_, ok := meta[protocolVersionMetaKey]
	return ok
}

// echoID is Node's echoableRequestId: the id of a body naming a string
// method, when it is a string or a number, written as JavaScript does.
func echoID(body []byte) json.RawMessage {
	members, ok := isRecordJSON(body)
	if !ok || !isStringJSON(members["method"]) {
		return nil
	}
	id := members["id"]
	if isStringJSON(id) {
		return id
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(string(id)), 64)
	if err != nil || math.IsInf(value, 0) {
		return nil
	}
	return json.RawMessage(jsNumber(value))
}

// jsNumber is JavaScript's Number toString for a finite number.
func jsNumber(value float64) string {
	if value == 0 {
		return "0"
	}
	if abs := math.Abs(value); abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	text := strconv.FormatFloat(value, 'e', -1, 64)
	mantissa, exponent, _ := strings.Cut(text, "e")
	sign := exponent[:1]
	exponent = strings.TrimLeft(exponent[1:], "0")
	return mantissa + "e" + sign + exponent
}

// nodeGate is what Node's createMcpHandler and its legacy transport answer
// before any handler, in their order; nil passes the request on. batch
// says the body is a legacy batch.
func nodeGate(r *http.Request, body []byte) (answer *recorder, batch bool) {
	header, hasVersion := r.Header["Mcp-Protocol-Version"]
	version := ""
	if hasVersion {
		version = strings.Trim(strings.Join(header, ", "), " \t")
	}
	modernHeader := hasVersion && version >= modernVersion
	if !json.Valid(body) {
		if !acceptsBoth(r) {
			return rpcError(http.StatusNotAcceptable, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream", nil), false
		}
		return rpcError(http.StatusBadRequest, -32700, "Parse error: Invalid JSON", nil), false
	}
	var messages []json.RawMessage
	if isArrayJSON(body) {
		if json.Unmarshal(body, &messages) != nil || len(messages) == 0 {
			return rpcError(http.StatusBadRequest, -32600, "Bad Request: empty JSON-RPC batch", nil), false
		}
		for _, message := range messages {
			if hasEnvelopeClaim(message) {
				return rpcError(http.StatusBadRequest, -32600, "Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later", nil), false
			}
			if !nodeMessage(message) {
				return rpcError(http.StatusBadRequest, -32600, "Bad Request: JSON-RPC batch contains an invalid message", nil), false
			}
		}
		batch = true
	} else {
		if !nodeMessage(body) {
			return rpcError(http.StatusBadRequest, -32600, notAMessage, echoID(body)), false
		}
		// 2026 requests keep their own rules (see recorder.send).
		if hasEnvelopeClaim(body) || modernHeader {
			return nil, false
		}
		messages = []json.RawMessage{body}
	}
	if !acceptsBoth(r) {
		return rpcError(http.StatusNotAcceptable, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream", nil), false
	}
	initialize := false
	for _, message := range messages {
		members, _ := isRecordJSON(message)
		initialize = initialize || isExactString(members["method"], "initialize")
	}
	if hasVersion && !initialize && !contains(legacyVersions, version) {
		return rpcError(http.StatusBadRequest, -32000, "Bad Request: Unsupported protocol version: "+version+" (supported versions: "+strings.Join(legacyVersions, ", ")+")", nil), false
	}
	if batch {
		return nil, true
	}
	members, _ := isRecordJSON(body)
	var method string
	if _, isCall := members["id"]; json.Unmarshal(members["method"], &method) == nil && isStringJSON(members["method"]) {
		if !isCall {
			// Node takes any notification with an empty 202.
			return &recorder{header: http.Header{}, status: http.StatusAccepted}, false
		}
		if !nodeMethods[method] {
			written := `{"jsonrpc":"2.0","id":` + string(members["id"]) + `,"error":{"code":-32601,"message":"Method not found"}}`
			answer := &recorder{header: http.Header{}, status: http.StatusOK}
			answer.header.Set("Content-Type", "text/event-stream")
			answer.body.WriteString("event: message\ndata: ")
			answer.body.WriteString(written)
			answer.body.WriteString("\n\n")
			return answer, false
		}
	}
	return nil, false
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// withoutBOM drops a leading UTF-8 byte order mark, as Request.text() does.
func withoutBOM(body []byte) []byte {
	return bytes.TrimPrefix(body, []byte("\xef\xbb\xbf"))
}
