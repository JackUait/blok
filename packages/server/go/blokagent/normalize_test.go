package blokagent

import (
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// A Go twin of the C# AgentParityNormalizer (and so of
// test/unit/agent/parity/normalize.ts). Pinned by
// test/fixtures/agent-commands/normalizer-cases.json, and its rich-text step
// by fixtures/rich-text-canonical. Test code only: the collab port owns the
// real rich-text package.

var loadDefaults = map[string][]jsjson.NodeMember{
	"code":    {jsjson.NewMember("lineNumbers", jsjson.NewBool(true))},
	"quote":   {jsjson.NewMember("size", str("default"))},
	"callout": {jsjson.NewMember("textColor", jsjson.NewNull()), jsjson.NewMember("backgroundColor", jsjson.NewNull())},
}

func emptyAutomations() *jsjson.Node {
	return jsjson.NewObject(jsjson.NewMember("version", jsjson.NewNumber("1")), jsjson.NewMember("definitions", jsjson.NewArray()))
}

func mustParse(t *testing.T, text string) *jsjson.Node {
	t.Helper()
	node, err := jsjson.ParseNode([]byte(text), jsjson.Options{MaxDepth: 512})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return node
}

func readRepoFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, path))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func lookup(node *jsjson.Node, key string) *jsjson.Node {
	found, _ := node.Lookup(key)
	return found
}

func stringOf(node *jsjson.Node) (string, bool) {
	value, ok, err := text(node)
	return value, ok && err == nil
}

func setMember(node *jsjson.Node, key string, value *jsjson.Node) { _ = node.Set(key, value) }

// stable is C# Stable: keys sorted by UTF-16 units at every depth.
func stable(t *testing.T, node *jsjson.Node) string {
	t.Helper()
	if node == nil {
		return "null"
	}
	out, err := node.AppendCanonical(nil)
	if err != nil {
		t.Fatalf("stable: %v", err)
	}
	return string(out)
}

// deepEquals compares numbers by value, as JsonNode.DeepEquals does
// (UNVERIFIED for spellings like 1.0 against 1; only 1 and true/null/strings
// reach it here).
func deepEquals(a, b *jsjson.Node) bool {
	if a == nil || b == nil {
		return (a == nil || a.Kind == jsjson.KindNull) && (b == nil || b.Kind == jsjson.KindNull)
	}
	if a.Kind != b.Kind {
		return false
	}
	switch a.Kind {
	case jsjson.KindNumber:
		x, _ := strconv.ParseFloat(string(a.Raw()), 64)
		y, _ := strconv.ParseFloat(string(b.Raw()), 64)
		return x == y
	case jsjson.KindString:
		x, _ := stringOf(a)
		y, _ := stringOf(b)
		return x == y
	case jsjson.KindArray:
		return slices.EqualFunc(a.Items, b.Items, deepEquals)
	case jsjson.KindObject:
		if len(a.Members) != len(b.Members) {
			return false
		}
		for _, m := range a.Members {
			key, _ := m.Key()
			other, _ := b.Lookup(key.String())
			if other == nil || !deepEquals(m.Value, other) {
				return false
			}
		}
		return true
	}
	return true
}

func typeOf(block *jsjson.Node) string           { value, _ := stringOf(lookup(block, "type")); return value }
func idOf(block *jsjson.Node) (string, bool)     { return stringOf(lookup(block, "id")) }
func parentOf(block *jsjson.Node) (string, bool) { return stringOf(lookup(block, "parent")) }

func records(node *jsjson.Node) []*jsjson.Node {
	if node == nil || node.Kind != jsjson.KindArray {
		return nil
	}
	var out []*jsjson.Node
	for _, item := range node.Items {
		if item.Kind == jsjson.KindObject {
			out = append(out, item)
		}
	}
	return out
}

