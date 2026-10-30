package blokdocs

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// The repo root, from this package's directory.
const repoRoot = "../../../.."

func readFixture(t *testing.T, name string, into any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/documents", name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

type hostRequest struct {
	Op    string `json:"op"`
	Input string `json:"input"`
}

type hostCase struct {
	Name    string                     `json:"name"`
	Method  string                     `json:"method"`
	Args    map[string]json.RawMessage `json:"args"`
	Runtime struct {
		Answer *string `json:"answer"`
		Error  *string `json:"error"`
	} `json:"runtime"`
	Request   *hostRequest   `json:"request"`
	HrefCalls []string       `json:"hrefCalls"`
	Expect    map[string]any `json:"expect"`
}

// fakeRuntime answers one call from the fixture and records the request.
type fakeRuntime struct {
	answer  *string
	failure *string
	request *hostRequest
	calls   int
}

func (f *fakeRuntime) Invoke(_ context.Context, op, input string, _ time.Duration) (string, error) {
	f.calls++
	f.request = &hostRequest{Op: op, Input: input}
	if f.failure != nil {
		kinds := map[string]jsruntime.Kind{
			"Unknown":          jsruntime.KindUnknown,
			"InvalidDocument":  jsruntime.KindInvalidDocument,
			"TimedOut":         jsruntime.KindTimedOut,
			"DocumentTooLarge": jsruntime.KindDocumentTooLarge,
		}
		kind, ok := kinds[*f.failure]
		if !ok {
			panic("unknown failure " + *f.failure)
		}
		return "", &jsruntime.Failure{Kind: kind, Err: errors.New("fake runtime failure")}
	}
	return *f.answer, nil
}

func arg[T any](t *testing.T, c hostCase, name string) T {
	t.Helper()
	var value T
	if raw, ok := c.Args[name]; ok {
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatalf("arg %s: %v", name, err)
		}
	}
	return value
}

func fixturePages(t *testing.T, c hostCase) map[string]*PageInfo {
	type icon struct {
		Emoji *string `json:"emoji"`
		Image *string `json:"image"`
	}
	type page struct {
		Title    *string `json:"title"`
		Icon     *icon   `json:"icon"`
		NoAccess bool    `json:"noAccess"`
	}
	raw := arg[map[string]*page](t, c, "pages")
	pages := map[string]*PageInfo{}
	for id, p := range raw {
		if p == nil {
			pages[id] = nil
			continue
		}
		info := &PageInfo{Title: p.Title, NoAccess: p.NoAccess}
		if p.Icon != nil {
			if p.Icon.Emoji != nil {
				info.Icon = EmojiIcon(*p.Icon.Emoji)
			} else {
				info.Icon = ImageIcon(*p.Icon.Image)
			}
		}
		pages[id] = info
	}
	return pages
}

