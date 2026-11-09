// Package convert turns Blok documents into Yjs docs and back, and plans and
// applies edits (C# YDocConverter.cs, CollabEditOps.cs, RichText*.cs,
// TextDiff.cs).
package convert

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// EditError is a refused edit request (C# CollabEditException): a 422 whose
// body is the message, or a 413 when Err is the runtime's memory budget
// (IsTooLarge).
type EditError struct {
	Message string
	Err     error
}

func (e *EditError) Error() string { return e.Message }
func (e *EditError) Unwrap() error { return e.Err }

// EditOp is one block-level operation. Only Insert, Update and Remove come
// from POST /edit; the rest are built by restore and the agent.
type EditOp interface{ editOp() }

// Insert places Block after After (nil = first) under Parent (nil = the root).
type Insert struct {
	ID     string
	Block  *jsjson.Node
	After  *string
	Parent *string
}

// Update replaces the block's data map wholesale.
type Update struct {
	ID   string
	Data *jsjson.Node
}

// Remove removes the block and everything under it.
type Remove struct{ ID string }

// PatchMaps sets or deletes keys of the page and values maps. Restore only.
type PatchMaps struct{ Patches []MapPatch }

// MapPatch is one key of a root map: set to Value, or deleted when Remove.
type MapPatch struct {
	Map, Key string
	Value    any
	Remove   bool
}

// SetPageField writes the page title or icon; nil or "" deletes it. Agent only.
type SetPageField struct {
	Key   string
	Value *jsjson.Node
}

// Move places an existing block, keeping its map. Agent only.
type Move struct {
	ID     string
	After  *string
	Parent *string
}

// Lift moves the block's children into its slot, right after it. Agent only.
type Lift struct{ ID string }

// Retype sets the type and replaces the data. Agent only.
type Retype struct {
	ID, Type string
	Data     *jsjson.Node
}

// SetTunes writes each named tune; a null deletes it. Agent only.
type SetTunes struct {
	ID    string
	Tunes *jsjson.Node
}

// SetMetadata writes lastEditedAt, lastEditedBy and lastEditedWith. Agent only.
type SetMetadata struct {
	ID             string
	LastEditedAt   float64
	LastEditedBy   string
	LastEditedWith *string
}

func (Insert) editOp()       {}
func (Update) editOp()       {}
func (Remove) editOp()       {}
func (PatchMaps) editOp()    {}
func (SetPageField) editOp() {}
func (Move) editOp()         {}
func (Lift) editOp()         {}
func (Retype) editOp()       {}
func (SetTunes) editOp()     {}
func (SetMetadata) editOp()  {}

// JSONMaxDepth is YDocConverter.JsonMaxDepth, the reader bound for edits and the doc endpoint.
const JSONMaxDepth = 512

var errNotUnicode = &EditError{Message: "collab: the request body holds text that is not valid Unicode."}

// ParseEditOps reads POST /edit: {"ops":[…]} with at least one op, each a
// closed schema, and no NUL in any string of any op.
func ParseEditOps(body []byte) ([]EditOp, error) {
	root, err := jsjson.ParseNode(body, jsjson.Options{MaxDepth: JSONMaxDepth, RefuseDuplicates: true})
	if err != nil {
		return nil, refusal(err, "collab: the request body is not valid JSON.")
	}
	ops, err := parseOps(root)
	if err != nil {
		return nil, refusal(err, "")
	}
	return ops, nil
}

// refusal maps a reader error the way C# maps its exceptions: a string .NET
// cannot read (InvalidOperationException) is a Unicode refusal, other reader
// errors (JsonException) the given message.
func refusal(err error, invalidJSON string) error {
	var edit *EditError
	switch {
	case errors.As(err, &edit):
		return err
	case errors.Is(err, jsjson.ErrLoneSurrogate) || errors.Is(err, jsjson.ErrInvalidUTF8):
		return errNotUnicode
	case invalidJSON != "":
		return &EditError{Message: invalidJSON}
	}
	return err
}

