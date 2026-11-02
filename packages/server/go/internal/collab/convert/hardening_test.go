package convert

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

// fixtures/collab-hardening/cases.json: the seed and export cases of C#
// YDocConverterHardeningTests, LawTests, TextMergeTests and ViewSettingsTests,
// captured by YDocConverterHardeningCaptureTests.
type hardeningCases struct {
	SeedClient uint32 `json:"seedClient"`
	Exports    []struct {
		Name       string          `json:"name"`
		Update     string          `json:"update"`
		Export     json.RawMessage `json:"export"`
		ExportPage json.RawMessage `json:"exportPage"`
		Warnings   []string        `json:"warnings"`
		Slots      [][4]string     `json:"slots"`
	} `json:"exports"`
	Seeds []struct {
		Name   string  `json:"name"`
		Before string  `json:"before"`
		Blocks string  `json:"blocks"`
		Page   *string `json:"page"`
		HTML   []struct {
			HTML     string          `json:"html"`
			Segments json.RawMessage `json:"segments"`
		} `json:"html"`
		Refused    *string         `json:"refused"`
		State      string          `json:"state"`
		Export     json.RawMessage `json:"export"`
		ExportPage json.RawMessage `json:"exportPage"`
		Slots      [][4]string     `json:"slots"`
	} `json:"seeds"`
}

func slotRows(slots []RichTextHTMLSlot) [][4]string {
	rows := [][4]string{}
	for _, slot := range slots {
		rows = append(rows, [4]string{slot.HTML.Type, slot.HTML.Field, slot.Key.String(), slot.HTML.HTML.String()})
	}
	return rows
}

func TestExportReadsEveryPeerShapeLikeCSharp(t *testing.T) {
	var fixture hardeningCases
	collabtest.Read(t, "collab-hardening/cases.json", &fixture)
	if len(fixture.Exports) < 30 {
		t.Fatalf("only %d export cases", len(fixture.Exports))
	}
	for _, c := range fixture.Exports {
		t.Run(c.Name, func(t *testing.T) {
			doc := yjs.NewDoc(yjs.Options{})
			if result, err := doc.ApplyUpdate(decode64(t, c.Update)); err != nil || result.Outcome != yjs.Applied {
				t.Fatalf("%+v %v", result, err)
			}
			warnings := []string{}
			blocks, slots, err := Export(doc, BuiltInRichTextFields(), func(line string) { warnings = append(warnings, line) })
			if err != nil {
				t.Fatal(err)
			}
			if got, want := canonical(t, blocks), canonical(t, jsValue(t, c.Export)); got != want {
				t.Errorf("export\n got %s\nwant %s", got, want)
			}
			if got, want := canonical(t, ExportPage(doc)), canonical(t, jsValue(t, c.ExportPage)); got != want {
				t.Errorf("page\n got %s\nwant %s", got, want)
			}
			if fmt.Sprint(warnings) != fmt.Sprint(c.Warnings) {
				t.Errorf("warnings\n got %q\nwant %q", warnings, c.Warnings)
			}
			if got := slotRows(slots); fmt.Sprint(got) != fmt.Sprint(c.Slots) {
				t.Errorf("slots\n got %q\nwant %q", got, c.Slots)
			}
		})
	}
}