func call(t *testing.T, c hostCase, conv *Converter, hrefCalls *[]string) (any, error) {
	ctx := context.Background()
	doc := arg[*string](t, c, "document")
	document := ""
	if doc != nil {
		document = *doc
	}
	hidden := arg[bool](t, c, "includeHiddenText")
	code := arg[bool](t, c, "includeCode")
	var href func(string) string
	if hrefs, ok := c.Args["pageHrefs"]; ok {
		var table map[string]string
		if err := json.Unmarshal(hrefs, &table); err != nil {
			t.Fatal(err)
		}
		href = func(id string) string {
			*hrefCalls = append(*hrefCalls, id)
			return table[id]
		}
	}
	switch c.Method {
	case "ToMarkdown":
		return conv.ToMarkdown(ctx, document)
	case "ToMarkdownWithPages":
		return conv.ToMarkdownWithPages(ctx, document, fixturePages(t, c), href)
	case "ToMarkdownWithTitle":
		return conv.ToMarkdownWithTitle(ctx, document)
	case "ToMarkdownWithTitleAndPages":
		return conv.ToMarkdownWithTitleAndPages(ctx, document, fixturePages(t, c), href)
	case "ToHtml":
		return conv.ToHTML(ctx, document)
	case "ToHtmlWithPages":
		return conv.ToHTMLWithPages(ctx, document, fixturePages(t, c), href)
	case "ToHtmlWithTitle":
		return conv.ToHTMLWithTitle(ctx, document)
	case "ToHtmlWithTitleAndPages":
		return conv.ToHTMLWithTitleAndPages(ctx, document, fixturePages(t, c), href)
	case "ToPlainText":
		return conv.ToPlainText(ctx, document, hidden)
	case "ToPlainTextWithTitle":
		return conv.ToPlainTextWithTitle(ctx, document, hidden)
	case "ToPlainTextWithReport":
		return conv.ToPlainTextWithReport(ctx, document, hidden)
	case "ExtractTexts":
		return conv.ExtractTexts(ctx, document, code)
	case "InjectTexts":
		return conv.InjectTexts(ctx, document, arg[[]string](t, c, "texts"), code)
	case "PageIndex":
		return conv.PageIndex(ctx, document)
	case "RemapPageDocument":
		return conv.RemapPageDocument(ctx, document, arg[map[string]string](t, c, "blockIds"), arg[map[string]string](t, c, "pageIds"))
	case "Validate":
		v, err := conv.Validate(ctx, document)
		var failure any
		if v.Failure != nil {
			failure = v.Failure.String()
		}
		return map[string]any{
			"isDocument": v.IsDocument, "isEmpty": v.IsEmpty, "blockCount": v.BlockCount,
			"malformedBlockCount": v.MalformedBlockCount, "unrecognizedBlockTypes": v.UnrecognizedBlockTypes,
			"failure": failure, "isFullyUnderstood": v.IsFullyUnderstood(),
		}, err
	case "FromMarkdown":
		r, err := conv.FromMarkdown(ctx, arg[string](t, c, "text"))
		return map[string]any{"document": r.DocumentJSON, "warnings": r.Warnings}, err
	case "FromHtml":
		r, err := conv.FromHTML(ctx, arg[string](t, c, "text"))
		return map[string]any{"document": r.DocumentJSON, "warnings": r.Warnings}, err
	}
	t.Fatalf("unknown method %s", c.Method)
	return nil, nil
}

// errorShape names an error the way the fixture does.
func errorShape(err error) map[string]any {
	var conversion *ConversionError
	var argument ArgumentError
	var answer *AnswerError
	switch {
	case errors.As(err, &conversion):
		return map[string]any{"kind": "conversion", "reason": conversion.Reason.String()}
	case errors.As(err, &argument):
		return map[string]any{"kind": "argument", "param": argument.Param(), "message": argument.Error()}
	case errors.As(err, &answer) && answer.NotJSON:
		return map[string]any{"kind": "json"}
	case errors.As(err, &answer):
		return map[string]any{"kind": "invalidOperation", "message": answer.Message}
	}
	return map[string]any{"kind": "unexpected", "message": err.Error()}
}

// normalize round-trips through encoding/json so Go values compare with fixture values.
func normalize(t *testing.T, value any) any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// Captured from C# (HostEnvelopeFixtureTests), which reads the same file.
func TestMatchesTheCSharpHostOnTheSharedFixture(t *testing.T) {
	var cases []hostCase
	readFixture(t, "host.json", &cases)
	if len(cases) < 50 {
		t.Fatalf("only %d host cases", len(cases))
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			fake := &fakeRuntime{answer: c.Runtime.Answer, failure: c.Runtime.Error}
			var hrefCalls []string
			result, err := call(t, c, newConverter(fake), &hrefCalls)

			if !reflect.DeepEqual(fake.request, c.Request) {
				t.Errorf("request\n got %+v\nwant %+v", fake.request, c.Request)
			}
			if fake.calls > 1 {
				t.Errorf("runtime called %d times", fake.calls)
			}
			if strings.Join(hrefCalls, ",") != strings.Join(c.HrefCalls, ",") {
				t.Errorf("href calls = %v, want %v", hrefCalls, c.HrefCalls)
			}
			var got map[string]any
			if err != nil {
				got = map[string]any{"error": errorShape(err)}
			} else {
				got = map[string]any{"result": result}
			}
			if g, w := normalize(t, got), normalize(t, c.Expect); !reflect.DeepEqual(g, w) {
				t.Errorf("outcome\n got %v\nwant %v", g, w)
			}
		})
	}
}
