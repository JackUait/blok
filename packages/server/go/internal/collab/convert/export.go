package convert

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// The doc's shape (C# YDocConverter).
const (
	MaxValueDepth   = 256
	blockFieldDepth = 0
	blocksRoot      = "blocks"
	orderRoot       = "root"
	pageRoot        = "page"
	gridRowsKey     = "__rows"
	gridOrderKey    = "__rowKeys"
	maxSafeInteger  = 9007199254740992
)

// PageMaps are the top-level maps that hold page fields.
var PageMaps = []string{"page", "values"}

// DataError is C#'s InvalidDataException from the converter: data a reader
// refuses. The message is C#'s, word for word.
type DataError struct{ Message string }

func (e *DataError) Error() string { return e.Message }

func dataError(format string, args ...any) error {
	return &DataError{Message: fmt.Sprintf(format, args...)}
}

// RichTextHTML is one rich field holding HTML, as htmlFieldsToSegments takes it.
type RichTextHTML struct {
	Type, Field string
	HTML        jsjson.Str
}

// RichTextHTMLSlot is an exported rich field still holding HTML: the caller
// converts it and writes the segments into Target under Key.
type RichTextHTMLSlot struct {
	Target *jsjson.Object
	Key    jsjson.Str
	HTML   RichTextHTML
}

// Exported block JSON is JS values (nil, bool, float64, jsjson.Str,
// *jsjson.Object, []any), plus int64 for a peer's bigint, which a double
// cannot hold exactly.

func value(m *yjs.Map, key string) any {
	v, ok := m.Get(str(key))
	if !ok {
		return nil
	}
	return v
}

func isGridMap(m *yjs.Map) bool {
	_, rows := value(m, gridRowsKey).(*yjs.Map)
	_, order := value(m, gridOrderKey).(*yjs.Array)
	return rows && order
}

// gridRowKeys: first occurrence wins, keys with no row are dropped, rows
// missing from the order follow, sorted.
func gridRowKeys(grid, rows *yjs.Map) []jsjson.Str {
	seen := map[string]bool{}
	var keys []jsjson.Str
	for _, entry := range value(grid, gridOrderKey).(*yjs.Array).Values() {
		key, ok := entry.(jsjson.Str)
		if !ok || seen[unitKey(key)] {
			continue
		}
		if _, live := rows.Get(key); !live {
			continue
		}
		seen[unitKey(key)] = true
		keys = append(keys, key)
	}
	var rest []jsjson.Str
	for _, key := range rows.Keys() {
		if !seen[unitKey(key)] {
			rest = append(rest, key)
		}
	}
	slices.SortFunc(rest, jsjson.Compare)
	return append(keys, rest...)
}

// numberNode is JSON.stringify's number: NaN and the infinities become null.
func numberNode(number float64) any {
	if math.IsNaN(number) || math.IsInf(number, 0) {
		return nil
	}
	return number
}

func hasLoneSurrogate(text jsjson.Str) bool {
	for i := 0; i < len(text); i++ {
		unit := text[i]
		switch {
		case unit >= 0xd800 && unit <= 0xdbff && i+1 < len(text) && text[i+1] >= 0xdc00 && text[i+1] <= 0xdfff:
			i++
		case unit >= 0xd800 && unit <= 0xdfff:
			return true
		}
	}
	return false
}

func bigToLong(value lib0.BigInt) int64 { return int64(value) }

// unitKey is a Str as a Go map key: its UTF-16 units big-endian, so two
// distinct texts never collide and byte order is UTF-16 (ordinal) order.
func unitKey(s jsjson.Str) string {
	b := make([]byte, 0, 2*len(s))
	for _, unit := range s {
		b = append(b, byte(unit>>8), byte(unit))
	}
	return string(b)
}

func fromUnitKey(k string) jsjson.Str {
	s := make(jsjson.Str, len(k)/2)
	for i := range s {
		s[i] = uint16(k[2*i])<<8 | uint16(k[2*i+1])
	}
	return s
}

func strValue(m *yjs.Map, key string) (jsjson.Str, bool) {
	s, ok := value(m, key).(jsjson.Str)
	return s, ok
}

