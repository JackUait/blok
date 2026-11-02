package convert

import "github.com/JackUait/blok/packages/server/go/internal/jsjson"

// RichTextInput is what the seed and edit paths do with a rich field's HTML
// (C# RichTextInput.cs). HTML needs the runtime, which the converter never
// calls, so the caller walks twice: once Collecting to learn the HTML, then
// Converting with the answers. Unanswered HTML is refused, so a path that
// skipped the conversion fails instead of storing HTML as text.
type RichTextInput struct {
	Fields    *RichTextFields
	converted map[string][]any
	collect   bool
	found     []RichTextHTML
	seen      map[string]bool
}

// Refusing refuses every non-empty HTML string.
func Refusing(fields *RichTextFields) *RichTextInput { return &RichTextInput{Fields: fields} }

// Collecting records each HTML string once and reads it as empty.
func Collecting(fields *RichTextFields) *RichTextInput {
	return &RichTextInput{Fields: fields, collect: true, seen: map[string]bool{}}
}

// Converting answers each HTML string with the segments read from it,
// keyed by the exact string.
func Converting(fields *RichTextFields, converted map[string][]any) *RichTextInput {
	return &RichTextInput{Fields: fields, converted: converted}
}

// HTMLKey is the key Converting looks an HTML string up by.
func HTMLKey(html jsjson.Str) string { return unitKey(html) }

// Found is the HTML met so far, each string once, in the order met.
func (in *RichTextInput) Found() []RichTextHTML { return in.found }

// Segments for one HTML string, still to be screened and canonicalised. An
// empty string is an empty text and needs no runtime.
func (in *RichTextInput) Segments(kind, field string, html jsjson.Str) ([]any, error) {
	if len(html) == 0 {
		return []any{}, nil
	}
	if in.converted != nil {
		if segments, ok := in.converted[unitKey(html)]; ok {
			return segments, nil
		}
	}
	if in.collect {
		if !in.seen[unitKey(html)] {
			in.seen[unitKey(html)] = true
			in.found = append(in.found, RichTextHTML{kind, field, html})
		}
		return []any{}, nil
	}
	return nil, dataError("collab: rich text field \"%s.%s\" holds HTML that was not converted to segments.", kind, field)
}
