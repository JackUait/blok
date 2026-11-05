package blokdocs

import (
	"context"
	"strings"
	"sync"
	"testing"
)

// Twins of C# BlokDocumentConverterTests, BlokPlainTextReportTests,
// BlokDocumentInspectionTests, LooksLikeADocumentFixtureTests and
// BlokRuntimeStartupTests cases that no Go test or shared fixture held.

var (
	parityOnce      sync.Once
	parityConverter *Converter
	parityErr       error
)

func sharedConverter(t *testing.T) *Converter {
	t.Helper()
	parityOnce.Do(func() { parityConverter, parityErr = New(Options{PoolSize: 1}) })
	if parityErr != nil {
		t.Fatal(parityErr)
	}
	return parityConverter
}

func TestReportsAContentReferenceItCouldNotResolve(t *testing.T) {
	conversion, err := sharedConverter(t).ToMarkdown(context.Background(),
		`{"blocks":[{"id":"l1","type":"list","data":{"text":"item","style":"unordered"},"content":["gone"]}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(conversion.Warnings) != 1 {
		t.Fatalf("warnings %+v", conversion.Warnings)
	}
	warning := conversion.Warnings[0]
	if warning.Construct != "list" || warning.Action != ActionDropped || !strings.Contains(warning.Detail, "could not be resolved") {
		t.Fatalf("warning %+v", warning)
	}
}

func TestReportsEveryUnusableDocumentTheSameWay(t *testing.T) {
	c := sharedConverter(t)
	ctx := context.Background()
	for _, document := range []string{"not json", `{"nope":1}`} {
		_, markdown := c.ToMarkdown(ctx, document)
		_, html := c.ToHTML(ctx, document)
		_, plain := c.ToPlainText(ctx, document, false)
		for name, err := range map[string]error{"markdown": markdown, "html": html, "plain": plain} {
			if !isReason(err, InvalidDocument) {
				t.Errorf("%s of %s: err = %v", name, document, err)
			}
		}
	}
}

func TestReportsUnreadableInputTheSameWayOnTheTranslationPath(t *testing.T) {
	c := sharedConverter(t)
	if _, err := c.ExtractTexts(context.Background(), "not json", false); !isReason(err, InvalidDocument) {
		t.Fatalf("not json: err = %v", err)
	}
	texts, err := c.ExtractTexts(context.Background(), `{"nope":1}`, false)
	if err != nil || len(texts) != 0 {
		t.Fatalf("no blocks: %q, %v", texts, err)
	}
}

func TestNamesTheTwoDegradationOutcomesItReports(t *testing.T) {
	conversion, err := sharedConverter(t).ToMarkdown(context.Background(), `{"blocks":[
  {"id":"c1","type":"callout","data":{"emoji":"💡"}},
  {"id":"p1","type":"paragraph","data":{"text":"Mind the gap"},"parent":"c1"},
  {"id":"s1","type":"spacer","data":{}}
]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(conversion.Warnings) < 2 || conversion.Warnings[0].Action != ActionDegraded || conversion.Warnings[1].Action != ActionDropped {
		t.Fatalf("warnings %+v", conversion.Warnings)
	}
	if ActionDegraded != "degraded" || ActionDropped != "dropped" {
		t.Fatal("the outcome names moved")
	}
}

func TestCarriesTheHiddenTextOptionThrough(t *testing.T) {
	c := sharedConverter(t)
	document := `{"blocks":[{"type":"image","data":{"url":"https://x/y.png","alt":"A chart"}}]}`
	for _, row := range []struct {
		hidden bool
		want   string
	}{{false, ""}, {true, "A chart"}} {
		report, err := c.ToPlainTextWithReport(context.Background(), document, row.hidden)
		if err != nil || report.Text != row.want {
			t.Fatalf("hidden %v: %q, %v", row.hidden, report.Text, err)
		}
	}
}

func TestReadsAnEmptyDocumentAsEmptyAndValid(t *testing.T) {
	v, err := sharedConverter(t).Validate(context.Background(), `{"blocks":[]}`)
	if err != nil || !v.IsDocument || !v.IsEmpty || v.BlockCount != 0 || v.Failure != nil {
		t.Fatalf("%+v, %v", v, err)
	}
}

func TestDoesNotCallABuiltInTextlessBlockUnrecognised(t *testing.T) {
	v, err := sharedConverter(t).Validate(context.Background(), `{"blocks":[{"type":"divider","data":{}}]}`)
	if err != nil || !v.IsDocument || !v.IsEmpty || len(v.UnrecognizedBlockTypes) != 0 {
		t.Fatalf("%+v, %v", v, err)
	}
}

// Validation never throws, so it inherits the shape check's answer. Go has
// no null string, so the fixture's null input reads as "".
func TestValidationAgreesWithTheSharedFixture(t *testing.T) {
	var cases []struct {
		Name     string  `json:"name"`
		Input    *string `json:"input"`
		Expected bool    `json:"expected"`
	}
	readFixture(t, "looks-like-a-document.json", &cases)
	c := sharedConverter(t)
	for _, entry := range cases {
		input := ""
		if entry.Input != nil {
			input = *entry.Input
		}
		v, err := c.Validate(context.Background(), input)
		if err != nil || v.IsDocument != entry.Expected {
			t.Errorf("%s: IsDocument %v, %v; want %v", entry.Name, v.IsDocument, err, entry.Expected)
		}
	}
	for _, candidate := range []string{"", "not json at all", "[]", "{}"} {
		v, err := c.Validate(context.Background(), candidate)
		if err != nil || v.IsDocument != LooksLikeADocument(candidate) {
			t.Errorf("%q: IsDocument %v, %v", candidate, v.IsDocument, err)
		}
	}
}

func TestPublishesTheFloorsItEnforces(t *testing.T) {
	if MinimumMemoryBudget <= 0 || MinimumTimeout <= 0 {
		t.Fatalf("floors %d, %v", MinimumMemoryBudget, MinimumTimeout)
	}
}