func normalizeDocument(document *jsjson.Node, keep map[string]bool) *jsjson.Node {
	var blocks []*jsjson.Node
	for _, block := range lookup(document, "blocks").Items {
		blocks = append(blocks, block.Clone())
	}
	blocks = canonicalDatabases(blocks)
	byID := map[string]int{}
	for i, block := range blocks {
		if id, ok := idOf(block); ok {
			byID[id] = i
		}
	}
	type labelled struct {
		block *jsjson.Node
		label string
	}
	var ordered []labelled
	visited := map[int]bool{}
	var walk func(index int, label string)
	walk = func(index int, label string) {
		if visited[index] {
			return
		}
		visited[index] = true
		block := blocks[index]
		ordered = append(ordered, labelled{block, label})
		var children []int
		if content := lookup(block, "content"); content != nil && content.Kind == jsjson.KindArray {
			for _, item := range content.Items {
				if id, ok := stringOf(item); ok {
					if child, found := byID[id]; found {
						children = append(children, child)
					}
				}
			}
		}
		if len(children) == 0 {
			if own, ok := idOf(block); ok {
				for i, other := range blocks {
					if parent, ok := parentOf(other); ok && parent == own {
						children = append(children, i)
					}
				}
			}
		}
		for i, child := range children {
			walk(child, label+"."+strconv.Itoa(i))
		}
	}
	var roots []int
	for i, block := range blocks {
		if !present(lookup(block, "parent")) {
			roots = append(roots, i)
		}
	}
	for i, root := range roots {
		walk(root, "b"+strconv.Itoa(i))
	}
	next := len(roots)
	for i := range blocks {
		if !visited[i] {
			walk(i, "b"+strconv.Itoa(next))
			next++
		}
	}
	names := map[string]string{}
	for _, entry := range ordered {
		if id, ok := idOf(entry.block); ok && !keep[id] {
			names[id] = entry.label
		}
	}
	output := jsjson.NewArray()
	for _, entry := range ordered {
		output.Items = append(output.Items, clean(entry.block, names))
	}
	result := jsjson.NewObject(jsjson.NewMember("blocks", output))
	for _, key := range []string{"title", "icon"} {
		if value := lookup(document, key); present(value) {
			setMember(result, key, value.Clone())
		}
	}
	return result
}

func canonicalDatabases(blocks []*jsjson.Node) []*jsjson.Node {
	labels := map[string]string{}
	ranks := map[*jsjson.Node]string{}
	label := func(id *jsjson.Node) {
		if text, ok := stringOf(id); ok {
			if _, seen := labels[text]; !seen {
				labels[text] = "dbid" + strconv.Itoa(len(labels)+1)
			}
		}
	}
	rank := func(siblings []*jsjson.Node) {
		var keys []string
		for _, sibling := range siblings {
			if position, ok := stringOf(lookup(sibling, "position")); ok && !slices.Contains(keys, position) {
				keys = append(keys, position)
			}
		}
		slices.SortFunc(keys, func(a, b string) int { return jsjson.Compare(jsjson.FromString(a), jsjson.FromString(b)) })
		for _, sibling := range siblings {
			if position, ok := stringOf(lookup(sibling, "position")); ok {
				ranks[sibling] = "pos:" + strconv.Itoa(slices.Index(keys, position))
			}
		}
	}
	for _, block := range blocks {
		data := lookup(block, "data")
		if typeOf(block) != "database" || data == nil || data.Kind != jsjson.KindObject {
			continue
		}
		schema := records(lookup(data, "schema"))
		for _, property := range schema {
			label(lookup(property, "id"))
			for _, option := range records(lookup(lookup(property, "config"), "options")) {
				label(lookup(option, "id"))
			}
		}
		for _, view := range records(lookup(data, "views")) {
			label(lookup(view, "id"))
		}
		rank(schema)
		rank(records(lookup(data, "views")))
		for _, property := range schema {
			rank(records(lookup(lookup(property, "config"), "options")))
		}
	}
	// Templates are their own ordered list beside the rows.
	type group struct {
		parent   string
		template bool
	}
	groups := map[group][]*jsjson.Node{}
	var order []group
	for _, block := range blocks {
		if typeOf(block) != "database-row" {
			continue
		}
		parent, _ := parentOf(block)
		data := lookup(block, "data")
		key := group{parent, lookup(data, "template") != nil && lookup(data, "template").Kind == jsjson.KindTrue}
		if _, ok := groups[key]; !ok {
			order = append(order, key)
		}
		if data != nil && data.Kind == jsjson.KindObject {
			groups[key] = append(groups[key], data)
		} else {
			groups[key] = append(groups[key], nil)
		}
	}
	for _, key := range order {
		var rows []*jsjson.Node
		for _, data := range groups[key] {
			if data != nil {
				rows = append(rows, data)
			}
		}
		rank(rows)
	}
	for _, block := range blocks {
		kind := typeOf(block)
		data := lookup(block, "data")
		if (kind != "database" && kind != "database-row") || data == nil || data.Kind != jsjson.KindObject {
			continue
		}
		relabelled := relabel(data, labels, ranks)
		if kind == "database" && deepEquals(lookup(relabelled, "automations"), emptyAutomations()) {
			relabelled.Remove("automations")
		}
		setMember(block, "data", relabelled)
	}
	return blocks
}

