package convert

import (
	"context"
	"errors"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// MigrationReadTimeout is the one-time budget a seed and a migration read
// HTML with: they may read a field far larger than any edit sends.
const MigrationReadTimeout = 60 * time.Second

// TransientError is C#'s CollabTransientException: a failure a retry may heal.
type TransientError struct {
	Message string
	Err     error
}

func (e *TransientError) Error() string { return e.Message }
func (e *TransientError) Unwrap() error { return e.Err }

// DocConverter is the room's adapter to the converter (C# CollabDocConverter):
// it reads rich text HTML through the runtime around the synchronous walks.
type DocConverter struct {
	Now    func() time.Time
	HTML   HTMLReader
	Fields *RichTextFields // nil is the built-ins
	Log    func(string)
}

func (c *DocConverter) fields() *RichTextFields {
	if c.Fields == nil {
		return BuiltInRichTextFields()
	}
	return c.Fields
}

// Seed writes an OutputData object's blocks, title and icon into doc.
func (c *DocConverter) Seed(ctx context.Context, doc *yjs.Doc, outputData *jsjson.Node) error {
	if outputData.Kind != jsjson.KindObject {
		return dataError("collab: the document is not a JSON object.")
	}
	blocks, err := member(outputData, "blocks")
	if err != nil {
		return errors.Join(ErrNotUnicode, err)
	}
	if blocks == nil || blocks.Kind != jsjson.KindArray {
		return dataError("collab: the document has no blocks array.")
	}
	found, err := CollectSeedHTML(blocks.Items, c.fields())
	if err != nil {
		return err
	}
	read, err := c.read(ctx, found, MigrationReadTimeout)
	if err != nil {
		return err
	}
	page := &jsjson.Object{}
	for _, key := range []string{"title", "icon"} {
		node, err := member(outputData, key)
		if err != nil {
			return errors.Join(ErrNotUnicode, err)
		}
		var v any
		if node != nil {
			if v, err = strictValue(node); err != nil {
				return err
			}
		}
		put(page, key, v)
	}
	return Seed(doc, blocks.Items, Converting(c.fields(), read), page)
}

// Export is {time, blocks, title?, icon?}, the legacy HTML slots read to segments.
func (c *DocConverter) Export(ctx context.Context, doc *yjs.Doc) (*jsjson.Object, error) {
	now := c.Now().UnixMilli()
	blocks, slots, err := Export(doc, c.fields(), c.Log)
	if err != nil {
		return nil, err
	}
	// Read with the blocks, before any wait, so both come from one state.
	page := ExportPage(doc)
	if err := c.Resolve(ctx, slots); err != nil {
		return nil, err
	}
	output := &jsjson.Object{}
	put(output, "time", now)
	put(output, "blocks", blocks)
	for _, m := range page.Members() {
		output.Set(m.Key, m.Value)
	}
	return output, nil
}

// ExportBlocks exports with each distinct warning logged once per warned set.
func (c *DocConverter) ExportBlocks(doc *yjs.Doc, warned map[string]bool) ([]any, []RichTextHTMLSlot, error) {
	var warn func(string)
	if c.Log != nil {
		warn = func(message string) {
			if !warned[message] {
				warned[message] = true
				c.Log(message)
			}
		}
	}
	return Export(doc, c.fields(), warn)
}

// Resolve reads each slot's HTML and writes the segments into it.
func (c *DocConverter) Resolve(ctx context.Context, slots []RichTextHTMLSlot) error {
	if len(slots) == 0 {
		return nil
	}
	found := make([]RichTextHTML, len(slots))
	for i, slot := range slots {
		found[i] = slot.HTML
	}
	read, err := c.read(ctx, found, 0)
	if err != nil {
		// A JavaScript error or a malformed answer repeats on every attempt
		// and keeps the refusal path, or a journal room would retry forever.
		if IsTransient(ctx, err) {
			return &TransientError{"collab: the rich text HTML in this document could not be read: " + err.Error(), err}
		}
		return err
	}
	for _, slot := range slots {
		slot.Target.Set(slot.Key, read[HTMLKey(slot.HTML.HTML)])
	}
	return nil
}

// IsTransient: the runtime's timeout or memory budget, or a wait cancelled by
// someone other than the caller.
func IsTransient(ctx context.Context, err error) bool {
	var failure *jsruntime.Failure
	if errors.As(err, &failure) {
		return failure.Kind == jsruntime.KindTimedOut || failure.Kind == jsruntime.KindDocumentTooLarge
	}
	return (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) && ctx.Err() == nil
}

// IsTooLarge is the runtime's memory budget, which a retry of the same body
// cannot heal.
func IsTooLarge(err error) bool {
	var failure *jsruntime.Failure
	return errors.As(err, &failure) && failure.Kind == jsruntime.KindDocumentTooLarge
}

// read is each distinct non-empty HTML string's segments; "" is an empty text.
func (c *DocConverter) read(ctx context.Context, found []RichTextHTML, timeout time.Duration) (map[string][]any, error) {
	var distinct []RichTextHTML
	seen := map[string]bool{}
	for _, field := range found {
		if len(field.HTML) > 0 && !seen[HTMLKey(field.HTML)] {
			seen[HTMLKey(field.HTML)] = true
			distinct = append(distinct, field)
		}
	}
	read := map[string][]any{HTMLKey(nil): {}}
	if len(distinct) == 0 {
		return read, nil
	}
	segments, err := c.HTML.Read(ctx, distinct, timeout)
	if err != nil {
		return nil, err
	}
	for i, field := range distinct {
		read[HTMLKey(field.HTML)] = segments[i]
	}
	return read, nil
}