type blockEntry struct {
	m          *yjs.Map
	rawParent  *string
	contentIDs []any // nil when contentIds is not an array
	hasContent bool
}

// docReader is doc -> JSON, mirroring the client's DocumentStore.toJSON.
type docReader struct {
	rootOrder *yjs.Array
	fields    *RichTextFields
	warn      func(string)
	slots     []RichTextHTMLSlot
	path      []string
	allIDs    map[string]bool
	ids       []string
	entries   map[string]*blockEntry
}

func newDocReader(blockMap *yjs.Map, rootOrder *yjs.Array, fields *RichTextFields, warn func(string)) *docReader {
	r := &docReader{rootOrder: rootOrder, fields: fields, warn: warn, allIDs: map[string]bool{}, entries: map[string]*blockEntry{}}
	for _, key := range blockMap.Keys() {
		id := unitKey(key)
		r.allIDs[id] = true
		r.ids = append(r.ids, id)
		if block, ok := blockMap.Get(key); ok {
			if block, ok := block.(*yjs.Map); ok {
				r.entries[id] = readEntry(id, block)
			}
		}
	}
	return r
}

func readEntry(id string, m *yjs.Map) *blockEntry {
	entry := &blockEntry{m: m}
	// A self-parent is never a real link.
	if parent, ok := strValue(m, "parentId"); ok && unitKey(parent) != id {
		k := unitKey(parent)
		entry.rawParent = &k
	}
	if contentIDs, ok := value(m, "contentIds").(*yjs.Array); ok {
		entry.contentIDs = contentIDs.Values()
		entry.hasContent = true
	}
	return entry
}

func (r *docReader) export() ([]any, error) {
	hierarchy := r.hierarchyView()
	exported := []any{}
	for _, id := range r.deriveOrderedIDs(hierarchy) {
		block, err := r.readBlock(id, r.entries[id])
		if err != nil {
			return nil, err
		}
		if block != nil {
			exported = append(exported, projectHierarchy(id, block, hierarchy))
		}
	}
	return exported, nil
}

func (r *docReader) readBlock(key string, entry *blockEntry) (*jsjson.Object, error) {
	r.path = r.path[:0]
	block, err := r.yBlockToOutputData(key, entry)
	if err != nil {
		where := "its fields"
		if len(r.path) > 0 {
			where = strings.Join(r.path, ".")
		}
		return nil, dataError("collab: block \"%s\" at %s: %s", fromUnitKey(key).String(), where, err.Error())
	}
	return block, nil
}

func (r *docReader) skip(key, reason string) *jsjson.Object {
	if r.warn != nil {
		r.warn(fmt.Sprintf("collab: block \"%s\" was skipped on export: %s.", fromUnitKey(key).String(), reason))
	}
	return nil
}

func (r *docReader) enter(key string) { r.path = append(r.path, key) }
func (r *docReader) leave()           { r.path = r.path[:len(r.path)-1] }

// hierarchyView is every id's effective parent: its parentId, or nil where a
// cycle broke the link. A dangling parent stays, for a peer not yet arrived.
func (r *docReader) hierarchyView() map[string]*string {
	broken := r.brokenCycleMembers()
	hierarchy := make(map[string]*string, len(r.allIDs))
	for id := range r.allIDs {
		if broken[id] {
			hierarchy[id] = nil
		} else {
			hierarchy[id] = r.rawParentID(id)
		}
	}
	return hierarchy
}

func (r *docReader) rawParentID(id string) *string {
	if entry, ok := r.entries[id]; ok {
		return entry.rawParent
	}
	return nil
}

func (r *docReader) brokenCycleMembers() map[string]bool {
	broken := map[string]bool{}
	state := map[string]bool{}
	for _, id := range r.ids {
		r.markParentChain(id, state, broken)
	}
	return broken
}

// markParentChain walks one parentId chain without recursion: a document may
// nest thousands of blocks deep.
func (r *docReader) markParentChain(start string, state, broken map[string]bool) {
	var path []string
	id := start
	for {
		if visiting, ok := state[id]; ok {
			if visiting {
				breakCycle(path[slices.Index(path, id):], broken)
			}
			break
		}
		if !r.allIDs[id] {
			break
		}
		state[id] = true
		path = append(path, id)
		parent := r.rawParentID(id)
		if parent == nil {
			break
		}
		id = *parent
	}
	for _, visited := range path {
		state[visited] = false
	}
}

