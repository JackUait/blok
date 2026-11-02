package convert

import (
	"crypto/rand"
	"errors"
	"slices"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// Seed input is read the System.Text.Json way (jsjson.Node), then turned into
// JS values one block at a time: a string .NET cannot read fails when its
// block is read, as GetValue<string> fails in C#.

const (
	rowKeyLength   = 10
	listSlotMapKey = "properties"
	// nanoid's default alphabet; keys are random so two peers never collide.
	rowKeyAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"
)

// GenerateRowKey mints a grid row key. Tests replace it.
var GenerateRowKey = func() string {
	var b [rowKeyLength]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	// 64 letters, so the low six bits pick one uniformly.
	for i := range b {
		b[i] = rowKeyAlphabet[b[i]&63]
	}
	return string(b[:])
}

// ErrNotUnicode is a string .NET cannot read (a lone-surrogate escape or
// invalid UTF-8): C#'s InvalidOperationException, not an InvalidDataException.
var ErrNotUnicode = errors.New("collab: the document holds text that is not valid Unicode")

// strictValue is a Node as JS values, every string and key read strictly.
func strictValue(n *jsjson.Node) (any, error) {
	switch n.Kind {
	case jsjson.KindNull:
		return nil, nil
	case jsjson.KindTrue:
		return true, nil
	case jsjson.KindFalse:
		return false, nil
	case jsjson.KindNumber:
		// GetDouble reads an overflow as an infinity, as ParseFloat does.
		number, err := strconv.ParseFloat(string(n.Raw()), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return nil, err
		}
		return number, nil
	case jsjson.KindString:
		text, err := n.Text()
		if err != nil {
			return nil, errors.Join(ErrNotUnicode, err)
		}
		return text, nil
	case jsjson.KindArray:
		items := make([]any, len(n.Items))
		for i, item := range n.Items {
			v, err := strictValue(item)
			if err != nil {
				return nil, err
			}
			items[i] = v
		}
		return items, nil
	}
	object := &jsjson.Object{}
	for _, m := range n.Members {
		key, err := m.Key()
		if err != nil {
			return nil, errors.Join(ErrNotUnicode, err)
		}
		v, err := strictValue(m.Value)
		if err != nil {
			return nil, err
		}
		object.Set(key, v)
	}
	return object, nil
}

func noNul(value jsjson.Str, what string) (jsjson.Str, error) {
	if slices.Contains(value, 0) {
		return nil, dataError("collab: %s contains a NUL character, which this endpoint does not accept.", what)
	}
	return value, nil
}

func guardDepth(depth int, what string) error {
	if depth > MaxValueDepth {
		return dataError("collab: %s is nested deeper than %d levels.", what, MaxValueDepth)
	}
	return nil
}

func getString(object *jsjson.Object, key string) (jsjson.Str, bool) {
	return getStr(object, str(key))
}

// objectEntries is what JS Object.entries yields for a malformed data or
// tunes: index keys for an array, one key per UTF-16 unit for a string,
// nothing for a number or boolean, and null throws.
func objectEntries(v any, present bool, what string) (*jsjson.Object, error) {
	switch v := v.(type) {
	case nil:
		_ = present
		return nil, dataError("collab: %s is null.", what)
	case *jsjson.Object:
		return v, nil
	case []any:
		indexed := &jsjson.Object{}
		for i, item := range v {
			indexed.Set(str(strconv.Itoa(i)), item)
		}
		return indexed, nil
	case jsjson.Str:
		characters := &jsjson.Object{}
		for i, unit := range v {
			characters.Set(str(strconv.Itoa(i)), jsjson.Str{unit})
		}
		return characters, nil
	}
	return &jsjson.Object{}, nil
}

// normalizeBlockData: empty paragraph data becomes { text: [] }.
func normalizeBlockData(kind jsjson.Str, data *jsjson.Object) *jsjson.Object {
	if kind.String() == "paragraph" && data.Len() == 0 {
		normalized := &jsjson.Object{}
		put(normalized, "text", []any{})
		return normalized
	}
	return data
}

// mergeableText is a block-data string bound for a Y.Text, kept as a string
// so the update path can diff it against the live text.
type mergeableText struct{ value jsjson.Str }

// mergeableRichText is a rich field's canonical segments, bound for a Y.XmlText.
type mergeableRichText struct{ segments []any }

type entry struct {
	key   jsjson.Str
	value any
}

// blockDataEntries screens only the keys; the update path must screen values.
func blockDataEntries(kind *jsjson.Str, data *jsjson.Object, input *RichTextInput) ([]entry, error) {
	if err := guardDepth(blockFieldDepth, "a data value"); err != nil {
		return nil, err
	}
	var entries []entry
	for _, m := range data.Members() {
		key, err := noNul(m.Key, "a data key")
		if err != nil {
			return nil, err
		}
		text, isString := m.Value.(jsjson.Str)
		_, isArray := m.Value.([]any)
		if kind != nil && input.Fields.IsRich(kind.String(), key.String()) && (isString || isArray) {
			segments, err := richSegments(kind.String(), key.String(), m.Value, input)
			if err != nil {
				return nil, err
			}
			entries = append(entries, entry{key, mergeableRichText{segments}})
			continue
		}
		if slices.Contains(diffableTextKeys, key.String()) && isString {
			value, err := noNul(text, "a string value")
			if err != nil {
				return nil, err
			}
			entries = append(entries, entry{key, mergeableText{value}})
			continue
		}
		entries = append(entries, entry{key, m.Value})
	}
	return entries, nil
}

// richSegments: HTML through the caller's table, then the NUL and depth
// guards, then the client's lenient input read.
func richSegments(kind, key string, v any, input *RichTextInput) ([]any, error) {
	segments, isArray := v.([]any)
	if !isArray {
		html, err := noNul(v.(jsjson.Str), "a string value")
		if err != nil {
			return nil, err
		}
		if segments, err = input.Segments(kind, key, html); err != nil {
			return nil, err
		}
	}
	atomic, err := atomicValue(segments, blockFieldDepth+1)
	if err != nil {
		return nil, err
	}
	return ReadInput(atomic.([]any)), nil
}

// newRichText is a prelim formatted text. Every insert names its marks, {}
// included: one without would inherit the run before it.
func newRichText(segments []any) *yjs.XmlText {
	text := yjs.NewXmlText(nil)
	index := 0
	for _, op := range ToWriteOps(segments) {
		if characters, ok := op.Insert.(jsjson.Str); ok {
			text.Insert(nil, index, characters, op.Attributes)
		} else {
			text.InsertEmbed(nil, index, op.Insert, op.Attributes)
		}
		index += op.Length()
	}
	return text
}

// screen runs the NUL and depth guards over the entries and throws the
// result away: the conversion is the validator.
func screen(entries []entry) error {
	for _, e := range entries {
		switch e.value.(type) {
		case mergeableText, mergeableRichText:
			continue
		}
		if _, err := plainToYValue(e.value, blockFieldDepth+1); err != nil {
			return err
		}
	}
	return nil
}

func toDataMap(entries []entry) (*yjs.Map, error) {
	mapEntries := make([]yjs.MapEntry, 0, len(entries))
	for _, e := range entries {
		v, err := toShared(e.key, e.value, blockFieldDepth+1)
		if err != nil {
			return nil, err
		}
		mapEntries = append(mapEntries, yjs.MapEntry{Key: e.key, Value: v})
	}
	return yjs.NewMap(mapEntries...), nil
}

func toShared(key jsjson.Str, v any, depth int) (any, error) {
	switch v := v.(type) {
	case mergeableRichText:
		return newRichText(v.segments), nil
	case mergeableText:
		return yjs.NewText(v.value), nil
	}
	return plainDataValue(key, v, depth)
}

// blockMap builds one block's Y.Map from its JSON.
func blockMap(id jsjson.Str, block *jsjson.Object, input *RichTextInput) (*yjs.Map, error) {
	// Export skips such a block, so accepting it would PUT the record back short.
	kind, ok := getString(block, "type")
	if !ok {
		return nil, dataError("collab: block \"%s\" type is not a string.", id.String())
	}
	if _, err := noNul(kind, "block \""+id.String()+"\" type"); err != nil {
		return nil, err
	}
	rawData, present := lookup(block, "data")
	dataEntries, err := objectEntries(rawData, present, "block \""+id.String()+"\" data")
	if err != nil {
		return nil, err
	}
	entries, err := blockDataEntries(&kind, normalizeBlockData(kind, dataEntries), input)
	if err != nil {
		return nil, err
	}
	data, err := toDataMap(entries)
	if err != nil {
		return nil, err
	}
	out := []yjs.MapEntry{{Key: str("id"), Value: id}, {Key: str("type"), Value: kind}, {Key: str("data"), Value: data}}

	// Eager even with no tunes, like contentIds: a container two peers can
	// create must be minted by the one that creates the block, or map-set
	// last-writer-wins drops a concurrent tune. LOCKSTEP with the client serializer.
	tuneEntries := &jsjson.Object{}
	if tunes, ok := lookup(block, "tunes"); ok {
		if tuneEntries, err = objectEntries(tunes, true, "block \""+id.String()+"\" tunes"); err != nil {
			return nil, err
		}
	}
	tunesMap, err := objectToYMap(tuneEntries, blockFieldDepth, false)
	if err != nil {
		return nil, err
	}
	out = append(out, yjs.MapEntry{Key: str("tunes"), Value: tunesMap})
	if parent, ok := lookup(block, "parent"); ok {
		v, err := atomicValue(parent, 1)
		if err != nil {
			return nil, err
		}
		out = append(out, yjs.MapEntry{Key: str("parentId"), Value: v})
	}
	content, _ := lookup(block, "content")
	contentIDs, err := contentIDsArray(id, content)
	if err != nil {
		return nil, err
	}
	out = append(out, yjs.MapEntry{Key: str("contentIds"), Value: contentIDs})
	for _, key := range []string{"lastEditedAt", "lastEditedBy"} {
		if v, ok := lookup(block, key); ok {
			atomic, err := atomicValue(v, 1)
			if err != nil {
				return nil, err
			}
			out = append(out, yjs.MapEntry{Key: str(key), Value: atomic})
		}
	}
	// Written only when the type is right, so a malformed stamp never reaches the client.
	stamps := []struct {
		key    string
		number bool
	}{{"createdAt", true}, {"createdBy", false}, {"createdWith", false}, {"lastEditedWith", false}}
	for _, stamp := range stamps {
		v, _ := lookup(block, stamp.key)
		_, isNumber := v.(float64)
		_, isString := v.(jsjson.Str)
		if (stamp.number && isNumber) || (!stamp.number && isString) {
			atomic, err := atomicValue(v, 1)
			if err != nil {
				return nil, err
			}
			out = append(out, yjs.MapEntry{Key: str(stamp.key), Value: atomic})
		}
	}
	return yjs.NewMap(out...), nil
}

// contentIDsArray is Y.Array.from(content ?? []): a string spreads into its
// code points. Strings were read strictly, so none holds a lone surrogate.
func contentIDsArray(id jsjson.Str, content any) (*yjs.Array, error) {
	switch content := content.(type) {
	case nil:
		return yjs.NewArray(), nil
	case []any:
		values := make([]any, len(content))
		for i, item := range content {
			v, err := atomicValue(item, 1)
			if err != nil {
				return nil, err
			}
			values[i] = v
		}
		return yjs.NewArray(values...), nil
	case jsjson.Str:
		var values []any
		for i := 0; i < len(content); i++ {
			unit := content[i]
			var character jsjson.Str
			switch {
			case unit >= 0xd800 && unit <= 0xdbff && i+1 < len(content) && content[i+1] >= 0xdc00 && content[i+1] <= 0xdfff:
				character = jsjson.Str{unit, content[i+1]}
				i++
			default:
				character = jsjson.Str{unit}
			}
			v, err := noNul(character, "block \""+id.String()+"\" content")
			if err != nil {
				return nil, err
			}
			values = append(values, v)
		}
		return yjs.NewArray(values...), nil
	}
	return nil, dataError("collab: block \"%s\" has non-iterable content.", id.String())
}

// plainDataValue is plainToYValue, except the list-slot map mints its empty
// lists as keyed wrappers (plainDataValue in the client serializer).
func plainDataValue(key jsjson.Str, v any, depth int) (any, error) {
	if object, ok := v.(*jsjson.Object); ok && key.String() == listSlotMapKey {
		return objectToYMap(object, depth, true)
	}
	return plainToYValue(v, depth)
}

func objectToYMap(object *jsjson.Object, depth int, listSlots bool) (*yjs.Map, error) {
	if err := guardDepth(depth, "a data value"); err != nil {
		return nil, err
	}
	var entries []yjs.MapEntry
	for _, m := range object.Members() {
		key, err := noNul(m.Key, "a data key")
		if err != nil {
			return nil, err
		}
		name := key.String()
		array, isArray := m.Value.([]any)
		if (listSlots || name == "definitions" || name == "triggers" || name == "actions") && isArray && len(array) == 0 {
			wrapper, err := plainToIdentityMap(array, depth+1)
			if err != nil {
				return nil, err
			}
			entries = append(entries, yjs.MapEntry{Key: key, Value: wrapper})
			continue
		}
		var v any
		if slices.Contains(orderedIDArrayKeys, name) && isArray && !isGridArray(array) && !isIdentityArray(array) {
			v, err = plainToYArray(array, depth+1)
		} else {
			v, err = plainToYValue(m.Value, depth+1)
		}
		if err != nil {
			return nil, err
		}
		entries = append(entries, yjs.MapEntry{Key: key, Value: v})
	}
	return yjs.NewMap(entries...), nil
}

// plainToYArray is element-wise whatever the elements are: only the
// ordered-id rule uses it.
func plainToYArray(array []any, depth int) (*yjs.Array, error) {
	if err := guardDepth(depth, "a data value"); err != nil {
		return nil, err
	}
	values := make([]any, len(array))
	for i, element := range array {
		v, err := plainToYValue(element, depth+1)
		if err != nil {
			return nil, err
		}
		values[i] = v
	}
	return yjs.NewArray(values...), nil
}

// plainToYValue: the grid rule, the identity rule, the array rule, then
// nested maps; primitives and other arrays stay atomic leaves.
func plainToYValue(v any, depth int) (any, error) {
	if array, ok := v.([]any); ok && isConvertibleArray(array) {
		if err := guardDepth(depth, "a data value"); err != nil {
			return nil, err
		}
		if isGridArray(array) {
			return plainToGridMap(array, depth)
		}
		if isIdentityArray(array) {
			return plainToIdentityMap(array, depth)
		}
		values := make([]any, len(array))
		for i, element := range array {
			converted, err := plainToYValue(element, depth+1)
			if err != nil {
				return nil, err
			}
			values[i] = converted
		}
		return yjs.NewArray(values...), nil
	}
	if object, ok := v.(*jsjson.Object); ok {
		return objectToYMap(object, depth, false)
	}
	return atomicValue(v, depth)
}

func plainToGridMap(rows []any, depth int) (*yjs.Map, error) {
	var rowEntries []yjs.MapEntry
	var order []any
	taken := map[string]bool{}
	for _, row := range rows {
		key := newGridRowKey(row, taken)
		taken[unitKey(key)] = true
		// A grid row costs two levels, matching the read-back walk.
		v, err := plainToYValue(row, depth+2)
		if err != nil {
			return nil, err
		}
		rowEntries = append(rowEntries, yjs.MapEntry{Key: key, Value: v})
		order = append(order, key)
	}
	return yjs.NewMap(
		yjs.MapEntry{Key: str(gridRowsKey), Value: yjs.NewMap(rowEntries...)},
		yjs.MapEntry{Key: str(gridOrderKey), Value: yjs.NewArray(order...)},
	), nil
}

// plainToIdentityMap keys each element by its own id, in the grid's shape.
func plainToIdentityMap(elements []any, depth int) (*yjs.Map, error) {
	var rowEntries []yjs.MapEntry
	var order []any
	for _, element := range elements {
		id, _ := getString(element.(*jsjson.Object), "id")
		key, err := noNul(id, "a data key")
		if err != nil {
			return nil, err
		}
		v, err := plainToYValue(element, depth+2)
		if err != nil {
			return nil, err
		}
		rowEntries = append(rowEntries, yjs.MapEntry{Key: key, Value: v})
		order = append(order, key)
	}
	return yjs.NewMap(
		yjs.MapEntry{Key: str(gridRowsKey), Value: yjs.NewMap(rowEntries...)},
		yjs.MapEntry{Key: str(gridOrderKey), Value: yjs.NewArray(order...)},
	), nil
}

// atomicValue is what a bare ymap.set(key, value) stores: plain all the way down.
func atomicValue(v any, depth int) (any, error) {
	switch v := v.(type) {
	case nil, bool, float64:
		return v, nil
	case jsjson.Str:
		return noNul(v, "a string value")
	case *jsjson.Object:
		if err := guardDepth(depth, "a data value"); err != nil {
			return nil, err
		}
		entries := &jsjson.Object{}
		for _, m := range v.Members() {
			key, err := noNul(m.Key, "a data key")
			if err != nil {
				return nil, err
			}
			child, err := atomicValue(m.Value, depth+1)
			if err != nil {
				return nil, err
			}
			entries.Set(key, child)
		}
		return entries, nil
	case []any:
		if err := guardDepth(depth, "a data value"); err != nil {
			return nil, err
		}
		items := make([]any, len(v))
		for i, item := range v {
			child, err := atomicValue(item, depth+1)
			if err != nil {
				return nil, err
			}
			items[i] = child
		}
		return items, nil
	}
	return nil, dataError("collab: unsupported JSON node.")
}

func isConvertibleArray(array []any) bool {
	if len(array) == 0 {
		return false
	}
	for _, element := range array {
		switch element.(type) {
		case *jsjson.Object, []any:
		default:
			return false
		}
	}
	return true
}

func isGridArray(array []any) bool {
	if !isConvertibleArray(array) {
		return false
	}
	for _, element := range array {
		if _, ok := element.([]any); !ok {
			return false
		}
	}
	return true
}

// isIdentityArray: every element carries a unique, non-empty string id, and
// it is not a grid.
func isIdentityArray(array []any) bool {
	if !isConvertibleArray(array) || isGridArray(array) {
		return false
	}
	ids := map[string]bool{}
	for _, element := range array {
		object, ok := element.(*jsjson.Object)
		if !ok {
			return false
		}
		id, ok := getString(object, "id")
		if !ok || len(id) == 0 || ids[unitKey(id)] {
			return false
		}
		ids[unitKey(id)] = true
	}
	return true
}

// gridRowID is the rowId every cell of a row carries, or nil.
func gridRowID(row any) jsjson.Str {
	cells, ok := row.([]any)
	if !ok || len(cells) == 0 {
		return nil
	}
	var first jsjson.Str
	for i, cell := range cells {
		object, ok := cell.(*jsjson.Object)
		if !ok {
			return nil
		}
		id, ok := getString(object, "rowId")
		if !ok {
			return nil
		}
		if i == 0 {
			first = id
		} else if !slices.Equal(first, id) {
			return nil
		}
	}
	if len(first) == 0 {
		return nil
	}
	return first
}

func newGridRowKey(row any, taken map[string]bool) jsjson.Str {
	if id := gridRowID(row); id != nil && !taken[unitKey(id)] {
		return id
	}
	return str(GenerateRowKey())
}

// composePage is the page fields to write: a valid value, or nil for
// "delete the key". A malformed icon is dropped before the guards run.
func composePage(page *jsjson.Object) ([]entry, error) {
	var title any
	if text, ok := getString(page, "title"); ok && len(text) > 0 {
		checked, err := noNul(text, "a page title")
		if err != nil {
			return nil, err
		}
		title = checked
	}
	var icon any
	if raw, ok := lookupObject(page, "icon"); ok && isPageIcon(raw) {
		atomic, err := atomicValue(raw, 1)
		if err != nil {
			return nil, err
		}
		if isPageIcon(atomic) {
			icon = atomic
		}
	}
	return []entry{{str("title"), title}, {str("icon"), icon}}, nil
}

type preparedBlock struct {
	id    jsjson.Str
	block *yjs.Map
}

func compose(blocks []*jsjson.Node, input *RichTextInput) ([]preparedBlock, []any, error) {
	var prepared []preparedBlock
	topLevel := []any{}
	for _, node := range blocks {
		// fromJSON reads block.id off every entry: null throws, a primitive is skipped.
		if node.Kind == jsjson.KindNull {
			return nil, nil, dataError("collab: a block entry is null.")
		}
		if node.Kind != jsjson.KindObject {
			continue
		}
		idNode, err := member(node, "id")
		if err != nil {
			return nil, nil, errors.Join(ErrNotUnicode, err)
		}
		if idNode == nil || idNode.Kind != jsjson.KindString {
			continue
		}
		v, err := strictValue(node)
		if err != nil {
			return nil, nil, err
		}
		block := v.(*jsjson.Object)
		id, _ := getString(block, "id")
		if _, err := noNul(id, "a block id"); err != nil {
			return nil, nil, err
		}
		m, err := blockMap(id, block, input)
		if err != nil {
			return nil, nil, err
		}
		prepared = append(prepared, preparedBlock{id, m})
		if _, hasParent := lookup(block, "parent"); !hasParent {
			topLevel = append(topLevel, id)
		}
	}
	return prepared, topLevel, nil
}

// CollectSeedHTML is the HTML in the rich fields of blocks, each once, found
// by the walk Seed runs. It writes nothing and fails where Seed would.
func CollectSeedHTML(blocks []*jsjson.Node, fields *RichTextFields) ([]RichTextHTML, error) {
	input := Collecting(fields)
	if _, _, err := compose(blocks, input); err != nil {
		return nil, err
	}
	return input.Found(), nil
}

// Seed replaces the doc's blocks with blocks: every block becomes a map
// entry, and each one with no parent key joins the root order in input order.
// A non-nil page (JS values, read strictly) replaces the page map's title and
// icon; values is never touched. Everything that can refuse runs before the
// transaction opens, so a refused document leaves the doc as it was.
func Seed(doc *yjs.Doc, blocks []*jsjson.Node, input *RichTextInput, page *jsjson.Object) error {
	prepared, topLevel, err := compose(blocks, input)
	if err != nil {
		return err
	}
	var pageFields []entry
	if page != nil {
		if pageFields, err = composePage(page); err != nil {
			return err
		}
	}
	blockMap := doc.GetMap(str(blocksRoot))
	rootOrder := doc.GetArray(str(orderRoot))
	doc.Transact(func(t *yjs.Transaction) {
		if pageFields != nil {
			pageMap := doc.GetMap(str(pageRoot))
			for _, field := range pageFields {
				if field.value != nil {
					pageMap.Set(t, field.key, field.value)
				} else if _, ok := pageMap.Get(field.key); ok {
					pageMap.Delete(t, field.key)
				}
			}
		}
		if length := rootOrder.Len(); length > 0 {
			rootOrder.Delete(t, 0, length)
		}
		blockMap.Clear(t)
		for _, p := range prepared {
			blockMap.Set(t, p.id, p.block)
		}
		if len(topLevel) > 0 {
			rootOrder.Insert(t, 0, topLevel)
		}
	})
	return nil
}
