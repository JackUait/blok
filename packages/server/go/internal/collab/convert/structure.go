package convert

import (
	"bytes"
	"slices"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// PageMap is one of the PageMaps with its live top-level keys, raw: a value
// may be a shared type or jsjson.Undefined.
type PageMap struct {
	Name    string
	Entries []yjs.MapEntry
}

// ReadPageMaps is C# ReadPageMaps, in PageMaps order and key order.
func ReadPageMaps(doc *yjs.Doc) []PageMap {
	var maps []PageMap
	for _, name := range PageMaps {
		m := doc.GetMap(str(name))
		var entries []yjs.MapEntry
		for _, key := range m.Keys() {
			entries = append(entries, yjs.MapEntry{Key: key, Value: mapValue(m, key)})
		}
		maps = append(maps, PageMap{Name: name, Entries: entries})
	}
	return maps
}

// PlainPageMap is a page map as JSON for a version read.
type PlainPageMap struct {
	Name string
	Map  *jsjson.Object
}

// PlainPageMaps keeps only the plain keys a restore can copy, and no empty
// map. skip names keys left out of the page map before conversion, so a
// value that is not JSON there cannot fail the read. A value holding one
// JSON cannot (a peer's bigint or bytes) is left out too, as ExportPage
// leaves out such an icon; a restore still copies the stored value.
func PlainPageMaps(doc *yjs.Doc, skip map[string]bool) []PlainPageMap {
	var maps []PlainPageMap
	for _, m := range ReadPageMaps(doc) {
		plain := &jsjson.Object{}
		for _, e := range m.Entries {
			if m.Name == pageRoot && skip[e.Key.String()] {
				continue
			}
			if !IsPlainMapValue(e.Value) {
				continue
			}
			node, err := toJSONNode(e.Value)
			if err != nil {
				continue
			}
			plain.Set(e.Key, node)
		}
		if plain.Len() > 0 {
			maps = append(maps, PlainPageMap{m.Name, plain})
		}
	}
	return maps
}

// IsPlainMapValue is what the client writes into the page maps (plain JSON)
// and one Any value a map can hold.
func IsPlainMapValue(v any) bool {
	switch v.(type) {
	case nil, bool, float64, jsjson.Str, *jsjson.Object, []any:
		return true
	}
	return false
}

// PlainMapValuesEqual: equal plain values encode to the same bytes, keys in
// their stored order.
func PlainMapValuesEqual(left, right any) bool {
	return IsPlainMapValue(left) && IsPlainMapValue(right) && bytes.Equal(encodeAny(left), encodeAny(right))
}

func encodeAny(v any) []byte {
	w := &lib0.Writer{}
	lib0.WriteAny(w, v)
	return w.Bytes()
}

// KeyShape is one key of the blocks map. StoredParent is the raw string
// parentId of any map entry (nil for a non-map), Listed the string entries
// of its contentIds (nil when there is no array).
type KeyShape struct {
	ID           jsjson.Str
	IsBlock      bool
	StoredParent *jsjson.Str
	Listed       []jsjson.Str
}

// DocStructure is the doc's raw structure for the restore planner: every
// key as the edit planner reads it, plus which blocks the export's main
// pass reaches.
type DocStructure struct {
	Keys      []KeyShape
	RootOrder []jsjson.Str
	reached   map[string]bool
}

// Reached reports whether the export's main pass reaches id.
func (s DocStructure) Reached(id jsjson.Str) bool { return s.reached[unitKey(id)] }

// DescribeStructure is C# DescribeStructure, keys in map order.
func DescribeStructure(doc *yjs.Doc) DocStructure {
	blockMap := doc.GetMap(str(blocksRoot))
	rootOrder := doc.GetArray(str(orderRoot))
	var keys []KeyShape
	for _, id := range blockMap.Keys() {
		block, ok := mapValue(blockMap, id).(*yjs.Map)
		if !ok {
			keys = append(keys, KeyShape{ID: id})
			continue
		}
		// Raw, self-parent included: the edit planner's removal walk follows
		// it, and the restore planner predicts that walk.
		shape := KeyShape{ID: id}
		if parent, ok := mapValue(block, str("parentId")).(jsjson.Str); ok {
			shape.StoredParent = &parent
		}
		if contentIDs, ok := mapValue(block, str("contentIds")).(*yjs.Array); ok {
			shape.Listed = []jsjson.Str{}
			for _, entry := range contentIDs.Values() {
				if s, ok := entry.(jsjson.Str); ok {
					shape.Listed = append(shape.Listed, s)
				}
			}
		}
		ownID, idOK := mapValue(block, str("id")).(jsjson.Str)
		_, typed := mapValue(block, str("type")).(jsjson.Str)
		_, hasData := mapValue(block, str("data")).(*yjs.Map)
		shape.IsBlock = idOK && slices.Equal(ownID, id) && typed && hasData
		keys = append(keys, shape)
	}
	var order []jsjson.Str
	for _, entry := range rootOrder.Values() {
		if s, ok := entry.(jsjson.Str); ok {
			order = append(order, s)
		}
	}
	reached := newDocReader(blockMap, rootOrder, BuiltInRichTextFields(), nil).mainPassIDs()
	return DocStructure{Keys: keys, RootOrder: order, reached: reached}
}