// breakCycle keeps the parent of the smallest member (UTF-16 order).
func breakCycle(members []string, broken map[string]bool) {
	keeper := members[0]
	for _, id := range members[1:] {
		if id < keeper {
			keeper = id
		}
	}
	for _, member := range members {
		if member != keeper {
			broken[member] = true
		}
	}
}

func (r *docReader) deriveOrderedIDs(hierarchy map[string]*string) []string {
	var ordered []string
	seen := map[string]bool{}
	r.mainPass(hierarchy, seen, &ordered)
	for _, id := range r.unreached(seen) {
		parent := hierarchy[id]
		if parent == nil || !r.allIDs[*parent] {
			r.visitBlock(id, parent, hierarchy, seen, &ordered)
		}
	}
	for _, id := range r.unreached(seen) {
		r.visitBlock(id, hierarchy[id], hierarchy, seen, &ordered)
	}
	return ordered
}

// MainPassIDs are the ids the export reaches from the root order.
func (r *docReader) mainPassIDs() map[string]bool {
	seen := map[string]bool{}
	var ordered []string
	r.mainPass(r.hierarchyView(), seen, &ordered)
	return seen
}

func (r *docReader) mainPass(hierarchy map[string]*string, seen map[string]bool, ordered *[]string) {
	for _, entry := range r.rootOrder.Values() {
		if id, ok := entry.(jsjson.Str); ok {
			r.visitBlock(unitKey(id), nil, hierarchy, seen, ordered)
		}
	}
}

