package blokdocs

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
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
	c, err := New(Options{PoolSize: 1})
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