func relabel(node *jsjson.Node, labels map[string]string, ranks map[*jsjson.Node]string) *jsjson.Node {
	switch node.Kind {
	case jsjson.KindString:
		value, ok := stringOf(node)
		if !ok {
			return node.Clone()
		}
		if label, ok := labels[value]; ok {
			return str(label)
		}
		if view, ok := labels[strings.TrimSuffix(value, "-filters")]; ok && strings.HasSuffix(value, "-filters") {
			return str(view + "-filters")
		}
		return node.Clone()
	case jsjson.KindArray:
		out := jsjson.NewArray()
		for _, item := range node.Items {
			out.Items = append(out.Items, relabel(item, labels, ranks))
		}
		return out
	case jsjson.KindObject:
		out := jsjson.NewObject()
		position, ranked := ranks[node]
		for _, m := range node.Members {
			key, _ := m.Key()
			name := key.String()
			target := name
			if label, ok := labels[name]; ok {
				target = label
			}
			if name == "position" && ranked {
				setMember(out, target, str(position))
			} else {
				setMember(out, target, relabel(m.Value, labels, ranks))
			}
		}
		return out
	}
	return node.Clone()
}

func clean(block *jsjson.Node, names map[string]string) *jsjson.Node {
	copied := block.Clone()
	kind := typeOf(copied)
	rename := func(id string) string {
		if name, ok := names[id]; ok {
			return name
		}
		return id
	}
	// Clocks differ per runner: compare that a stamp is there, not its value.
	for _, stamp := range []string{"lastEditedAt", "createdAt"} {
		if lookup(copied, stamp) != nil {
			setMember(copied, stamp, jsjson.NewNumber("0"))
		}
	}
	if own, ok := idOf(copied); ok {
		setMember(copied, "id", str(rename(own)))
	}
	if parent, ok := parentOf(copied); ok {
		setMember(copied, "parent", str(rename(parent)))
	}
	if content := lookup(copied, "content"); content != nil && content.Kind == jsjson.KindArray {
		out := jsjson.NewArray()
		for _, item := range content.Items {
			if id, ok := stringOf(item); ok {
				out.Items = append(out.Items, str(rename(id)))
			} else {
				out.Items = append(out.Items, item.Clone())
			}
		}
		setMember(copied, "content", out)
	}
	if data := lookup(copied, "data"); data != nil && data.Kind == jsjson.KindObject {
		setMember(copied, "data", cleanData(kind, data, rename))
	}
	return copied
}

