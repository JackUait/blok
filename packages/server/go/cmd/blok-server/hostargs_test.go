package main

import (
	"slices"
	"strings"
	"testing"
	"time"
)

// Parse-level twins of C# HostProcessTests.

const (
	validDocEndpoint = "https://app.example.test/api/blok-docs"
	validSecret      = "a-secret-value-with-at-least-32-characters"
)

func env(pairs ...string) func(string) string {
	return func(name string) string {
		for i := 0; i < len(pairs); i += 2 {
			if pairs[i] == name {
				return pairs[i+1]
			}
		}
		return ""
	}
}

func parsedOK(t *testing.T, args []string, getenv func(string) string) hostArguments {
	t.Helper()
	parsed := parseHostArguments(args, getenv)
	if parsed.err != "" || parsed.help {
		t.Fatalf("%v: %+v", args, parsed)
	}
	return parsed
}

func parseError(t *testing.T, args []string, getenv func(string) string, want string) {
	t.Helper()
	if got := parseHostArguments(args, getenv).err; got != want {
		t.Fatalf("%v: error %q, want %q", args, got, want)
	}
}

func TestUsesALoopbackPublicURLForWildcardListeners(t *testing.T) {
	for _, listen := range []string{"*:4000", "+:4000"} {
		if got := parsedOK(t, []string{"--listen", listen}, noEnv).options.PublicURL; got != "http://127.0.0.1:4000/files" {
			t.Errorf("%s: %q", listen, got)
		}
	}
}

func TestUsesTheAuthDefaultRateLimitWhenTheFlagIsOmitted(t *testing.T) {
	for auth, want := range map[string]int64{"none": 0, "proxy": 0, "ticket": 60} {
		if got := parsedOK(t, []string{"--auth", auth}, noEnv).options.RateLimitPerMinute; got != want {
			t.Errorf("%s: %d, want %d", auth, got, want)
		}
	}
}

func TestParsesTheDocEndpointAuthFromTheEnvironment(t *testing.T) {
	parsed := parsedOK(t, []string{"--collab", "--doc-endpoint", validDocEndpoint}, env("BLOK_DOC_ENDPOINT_AUTH", "Bearer environment-token"))
	o := parsed.options
	if !o.CollabEnabled || o.DocEndpoint != validDocEndpoint || o.DocEndpointAuth != "Bearer environment-token" || parsed.docEndpointAuthFromFlag {
		t.Fatalf("%+v", parsed)
	}
}

func TestLetsAnExplicitDocEndpointAuthFlagOverrideTheEnvironment(t *testing.T) {
	parsed := parsedOK(t, []string{"--collab", "--doc-endpoint", validDocEndpoint, "--doc-endpoint-auth", "Bearer flag-token"}, env("BLOK_DOC_ENDPOINT_AUTH", "Bearer environment-token"))
	if parsed.options.DocEndpointAuth != "Bearer flag-token" || !parsed.docEndpointAuthFromFlag {
		t.Fatalf("%+v", parsed)
	}
}

func TestDefaultsCollabOffWithAWorkingSetDirectoryBesideTheUploads(t *testing.T) {
	o := parsedOK(t, nil, noEnv).options
	if o.CollabEnabled || o.CollabDirectory != "./blok-collab" || o.DocEndpoint != "" || o.DocEndpointAuth != "" || o.CollabS3Prefix != "" {
		t.Fatalf("%+v", o)
	}
}

func TestParsesTheBooleanCollabFlagForms(t *testing.T) {
	if !parsedOK(t, []string{"--collab"}, noEnv).options.CollabEnabled || parsedOK(t, []string{"--collab=false"}, noEnv).options.CollabEnabled {
		t.Fatal("--collab forms")
	}
}

func TestDefaultsTheCollabJournalOff(t *testing.T) {
	if parsedOK(t, []string{"--collab"}, noEnv).options.CollabJournal {
		t.Fatal("journal on")
	}
}

func TestParsesTheBooleanCollabJournalFlagForms(t *testing.T) {
	if !parsedOK(t, []string{"--collab-journal"}, noEnv).options.CollabJournal || parsedOK(t, []string{"--collab-journal=false"}, noEnv).options.CollabJournal {
		t.Fatal("--collab-journal forms")
	}
	parseError(t, []string{"--collab-journal=maybe"}, noEnv, `invalid value "maybe" for flag -collab-journal: parse error`)
}

func TestReadsTheCollabJournalFromTheEnvironmentUnlessTheFlagIsGiven(t *testing.T) {
	journal := env("BLOK_COLLAB_JOURNAL", "true")
	if !parsedOK(t, []string{"--collab"}, journal).options.CollabJournal {
		t.Fatal("the environment did not turn the journal on")
	}
	if parsedOK(t, []string{"--collab-journal=false"}, journal).options.CollabJournal {
		t.Fatal("the flag did not win")
	}
	if parsedOK(t, nil, env("BLOK_COLLAB_JOURNAL", "")).options.CollabJournal {
		t.Fatal("an empty variable turned the journal on")
	}
	parseError(t, nil, env("BLOK_COLLAB_JOURNAL", "maybe"), `invalid value "maybe" for BLOK_COLLAB_JOURNAL: parse error`)
}

