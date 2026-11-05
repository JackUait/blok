package convert

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// echoRuntime answers each field with one segment holding its HTML.
type echoRuntime struct {
	calls    [][]string
	timeouts []time.Duration
}

func (e *echoRuntime) Invoke(_ context.Context, op, input string, timeout *time.Duration) (string, error) {
	e.timeouts = append(e.timeouts, orDefault(timeout))
	if op != "htmlFieldsToSegments" {
		panic(op)
	}
	parsed, err := jsjson.Parse([]byte(input))
	if err != nil {
		panic(err)
	}
	var call []string
	var answer []any
	for _, entry := range parsed.([]any) {
		html := lookupValue(entry.(*jsjson.Object), "html").(jsjson.Str)
		call = append(call, html.String())
		segment := &jsjson.Object{}
		put(segment, "text", html)
		answered := &jsjson.Object{}
		put(answered, "segments", []any{segment})
		answer = append(answer, answered)
	}
	e.calls = append(e.calls, call)
	return jsjson.Stringify(answer)
}

func html(texts ...string) []RichTextHTML {
	var fields []RichTextHTML
	for _, text := range texts {
		fields = append(fields, RichTextHTML{"paragraph", "text", str(text)})
	}
	return fields
}

func firstTexts(read [][]any) []string {
	var texts []string
	for _, segments := range read {
		texts = append(texts, lookupValue(segments[0].(*jsjson.Object), "text").(jsjson.Str).String())
	}
	return texts
}

// Twins of RuntimeRichTextHtmlReaderTests.
func TestReadsALargeBatchInBoundedCallsAndKeepsTheOrder(t *testing.T) {
	runtime := &echoRuntime{}
	body := strings.Repeat("x", MaxCallChars/4)
	var texts []string
	for i := range 10 {
		texts = append(texts, string(rune('0'+i))+":"+body)
	}
	read, err := RuntimeHTMLReader{runtime}.Read(context.Background(), html(texts...), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(runtime.calls) != 4 {
		t.Fatalf("%d calls", len(runtime.calls))
	}
	for _, call := range runtime.calls {
		total := 0
		for _, field := range call {
			total += len(field)
		}
		if total > MaxCallChars {
			t.Fatalf("a call carried %d", total)
		}
	}
	if !slices.Equal(firstTexts(read), texts) {
		t.Fatal("order lost")
	}
}

func TestTwoFieldsAtTheEditCapGoInTwoCalls(t *testing.T) {
	runtime := &echoRuntime{}
	body := strings.Repeat("x", MaxEditHTMLChars-1)
	if _, err := (RuntimeHTMLReader{runtime}).Read(context.Background(), html("a"+body, "b"+body), nil); err != nil {
		t.Fatal(err)
	}
	if len(runtime.calls) != 2 {
		t.Fatalf("%d calls", len(runtime.calls))
	}
}

func TestPassesTheCallersBudgetToEveryCall(t *testing.T) {
	runtime := &echoRuntime{}
	body := strings.Repeat("x", MaxCallChars)
	reader := RuntimeHTMLReader{runtime}
	if _, err := reader.Read(context.Background(), html(body, body), new(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.Read(context.Background(), html("a"), nil); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(runtime.timeouts, []time.Duration{time.Minute, time.Minute, 0}) {
		t.Fatal(runtime.timeouts)
	}
}

func TestReadsAnOversizedFieldInACallOfItsOwn(t *testing.T) {
	runtime := &echoRuntime{}
	huge := strings.Repeat("h", MaxCallChars+1)
	read, err := RuntimeHTMLReader{runtime}.Read(context.Background(), html("a", huge, "b"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(runtime.calls) != 3 || runtime.calls[1][0] != huge || !slices.Equal(firstTexts(read), []string{"a", huge, "b"}) {
		t.Fatalf("%d calls", len(runtime.calls))
	}
}

// A field's length is UTF-16 units: an astral character costs two.
func TestTheCallCapCountsUTF16Units(t *testing.T) {
	runtime := &echoRuntime{}
	half := strings.Repeat("😀", MaxCallChars/4)
	if _, err := (RuntimeHTMLReader{runtime}).Read(context.Background(), html(half, half, "x"), nil); err != nil {
		t.Fatal(err)
	}
	if len(runtime.calls) != 2 {
		t.Fatalf("%d calls", len(runtime.calls))
	}
}

func TestFieldsThatExactlyFillACallShareIt(t *testing.T) {
	runtime := &echoRuntime{}
	half := strings.Repeat("x", MaxCallChars/2)
	if _, err := (RuntimeHTMLReader{runtime}).Read(context.Background(), html(half, half), nil); err != nil {
		t.Fatal(err)
	}
	if len(runtime.calls) != 1 {
		t.Fatalf("%d calls", len(runtime.calls))
	}
}

// orDefault records an unset timeout as 0.
func orDefault(timeout *time.Duration) time.Duration {
	if timeout == nil {
		return 0
	}
	return *timeout
}
