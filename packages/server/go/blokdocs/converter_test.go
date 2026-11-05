package blokdocs

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

type scriptedRuntime struct {
	answers []string
	err     error
	calls   int
}

func (s *scriptedRuntime) Invoke(_ context.Context, _, _ string, _ time.Duration) (string, error) {
	s.calls++
	if s.err != nil {
		return "", s.err
	}
	answer := s.answers[0]
	if len(s.answers) > 1 {
		s.answers = s.answers[1:]
	}
	return answer, nil
}

func TestAsksTheBundleForItsVersionOnlyOnce(t *testing.T) {
	runtime := &scriptedRuntime{answers: []string{"1.2.3"}}
	c := newConverter(runtime)
	for range 2 {
		if v, err := c.Version(context.Background()); err != nil || v != "1.2.3" {
			t.Fatalf("Version = %q, %v", v, err)
		}
	}
	if runtime.calls != 1 {
		t.Fatalf("calls = %d, want 1", runtime.calls)
	}
}

// "dev" is the bundle built without the VERSION define. Caching it would stamp it into every document.
func TestRefusesToHandOutAVersionTheBundleDoesNotHaveAndAsksAgain(t *testing.T) {
	runtime := &scriptedRuntime{answers: []string{"dev", "", "1.2.3"}}
	c := newConverter(runtime)
	for range 2 {
		if _, err := c.Version(context.Background()); !errors.Is(err, ErrNoVersion) {
			t.Fatalf("err = %v, want ErrNoVersion", err)
		}
	}
	if v, err := c.Version(context.Background()); err != nil || v != "1.2.3" {
		t.Fatalf("Version = %q, %v", v, err)
	}
	if runtime.calls != 3 {
		t.Fatalf("calls = %d, want 3", runtime.calls)
	}
}

func TestFetchesTheSchemaOnce(t *testing.T) {
	runtime := &scriptedRuntime{answers: []string{`{"type":"object"}`}}
	c := newConverter(runtime)
	for range 2 {
		if s, err := c.Schema(context.Background()); err != nil || s != `{"type":"object"}` {
			t.Fatalf("Schema = %q, %v", s, err)
		}
	}
	if runtime.calls != 1 {
		t.Fatalf("calls = %d, want 1", runtime.calls)
	}
}

// Cancellation stays cancellation, Validate included, which otherwise never fails.
func TestReportsTheCallersOwnCancellationAsCancellation(t *testing.T) {
	c := newConverter(&scriptedRuntime{err: context.Canceled})
	if _, err := c.ToHTML(context.Background(), `{"blocks":[]}`); err != context.Canceled {
		t.Fatalf("ToHTML err = %v, want context.Canceled itself", err)
	}
	if _, err := c.Validate(context.Background(), `{"blocks":[]}`); err != context.Canceled {
		t.Fatalf("Validate err = %v, want context.Canceled itself", err)
	}
}

func TestIsFullyUnderstoodOnlyWithNothingMalformedOrUnknown(t *testing.T) {
	cases := []struct {
		v    Validation
		want bool
	}{
		{Validation{IsDocument: true}, true},
		{Validation{IsDocument: false}, false},
		{Validation{IsDocument: true, MalformedBlockCount: 1}, false},
		{Validation{IsDocument: true, UnrecognizedBlockTypes: []string{"x"}}, false},
	}
	for _, c := range cases {
		if got := c.v.IsFullyUnderstood(); got != c.want {
			t.Errorf("%+v: IsFullyUnderstood = %v", c.v, got)
		}
	}
}

