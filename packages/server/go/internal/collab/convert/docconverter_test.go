package convert

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

var fixedNow = time.Date(2026, 11, 2, 3, 4, 5, 6_000_000, time.UTC)

func converter(t *testing.T, reader HTMLReader) *DocConverter {
	if reader == nil {
		reader = runtimeReader(t)
	}
	return &DocConverter{Now: func() time.Time { return fixedNow }, HTML: reader}
}

func parseNode(t *testing.T, text string) *jsjson.Node {
	node, err := jsjson.ParseNode([]byte(text), jsjson.Options{MaxDepth: JSONMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	return node
}

func path(value any, keys ...any) any {
	for _, key := range keys {
		switch key := key.(type) {
		case string:
			value = lookupValue(value.(*jsjson.Object), key)
		case int:
			value = value.([]any)[key]
		}
	}
	return value
}

// Twins of CollabDocConverterTests.
func TestSeedsTheBlocksOfAnOutputDataObjectAndExportsThemBackWithATimestamp(t *testing.T) {
	doc := yjs.NewDoc(yjs.Options{})
	c := converter(t, nil)
	if err := c.Seed(context.Background(), doc, parseNode(t, `{"time":1,"blocks":[{"id":"a","type":"paragraph","data":{"text":"hi <b>you</b>"}}],"version":"1.12.0"}`)); err != nil {
		t.Fatal(err)
	}
	exported, err := c.Export(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	if got := lookupValue(exported, "time"); got != fixedNow.UnixMilli() {
		t.Fatalf("time %v", got)
	}
	blocks := lookupValue(exported, "blocks").([]any)
	if len(blocks) != 1 || path(blocks, 0, "id").(jsjson.Str).String() != "a" || path(blocks, 0, "type").(jsjson.Str).String() != "paragraph" {
		t.Fatal(stringify(t, blocks))
	}
	if got := stringify(t, path(blocks, 0, "data", "text")); got != `[{"text":"hi "},{"text":"you","marks":{"bold":true}}]` {
		t.Fatal(got)
	}
}

func setBlock(doc *yjs.Doc, id string, block *yjs.Map, root ...any) {
	doc.Transact(func(tx *yjs.Transaction) {
		doc.GetMap(str("blocks")).Set(tx, str(id), block)
		if len(root) > 0 {
			doc.GetArray(str("root")).Insert(tx, 0, root)
		}
	})
}

func newBlock(id, kind string, data *yjs.Map) *yjs.Map {
	return yjs.NewMap(yjs.MapEntry{Key: str("id"), Value: str(id)}, yjs.MapEntry{Key: str("type"), Value: str(kind)}, yjs.MapEntry{Key: str("data"), Value: data})
}

func TestForwardsExportWarningsToTheLog(t *testing.T) {
	doc := yjs.NewDoc(yjs.Options{})
	var warnings []string
	c := converter(t, nil)
	c.Log = func(message string) { warnings = append(warnings, message) }
	setBlock(doc, "bad", yjs.NewMap(yjs.MapEntry{Key: str("id"), Value: 1.0}, yjs.MapEntry{Key: str("type"), Value: str("paragraph")}, yjs.MapEntry{Key: str("data"), Value: yjs.NewMap()}))
	if _, err := c.Export(context.Background(), doc); err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(warnings, func(w string) bool { return strings.Contains(w, `"bad"`) }) {
		t.Fatal(warnings)
	}
}

func TestRefusesADocumentWithoutABlocksArray(t *testing.T) {
	for _, body := range []string{`[]`, `"text"`, `{"time":1}`, `{"blocks":{}}`} {
		err := converter(t, nil).Seed(context.Background(), yjs.NewDoc(yjs.Options{}), parseNode(t, body))
		var data *DataError
		if !errors.As(err, &data) {
			t.Errorf("%s: %v", body, err)
		}
	}
}

func TestExportReadsLegacyHtmlTextAsSegments(t *testing.T) {
	doc := yjs.NewDoc(yjs.Options{})
	nested := yjs.NewMap(yjs.MapEntry{Key: str("type"), Value: str("paragraph")}, yjs.MapEntry{Key: str("data"), Value: yjs.NewMap(yjs.MapEntry{Key: str("text"), Value: str("<i>n</i>")})})
	properties := yjs.NewMap(yjs.MapEntry{Key: str("notes"), Value: yjs.NewMap(yjs.MapEntry{Key: str("blocks"), Value: yjs.NewArray(nested)})})
	doc.Transact(func(tx *yjs.Transaction) {
		doc.GetMap(str("blocks")).Set(tx, str("a"), newBlock("a", "paragraph", yjs.NewMap(yjs.MapEntry{Key: str("text"), Value: yjs.NewText(str("<b>x</b>"))})))
		doc.GetMap(str("blocks")).Set(tx, str("r"), newBlock("r", "database-row", yjs.NewMap(yjs.MapEntry{Key: str("properties"), Value: properties})))
		doc.GetArray(str("root")).Insert(tx, 0, []any{str("a"), str("r")})
	})
	exported, err := converter(t, nil).Export(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	blocks := lookupValue(exported, "blocks")
	if got := stringify(t, path(blocks, 0, "data", "text")); got != `[{"text":"x","marks":{"bold":true}}]` {
		t.Fatal(got)
	}
	if got := stringify(t, path(blocks, 1, "data", "properties", "notes", "blocks", 0, "data", "text")); got != `[{"text":"n","marks":{"italic":true}}]` {
		t.Fatal(got)
	}
}

func TestCustomRichFieldsComeFromTheConstructor(t *testing.T) {
	fields, err := NewRichTextFields(map[string][]string{"callout": {"title"}})
	if err != nil {
		t.Fatal(err)
	}
	doc := yjs.NewDoc(yjs.Options{})
	c := converter(t, nil)
	c.Fields = fields
	if err := c.Seed(context.Background(), doc, parseNode(t, `{"blocks":[{"id":"c","type":"callout","data":{"title":"<u>T</u>"}}]}`)); err != nil {
		t.Fatal(err)
	}
	block, _ := doc.GetMap(str("blocks")).Get(str("c"))
	data, _ := block.(*yjs.Map).Get(str("data"))
	title, _ := data.(*yjs.Map).Get(str("title"))
	if _, ok := title.(*yjs.XmlText); !ok {
		t.Fatalf("%T", title)
	}
}

type failingReader struct{ err error }

func (f failingReader) Read(context.Context, []RichTextHTML, time.Duration) ([][]any, error) {
	return nil, f.err
}

func legacyHTMLDoc() *yjs.Doc {
	doc := yjs.NewDoc(yjs.Options{})
	setBlock(doc, "a", newBlock("a", "paragraph", yjs.NewMap(yjs.MapEntry{Key: str("text"), Value: yjs.NewText(str("<b>x</b>"))})), str("a"))
	return doc
}

func TestAnExportRuntimeLimitIsTransient(t *testing.T) {
	for _, kind := range []jsruntime.Kind{jsruntime.KindTimedOut, jsruntime.KindDocumentTooLarge} {
		failure := &jsruntime.Failure{Kind: kind, Err: errors.New("limit")}
		_, err := converter(t, failingReader{failure}).Export(context.Background(), legacyHTMLDoc())
		var transient *TransientError
		if !errors.As(err, &transient) || transient.Err != failure {
			t.Errorf("%v: %v", kind, err)
		}
	}
}

func TestAnEnginePoolWaitCancelledElsewhereIsTransient(t *testing.T) {
	_, err := converter(t, failingReader{context.Canceled}).Export(context.Background(), legacyHTMLDoc())
	var transient *TransientError
	if !errors.As(err, &transient) {
		t.Fatal(err)
	}
}

func TestAnExportFailureThatRepeatsIsNotTransient(t *testing.T) {
	for _, failure := range []error{
		&jsruntime.Failure{Kind: jsruntime.KindInvalidDocument, Err: errors.New("TypeError")},
		&jsruntime.Failure{Kind: jsruntime.KindUnknown, Err: errors.New("RangeError")},
		dataError("collab: the runtime answered htmlFieldsToSegments with the wrong shape."),
		errors.New("not the runtime's own classification"),
	} {
		if _, err := converter(t, failingReader{failure}).Export(context.Background(), legacyHTMLDoc()); err != failure {
			t.Errorf("%v: %v", failure, err)
		}
	}
}

func TestAnExportCancelledByItsTokenStaysACancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := converter(t, failingReader{ctx.Err()}).Export(ctx, legacyHTMLDoc())
	var transient *TransientError
	if !errors.Is(err, context.Canceled) || errors.As(err, &transient) {
		t.Fatal(err)
	}
}

type recordingReader struct{ timeouts []time.Duration }

func (r *recordingReader) Read(_ context.Context, fields []RichTextHTML, timeout time.Duration) ([][]any, error) {
	r.timeouts = append(r.timeouts, timeout)
	read := make([][]any, len(fields))
	for i := range read {
		read[i] = []any{}
	}
	return read, nil
}

// Twin of SeedAndMigrationReadWithTheOneTimeBudget.
func TestSeedAndMigrationReadWithTheOneTimeBudget(t *testing.T) {
	reader := &recordingReader{}
	c := converter(t, reader)
	if err := c.Seed(context.Background(), yjs.NewDoc(yjs.Options{}), parseNode(t, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Export(context.Background(), legacyHTMLDoc()); err != nil {
		t.Fatal(err)
	}
	if err := c.ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, `{"op":"update","id":"a","data":{"text":"<i>y</i>"}}`)); err != nil {
		t.Fatal(err)
	}
	migrated, err := c.MigrateRichText(context.Background(), legacyHTMLDoc())
	if err != nil || migrated != 1 {
		t.Fatal(migrated, err)
	}
	if !slices.Equal(reader.timeouts, []time.Duration{MigrationReadTimeout, 0, 0, MigrationReadTimeout}) || MigrationReadTimeout != time.Minute {
		t.Fatal(reader.timeouts)
	}
}

func editOps(t *testing.T, ops ...string) []EditOp {
	t.Helper()
	parsed, err := ParseEditOps([]byte(`{"ops":[` + strings.Join(ops, ",") + `]}`))
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

// Twin of AnEditThatOnlyRespellsTheHtmlWritesNothing. The C# edit holds a
// literal U+00A0 where the seed spells &nbsp;.
func TestAnEditThatOnlyRespellsTheHTMLWritesNothing(t *testing.T) {
	c := converter(t, nil)
	doc := yjs.NewDoc(yjs.Options{})
	if err := c.Seed(context.Background(), doc, parseNode(t, `{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<strong>x</strong>&nbsp;<a href=\"h\" target=\"_blank\">y</a>"}}]}`)); err != nil {
		t.Fatal(err)
	}
	updates := 0
	doc.OnUpdate(func(yjs.UpdateEvent) { updates++ })
	if err := c.ApplyOps(context.Background(), doc, editOps(t, `{"op":"update","id":"a","data":{"text":"<b>x</b>\u00a0<a target=\"_blank\" href=\"h\">y</a><br>"}}`)); err != nil {
		t.Fatal(err)
	}
	if updates != 0 {
		t.Fatalf("%d updates", updates)
	}
}

// Twin of AnEditReadsHtmlForTheBlocksTypeInTheDoc.
func TestAnEditReadsHTMLForTheBlocksTypeInTheDoc(t *testing.T) {
	c := converter(t, nil)
	doc := yjs.NewDoc(yjs.Options{})
	if err := c.Seed(context.Background(), doc, parseNode(t, `{"blocks":[{"id":"a","type":"header","data":{"text":"x","level":2}}]}`)); err != nil {
		t.Fatal(err)
	}
	if err := c.ApplyOps(context.Background(), doc, editOps(t, `{"op":"update","id":"a","data":{"text":"x <i>y</i>","level":2}}`)); err != nil {
		t.Fatal(err)
	}
	exported, err := c.Export(context.Background(), doc)
	if err != nil {
		t.Fatal(err)
	}
	text, err := jsjson.Stringify(path(exported, "blocks", 0, "data", "text"))
	if err != nil || text != `[{"text":"x "},{"text":"y","marks":{"italic":true}}]` {
		t.Fatal(text, err)
	}
}

// Twin of AnEditHtmlFieldPastTheCapIsRefusedAsTooLargeBeforeAnyRead.
func TestAnEditHTMLFieldPastTheCapIsRefusedAsTooLargeBeforeAnyRead(t *testing.T) {
	reader := &recordingReader{}
	c := converter(t, reader)
	atCap := strings.Repeat("x", MaxEditHTMLChars)
	if err := c.ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, `{"op":"update","id":"a","data":{"text":"`+atCap+`"}}`)); err != nil {
		t.Fatal(err)
	}
	err := c.ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, `{"op":"update","id":"a","data":{"text":"`+atCap+`y"}}`))
	var edit *EditError
	// The room maps exactly this inner failure to 413.
	if !errors.As(err, &edit) || !IsTooLarge(edit.Err) {
		t.Fatalf("got %v", err)
	}
	if edit.Message != `collab: rich text field "paragraph.text" holds 32769 HTML characters; an edit may send at most 32768.` {
		t.Fatal(edit.Message)
	}
	if len(reader.timeouts) != 1 {
		t.Fatal(reader.timeouts)
	}
}

