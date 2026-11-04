package convert

import (
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// RichTextFields names the data keys stored as formatted text, per block
// type: the client's built-ins plus a host's custom tools (C# RichTextFields.cs).
type RichTextFields struct {
	table map[string][]string
}

func builtInFields() map[string][]string {
	return map[string][]string{
		"paragraph": {"text"},
		"header":    {"text"},
		"quote":     {"text"},
		"toggle":    {"text"},
		"list":      {"text"},
	}
}

// BuiltInRichTextFields is the client's table alone.
func BuiltInRichTextFields() *RichTextFields {
	return &RichTextFields{table: builtInFields()}
}

// RichTextFieldEntry is one custom block type and its rich fields.
type RichTextFieldEntry struct {
	Type   string
	Fields []string
}

// NewRichTextFields adds custom fields to the built-ins; an empty or NUL
// name, or a nil list, is refused as C# refuses it at startup. The entries are
// read in order, so the first bad one is the one reported, as in C#.
func NewRichTextFields(custom []RichTextFieldEntry) (*RichTextFields, error) {
	table := builtInFields()
	for _, entry := range custom {
		kind := entry.Type
		if err := checkFieldName(kind, "block type"); err != nil {
			return nil, err
		}
		if entry.Fields == nil {
			return nil, fmt.Errorf("rich text fields: block type \"%s\" has a null field list.", kind)
		}
		if _, ok := table[kind]; !ok {
			table[kind] = []string{}
		}
		for _, field := range entry.Fields {
			if err := checkFieldName(field, fmt.Sprintf("field of \"%s\"", kind)); err != nil {
				return nil, err
			}
			if !slices.Contains(table[kind], field) {
				table[kind] = append(table[kind], field)
			}
		}
	}
	return &RichTextFields{table: table}, nil
}

func checkFieldName(name, what string) error {
	if name == "" || strings.Contains(name, "\x00") {
		return fmt.Errorf("rich text fields: a %s name is empty or holds a NUL.", what)
	}
	return nil
}

// IsRich is whether key of a block of type kind holds formatted text.
func (f *RichTextFields) IsRich(kind, key string) bool {
	return kind != "" && slices.Contains(f.table[kind], key)
}

// isRich is IsRich on the doc's own UTF-16, compared exactly as C# does: a
// lone surrogate is not its U+FFFD replacement, so it matches no field.
func (f *RichTextFields) isRich(kind, key jsjson.Str) bool {
	return !hasLoneSurrogate(kind) && !hasLoneSurrogate(key) && f.IsRich(kind.String(), key.String())
}

// Table is each type's fields in ordinal order.
func (f *RichTextFields) Table() map[string][]string {
	out := make(map[string][]string, len(f.table))
	for kind, fields := range f.table {
		sorted := slices.Clone(fields)
		// Ordinal is UTF-16 order, not Go's byte order.
		sort.Slice(sorted, func(i, j int) bool {
			return jsjson.Compare(jsjson.FromString(sorted[i]), jsjson.FromString(sorted[j])) < 0
		})
		out[kind] = sorted
	}
	return out
}