func sortedKeys(fields map[string][]string) []string {
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func TestParsesTheRichTextFieldsFlagAsAJSONObjectOfFieldLists(t *testing.T) {
	fields := parsedOK(t, []string{"--rich-text-fields", `{ "callout": ["title", "caption"], "widget": [] }`}, noEnv).options.RichTextFields
	if !slices.Equal(sortedKeys(fields), []string{"callout", "widget"}) || !slices.Equal(fields["callout"], []string{"title", "caption"}) || len(fields["widget"]) != 0 {
		t.Fatalf("%v", fields)
	}
}

func TestDefaultsTheRichTextFieldsToNone(t *testing.T) {
	if fields := parsedOK(t, nil, noEnv).options.RichTextFields; len(fields) != 0 {
		t.Fatalf("%v", fields)
	}
}

func TestRefusesRichTextFieldsThatAreNotAnObjectOfStringLists(t *testing.T) {
	for _, value := range []string{
		"not json",
		`["callout"]`,
		`{ "callout": "title" }`,
		`{ "callout": [1] }`,
		`{ "callout": [null] }`,
		`{ "callout": null }`,
		`{ "a": ["x"], "a": ["y"] }`,
	} {
		parseError(t, []string{"--rich-text-fields", value}, noEnv, `invalid value "`+value+`" for flag -rich-text-fields: parse error`)
	}
}

func TestReadsTheRichTextFieldsFromTheEnvironmentUnlessTheFlagIsGiven(t *testing.T) {
	fields := env("BLOK_RICH_TEXT_FIELDS", `{ "callout": ["title"] }`)
	if got := parsedOK(t, nil, fields).options.RichTextFields["callout"]; !slices.Equal(got, []string{"title"}) {
		t.Fatalf("%v", got)
	}
	if got := parsedOK(t, []string{"--rich-text-fields", `{ "widget": ["text"] }`}, fields).options.RichTextFields; !slices.Equal(sortedKeys(got), []string{"widget"}) {
		t.Fatalf("%v", got)
	}
	if got := parsedOK(t, nil, env("BLOK_RICH_TEXT_FIELDS", "")).options.RichTextFields; len(got) != 0 {
		t.Fatalf("%v", got)
	}
	parseError(t, nil, env("BLOK_RICH_TEXT_FIELDS", "nope"), `invalid value "nope" for BLOK_RICH_TEXT_FIELDS: parse error`)
}

// A blank host keeps port 0: the host stays up and prints the address as given.
func TestKeepsPortZeroWhenBindingABlankHostListener(t *testing.T) {
	started := listeningHost(t, []string{"--listen", ":0", "--auth", "ticket", "--secret", validSecret, "--allow-origin", "https://app.example.com", "--storage-dir", ""}, noEnv)
	if out := started.stderr.String(); !strings.Contains(out, "listening on :0") {
		t.Fatalf("%q", out)
	}
	select {
	case code := <-started.done:
		t.Fatalf("exited %d: %s", code, started.stderr.String())
	case <-time.After(500 * time.Millisecond):
	}
	started.cancel()
	if code := <-started.done; code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestFileBytesAndFilesCORSAreOffByDefault(t *testing.T) {
	options := parsedOK(t, nil, noEnv).options
	if options.FileBytesEnabled || options.FilesCORS || options.FileBytesMaxBytes == nil || *options.FileBytesMaxBytes != 100<<20 {
		t.Fatalf("defaults %v %v %v", options.FileBytesEnabled, options.FilesCORS, options.FileBytesMaxBytes)
	}
}

func TestParsesTheFileBytesFlags(t *testing.T) {
	options := parsedOK(t, []string{"--file-bytes", "--file-bytes-max-bytes", "2048", "--files-cors"}, noEnv).options
	if !options.FileBytesEnabled || !options.FilesCORS || *options.FileBytesMaxBytes != 2048 {
		t.Fatalf("got %v %v %d", options.FileBytesEnabled, options.FilesCORS, *options.FileBytesMaxBytes)
	}
	options = parsedOK(t, []string{"--file-bytes=false", "--files-cors=false", "--file-bytes-max-bytes=0x800"}, noEnv).options
	if options.FileBytesEnabled || options.FilesCORS || *options.FileBytesMaxBytes != 2048 {
		t.Fatalf("explicit forms: %v %v %d", options.FileBytesEnabled, options.FilesCORS, *options.FileBytesMaxBytes)
	}
	parseError(t, []string{"--file-bytes=maybe"}, noEnv, `invalid value "maybe" for flag -file-bytes: parse error`)
	parseError(t, []string{"--files-cors=maybe"}, noEnv, `invalid value "maybe" for flag -files-cors: parse error`)
	parseError(t, []string{"--file-bytes-max-bytes=lots"}, noEnv, `invalid value "lots" for flag -file-bytes-max-bytes: parse error`)
	parseError(t, []string{"--file-bytes-max-bytes"}, noEnv, "flag needs an argument: -file-bytes-max-bytes")
}
