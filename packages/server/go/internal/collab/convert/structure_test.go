package convert

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/lib0"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

type structureCase struct {
	Name       string  `json:"name"`
	Room       *string `json:"room"`
	RoomUpdate *string `json:"roomUpdate"`
	Structure  struct {
		Keys []struct {
			ID           string    `json:"id"`
			IsBlock      bool      `json:"isBlock"`
			StoredParent *string   `json:"storedParent"`
			Listed       *[]string `json:"listed"`
		} `json:"keys"`
		RootOrder []string `json:"rootOrder"`
		Reached   []string `json:"reached"`
	} `json:"structure"`
	PageMaps          map[string]map[string]string `json:"pageMaps"`
	Plain             json.RawMessage              `json:"plainPageMaps"`
	PlainSkippedTitle json.RawMessage              `json:"plainPageMapsSkippingTitle"`
	EqualPairs        [][2]string                  `json:"equalPairs"`
}

// ordered writes JSON keeping each object's member order, so a key order
// difference shows.
func ordered(v any) string {
	switch v := v.(type) {
	case *jsjson.Object:
		var parts []string
		for _, m := range v.Members() {
			parts = append(parts, string(jsjson.AppendQuoted(nil, m.Key))+":"+ordered(m.Value))
		}
		return "{" + strings.Join(parts, ",") + "}"
	case []any:
		var parts []string
		for _, item := range v {
			parts = append(parts, ordered(item))
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	text, _ := jsjson.Stringify(v)
	return text
}

func valueKind(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case jsjson.Str:
		return "string"
	case float64:
		return "number"
	case bool:
		return "bool"
	case *jsjson.Object:
		return "object"
	case []any:
		return "array"
	case []byte:
		return "bytes"
	case lib0.BigInt:
		return "bigint"
	case jsjson.Undefined:
		return "undefined"
	case *yjs.Map:
		return "YMap"
	case *yjs.Array:
		return "YArray"
	case *yjs.XmlText:
		return "YXmlText"
	case *yjs.Text:
		return "YText"
	}
	return fmt.Sprintf("%T", v)
}

func plainMapsJSON(maps []PlainPageMap) string {
	var parts []string
	for _, m := range maps {
		parts = append(parts, `{"name":"`+m.Name+`","map":`+ordered(m.Map)+`}`)
	}
	return "[" + strings.Join(parts, ",") + "]"
}

// Twin of YDocConverterStructureCaptureTests.
func TestTheDocReadsMatchCSharp(t *testing.T) {
	var fixture struct {
		Cases []structureCase `json:"cases"`
	}
	collabtest.Read(t, "collab-structure/cases.json", &fixture)
	if len(fixture.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			var room []byte
			if c.Room != nil {
				raw, err := os.ReadFile(filepath.Join(collabtest.Path(t, "collab"), *c.Room, "update.b64"))
				if err != nil {
					t.Fatal(err)
				}
				room = decode64(t, strings.TrimSpace(string(raw)))
			} else {
				room = decode64(t, *c.RoomUpdate)
			}
			doc := yjs.NewDoc(yjs.Options{})
			if _, err := doc.ApplyUpdate(room); err != nil {
				t.Fatal(err)
			}

			structure := DescribeStructure(doc)
			var got, want []string
			keys := slices.Clone(structure.Keys)
			slices.SortFunc(keys, func(a, b KeyShape) int { return jsjson.Compare(a.ID, b.ID) })
			for _, k := range keys {
				got = append(got, fmt.Sprintf("%s %v %v %v", k.ID.String(), k.IsBlock, strs(k.StoredParent), listed(k.Listed)))
			}
			for _, k := range c.Structure.Keys {
				var parent *jsjson.Str
				if k.StoredParent != nil {
					p := str(*k.StoredParent)
					parent = &p
				}
				var l []jsjson.Str
				if k.Listed != nil {
					l = []jsjson.Str{}
					for _, id := range *k.Listed {
						l = append(l, str(id))
					}
				}
				want = append(want, fmt.Sprintf("%s %v %v %v", k.ID, k.IsBlock, strs(parent), listed(l)))
			}
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Errorf("keys\n got %v\nwant %v", got, want)
			}
			var order []string
			for _, id := range structure.RootOrder {
				order = append(order, id.String())
			}
			if fmt.Sprint(order) != fmt.Sprint(c.Structure.RootOrder) {
				t.Errorf("order %v, want %v", order, c.Structure.RootOrder)
			}
			var reached []string
			for _, k := range keys {
				if structure.Reached(k.ID) {
					reached = append(reached, k.ID.String())
				}
			}
			// Asked per key, as the restore planner asks it.
			if fmt.Sprint(reached) != fmt.Sprint(c.Structure.Reached) {
				t.Errorf("reached %v, want %v", reached, c.Structure.Reached)
			}

			var names []string
			kinds := map[string]map[string]string{}
			type named struct {
				name  string
				value any
			}
			var values []named
			for _, m := range ReadPageMaps(doc) {
				names = append(names, m.Name)
				kinds[m.Name] = map[string]string{}
				entries := slices.Clone(m.Entries)
				slices.SortFunc(entries, func(a, b yjs.MapEntry) int { return jsjson.Compare(a.Key, b.Key) })
				for _, e := range entries {
					kinds[m.Name][e.Key.String()] = valueKind(e.Value)
					values = append(values, named{m.Name + "." + e.Key.String(), e.Value})
				}
			}
			if fmt.Sprint(names) != fmt.Sprint(PageMaps) || fmt.Sprint(kinds) != fmt.Sprint(c.PageMaps) {
				t.Errorf("page maps\n got %v\nwant %v", kinds, c.PageMaps)
			}
			if got, want := plainMapsJSON(PlainPageMaps(doc, nil)), ordered(jsValue(t, c.Plain)); got != want {
				t.Errorf("plain\n got %s\nwant %s", got, want)
			}
			if got, want := plainMapsJSON(PlainPageMaps(doc, map[string]bool{"title": true})), ordered(jsValue(t, c.PlainSkippedTitle)); got != want {
				t.Errorf("plain skipping title\n got %s\nwant %s", got, want)
			}
			var pairs [][2]string
			for i := range values {
				for j := i + 1; j < len(values); j++ {
					if PlainMapValuesEqual(values[i].value, values[j].value) {
						pairs = append(pairs, [2]string{values[i].name, values[j].name})
					}
				}
			}
			if fmt.Sprint(pairs) != fmt.Sprint(c.EqualPairs) {
				t.Errorf("equal pairs\n got %v\nwant %v", pairs, c.EqualPairs)
			}
		})
	}
}

func strs(s *jsjson.Str) string {
	if s == nil {
		return "<nil>"
	}
	return s.String()
}

func listed(ids []jsjson.Str) string {
	if ids == nil {
		return "<none>"
	}
	var parts []string
	for _, id := range ids {
		parts = append(parts, id.String())
	}
	return "[" + strings.Join(parts, " ") + "]"
}
