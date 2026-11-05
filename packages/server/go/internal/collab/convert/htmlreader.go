package convert

import (
	"context"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// MaxEditHTMLChars is the HTML one edit field may carry, in UTF-16 units
// (C# CollabDocConverter.MaxEditHtmlChars).
const MaxEditHTMLChars = 32768

// MaxCallChars is the HTML one runtime call may carry. Equal to the edit cap,
// so two capped fields never share a call; a larger field goes alone.
const MaxCallChars = MaxEditHTMLChars

// Invoker runs one runtime op; jsruntime.Pool is one. nil timeout is the
// runtime's default.
type Invoker interface {
	Invoke(ctx context.Context, op, input string, timeout *time.Duration) (string, error)
}

// HTMLReader reads HTML rich text fields as segments, in the same order.
type HTMLReader interface {
	Read(ctx context.Context, fields []RichTextHTML, timeout *time.Duration) ([][]any, error)
}

// RuntimeHTMLReader is the client's own reader, run in the embedded runtime
// through its htmlFieldsToSegments op, one call per batch.
type RuntimeHTMLReader struct{ Runtime Invoker }

func (r RuntimeHTMLReader) Read(ctx context.Context, fields []RichTextHTML, timeout *time.Duration) ([][]any, error) {
	read := make([][]any, 0, len(fields))
	for start := 0; start < len(fields); {
		end := start + 1
		chars := len(fields[start].HTML)
		for end < len(fields) && chars+len(fields[end].HTML) <= MaxCallChars {
			chars += len(fields[end].HTML)
			end++
		}
		batch, err := r.call(ctx, fields[start:end], timeout)
		if err != nil {
			return nil, err
		}
		read = append(read, batch...)
		start = end
	}
	return read, nil
}

func (r RuntimeHTMLReader) call(ctx context.Context, fields []RichTextHTML, timeout *time.Duration) ([][]any, error) {
	request := make([]any, len(fields))
	for i, field := range fields {
		entry := &jsjson.Object{}
		put(entry, "type", str(field.Type))
		put(entry, "field", str(field.Field))
		put(entry, "html", field.HTML)
		request[i] = entry
	}
	// JS JSON both ways: it carries a lone surrogate the way JS does.
	input, err := jsjson.Stringify(request)
	if err != nil {
		return nil, err
	}
	answer, err := r.Runtime.Invoke(ctx, "htmlFieldsToSegments", input, timeout)
	if err != nil {
		return nil, err
	}
	parsed, err := jsjson.Parse([]byte(answer))
	entries, ok := parsed.([]any)
	if err != nil || !ok || len(entries) != len(fields) {
		return nil, dataError("collab: the runtime answered htmlFieldsToSegments with the wrong shape.")
	}
	read := make([][]any, len(entries))
	for i, item := range entries {
		answered, ok := item.(*jsjson.Object)
		var segments []any
		if ok {
			segments, ok = lookupValue(answered, "segments").([]any)
		}
		if !ok {
			return nil, dataError("collab: the runtime answered a field without segments.")
		}
		node, err := toJSONNode(segments)
		if err != nil {
			return nil, err
		}
		read[i] = node.([]any)
	}
	return read, nil
}