func (r *docReader) unreached(seen map[string]bool) []string {
	var ids []string
	for _, id := range r.ids {
		if !seen[id] {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	return ids
}

func sameParent(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// visitBlock emits an id once, only where its effective parent is the block
// whose order is walked; a disagreeing slot is skipped without marking it
// seen, so a later agreeing one can claim it. No recursion, as above.
func (r *docReader) visitBlock(start string, expected *string, hierarchy map[string]*string, seen map[string]bool, ordered *[]string) {
	type pending struct {
		id       string
		expected *string
	}
	stack := []pending{{start, expected}}
	for len(stack) > 0 {
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		entry, ok := r.entries[top.id]
		if seen[top.id] || !ok {
			continue
		}
		if !sameParent(hierarchy[top.id], top.expected) {
			continue
		}
		seen[top.id] = true
		*ordered = append(*ordered, top.id)
		id := top.id
		for i := len(entry.contentIDs) - 1; i >= 0; i-- {
			if child, ok := entry.contentIDs[i].(jsjson.Str); ok {
				stack = append(stack, pending{unitKey(child), &id})
			}
		}
	}
}

func (r *docReader) yBlockToOutputData(key string, entry *blockEntry) (*jsjson.Object, error) {
	id, ok := strValue(entry.m, "id")
	if !ok {
		return r.skip(key, "its id is not a string"), nil
	}
	kindText, ok := strValue(entry.m, "type")
	kind := kindText.String()
	if !ok {
		return r.skip(key, "its type is not a string"), nil
	}
	data, ok := value(entry.m, "data").(*yjs.Map)
	if !ok {
		return r.skip(key, "its data is not a map"), nil
	}
	r.enter("data")
	blockData, err := r.yMapToObject(data, blockFieldDepth)
	if err != nil {
		return nil, err
	}
	block := &jsjson.Object{}
	put(block, "id", id)
	put(block, "type", kindText)
	put(block, "data", blockData)
	r.leave()

	// What is left holding HTML after the generic read is a legacy text or string.
	for _, dataKey := range data.Keys() {
		if !r.fields.IsRich(kind, dataKey.String()) {
			continue
		}
		switch value(data, dataKey.String()).(type) {
		case *yjs.Text, jsjson.Str:
		default:
			continue
		}
		if html, ok := getStr(blockData, dataKey); ok {
			r.slots = append(r.slots, RichTextHTMLSlot{blockData, dataKey, RichTextHTML{kind, dataKey.String(), html}})
		}
	}
	r.nestedDocumentSlots(kind, blockData)

	if tunes, ok := value(entry.m, "tunes").(*yjs.Map); ok && tunes.Len() > 0 {
		r.enter("tunes")
		plain, err := r.yMapToObject(tunes, blockFieldDepth)
		if err != nil {
			return nil, err
		}
		put(block, "tunes", plain)
		r.leave()
	}
	// Any string parentId, self-parent included: the projection re-decides it.
	if parent, ok := strValue(entry.m, "parentId"); ok {
		put(block, "parent", parent)
	}
	if len(entry.contentIDs) > 0 {
		r.enter("content")
		plain, err := r.toPlainArray(entry.contentIDs, 1)
		if err != nil {
			return nil, err
		}
		put(block, "content", plain)
		r.leave()
	}
	if err := r.stamp(entry.m, block, "lastEditedAt"); err != nil {
		return nil, err
	}
	if by, ok := strValue(entry.m, "lastEditedBy"); ok {
		put(block, "lastEditedBy", by)
	}
	if err := r.stamp(entry.m, block, "createdAt"); err != nil {
		return nil, err
	}
	for _, key := range []string{"createdBy", "createdWith", "lastEditedWith"} {
		if text, ok := strValue(entry.m, key); ok {
			put(block, key, text)
		}
	}
	return block, nil
}

func (r *docReader) stamp(m *yjs.Map, block *jsjson.Object, key string) error {
	switch at := value(m, key).(type) {
	case float64, lib0.BigInt:
		r.enter(key)
		plain, err := r.toPlainOrNull(at, 1)
		if err != nil {
			return err
		}
		put(block, key, plain)
		r.leave()
	}
	return nil
}

func getStr(object *jsjson.Object, key jsjson.Str) (jsjson.Str, bool) {
	v, ok := object.Get(key)
	if !ok {
		return nil, false
	}
	s, ok := v.(jsjson.Str)
	return s, ok
}

// nestedDocumentSlots: a database-row keeps whole documents in
// properties.*.blocks as plain JSON, and their rich HTML is converted too.
func (r *docReader) nestedDocumentSlots(kind string, data *jsjson.Object) {
	if kind != "database-row" {
		return
	}
	properties, ok := lookupObject(data, "properties")
	if !ok {
		return
	}
	for _, property := range properties.Members() {
		document, ok := property.Value.(*jsjson.Object)
		if !ok {
			continue
		}
		nested, ok := lookupValue(document, "blocks").([]any)
		if !ok {
			continue
		}
		for _, node := range nested {
			block, ok := node.(*jsjson.Object)
			if !ok {
				continue
			}
			nestedType, ok := lookupValue(block, "type").(jsjson.Str)
			if !ok {
				continue
			}
			nestedData, ok := lookupObject(block, "data")
			if !ok {
				continue
			}
			for _, m := range nestedData.Members() {
				if html, ok := m.Value.(jsjson.Str); ok && r.fields.IsRich(nestedType.String(), m.Key.String()) {
					r.slots = append(r.slots, RichTextHTMLSlot{nestedData, m.Key, RichTextHTML{nestedType.String(), m.Key.String(), html}})
				}
			}
			r.nestedDocumentSlots(nestedType.String(), nestedData)
		}
	}
}

func lookupValue(object *jsjson.Object, key string) any {
	v, _ := lookup(object, key)
	return v
}

func lookupObject(object *jsjson.Object, key string) (*jsjson.Object, bool) {
	v, ok := lookupValue(object, key).(*jsjson.Object)
	return v, ok && v != nil
}

// projectHierarchy reports the effective parent and keeps only the children
// that name this block as theirs. Ids with no entry stay; nothing is
// deduplicated. Both keys keep their place, as a JsonObject set does.
func projectHierarchy(id string, block *jsjson.Object, hierarchy map[string]*string) *jsjson.Object {
	parent := hierarchy[id]
	content, _ := lookupValue(block, "content").([]any)
	var owned []any
	for _, child := range content {
		childID, isString := child.(jsjson.Str)
		if !isString {
			owned = append(owned, child)
			continue
		}
		childParent, known := hierarchy[unitKey(childID)]
		if !known || (childParent != nil && *childParent == id) {
			owned = append(owned, child)
		}
	}
	projected := &jsjson.Object{}
	for _, m := range block.Members() {
		switch m.Key.String() {
		case "parent":
			if parent != nil {
				projected.Set(m.Key, fromUnitKey(*parent))
			}
		case "content":
			if len(owned) > 0 {
				projected.Set(m.Key, owned)
			}
		default:
			projected.Set(m.Key, m.Value)
		}
	}
	return projected
}

func (r *docReader) yMapToObject(m *yjs.Map, depth int) (*jsjson.Object, error) {
	result := &jsjson.Object{}
	for _, key := range m.Keys() {
		r.enter(key.String())
		v, _ := m.Get(key)
		plain, ok, err := r.tryToPlain(v, depth+1)
		if err != nil {
			return nil, err
		}
		// JSON.stringify drops undefined-valued keys.
		if ok {
			result.Set(key, plain)
		}
		r.leave()
	}
	return result, nil
}

func (r *docReader) toPlainArray(items []any, depth int) ([]any, error) {
	result := make([]any, 0, len(items))
	for i, item := range items {
		r.enter(strconv.Itoa(i))
		plain, err := r.toPlainOrNull(item, depth)
		if err != nil {
			return nil, err
		}
		result = append(result, plain)
		r.leave()
	}
	return result, nil
}

func (r *docReader) toPlainOrNull(v any, depth int) (any, error) {
	plain, ok, err := r.tryToPlain(v, depth)
	if err != nil || !ok {
		return nil, err
	}
	return plain, nil
}

// tryToPlain reads back what the write rules stored. The grid branch comes
// first: a keyed grid IS a map, and reading it as one would leak row keys.
// ok is false for undefined, which JSON has no value for.
func (r *docReader) tryToPlain(v any, depth int) (any, bool, error) {
	if depth > MaxValueDepth {
		switch v.(type) {
		case *yjs.Map, *yjs.Array, *jsjson.Object, []any:
			return nil, true, nil
		}
	}
	switch v := v.(type) {
	case nil:
		return nil, true, nil
	case *yjs.Map:
		if isGridMap(v) {
			plain, err := r.gridMapToPlain(v, depth)
			return plain, err == nil, err
		}
		plain, err := r.yMapToObject(v, depth)
		return plain, err == nil, err
	case *yjs.Array:
		plain, err := r.toPlainArray(v.Values(), depth+1)
		return plain, err == nil, err
	case *jsjson.Object:
		result := &jsjson.Object{}
		for _, m := range v.Members() {
			r.enter(m.Key.String())
			plain, ok, err := r.tryToPlain(m.Value, depth+1)
			if err != nil {
				return nil, false, err
			}
			if ok {
				result.Set(m.Key, plain)
			}
			r.leave()
		}
		return result, true, nil
	case []any:
		plain, err := r.toPlainArray(v, depth+1)
		return plain, err == nil, err
	// Formatted rich text by class, never by field list, read through the
	// delta so embeds and marks survive.
	case *yjs.XmlText:
		segments, err := toJSONNode(FromDelta(v.ToDelta()))
		return segments, err == nil, err
	case *yjs.Text:
		return v.Units(), true, nil
	// The XML containers hold no markup in this engine and read as "".
	case *yjs.XmlElement, *yjs.XmlFragment, *yjs.XmlHook:
		return jsjson.Str{}, true, nil
	case jsjson.Str:
		// Only wire JSON can carry a lone surrogate; .NET would write U+FFFD,
		// so it is dropped as undefined is.
		if hasLoneSurrogate(v) {
			return nil, false, nil
		}
		return v, true, nil
	case bool:
		return v, true, nil
	case float64:
		return numberNode(v), true, nil
	case lib0.BigInt:
		return bigToLong(v), true, nil
	case *yjs.Subdoc:
		return &jsjson.Object{}, true, nil
	case []byte:
		result := &jsjson.Object{}
		for i, b := range v {
			result.Set(str(strconv.Itoa(i)), float64(b))
		}
		return result, true, nil
	case jsjson.Undefined:
		return nil, false, nil
	}
	return nil, false, dataError("collab: unsupported value %s in block data.", csharpTypeName(v))
}

// csharpTypeName names the C# class an engine value maps to, for the message.
func csharpTypeName(v any) string { return fmt.Sprintf("%T", v) }

func (r *docReader) gridMapToPlain(grid *yjs.Map, depth int) ([]any, error) {
	rows := value(grid, gridRowsKey).(*yjs.Map)
	keys := gridRowKeys(grid, rows)
	result := make([]any, 0, len(keys))
	for i, key := range keys {
		r.enter(strconv.Itoa(i))
		row, _ := rows.Get(key)
		// The keyed wrapper costs the two levels the write side spends.
		plain, err := r.toPlainOrNull(row, depth+2)
		if err != nil {
			return nil, err
		}
		result = append(result, plain)
		r.leave()
	}
	return result, nil
}

// toJSONNode is C# RichText.ToJsonNode: keys in JS order, undefined members
// dropped, non-finite numbers null.
func toJSONNode(v any) (any, error) {
	switch v := v.(type) {
	case nil:
		return nil, nil
	case jsjson.Str, bool:
		return v, nil
	case float64:
		return numberNode(v), nil
	case []any:
		array := make([]any, len(v))
		for i, item := range v {
			node, err := toJSONNode(item)
			if err != nil {
				return nil, err
			}
			array[i] = node
		}
		return array, nil
	case *jsjson.Object:
		result := &jsjson.Object{}
		for _, m := range jsjson.KeyOrder(v.Members()) {
			if _, undefined := m.Value.(jsjson.Undefined); undefined {
				continue
			}
			node, err := toJSONNode(m.Value)
			if err != nil {
				return nil, err
			}
			result.Set(m.Key, node)
		}
		return result, nil
	}
	return nil, dataError("collab: unsupported value %s in rich text.", csharpTypeName(v))
}

// Export reads the doc as block JSON. A rich field still holding HTML is
// left as that string and listed in the slots: the caller converts it.
func Export(doc *yjs.Doc, fields *RichTextFields, warn func(string)) ([]any, []RichTextHTMLSlot, error) {
	reader := newDocReader(doc.GetMap(str(blocksRoot)), doc.GetArray(str(orderRoot)), fields, warn)
	blocks, err := reader.export()
	if err != nil {
		return nil, nil, err
	}
	return blocks, reader.slots, nil
}

// ExportPage is the page map's title and icon, by the client's readPageFields;
// a title or icon holding U+0000 is left out too.
func ExportPage(doc *yjs.Doc) *jsjson.Object {
	m := doc.GetMap(str(pageRoot))
	page := &jsjson.Object{}
	if title, ok := value(m, "title").(jsjson.Str); ok && len(title) > 0 && !slices.Contains(title, 0) {
		put(page, "title", title)
	}
	icon := value(m, "icon")
	if isPageIcon(icon) {
		// A value JSON cannot hold is left out: throwing would fail every PUT.
		if node, err := toJSONNode(icon); err == nil && !hasNul(node) {
			put(page, "icon", node)
		}
	}
	return page
}

func hasNul(node any) bool {
	switch node := node.(type) {
	case *jsjson.Object:
		for _, m := range node.Members() {
			if slices.Contains(m.Key, 0) || hasNul(m.Value) {
				return true
			}
		}
	case []any:
		return slices.ContainsFunc(node, hasNul)
	case jsjson.Str:
		return slices.Contains(node, 0)
	}
	return false
}

// isPageIcon is the client's isPageIcon: {type:'emoji', value} or {type:'image', url}.
func isPageIcon(v any) bool {
	icon, ok := v.(*jsjson.Object)
	if !ok || icon == nil {
		return false
	}
	kind, _ := lookupValue(icon, "type").(jsjson.Str)
	switch {
	case kind == nil:
		return false
	case kind.String() == "emoji":
		return isStr(lookupValue(icon, "value"))
	case kind.String() == "image":
		return isStr(lookupValue(icon, "url"))
	}
	return false
}

func isStr(v any) bool {
	_, ok := v.(jsjson.Str)
	return ok
}

// PlainJSON is C# RichText.ToJsonNode: a plain page map value as JSON,
// keys in JS order and undefined members dropped.
func PlainJSON(v any) (any, error) { return toJSONNode(v) }