func parseOps(root *jsjson.Node) ([]EditOp, error) {
	requested, err := member(root, "ops")
	if err != nil {
		return nil, err
	}
	if root.Kind != jsjson.KindObject || requested == nil || requested.Kind != jsjson.KindArray || len(requested.Items) == 0 {
		return nil, &EditError{Message: `collab: the request body must be an object with a non-empty "ops" array.`}
	}
	ops := make([]EditOp, 0, len(requested.Items))
	for index, item := range requested.Items {
		op, err := parseOp(item, index)
		if err != nil {
			return nil, err
		}
		ops = append(ops, op)
	}
	return ops, nil
}

// member looks up a key the way a JsonObject does: its first read decodes
// every key of the object, so any bad key fails it.
func member(object *jsjson.Node, key string) (*jsjson.Node, error) {
	if object.Kind != jsjson.KindObject {
		return nil, nil
	}
	want := jsjson.FromString(key)
	var found *jsjson.Node
	for _, m := range object.Members {
		name, err := m.Key()
		if err != nil {
			return nil, err
		}
		if found == nil && slices.Equal(name, want) {
			found = m.Value
		}
	}
	return found, nil
}

func parseOp(node *jsjson.Node, index int) (EditOp, error) {
	if node.Kind != jsjson.KindObject {
		return nil, refused(index, "an op must be a JSON object")
	}
	if err := guardNoNul(node, index); err != nil {
		return nil, err
	}
	kind, err := requiredString(node, "op", index)
	if err != nil {
		return nil, err
	}
	switch kind {
	case "insert":
		if err := allowedMembers(node, index, "op", "id", "block", "after", "parent"); err != nil {
			return nil, err
		}
		id, err := requiredString(node, "id", index)
		if err != nil {
			return nil, err
		}
		block, err := insertBlock(node, index)
		if err != nil {
			return nil, err
		}
		after, err := optionalString(node, "after", index)
		if err != nil {
			return nil, err
		}
		parent, err := optionalString(node, "parent", index)
		if err != nil {
			return nil, err
		}
		return Insert{ID: id, Block: block, After: after, Parent: parent}, nil
	case "update":
		if err := allowedMembers(node, index, "op", "id", "data"); err != nil {
			return nil, err
		}
		id, err := requiredString(node, "id", index)
		if err != nil {
			return nil, err
		}
		data, err := requiredObject(node, "data", index)
		if err != nil {
			return nil, err
		}
		return Update{ID: id, Data: data}, nil
	case "remove":
		if err := allowedMembers(node, index, "op", "id"); err != nil {
			return nil, err
		}
		id, err := requiredString(node, "id", index)
		if err != nil {
			return nil, err
		}
		return Remove{ID: id}, nil
	}
	return nil, refused(index, `"op" must be "insert", "update" or "remove"`)
}

// insertBlock is everything the converter writes for a block except its
// place in the tree, which the op owns.
func insertBlock(op *jsjson.Node, index int) (*jsjson.Node, error) {
	id, err := requiredString(op, "id", index)
	if err != nil {
		return nil, err
	}
	block, err := requiredObject(op, "block", index)
	if err != nil {
		return nil, err
	}
	if err := allowedMembers(block, index, "id", "type", "data", "tunes", "lastEditedAt", "lastEditedBy",
		"lastEditedWith", "createdAt", "createdBy", "createdWith"); err != nil {
		return nil, err
	}
	if has(block, "id") {
		blockID, err := requiredString(block, "id", index)
		if err != nil {
			return nil, err
		}
		if blockID != id {
			return nil, refused(index, `the block's "id" disagrees with the op's`)
		}
	}
	if _, err := requiredString(block, "type", index); err != nil {
		return nil, err
	}
	if _, err := requiredObject(block, "data", index); err != nil {
		return nil, err
	}
	if has(block, "tunes") {
		if _, err := requiredObject(block, "tunes", index); err != nil {
			return nil, err
		}
	}
	// A null time passes: C# tests "is { }" before the kind.
	for _, key := range []string{"lastEditedAt", "createdAt"} {
		if value, _ := member(block, key); value != nil && value.Kind != jsjson.KindNull && value.Kind != jsjson.KindNumber {
			return nil, refused(index, fmt.Sprintf(`the block's "%s" must be a number`, key))
		}
	}
	for _, key := range []string{"lastEditedBy", "createdBy", "createdWith", "lastEditedWith"} {
		if has(block, key) {
			if _, err := requiredString(block, key, index); err != nil {
				return nil, err
			}
		}
	}
	return block, nil
}

