package blokmcp

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Ports test/unit/mcp/local-files.test.ts: reads stay inside the root.
type localFixture struct{ base, root string }

func newLocalFixture(t *testing.T) localFixture {
	t.Helper()
	// t.TempDir is under /var on macOS, a symlink to /private/var.
	base := t.TempDir()
	root := filepath.Join(base, "root")
	if err := os.MkdirAll(filepath.Join(root, "pics"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, "pics", "cat.png"), []byte("cat-bytes"), 0o644)
	_ = os.WriteFile(filepath.Join(base, "secret.png"), []byte("secret"), 0o644)
	return localFixture{base, root}
}

func readerOf(t *testing.T, root string) *localReader {
	t.Helper()
	reader, err := newLocalReader(root)
	if err != nil {
		t.Fatal(err)
	}
	return reader
}

func refusalOf(t *testing.T, reader *localReader, path string, maxBytes int64) *agentFailure {
	t.Helper()
	_, _, err := reader.read(path, maxBytes)
	var failure *agentFailure
	if !errors.As(err, &failure) {
		t.Fatalf("read %q: %v, want an agent failure", path, err)
	}
	return failure
}

func TestLocalReadsAFileUnderTheRoot(t *testing.T) {
	f := newLocalFixture(t)
	bytes, name, err := readerOf(t, f.root).read("pics/cat.png", 100)
	if err != nil || string(bytes) != "cat-bytes" || name != "cat.png" {
		t.Fatalf("%q %q %v", bytes, name, err)
	}
}

func TestLocalRefusesPathsOutOfTheRoot(t *testing.T) {
	f := newLocalFixture(t)
	reader := readerOf(t, f.root)
	for _, path := range []string{"../secret.png", "pics/../../secret.png", filepath.Join(f.base, "secret.png"), "/etc/hosts"} {
		if got := refusalOf(t, reader, path, 100); got.Code != "PRECONDITION_FAILED" {
			t.Fatalf("%s: %v", path, got)
		}
	}
	real, _ := filepath.EvalSymlinks(f.root)
	if _, name, err := reader.read(filepath.Join(real, "pics", "cat.png"), 100); err != nil || name != "cat.png" {
		t.Fatalf("an absolute path inside: %q %v", name, err)
	}
}

func TestLocalRefusesSymlinksOut(t *testing.T) {
	f := newLocalFixture(t)
	_ = os.Symlink(filepath.Join(f.base, "secret.png"), filepath.Join(f.root, "link.png"))
	_ = os.Symlink(f.base, filepath.Join(f.root, "out"))
	reader := readerOf(t, f.root)
	for _, path := range []string{"link.png", "out/secret.png"} {
		if got := refusalOf(t, reader, path, 100); got.Code != "PRECONDITION_FAILED" {
			t.Fatalf("%s: %v", path, got)
		}
	}
}

func TestLocalRefusesHiddenFiles(t *testing.T) {
	f := newLocalFixture(t)
	_ = os.Mkdir(filepath.Join(f.root, ".git"), 0o755)
	_ = os.WriteFile(filepath.Join(f.root, ".env"), []byte("SECRET=1"), 0o644)
	_ = os.WriteFile(filepath.Join(f.root, ".git", "config"), []byte("token"), 0o644)
	_ = os.WriteFile(filepath.Join(f.root, "pics", ".hidden.png"), []byte("hidden"), 0o644)
	_ = os.Symlink(filepath.Join(f.root, ".env"), filepath.Join(f.root, "pics", "env.png"))
	reader := readerOf(t, f.root)
	for _, path := range []string{".env", ".git/config", "pics/.hidden.png", "pics/env.png"} {
		if got := refusalOf(t, reader, path, 100); got.Code != "PRECONDITION_FAILED" {
			t.Fatalf("%s: %v", path, got)
		}
	}
	if _, name, err := reader.read("./pics/cat.png", 100); err != nil || name != "cat.png" {
		t.Fatalf("./pics/cat.png: %q %v", name, err)
	}
}

