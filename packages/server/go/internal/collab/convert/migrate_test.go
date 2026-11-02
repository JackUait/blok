package convert

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/collab/collabtest"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

type migrationCase struct {
	Name         string              `json:"name"`
	Room         *string             `json:"room"`
	RoomUpdate   *string             `json:"roomUpdate"`
	ShapeUpdate  *string             `json:"shapeUpdate"`
	CustomFields map[string][]string `json:"customFields"`
	Found        []struct {
		Type     string          `json:"type"`
		Field    string          `json:"field"`
		HTML     string          `json:"html"`
		Segments json.RawMessage `json:"segments"`
	} `json:"found"`
	Refusing *string         `json:"refusing"`
	Migrated int             `json:"migrated"`
	Updates  []string        `json:"updates"`
	Export   json.RawMessage `json:"export"`
}

// Twin of YDocConverterMigrationCaptureTests: the same room collects the
// same HTML, and migrating it with the same segments emits the same bytes.
func TestMigrateRichTextWritesWhatCSharpWrites(t *testing.T) {
	var fixture struct {
		EditClient uint32          `json:"editClient"`
		Cases      []migrationCase `json:"cases"`
	}
	collabtest.Read(t, "collab-migrations/cases.json", &fixture)
	if len(fixture.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			var room []byte
			if c.Room != nil {
				raw, err := os.ReadFile(filepath.Join(collabtest.Path(t, "collab-format1"), *c.Room, "update.b64"))
				if err != nil {
					t.Fatal(err)
				}
				room = decode64(t, strings.TrimSpace(string(raw)))
			} else {
				room = decode64(t, *c.RoomUpdate)
			}
			client := fixture.EditClient
			doc := yjs.NewDoc(yjs.Options{ClientID: &client})
			if result, err := doc.ApplyUpdate(room); err != nil || result.Outcome != yjs.Applied {
				t.Fatalf("room: %+v %v", result, err)
			}
			if c.ShapeUpdate != nil {
				if _, err := doc.ApplyUpdate(decode64(t, *c.ShapeUpdate)); err != nil {
					t.Fatal(err)
				}
			}
			fields := BuiltInRichTextFields()
			if c.CustomFields != nil {
				var err error
				if fields, err = NewRichTextFields(c.CustomFields); err != nil {
					t.Fatal(err)
				}
			}
			found := CollectLegacyRichText(doc, fields)
			converted := map[string][]any{}
			var got, want []string
			for _, f := range found {
				got = append(got, fmt.Sprintf("%s.%s=%q", f.Type, f.Field, f.HTML.String()))
			}
			for _, f := range c.Found {
				want = append(want, fmt.Sprintf("%s.%s=%q", f.Type, f.Field, f.HTML))
				converted[HTMLKey(str(f.HTML))] = jsValue(t, f.Segments).([]any)
			}
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("found\n got %v\nwant %v", got, want)
			}
			if c.Refusing != nil {
				vector := doc.EncodeStateVector()
				_, err := MigrateRichText(doc, Refusing(fields))
				var data *DataError
				if !errors.As(err, &data) || data.Message != *c.Refusing || !bytes.Equal(vector, doc.EncodeStateVector()) {
					t.Fatalf("refusing: %v", err)
				}
			}
			var updates []string
			doc.OnUpdate(func(e yjs.UpdateEvent) {
				if e.Local {
					updates = append(updates, base64.StdEncoding.EncodeToString(e.Update))
				}
			})
			migrated, err := MigrateRichText(doc, Converting(fields, converted))
			if err != nil {
				t.Fatal(err)
			}
			if migrated != c.Migrated {
				t.Errorf("migrated %d, want %d", migrated, c.Migrated)
			}
			if fmt.Sprint(updates) != fmt.Sprint(c.Updates) {
				t.Errorf("updates\n got %v\nwant %v", updates, c.Updates)
			}
			blocks, _, err := Export(doc, fields, nil)
			if err != nil {
				t.Fatal(err)
			}
			if got, want := canonical(t, blocks), canonical(t, jsValue(t, c.Export)); got != want {
				t.Errorf("export\n got %s\nwant %s", got, want)
			}
			if left := CollectLegacyRichText(doc, fields); len(left) != 0 {
				t.Errorf("left %v", left)
			}
		})
	}
}