// has is JsonObject.ContainsKey. Keys were decoded by the NUL guard already.
func has(object *jsjson.Node, key string) bool {
	value, _ := member(object, key)
	return value != nil
}

func allowedMembers(object *jsjson.Node, index int, allowed ...string) error {
	for _, m := range object.Members {
		name, err := m.Key()
		if err != nil {
			return err
		}
		if !slices.Contains(allowed, name.String()) {
			return refused(index, fmt.Sprintf(`"%s" is not part of this op`, name.String()))
		}
	}
	return nil
}

func requiredString(object *jsjson.Node, key string, index int) (string, error) {
	value, err := member(object, key)
	if err != nil {
		return "", err
	}
	if value != nil && value.Kind == jsjson.KindString {
		text, err := value.Text()
		if err != nil {
			return "", err
		}
		if len(text) > 0 {
			return text.String(), nil
		}
	}
	return "", refused(index, fmt.Sprintf(`"%s" must be a non-empty string`, key))
}

// optionalString: absent and null both mean "not given".
func optionalString(object *jsjson.Node, key string, index int) (*string, error) {
	value, err := member(object, key)
	if err != nil || value == nil || value.Kind == jsjson.KindNull {
		return nil, err
	}
	text, err := requiredString(object, key, index)
	if err != nil {
		return nil, err
	}
	return &text, nil
}

func requiredObject(object *jsjson.Node, key string, index int) (*jsjson.Node, error) {
	value, err := member(object, key)
	if err != nil {
		return nil, err
	}
	if value == nil || value.Kind != jsjson.KindObject {
		return nil, refused(index, fmt.Sprintf(`"%s" must be a JSON object`, key))
	}
	return value, nil
}

// guardNoNul walks every key and string in document order; the reader's
// depth bound keeps the recursion short.
func guardNoNul(node *jsjson.Node, index int) error {
	switch node.Kind {
	case jsjson.KindObject:
		// C# enumerates a JsonObject, which decodes all its keys first.
		for _, m := range node.Members {
			if _, err := m.Key(); err != nil {
				return err
			}
		}
		for _, m := range node.Members {
			name, _ := m.Key()
			if slices.Contains(name, 0) {
				return nulRefused(index)
			}
			if err := guardNoNul(m.Value, index); err != nil {
				return err
			}
		}
	case jsjson.KindArray:
		for _, item := range node.Items {
			if err := guardNoNul(item, index); err != nil {
				return err
			}
		}
	case jsjson.KindString:
		text, err := node.Text()
		if err != nil {
			return err
		}
		if slices.Contains(text, 0) {
			return nulRefused(index)
		}
	}
	return nil
}

func nulRefused(index int) error {
	return refused(index, "a string contains a NUL character, which this endpoint does not accept")
}

func refused(index int, reason string) error {
	return &EditError{Message: fmt.Sprintf("collab: op %d: %s.", index, reason)}
}

// NormalizeIdempotencyKey maps a printable key of 1–128 chars to a 32-hex op id.
func NormalizeIdempotencyKey(key string) (string, bool) {
	if len(key) < 1 || len(key) > 128 {
		return "", false
	}
	for i := 0; i < len(key); i++ {
		if key[i] < ' ' || key[i] > '~' {
			return "", false
		}
	}
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:16]), true
}

// RestoreDigest is the restore key's digest: the request line, never the plan.
func RestoreDigest(lineage string, sequence uint64) []byte {
	return RestoreDigestKeeping(lineage, sequence, false)
}