func cleanData(kind string, data *jsjson.Node, rename func(string) string) *jsjson.Node {
	for _, def := range loadDefaults[kind] {
		key, _ := def.Key()
		if actual := lookup(data, key.String()); actual != nil && deepEquals(actual, def.Value) {
			data.Remove(key.String())
		}
	}
	// normalizeList saves checked only on a checklist and start only when not 1.
	if kind == "list" {
		style, _ := stringOf(lookup(data, "style"))
		checked := lookup(data, "checked")
		if style != "checklist" || (checked != nil && checked.Kind == jsjson.KindFalse) {
			data.Remove("checked")
		}
		if start := lookup(data, "start"); start != nil && start.Kind == jsjson.KindNumber {
			if value, err := strconv.ParseFloat(string(start.Raw()), 64); err == nil && value == 1 {
				data.Remove("start")
			}
		}
	}
	if content := lookup(data, "content"); kind == "table" && content != nil && content.Kind == jsjson.KindArray {
		for _, row := range content.Items {
			if row.Kind != jsjson.KindArray {
				continue
			}
			for _, cell := range row.Items {
				if cell.Kind != jsjson.KindObject {
					continue
				}
				// Random until the table ships ToolRuntime.normalize.
				cell.Remove("id")
				cell.Remove("rowId")
				if cellBlocks := lookup(cell, "blocks"); cellBlocks != nil && cellBlocks.Kind == jsjson.KindArray {
					out := jsjson.NewArray()
					for _, item := range cellBlocks.Items {
						if id, ok := stringOf(item); ok {
							out.Items = append(out.Items, str(rename(id)))
						} else {
							out.Items = append(out.Items, item.Clone())
						}
					}
					setMember(cell, "blocks", out)
				}
			}
		}
	}
	for _, m := range slices.Clone(data.Members) {
		key, _ := m.Key()
		if richFields[kind][key.String()] && m.Value.Kind == jsjson.KindArray && isRichText(m.Value) {
			setMember(data, key.String(), canonicalize(m.Value))
		}
	}
	return data
}

// richFields is filled from fixtures/rich-text-fields.json, which pins the
// C# and TS built-ins.
var richFields map[string]map[string]bool

func loadRichFields(t *testing.T) {
	t.Helper()
	if richFields != nil {
		return
	}
	fields := mustParse(t, readRepoFile(t, "test/unit/server-conformance/fixtures/rich-text-fields.json"))
	richFields = map[string]map[string]bool{}
	for _, m := range fields.Members {
		kind, _ := m.Key()
		richFields[kind.String()] = map[string]bool{}
		for _, field := range m.Value.Items {
			name, _ := stringOf(field)
			richFields[kind.String()][name] = true
		}
	}
}

// Rich text, as C# RichText.IsRichText and Canonicalize.

var markOrder = []string{"link", "color", "background", "highlight", "bold", "italic", "underline", "strikethrough", "code", "sup", "sub"}

var booleanMarks = map[string]bool{"highlight": true, "bold": true, "italic": true, "underline": true, "strikethrough": true, "code": true, "sup": true, "sub": true}

func isRichText(array *jsjson.Node) bool {
	return !slices.ContainsFunc(array.Items, func(item *jsjson.Node) bool { return !isSegment(item) })
}

func hasKey(node *jsjson.Node, key string) bool { return lookup(node, key) != nil }

func isSegment(item *jsjson.Node) bool {
	if item.Kind != jsjson.KindObject {
		return false
	}
	marks := lookup(item, "marks")
	if (hasKey(item, "text") && hasKey(item, "embed")) || (marks != nil && marks.Kind != jsjson.KindObject) {
		return false
	}
	_, isText := stringOf(lookup(item, "text"))
	return (isText && hasOnlyKeys(item, "text")) || (isEmbed(lookup(item, "embed")) && hasOnlyKeys(item, "embed"))
}

func hasOnlyKeys(record *jsjson.Node, shape string) bool {
	for _, m := range record.Members {
		key, _ := m.Key()
		if key.String() != shape && key.String() != "marks" {
			return false
		}
	}
	return true
}

func isEmbed(value *jsjson.Node) bool {
	if value == nil || value.Kind != jsjson.KindObject || len(value.Members) != 1 {
		return false
	}
	key, _ := value.Members[0].Key()
	inner := value.Members[0].Value
	switch key.String() {
	case "html":
		_, ok := stringOf(inner)
		return ok
	case "equation":
		return hasOneString(inner, "expression")
	case "page":
		return hasOneString(inner, "id")
	}
	return false
}

func hasOneString(value *jsjson.Node, key string) bool {
	if value == nil || value.Kind != jsjson.KindObject || len(value.Members) != 1 {
		return false
	}
	name, _ := value.Members[0].Key()
	_, ok := stringOf(value.Members[0].Value)
	return name.String() == key && ok
}