// The cap counts UTF-16 units, as string.Length does.
func TestTheEditCapCountsUTF16Units(t *testing.T) {
	c := converter(t, &recordingReader{})
	astral := strings.Repeat("😀", MaxEditHTMLChars/2)
	if err := c.ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, `{"op":"update","id":"a","data":{"text":"`+astral+`"}}`)); err != nil {
		t.Fatal(err)
	}
	err := c.ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, `{"op":"update","id":"a","data":{"text":"`+astral+`x"}}`))
	var edit *EditError
	if !errors.As(err, &edit) || !IsTooLarge(edit.Err) {
		t.Fatalf("got %v", err)
	}
}

// ApplyOpsAsync's catches: a runtime limit is a retry (except the memory
// budget, which the same body hits again), anything else refuses this one
// request, and a cancel by the caller stays a cancel.
func TestAnEditReadFailureIsARetryOrARefusal(t *testing.T) {
	update := `{"op":"update","id":"a","data":{"text":"<i>y</i>"}}`
	timedOut := &jsruntime.Failure{Kind: jsruntime.KindTimedOut, Err: errors.New("slow")}
	err := converter(t, failingReader{timedOut}).ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, update))
	var transient *TransientError
	if !errors.As(err, &transient) || transient.Err != timedOut || transient.Message != "collab: reading the rich text HTML in this edit ran past the runtime's limits: "+timedOut.Error() {
		t.Fatalf("timed out: %v", err)
	}
	for _, failure := range []error{
		&jsruntime.Failure{Kind: jsruntime.KindDocumentTooLarge, Err: errors.New("budget")},
		&jsruntime.Failure{Kind: jsruntime.KindInvalidDocument, Err: errors.New("TypeError")},
		errors.New("anything else"),
	} {
		err := converter(t, failingReader{failure}).ApplyOps(context.Background(), legacyHTMLDoc(), editOps(t, update))
		var edit *EditError
		if !errors.As(err, &edit) || edit.Err != failure || edit.Message != "collab: the rich text HTML in this edit could not be read: "+failure.Error() {
			t.Errorf("%v: %v", failure, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = converter(t, failingReader{ctx.Err()}).ApplyOps(ctx, legacyHTMLDoc(), editOps(t, update))
	var edit *EditError
	if !errors.Is(err, context.Canceled) || errors.As(err, &edit) || errors.As(err, &transient) {
		t.Fatalf("cancelled: %v", err)
	}
}

// One HTML string read once, however many slots hold it; "" needs no runtime.
func TestEachDistinctHTMLIsReadOnce(t *testing.T) {
	reader := &recordingReader{}
	doc := yjs.NewDoc(yjs.Options{})
	doc.Transact(func(tx *yjs.Transaction) {
		for _, id := range []string{"a", "b"} {
			doc.GetMap(str("blocks")).Set(tx, str(id), newBlock(id, "paragraph", yjs.NewMap(yjs.MapEntry{Key: str("text"), Value: str("<b>x</b>")})))
		}
		doc.GetMap(str("blocks")).Set(tx, str("e"), newBlock("e", "paragraph", yjs.NewMap(yjs.MapEntry{Key: str("text"), Value: str("")})))
		doc.GetArray(str("root")).Insert(tx, 0, []any{str("a"), str("b"), str("e")})
	})
	recorded := &countingReader{inner: reader}
	if _, err := converter(t, recorded).Export(context.Background(), doc); err != nil {
		t.Fatal(err)
	}
	if recorded.fields != 1 {
		t.Fatalf("%d fields read", recorded.fields)
	}
}

type countingReader struct {
	inner  HTMLReader
	fields int
}

func (c *countingReader) Read(ctx context.Context, fields []RichTextHTML, timeout time.Duration) ([][]any, error) {
	c.fields += len(fields)
	return c.inner.Read(ctx, fields, timeout)
}