func newRealConverter(t *testing.T) *Converter {
	t.Helper()
	c, err := New(Options{PoolSize: new(1)})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func TestConvertsThroughTheEmbeddedBundle(t *testing.T) {
	c := newRealConverter(t)
	ctx := context.Background()
	const article = `{"blocks":[{"id":"h1","type":"header","data":{"text":"Release notes","level":2}},{"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b>"}}]}`

	html, err := c.ToHTML(ctx, article)
	if err != nil || !strings.Contains(html, "<b>today</b>") {
		t.Fatalf("ToHTML = %q, %v", html, err)
	}
	md, err := c.ToMarkdown(ctx, article)
	if err != nil || md.Markdown != "## Release notes\n\nShips **today**" || len(md.Warnings) != 0 {
		t.Fatalf("ToMarkdown = %+v, %v", md, err)
	}
	if _, err := c.ToMarkdown(ctx, `{"nope":1}`); !isReason(err, InvalidDocument) {
		t.Fatalf("ToMarkdown of a non-document: err = %v", err)
	}
	v, err := c.Validate(ctx, `{"blocks":[{"type":"org-chart","data":{}}]}`)
	if err != nil || !v.IsDocument || !v.IsEmpty || strings.Join(v.UnrecognizedBlockTypes, ",") != "org-chart" {
		t.Fatalf("Validate = %+v, %v", v, err)
	}
	version, err := c.Version(ctx)
	if err != nil || version == "dev" || version == "" {
		t.Fatalf("Version = %q, %v", version, err)
	}
	if err := c.WarmUp(ctx); err != nil {
		t.Fatalf("WarmUp: %v", err)
	}
}

// C# BlokDocumentConverterTests.RefusesADocumentNestedPastTheParseDepth:
// Jint's JSON.parse refuses a 65th nested array or object, and the bare
// readers hand it the document as is; plain text wraps it one level deeper.
func TestRefusesADocumentNestedPastTheParseDepth(t *testing.T) {
	c := newRealConverter(t)
	ctx := context.Background()
	nested := func(depth int) string {
		return `{"blocks":[],"deep":` + strings.Repeat("[", depth-1) + strings.Repeat("]", depth-1) + `}`
	}
	if _, err := c.ToHTML(ctx, nested(64)); err != nil {
		t.Fatalf("ToHTML at 64: %v", err)
	}
	if _, err := c.ToMarkdown(ctx, nested(64)); err != nil {
		t.Fatalf("ToMarkdown at 64: %v", err)
	}
	if _, err := c.ToPlainText(ctx, nested(64), false); !isReason(err, InvalidDocument) {
		t.Fatalf("ToPlainText at 64: err = %v", err)
	}
	if _, err := c.ToHTML(ctx, nested(65)); !isReason(err, InvalidDocument) {
		t.Fatalf("ToHTML at 65: err = %v", err)
	}
	if _, err := c.ToMarkdown(ctx, nested(65)); !isReason(err, InvalidDocument) {
		t.Fatalf("ToMarkdown at 65: err = %v", err)
	}
}

func TestRefusesLimitsBelowTheFloorsBeforeLoading(t *testing.T) {
	var constraint *ConstraintError
	if _, err := New(Options{Timeout: time.Millisecond}); !errors.As(err, &constraint) {
		t.Fatalf("err = %v, want a ConstraintError", err)
	}
	if _, err := New(Options{MemoryBudget: 1024}); !errors.As(err, &constraint) {
		t.Fatalf("err = %v, want a ConstraintError", err)
	}
}

func isReason(err error, reason Reason) bool {
	var conversion *ConversionError
	return errors.As(err, &conversion) && conversion.Reason == reason
}

// goja's JSON.parse reads a lone-surrogate escape as U+FFFD, so the bare
// operations convert such a document. C# reads its runtime input the same way
// (JsonInputNormalizer.cs), pinned by the C# test of the same name.
func TestReadsALoneSurrogateInABareDocumentAsAReplacementCharacter(t *testing.T) {
	c := newRealConverter(t)
	ctx := context.Background()
	const lone = `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\ud800b"}}]}`

	md, err := c.ToMarkdown(ctx, lone)
	if err != nil || md.Markdown != "a�b" {
		t.Fatalf("ToMarkdown = %+v, %v", md, err)
	}
	html, err := c.ToHTML(ctx, lone)
	if err != nil || html != "<p>a�b</p>" {
		t.Fatalf("ToHTML = %q, %v", html, err)
	}
	v, err := c.Validate(ctx, `{"blocks":[{"type":"\udc00","data":{}}]}`)
	if err != nil || v.Failure != nil || strings.Join(v.UnrecognizedBlockTypes, ",") != "�" {
		t.Fatalf("Validate = %+v, %v", v, err)
	}
	if _, err := c.ToPlainText(ctx, lone, false); !isReason(err, InvalidDocument) {
		t.Fatalf("an envelope operation: err = %v, want InvalidDocument", err)
	}
}

type recordingRuntime struct{ input string }

func (r *recordingRuntime) Invoke(_ context.Context, _, input string, _ time.Duration) (string, error) {
	r.input = input
	return `{"document":{}}`, nil
}

// A repeated id is what assigning it twice into a C# Dictionary gives: one
// entry, at the first position, holding the last value.
func TestARepeatedIdKeepsItsFirstPlaceAndItsLastValue(t *testing.T) {
	runtime := &recordingRuntime{}
	c := newConverter(runtime)
	first, last := "first", "last"
	var hrefs []string
	href := func(id string) string { hrefs = append(hrefs, id); return "" }
	pages := []Page{{ID: "b", Info: &PageInfo{Title: &first}}, {ID: "a"}, {ID: "b", Info: &PageInfo{Title: &last}}}
	if _, err := c.ToHTMLWithPages(context.Background(), `{"blocks":[]}`, pages, href); err != nil {
		t.Fatal(err)
	}
	if want := `{"document":{"blocks":[]},"pages":{"b":{"title":"last"},"a":null}}`; runtime.input != want {
		t.Fatalf("input = %s, want %s", runtime.input, want)
	}
	if strings.Join(hrefs, ",") != "b" {
		t.Fatalf("href calls = %v, want [b]", hrefs)
	}
	ids := []IDMapping{{Old: "y", New: "1"}, {Old: "x", New: "2"}, {Old: "y", New: "3"}}
	if _, err := c.RemapPageDocument(context.Background(), `{"blocks":[]}`, ids, []IDMapping{}); err != nil {
		t.Fatal(err)
	}
	if want := `{"document":{"blocks":[]},"blockIds":{"y":"3","x":"2"},"pageIds":{}}`; runtime.input != want {
		t.Fatalf("input = %s, want %s", runtime.input, want)
	}
}

// A host can tell the process heap backstop from a document's own budget.
func TestNamesTheHeapBackstopApartFromTheBudget(t *testing.T) {
	stopped := newConverter(&scriptedRuntime{err: &jsruntime.Failure{Kind: jsruntime.KindDocumentTooLarge, Err: jsruntime.ErrHeapBackstop}})
	_, err := stopped.ToHTML(context.Background(), `{"blocks":[]}`)
	var conversion *ConversionError
	if !errors.As(err, &conversion) || conversion.Reason != DocumentTooLarge || !errors.Is(err, ErrHeapBackstop) {
		t.Fatalf("err = %v, want DocumentTooLarge wrapping ErrHeapBackstop", err)
	}
	overBudget := newConverter(&scriptedRuntime{err: &jsruntime.Failure{Kind: jsruntime.KindDocumentTooLarge}})
	if _, err := overBudget.ToHTML(context.Background(), `{"blocks":[]}`); errors.Is(err, ErrHeapBackstop) {
		t.Fatalf("err = %v names the backstop for a plain budget stop", err)
	}
}
