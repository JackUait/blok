package blokmcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// lineTransport is Node's stdio framing: one message per line. A line
// Node's SDK would drop (see nodeMessage) is skipped, never an error: the
// Go SDK ends the session on a read error.
type lineTransport struct {
	in  io.ReadCloser
	out io.WriteCloser
}

func (t lineTransport) Connect(context.Context) (mcp.Connection, error) {
	c := &lineConn{in: t.in, out: t.out, lines: make(chan []byte), closed: make(chan struct{})}
	go c.readLines()
	return c, nil
}

type lineConn struct {
	in        io.ReadCloser
	out       io.WriteCloser
	writeMu   sync.Mutex
	lines     chan []byte
	readErr   error
	closed    chan struct{}
	closeOnce sync.Once
}

// readLines runs apart from Read, so Close can end a Read blocked on stdin.
func (c *lineConn) readLines() {
	defer close(c.lines)
	reader := bufio.NewReader(c.in)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			// A last line with no newline is never read, as in Node.
			c.readErr = err
			return
		}
		line = clampDepth(bytes.TrimSuffix(line[:len(line)-1], []byte("\r")), messageDepthLimit)
		if !nodeMessage(line) {
			continue
		}
		select {
		case c.lines <- line:
		case <-c.closed:
			return
		}
	}
}

func (c *lineConn) Read(ctx context.Context) (jsonrpc.Message, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-c.closed:
			return nil, io.EOF
		case line, ok := <-c.lines:
			if !ok {
				if c.readErr == nil || errors.Is(c.readErr, io.EOF) {
					return nil, io.EOF
				}
				return nil, c.readErr
			}
			message, err := jsonrpc.DecodeMessage(line)
			if err != nil {
				continue
			}
			return message, nil
		}
	}
}

func (c *lineConn) Write(ctx context.Context, message jsonrpc.Message) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	data, err := jsonrpc.EncodeMessage(message)
	if err != nil {
		return err
	}
	// The SDK's encoder escapes what JSON.stringify writes raw.
	data = rawLineSeparators(data)
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_, err = c.out.Write(append(data, '\n'))
	return err
}

func (c *lineConn) Close() error {
	var err error
	c.closeOnce.Do(func() {
		close(c.closed)
		err = errors.Join(c.in.Close(), c.out.Close())
	})
	return err
}

func (c *lineConn) SessionID() string { return "" }

// nodeMessage is Node's SDK deserializeMessage on one line: JSON.parse,
// then the strict JSONRPCMessageSchema union. Keys are exact and the last
// of a repeated key wins, as JSON.parse reads them.
func nodeMessage(line []byte) bool {
	if !json.Valid(line) {
		return false
	}
	members, ok := isRecordJSON(line)
	if !ok || !isExactString(members["jsonrpc"], "2.0") {
		return false
	}
	id, hasID := members["id"]
	if hasID && !isRequestID(id) {
		return false
	}
	_, hasMethod := members["method"]
	result, hasResult := members["result"]
	failure, hasError := members["error"]
	switch {
	case hasMethod:
		return onlyKeys(members, "jsonrpc", "id", "method", "params") && isStringJSON(members["method"]) && requestParams(members)
	case hasResult:
		if !hasID || !onlyKeys(members, "jsonrpc", "id", "result") {
			return false
		}
		fields, ok := isRecordJSON(result)
		if !ok {
			return false
		}
		meta, has := fields["_meta"]
		if !has {
			return true
		}
		_, ok = isRecordJSON(meta)
		return ok
	case hasError:
		if !onlyKeys(members, "jsonrpc", "id", "error") {
			return false
		}
		fields, ok := isRecordJSON(failure)
		return ok && isSafeInteger(fields["code"]) && isStringJSON(fields["message"])
	}
	return false
}

// requestParams is RequestSchema's params: absent, or an object whose _meta
// is absent or an object with a well-typed progressToken and related task.
func requestParams(members map[string]json.RawMessage) bool {
	if !isMessage(members) {
		return false
	}
	params, ok := isRecordJSON(members["params"])
	if !ok {
		return true
	}
	meta, ok := isRecordJSON(params["_meta"])
	if !ok {
		return true
	}
	if token, has := meta["progressToken"]; has && !isRequestID(token) {
		return false
	}
	if task, has := meta["io.modelcontextprotocol/related-task"]; has {
		fields, ok := isRecordJSON(task)
		return ok && isStringJSON(fields["taskId"])
	}
	return true
}

func onlyKeys(members map[string]json.RawMessage, keys ...string) bool {
	allowed := 0
	for _, key := range keys {
		if _, has := members[key]; has {
			allowed++
		}
	}
	return allowed == len(members)
}

func isExactString(raw json.RawMessage, want string) bool {
	var text string
	return isStringJSON(raw) && json.Unmarshal(raw, &text) == nil && text == want
}

// isRequestID is RequestIdSchema: a string or a zod int (a safe integer).
func isRequestID(raw json.RawMessage) bool {
	return isStringJSON(raw) || isSafeInteger(raw)
}

// isSafeInteger reads a number as JavaScript does and wants it integral
// within ±(2^53-1); 1e3 and -0 pass, 1.5 and 9007199254740993 do not.
func isSafeInteger(raw json.RawMessage) bool {
	text := string(bytes.TrimSpace(raw))
	if text == "" || !(text[0] == '-' || (text[0] >= '0' && text[0] <= '9')) {
		return false
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(value, 0) || value != math.Trunc(value) {
		return false
	}
	return math.Abs(value) <= 1<<53-1
}