func canonicalize(segments *jsjson.Node) *jsjson.Node {
	result := jsjson.NewArray()
	for _, raw := range segments.Items {
		if raw.Kind != jsjson.KindObject {
			continue
		}
		segment := jsjson.NewObject()
		content, isText := stringOf(lookup(raw, "text"))
		switch {
		case isText:
			setMember(segment, "text", str(content))
		case isEmbed(lookup(raw, "embed")):
			setMember(segment, "embed", jsValue(lookup(raw, "embed")))
		default:
			continue
		}
		marks := lookup(raw, "marks")
		if marks == nil || marks.Kind != jsjson.KindObject {
			marks = jsjson.NewObject()
		}
		if ordered := orderMarks(marks); ordered != nil {
			setMember(segment, "marks", ordered)
		}
		if isText && content == "" {
			continue
		}
		if count := len(result.Items); isText && count > 0 {
			last := result.Items[count-1]
			if previous, ok := stringOf(lookup(last, "text")); ok && sameMarks(last, segment) {
				merged := last.Clone()
				setMember(merged, "text", str(previous+content))
				result.Items[count-1] = merged
				continue
			}
		}
		result.Items = append(result.Items, segment)
	}
	return jsOrder(result)
}

// jsOrder puts object keys in the order JS writes them (array indexes
// first), as RichText.ToJsonNode does through JsJson.KeyOrder.
func jsOrder(node *jsjson.Node) *jsjson.Node {
	for _, item := range node.Items {
		jsOrder(item)
	}
	if node.Kind != jsjson.KindObject {
		return node
	}
	members := make([]jsjson.Member, len(node.Members))
	for i, m := range node.Members {
		key, _ := m.Key()
		members[i] = jsjson.Member{Key: key, Value: m}
		jsOrder(m.Value)
	}
	for i, m := range jsjson.KeyOrder(members) {
		node.Members[i] = m.Value.(jsjson.NodeMember)
	}
	return node
}

func orderMarks(record *jsjson.Node) *jsjson.Node {
	var unknown []string
	for _, m := range record.Members {
		key, _ := m.Key()
		if !slices.Contains(markOrder, key.String()) {
			unknown = append(unknown, key.String())
		}
	}
	slices.SortFunc(unknown, func(a, b string) int { return jsjson.Compare(jsjson.FromString(a), jsjson.FromString(b)) })
	ordered := jsjson.NewObject()
	for _, key := range append(slices.Clone(markOrder), unknown...) {
		raw := lookup(record, key)
		if raw == nil {
			continue
		}
		if value := markValue(key, raw); value != nil {
			setMember(ordered, key, value)
		}
	}
	if len(ordered.Members) == 0 {
		return nil
	}
	return ordered
}

// markValue is C# MarkValue; nil means the mark is absent.
func markValue(key string, raw *jsjson.Node) *jsjson.Node {
	if key == "link" {
		href, ok := stringOf(lookup(raw, "href"))
		if raw.Kind != jsjson.KindObject || !ok {
			return nil
		}
		link := jsjson.NewObject(jsjson.NewMember("href", str(href)))
		if target, ok := stringOf(lookup(raw, "target")); ok {
			setMember(link, "target", str(target))
		}
		if rel, ok := stringOf(lookup(raw, "rel")); ok {
			setMember(link, "rel", str(rel))
		}
		return link
	}
	if booleanMarks[key] {
		if raw.Kind == jsjson.KindTrue {
			return jsjson.NewBool(true)
		}
		return nil
	}
	if raw.Kind == jsjson.KindNull {
		return nil
	}
	if key == "color" || key == "background" {
		if _, ok := stringOf(raw); ok {
			return raw.Clone()
		}
		return nil
	}
	if strings.HasPrefix(key, "tag:") {
		if raw.Kind != jsjson.KindObject {
			return nil
		}
		var names []string
		for _, m := range raw.Members {
			name, _ := m.Key()
			if _, ok := stringOf(m.Value); ok {
				names = append(names, name.String())
			}
		}
		slices.SortFunc(names, func(a, b string) int { return jsjson.Compare(jsjson.FromString(a), jsjson.FromString(b)) })
		sorted := jsjson.NewObject()
		for _, name := range names {
			setMember(sorted, name, lookup(raw, name).Clone())
		}
		return sorted
	}
	return jsValue(raw)
}