func TestLocalRefusesAFIFOAFolderAndADevice(t *testing.T) {
	f := newLocalFixture(t)
	if err := exec.Command("mkfifo", filepath.Join(f.root, "pipe.png")).Run(); err != nil {
		t.Skip("no mkfifo")
	}
	reader := readerOf(t, f.root)
	for _, path := range []string{"pipe.png", "pics"} {
		if got := refusalOf(t, reader, path, 100); !strings.Contains(got.Message, "not a regular file") {
			t.Fatalf("%s: %v", path, got)
		}
	}
	if got := refusalOf(t, readerOf(t, "/dev"), "null", 100); !strings.Contains(got.Message, "not a regular file") {
		t.Fatalf("/dev/null: %v", got)
	}
}

func TestLocalRefusesAFilePastTheCap(t *testing.T) {
	f := newLocalFixture(t)
	if got := refusalOf(t, readerOf(t, f.root), "pics/cat.png", 3); !strings.Contains(got.Message, "too large") {
		t.Fatal(got)
	}
}

func TestLocalRefusesMissingEmptyAndNUL(t *testing.T) {
	f := newLocalFixture(t)
	reader := readerOf(t, f.root)
	if got := refusalOf(t, reader, "pics/none.png", 100); got.Code != "PRECONDITION_FAILED" {
		t.Fatal(got)
	}
	for _, path := range []string{"", "pics/cat.png\x00.txt", strings.Repeat("a", 4097)} {
		if got := refusalOf(t, reader, path, 100); got.Code != "INVALID_ARGS" {
			t.Fatalf("%q: %v", path, got)
		}
	}
}

func TestLocalRefusesAHardLinkOut(t *testing.T) {
	f := newLocalFixture(t)
	if err := os.Link(filepath.Join(f.base, "secret.png"), filepath.Join(f.root, "linked.png")); err != nil {
		t.Skip(err)
	}
	if got := refusalOf(t, readerOf(t, f.root), "linked.png", 100); got.Code != "PRECONDITION_FAILED" {
		t.Fatal(got)
	}
}

func TestLocalRefusesAParentSwappedAfterTheCheck(t *testing.T) {
	f := newLocalFixture(t)
	_ = os.Mkdir(filepath.Join(f.base, "outside"), 0o755)
	_ = os.WriteFile(filepath.Join(f.base, "outside", "cat.png"), []byte("outside-bytes"), 0o644)
	reader := readerOf(t, f.root)
	reader.afterResolve = func() {
		_ = os.Rename(filepath.Join(f.root, "pics"), filepath.Join(f.base, "pics-moved"))
		_ = os.Symlink(filepath.Join(f.base, "outside"), filepath.Join(f.root, "pics"))
	}
	if got := refusalOf(t, reader, "pics/cat.png", 100); got.Code != "PRECONDITION_FAILED" {
		t.Fatal(got)
	}
}

func TestLocalGivesOneAnswerForMissingAndOutside(t *testing.T) {
	f := newLocalFixture(t)
	reader := readerOf(t, f.root)
	outside := strings.Replace(refusalOf(t, reader, "../secret.png", 100).Message, "../secret.png", "X", 1)
	missing := strings.Replace(refusalOf(t, reader, "../nothing-here.png", 100).Message, "../nothing-here.png", "X", 1)
	inside := strings.Replace(refusalOf(t, reader, "pics/none.png", 100).Message, "pics/none.png", "X", 1)
	if outside != missing || inside != missing {
		t.Fatalf("%q %q %q", outside, missing, inside)
	}
}

func TestLocalReadsUnderARootInAnotherCase(t *testing.T) {
	f := newLocalFixture(t)
	upper := strings.TrimSuffix(f.root, "root") + "ROOT"
	if _, err := os.Stat(upper); err != nil {
		t.Skip("a case-sensitive disk")
	}
	if _, name, err := readerOf(t, upper).read("pics/cat.png", 100); err != nil || name != "cat.png" {
		t.Fatalf("%q %v", name, err)
	}
}

func TestLocalRefusesARootThatIsNotAFolder(t *testing.T) {
	f := newLocalFixture(t)
	for _, root := range []string{filepath.Join(f.base, "secret.png"), filepath.Join(f.base, "missing")} {
		if _, err := newLocalReader(root); err == nil || !strings.Contains(err.Error(), "folder") {
			t.Fatalf("%s: %v", root, err)
		}
	}
}
