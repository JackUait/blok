package framecheck

import "testing"

// the same table as the Rust twin
// rust/crates/framecheck/tests/attack_verdicts.rs.
func TestVerdictEdgeCasesMatchRust(t *testing.T) {
	const page, editor = "https://page.example/x", "https://editor.example"
	h := func(name, value string) Header { return Header{Name: name, Value: value} }
	for _, c := range []struct {
		name, url, embedder string
		headers             []Header
		want                string
	}{
		{"idn-throwing embedder is unknown", page, "https://a／b.example", []Header{h("X-Frame-Options", "DENY")}, "unknown"},
		{"xfo deny + allowall blocks", page, editor, []Header{h("X-Frame-Options", "DENY, ALLOWALL")}, "blocked"},
		{"xfo two lines conflict blocks", page, editor, []Header{h("X-Frame-Options", "sameorigin"), h("X-Frame-Options", "deny")}, "blocked"},
		{"xfo quoted deny is invalid", page, editor, []Header{h("X-Frame-Options", "\"deny\"")}, "allowed"},
		{"xfo sameorigin same origin", page, "https://page.example", []Header{h("X-Frame-Options", "SAMEORIGIN")}, "allowed"},
		{"xfo sameorigin other origin", page, editor, []Header{h("X-Frame-Options", "SAMEORIGIN")}, "blocked"},
		{"csp none", page, editor, []Header{h("Content-Security-Policy", "frame-ancestors 'none'")}, "blocked"},
		{"csp upper case", page, editor, []Header{h("Content-Security-Policy", "FRAME-ANCESTORS 'NONE'")}, "blocked"},
		{"csp second policy in one line", page, editor, []Header{h("Content-Security-Policy", "frame-ancestors *, frame-ancestors 'none'")}, "blocked"},
		{"csp wildcard sub does not match apex", page, "https://example.com", []Header{h("Content-Security-Policy", "frame-ancestors https://*.example.com")}, "blocked"},
		{"csp default-src does not govern framing", page, editor, []Header{h("Content-Security-Policy", "default-src 'none'")}, "allowed"},
		{"csp non-ascii directive skipped, xfo decides", page, editor, []Header{h("Content-Security-Policy", "frame-ancestors 'none'é"), h("X-Frame-Options", "DENY")}, "blocked"},
		{"csp port mismatch", page, "https://editor.example:8443", []Header{h("Content-Security-Policy", "frame-ancestors https://editor.example")}, "blocked"},
		{"csp overrides xfo", page, editor, []Header{h("Content-Security-Policy", "frame-ancestors https://editor.example"), h("X-Frame-Options", "DENY")}, "allowed"},
		{"http page with deny still blocked first", "http://page.example/", editor, []Header{h("X-Frame-Options", "DENY")}, "blocked"},
		{"no embedder", page, "", nil, "unknown"},
	} {
		if got := Verdict(c.url, c.embedder, c.headers); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}
