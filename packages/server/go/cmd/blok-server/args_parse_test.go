package main

import (
	"reflect"
	"strings"
	"testing"
)

// Parse-level twins of HostProcessTests, with the Rust names.

const validDocEndpoint = "https://app.example.com/api/blok-docs"

func envOf(name, value string) func(string) string {
	return func(asked string) string {
		if asked == name {
			return value
		}
		return ""
	}
}

func TestUsesALoopbackPublicUrlForWildcardListeners(t *testing.T) {
	for _, listen := range []string{"*:4000", "+:4000"} {
		parsed := parseHostArguments([]string{"--listen", listen}, noEnv)
		if parsed.err != "" || parsed.options.PublicURL != "http://127.0.0.1:4000/files" {
			t.Fatalf("%s: err %q, public url %q", listen, parsed.err, parsed.options.PublicURL)
		}
	}
}

func TestUsesTheAuthDefaultRateLimitWhenTheFlagIsOmitted(t *testing.T) {
	for auth, want := range map[string]int64{"none": 0, "proxy": 0, "ticket": 60} {
		parsed := parseHostArguments([]string{"--auth", auth}, noEnv)
		if parsed.err != "" || parsed.options.RateLimitPerMinute != want {
			t.Fatalf("%s: err %q, rate %d", auth, parsed.err, parsed.options.RateLimitPerMinute)
		}
	}
}

func TestKeepsPortZeroWhenBindingABlankHostListener(t *testing.T) {
	started := listeningHost(t, []string{"--listen", ":0", "--auth", "ticket", "--secret", strings.Repeat("s", 32),
		"--allow-origin", "https://app.example.com", "--storage-dir", ""}, noEnv)
	defer func() { started.cancel(); <-started.done }()
	if !strings.Contains(started.stderr.String(), "listening on :0 ") {
		t.Fatalf("stderr %q", started.stderr.String())
	}
}

func TestParsesTheDocEndpointAuthFromTheEnvironment(t *testing.T) {
	parsed := parseHostArguments([]string{"--collab", "--doc-endpoint", validDocEndpoint},
		envOf("BLOK_DOC_ENDPOINT_AUTH", "Bearer environment-token"))
	if parsed.err != "" || parsed.options.DocEndpointAuth != "Bearer environment-token" || parsed.docEndpointAuthFromFlag {
		t.Fatalf("%+v", parsed)
	}
}

func TestLetsAnExplicitDocEndpointAuthFlagOverrideTheEnvironment(t *testing.T) {
	parsed := parseHostArguments([]string{"--collab", "--doc-endpoint", validDocEndpoint, "--doc-endpoint-auth", "Bearer flag-token"},
		envOf("BLOK_DOC_ENDPOINT_AUTH", "Bearer environment-token"))
	if parsed.err != "" || parsed.options.DocEndpointAuth != "Bearer flag-token" || !parsed.docEndpointAuthFromFlag {
		t.Fatalf("%+v", parsed)
	}
}

func TestDefaultsCollabOffWithAWorkingSetDirectoryBesideTheUploads(t *testing.T) {
	parsed := parseHostArguments(nil, noEnv)
	o := parsed.options
	if parsed.err != "" || o.CollabEnabled || o.CollabDirectory != "./blok-collab" || o.DocEndpoint != "" || o.DocEndpointAuth != "" || o.CollabS3Prefix != "" {
		t.Fatalf("%+v", parsed)
	}
}

func TestReadsTheCollabJournalFromTheEnvironmentUnlessTheFlagIsGiven(t *testing.T) {
	journal := envOf("BLOK_COLLAB_JOURNAL", "true")
	if parsed := parseHostArguments([]string{"--collab"}, journal); parsed.err != "" || !parsed.options.CollabJournal {
		t.Fatalf("environment: %+v", parsed)
	}
	if parsed := parseHostArguments([]string{"--collab-journal=false"}, journal); parsed.err != "" || parsed.options.CollabJournal {
		t.Fatalf("flag: %+v", parsed)
	}
	if parsed := parseHostArguments(nil, envOf("BLOK_COLLAB_JOURNAL", "maybe")); parsed.err != `invalid value "maybe" for BLOK_COLLAB_JOURNAL: parse error` {
		t.Fatalf("invalid: %q", parsed.err)
	}
}

func TestReadsTheRichTextFieldsFromTheEnvironmentUnlessTheFlagIsGiven(t *testing.T) {
	fields := envOf("BLOK_RICH_TEXT_FIELDS", `{ "callout": ["title"] }`)
	if parsed := parseHostArguments(nil, fields); parsed.err != "" || !reflect.DeepEqual(parsed.options.RichTextFields, map[string][]string{"callout": {"title"}}) {
		t.Fatalf("environment: %+v", parsed)
	}
	parsed := parseHostArguments([]string{"--rich-text-fields", `{ "widget": ["text"] }`}, fields)
	if parsed.err != "" || !reflect.DeepEqual(parsed.options.RichTextFields, map[string][]string{"widget": {"text"}}) {
		t.Fatalf("flag: %+v", parsed)
	}
	if parsed := parseHostArguments(nil, noEnv); parsed.err != "" || len(parsed.options.RichTextFields) != 0 {
		t.Fatalf("none: %+v", parsed)
	}
}
