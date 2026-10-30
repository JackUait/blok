package jsruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

type opsPart struct {
	Literal string
	Repeat  int      `json:"repeat"`
	Join    string   `json:"join"`
	Items   []string `json:"items"`
}

func (p *opsPart) UnmarshalJSON(data []byte) error {
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, &p.Literal)
	}
	type plain opsPart
	return json.Unmarshal(data, (*plain)(p))
}

type opsCase struct {
	Name        string `json:"name"`
	Op          string `json:"op"`
	Input       string `json:"input"`
	InputRecipe *struct {
		Parts []opsPart `json:"parts"`
	} `json:"inputRecipe"`
	Output       *string `json:"output"`
	OutputSha256 string  `json:"outputSha256"`
	ErrorName    string  `json:"errorName"`
	NormalizeIDs bool    `json:"normalizeIds"`
}

func (c opsCase) input() string {
	if c.InputRecipe == nil {
		return c.Input
	}
	var b strings.Builder
	for _, part := range c.InputRecipe.Parts {
		if part.Items == nil {
			b.WriteString(part.Literal)
			continue
		}
		for i := range part.Repeat {
			if i > 0 {
				b.WriteString(part.Join)
			}
			b.WriteString(strings.ReplaceAll(part.Items[i%len(part.Items)], "{i}", strconv.Itoa(i)))
		}
	}
	return b.String()
}

var importIDs = regexp.MustCompile(`"(md|html)-[a-z0-9]+-`)

var surrogateEscape = regexp.MustCompile(`\\u[dD][89a-fA-F][0-9a-fA-F]{2}`)

// gojaReadsLoneSurrogates is what goja makes of node's answer: its JSON.parse
// reads a lone-surrogate escape as U+FFFD (measured), where node and Jint keep
// the unit. Paired escapes stay escapes.
func gojaReadsLoneSurrogates(want string) string {
	matches := surrogateEscape.FindAllStringIndex(want, -1)
	high := func(i int) bool { return strings.ContainsAny(want[matches[i][0]+3:matches[i][0]+4], "89abAB") }
	var b strings.Builder
	last := 0
	for i := 0; i < len(matches); i++ {
		paired := high(i) && i+1 < len(matches) && matches[i+1][0] == matches[i][1] && !high(i+1)
		b.WriteString(want[last:matches[i][0]])
		if paired {
			b.WriteString(want[matches[i][0]:matches[i+1][1]])
			last = matches[i+1][1]
			i++
			continue
		}
		b.WriteRune(0xfffd)
		last = matches[i][1]
	}
	b.WriteString(want[last:])
	return b.String()
}

// Outputs are node:vm's answers (scripts/generate-documents-ops-fixture.mjs);
// C# DocumentOpsFixtureTests checks Jint against the same file.
func TestMatchesNodeOnTheDocumentOpsFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "test/unit/server-conformance/fixtures/documents/ops.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []opsCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 300 {
		t.Fatalf("only %d cases", len(cases))
	}
	pool, err := NewPool(Options{PoolSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			big := strings.HasPrefix(c.Name, "big.")
			if big && (testing.Short() || raceEnabled) {
				t.Skip("large document: run without -short and -race")
			}
			start := time.Now()
			got, err := pool.Invoke(context.Background(), c.Op, c.input(), 5*time.Minute)
			if big {
				t.Logf("%s: %v", c.Op, time.Since(start).Round(time.Millisecond))
			}
			if c.ErrorName != "" {
				var failure *Failure
				var jsErr *JSError
				if !errors.As(err, &failure) || !errors.As(err, &jsErr) || jsErr.Name != c.ErrorName {
					t.Fatalf("err = %v, want a %s", err, c.ErrorName)
				}
				return
			}
			if err != nil {
				t.Fatalf("Invoke: %v", err)
			}
			if c.NormalizeIDs {
				got = importIDs.ReplaceAllString(got, `"$1-X-`)
			}
			if c.Output != nil {
				want := *c.Output
				if strings.HasPrefix(c.Name, "lone.") {
					want = gojaReadsLoneSurrogates(want)
				}
				if got != want {
					t.Fatalf("output differs\n got %.400q\nwant %.400q", got, want)
				}
				return
			}
			sum := sha256.Sum256([]byte(got))
			if hex.EncodeToString(sum[:]) != c.OutputSha256 {
				t.Fatalf("output sha256 differs; got %d bytes starting %.200q", len(got), got)
			}
		})
	}
}