// jsValue is a value after JsJson.Parse and RichText.ToJsonNode: numbers
// re-spelled from their double (UNVERIFIED past 2^53, where C# writes a
// double and not a long).
func jsValue(node *jsjson.Node) *jsjson.Node {
	switch node.Kind {
	case jsjson.KindNumber:
		value, _ := strconv.ParseFloat(string(node.Raw()), 64)
		if math.IsInf(value, 0) {
			return jsjson.NewNull()
		}
		return jsjson.NewNumber(jsjson.FormatNumber(value))
	case jsjson.KindArray:
		out := jsjson.NewArray()
		for _, item := range node.Items {
			out.Items = append(out.Items, jsValue(item))
		}
		return out
	case jsjson.KindObject:
		out := jsjson.NewObject()
		for _, m := range node.Members {
			key, _ := m.Key()
			setMember(out, key.String(), jsValue(m.Value))
		}
		return out
	}
	return node.Clone()
}

// sameMarks is C# SameMarks: keys sorted at every object depth, array
// members left as written.
func sameMarks(left, right *jsjson.Node) bool {
	return sortedText(lookup(left, "marks"), true) == sortedText(lookup(right, "marks"), true)
}

func sortedText(node *jsjson.Node, sortObjects bool) string {
	if node == nil {
		return "{}"
	}
	switch node.Kind {
	case jsjson.KindObject:
		members := slices.Clone(node.Members)
		if sortObjects {
			slices.SortFunc(members, func(a, b jsjson.NodeMember) int {
				x, _ := a.Key()
				y, _ := b.Key()
				return jsjson.Compare(x, y)
			})
		}
		parts := make([]string, len(members))
		for i, m := range members {
			key, _ := m.Key()
			parts[i] = string(jsjson.AppendQuoted(nil, key)) + ":" + sortedText(m.Value, sortObjects)
		}
		return "{" + strings.Join(parts, ",") + "}"
	case jsjson.KindArray:
		parts := make([]string, len(node.Items))
		for i, item := range node.Items {
			parts[i] = sortedText(item, false)
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	out, _ := jsValue(node).AppendJSON(nil)
	return string(out)
}

func TestNormalizerMatchesTheTypeScriptNormalizer(t *testing.T) {
	loadRichFields(t)
	file := mustParse(t, readRepoFile(t, "test/fixtures/agent-commands/normalizer-cases.json"))
	ran := 0
	for _, item := range lookup(file, "cases").Items {
		name, _ := stringOf(lookup(item, "name"))
		if lookup(item, "tsOnly") != nil {
			continue
		}
		ran++
		t.Run(name, func(t *testing.T) {
			keep := map[string]bool{}
			for _, id := range lookup(item, "keepIds").Items {
				value, _ := stringOf(id)
				keep[value] = true
			}
			got := stable(t, normalizeDocument(lookup(item, "input"), keep))
			if want := stable(t, lookup(item, "expected")); got != want {
				t.Fatalf("got  %s\nwant %s", got, want)
			}
		})
	}
	if ran != 8 {
		t.Fatalf("ran %d normalizer cases, want the 8 C# runs", ran)
	}
}

func TestCanonicalizeMatchesTheRichTextFixture(t *testing.T) {
	inputs := lookup(mustParse(t, readRepoFile(t, "test/unit/server-conformance/fixtures/rich-text-canonical/inputs.json")), "segments")
	expected := lookup(mustParse(t, readRepoFile(t, "test/unit/server-conformance/fixtures/rich-text-canonical/expected.json")), "segments")
	if len(inputs.Items) == 0 {
		t.Fatal("no cases")
	}
	for _, item := range inputs.Items {
		name, _ := stringOf(lookup(item, "name"))
		t.Run(name, func(t *testing.T) {
			input := lookup(item, "input")
			want, _ := lookup(expected, name).AppendJSON(nil)
			var got []byte
			if input.Kind == jsjson.KindArray {
				got, _ = canonicalize(input).AppendJSON(nil)
			}
			if string(got) != string(want) {
				t.Fatalf("got  %s\nwant %s", got, want)
			}
		})
	}
}
