package httpapi_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// outboundExemption is a file allowed to construct an outbound client, the
// reason it is not an SSRF sink, and the substring of that reason which must
// still be present in the file itself. The marker is what stops an exemption
// from outliving its justification: delete the comment that explains the
// client and this law fails until someone re-reads why the exemption exists.
type outboundExemption struct {
	reason string
	marker string
}

// There is exactly ONE exemption. Adding a second means re-reading
// internal/fetchguard's package comment first.
var outboundExemptions = map[string]outboundExemption{
	"internal/blobstore/s3.go": {
		// The S3 driver talks to the operator's OWN configured endpoint, which
		// is never consumer-supplied, so it is not an SSRF sink. This is the
		// only exemption; adding another means re-reading fetchguard's package
		// comment.
		reason: "the S3 driver talks to the operator's own configured endpoint, which is never consumer-supplied",
		marker: "the one exemption from the fetchguard law",
	},
}

// LAW: every server-side fetch of a consumer-supplied URL goes through
// internal/fetchguard. Constructing an outbound HTTP client anywhere else
// silently reopens the SSRF hole that package exists to close, so the whole
// module is scanned for one.
//
// Two scope decisions differ from the plan's sketch, both deliberate:
//
//   - The walk starts at the MODULE root, not at internal/. cmd/blok-server is
//     precisely where a bare client gets wired into a store or a fetcher, and
//     a law that cannot see main.go guards the half of the tree that does no
//     wiring.
//   - _test.go files are in scope. A test client is how a law like this gets
//     routed around: a helper lands in a fixture "just for the test" and is
//     promoted later. The pattern a test actually needs — httptest's own
//     srv.Client() — trips none of these needles, so nothing legitimate is
//     blocked.
func TestNoPackageOutsideFetchguardConstructsAnOutboundClient(t *testing.T) {
	root := filepath.Join("..", "..")

	// Needles are assembled at runtime, not written out: this file is a
	// _test.go and _test.go files are in scope, so a literal here would fail
	// the law on itself.
	pkg := "http."
	banned := []string{
		pkg + "Client{",
		pkg + "DefaultClient",
		pkg + "DefaultTransport",
		pkg + "Get(",
		pkg + "Post(",
		pkg + "PostForm(",
		pkg + "Head(",
	}

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "node_modules" || d.Name() == ".git" {
				return fs.SkipDir
			}

			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}

		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		if strings.HasPrefix(rel, "internal/fetchguard/") {
			return nil
		}
		if _, exempt := outboundExemptions[rel]; exempt {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, needle := range banned {
			if strings.Contains(string(src), needle) {
				t.Errorf("%s uses %s — every outbound fetch must go through internal/fetchguard", rel, needle)
			}
		}

		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
}

// An exemption whose reason is no longer written down is an exemption nobody
// can audit. Each exempt file must still carry its own marker.
func TestEveryOutboundExemptionStillStatesItsReason(t *testing.T) {
	root := filepath.Join("..", "..")

	for rel, exemption := range outboundExemptions {
		src, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("exempt file %s: %v — a stale exemption is a hole in the law", rel, err)
		}
		if !strings.Contains(string(src), exemption.marker) {
			t.Errorf("%s no longer says %q; its exemption rests on %q", rel, exemption.marker, exemption.reason)
		}
	}
}
