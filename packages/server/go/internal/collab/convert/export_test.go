package convert

import (
	"encoding/base64"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// canonical is YDocConverterFixtures.Canonicalize: keys in ordinal order,
// numbers by value. Compare two of these, never raw JSON text.
func canonical(t *testing.T, value any) string {
	var b strings.Builder
	var write func(any)
	write = func(value any) {
		switch value := value.(type) {
		case nil:
			b.WriteString("null")
		case bool:
			b.WriteString(strconv.FormatBool(value))
		case int64:
			write(float64(value))
		case float64:
			if value == math.Trunc(value) && math.Abs(value) <= maxSafeInteger {
				b.WriteString(strconv.FormatInt(int64(value), 10))
			} else {
				b.WriteString(dotnet.FormatDouble(value))
			}
		case jsjson.Str:
			b.Write(jsjson.AppendQuoted(nil, value))
		case []any:
			b.WriteByte('[')
			for i, item := range value {
				if i > 0 {
					b.WriteByte(',')
				}
				write(item)
			}
			b.WriteByte(']')
		case *jsjson.Object:
			members := slices.Clone(value.Members())
			slices.SortFunc(members, func(x, y jsjson.Member) int { return jsjson.Compare(x.Key, y.Key) })
			b.WriteByte('{')
			for i, m := range members {
				if i > 0 {
					b.WriteByte(',')
				}
				b.Write(jsjson.AppendQuoted(nil, m.Key))
				b.WriteByte(':')
				write(m.Value)
			}
			b.WriteByte('}')
		default:
			t.Fatalf("not JSON: %T", value)
		}
	}
	write(value)
	return b.String()
}

type collabCase struct {
	name      string
	update    []byte
	input     any
	segments  any
	page      any
	pageCanon any
}

func collabCases(t *testing.T) []collabCase {
	root := collabtest.Path(t, "collab")
	dirs, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	var cases []collabCase
	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		name := dir.Name()
		raw, err := os.ReadFile(filepath.Join(root, name, "update.b64"))
		if err != nil {
			t.Fatal(err)
		}
		update, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil {
			t.Fatal(err)
		}
		c := collabCase{name: name, update: update, input: engine(t, "collab/"+name+"/input.json"), segments: engine(t, "collab/"+name+"/canonical.segments.json")}
		if _, err := os.Stat(filepath.Join(root, name, "page.json")); err == nil {
			c.page = engine(t, "collab/"+name+"/page.json")
			c.pageCanon = engine(t, "collab/"+name+"/page-canonical.json")
		}
		cases = append(cases, c)
	}
	// Twin of ManifestListsExactlyTheCommittedCases.
	var manifest struct {
		Cases []struct{ Name string } `json:"cases"`
	}
	collabtest.Read(t, "collab/manifest.json", &manifest)
	var listed, found []string
	for _, entry := range manifest.Cases {
		listed = append(listed, entry.Name)
	}
	for _, c := range cases {
		found = append(found, c.name)
	}
	slices.Sort(listed)
	if len(found) == 0 || !slices.Equal(listed, found) {
		t.Fatalf("manifest %v, folders %v", listed, found)
	}
	return cases
}

func applied(t *testing.T, update []byte) *yjs.Doc {
	doc := yjs.NewDoc(yjs.Options{})
	result, err := doc.ApplyUpdate(update)
	// A parked update would export empty and still match empty-doc.
	if err != nil || result.Outcome != yjs.Applied || doc.HasPending() {
		t.Fatalf("%+v %v", result, err)
	}
	return doc
}

// Twin of YDocConverterConformanceTests.ApplyingTheClientUpdateExportsCanonicalJson.
func TestExportingTheClientUpdateGivesTheCanonicalJSON(t *testing.T) {
	for _, c := range collabCases(t) {
		blocks, slots, err := Export(applied(t, c.update), BuiltInRichTextFields(), nil)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if len(slots) > 0 {
			t.Errorf("%s: %d HTML slots from a format-2 client", c.name, len(slots))
		}
		if got, want := canonical(t, blocks), canonical(t, c.segments); got != want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, got, want)
		}
	}
}

// Twin of ApplyingTheClientUpdateExportsCanonicalPage.
func TestExportingTheClientUpdateGivesTheCanonicalPage(t *testing.T) {
	pages := 0
	for _, c := range collabCases(t) {
		if c.page == nil {
			continue
		}
		pages++
		if got, want := canonical(t, ExportPage(applied(t, c.update))), canonical(t, c.pageCanon); got != want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, got, want)
		}
	}
	if pages != 13 {
		t.Fatalf("%d page cases, want 13", pages)
	}
}