// RestoreDigestKeeping: with keepDatabases the line ends in \nkeep, so a key
// reused across the two kinds of restore is a different edit. Without it
// the digest is the one restores always had.
func RestoreDigestKeeping(lineage string, sequence uint64, keepDatabases bool) []byte {
	line := "restore\n" + lineage + "\n" + strconv.FormatUint(sequence, 10)
	if keepDatabases {
		line += "\nkeep"
	}
	sum := sha256.Sum256([]byte(line))
	return sum[:]
}

// CanonicalBodyDigest is the SHA-256 of CanonicalBody.
func CanonicalBodyDigest(ops []EditOp) ([]byte, error) {
	body, err := CanonicalBody(ops)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	return sum[:], nil
}

// CanonicalBody is stable JSON for parsed ops, independent of whitespace and
// key order, written the way Utf8JsonWriter writes it (the digest is stored in
// the journal, so one byte of difference turns a retry into a 409).
func CanonicalBody(ops []EditOp) ([]byte, error) {
	out := []byte(`{"ops":[`)
	for i, op := range ops {
		if i > 0 {
			out = append(out, ',')
		}
		var err error
		if out, err = appendCanonicalOp(out, op); err != nil {
			return nil, err
		}
	}
	return append(out, "]}"...), nil
}

type canonicalWriter struct {
	out   []byte
	first bool
	err   error
}

func (w *canonicalWriter) name(key string) {
	if !w.first {
		w.out = append(w.out, ',')
	}
	w.first = false
	w.out = jsjson.AppendQuoted(w.out, jsjson.FromString(key))
	w.out = append(w.out, ':')
}

func (w *canonicalWriter) text(key string, value *string) {
	w.name(key)
	if value == nil {
		w.out = append(w.out, "null"...)
		return
	}
	w.out = jsjson.AppendQuoted(w.out, jsjson.FromString(*value))
}

func (w *canonicalWriter) str(key, value string) { w.text(key, &value) }

func (w *canonicalWriter) node(key string, value *jsjson.Node) {
	w.name(key)
	if value == nil {
		w.out = append(w.out, "null"...)
		return
	}
	if w.err == nil {
		w.out, w.err = value.AppendCanonical(w.out)
	}
}

func appendCanonicalOp(out []byte, op EditOp) ([]byte, error) {
	w := &canonicalWriter{out: append(out, '{'), first: true}
	switch op := op.(type) {
	case Insert:
		w.text("after", op.After)
		w.node("block", op.Block)
		w.str("id", op.ID)
		w.str("op", "insert")
		w.text("parent", op.Parent)
	case Update:
		w.node("data", op.Data)
		w.str("id", op.ID)
		w.str("op", "update")
	case Remove:
		w.str("id", op.ID)
		w.str("op", "remove")
	case Move:
		w.text("after", op.After)
		w.str("id", op.ID)
		w.str("op", "move")
		w.text("parent", op.Parent)
	case Lift:
		w.str("id", op.ID)
		w.str("op", "lift")
	case Retype:
		w.node("data", op.Data)
		w.str("id", op.ID)
		w.str("op", "retype")
		w.str("type", op.Type)
	case SetTunes:
		w.str("id", op.ID)
		w.str("op", "setTunes")
		w.node("tunes", op.Tunes)
	case SetMetadata:
		w.str("id", op.ID)
		w.name("lastEditedAt")
		w.out = append(w.out, dotnet.FormatDouble(op.LastEditedAt)...)
		w.str("lastEditedBy", op.LastEditedBy)
		if op.LastEditedWith != nil {
			w.str("lastEditedWith", *op.LastEditedWith)
		}
		w.str("op", "setMetadata")
	case SetPageField:
		w.str("key", op.Key)
		w.str("op", "setPageField")
		w.node("value", op.Value)
	case PatchMaps:
		return nil, errors.New("collab: a map patch comes only from restore, which never digests its ops")
	default:
		return nil, fmt.Errorf("collab: unknown edit op %T", op)
	}
	if w.err != nil {
		return nil, w.err
	}
	return append(w.out, '}'), nil
}