// A seed must write C#'s bytes, or refuse with C#'s words and write nothing.
func TestSeedWritesOrRefusesLikeCSharp(t *testing.T) {
	var fixture hardeningCases
	collabtest.Read(t, "collab-hardening/cases.json", &fixture)
	if len(fixture.Seeds) < 50 {
		t.Fatalf("only %d seed cases", len(fixture.Seeds))
	}
	original := GenerateRowKey
	t.Cleanup(func() { GenerateRowKey = original })
	for _, c := range fixture.Seeds {
		t.Run(c.Name, func(t *testing.T) {
			GenerateRowKey = rowKeyCounter("s")
			client := fixture.SeedClient
			doc := yjs.NewDoc(yjs.Options{ClientID: &client})
			if c.Before != "" {
				if result, err := doc.ApplyUpdate(decode64(t, c.Before)); err != nil || result.Outcome != yjs.Applied {
					t.Fatalf("before: %+v %v", result, err)
				}
			}
			var page *jsjson.Object
			if c.Page != nil {
				page = jsValue(t, []byte(*c.Page)).(*jsjson.Object)
			}
			// The fixture nests past jsjson's default depth of 64, as C# read it.
			parsed, err := jsjson.ParseNode([]byte(c.Blocks), jsjson.Options{MaxDepth: 1024})
			if err != nil {
				t.Fatal(err)
			}
			blocks := parsed.Items
			converted := map[string][]any{}
			for _, h := range c.HTML {
				converted[HTMLKey(str(h.HTML))] = jsValue(t, h.Segments).([]any)
			}
			var emitted int
			doc.OnUpdate(func(yjs.UpdateEvent) { emitted++ })
			vector := doc.EncodeStateVector()
			_, err = CollectSeedHTML(blocks, BuiltInRichTextFields())
			if err == nil {
				err = Seed(doc, blocks, Converting(BuiltInRichTextFields(), converted), page)
			}
			if c.Refused != nil {
				var data *DataError
				if !errors.As(err, &data) || data.Message != *c.Refused {
					t.Fatalf("refusal: got %v, want %q", err, *c.Refused)
				}
				if emitted != 0 || !bytes.Equal(vector, doc.EncodeStateVector()) {
					t.Fatal("a refused seed wrote")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			state, err := doc.EncodeStateAsUpdate(nil)
			if err != nil {
				t.Fatal(err)
			}
			if got := base64.StdEncoding.EncodeToString(state); got != c.State {
				t.Errorf("state\n got %s\nwant %s", got, c.State)
			}
			exported, slots, err := Export(doc, BuiltInRichTextFields(), nil)
			if err != nil {
				t.Fatal(err)
			}
			if got, want := canonical(t, exported), canonical(t, jsValue(t, c.Export)); got != want {
				t.Errorf("export\n got %s\nwant %s", got, want)
			}
			if got, want := canonical(t, ExportPage(doc)), canonical(t, jsValue(t, c.ExportPage)); got != want {
				t.Errorf("page\n got %s\nwant %s", got, want)
			}
			if got := slotRows(slots); fmt.Sprint(got) != fmt.Sprint(c.Slots) {
				t.Errorf("slots\n got %q\nwant %q", got, c.Slots)
			}
		})
	}
}

// Twin of ExportWalksALongParentChainWithoutRecursing. Too big for the
// fixture: a chain far past any recursion limit must export whole.
func TestExportWalksALongParentChainWithoutRecursing(t *testing.T) {
	const length = 20000
	var text bytes.Buffer
	text.WriteString("[")
	for i := range length {
		if i > 0 {
			text.WriteString(",")
		}
		fmt.Fprintf(&text, `{"id":"b%d","type":"paragraph","data":{"text":[{"text":"x"}]}`, i)
		if i > 0 {
			fmt.Fprintf(&text, `,"parent":"b%d"`, i-1)
		}
		if i < length-1 {
			fmt.Fprintf(&text, `,"content":["b%d"]`, i+1)
		}
		text.WriteString("}")
	}
	text.WriteString("]")
	doc := yjs.NewDoc(yjs.Options{})
	if err := Seed(doc, node(t, text.Bytes()).Items, Refusing(BuiltInRichTextFields()), nil); err != nil {
		t.Fatal(err)
	}
	blocks, _, err := Export(doc, BuiltInRichTextFields(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(blocks) != length || blocks[0].(*jsjson.Object).Members()[0].Value.(jsjson.Str).String() != "b0" {
		t.Fatalf("%d blocks", len(blocks))
	}
}
