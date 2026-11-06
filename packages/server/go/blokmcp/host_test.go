package blokmcp

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fakeRuntime answers bundle operations from a table, for host-only tests.
type fakeRuntime map[string]func(input string) string

func (f fakeRuntime) Invoke(_ context.Context, op, input string, _ *time.Duration) (string, error) {
	answer, ok := f[op]
	if !ok {
		return "", errors.New("unexpected operation " + op)
	}
	return answer(input), nil
}

func idsAreFine() fakeRuntime {
	return fakeRuntime{"mcpFileId": func(string) string { return "{}" }}
}

func TestVersionFollowsTheNodePackage(t *testing.T) {
	_, here, _, _ := runtime.Caller(0)
	bytes, err := os.ReadFile(filepath.Join(filepath.Dir(here), "../../../mcp/package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct{ Version string }
	if err := json.Unmarshal(bytes, &pkg); err != nil {
		t.Fatal(err)
	}
	if Version != pkg.Version {
		t.Fatalf("Version is %q, packages/mcp/package.json says %q", Version, pkg.Version)
	}
}

func TestEncodesIdsAsEncodeURIComponent(t *testing.T) {
	cases := map[string]string{
		"a b/c?d#e":  "a%20b%2Fc%3Fd%23e",
		"!~*'()-_.":  "!~*'()-_.",
		"$&+,:;=@":   "%24%26%2B%2C%3A%3B%3D%40",
		"документ-😀": "%D0%B4%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82-%F0%9F%98%80",
		"é-doc":      "%C3%A9-doc",
	}
	for in, want := range cases {
		if got := encodeURIComponent(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestEncodesQueryValuesAsURLSearchParams(t *testing.T) {
	cases := map[string]string{"a b": "a+b", "~!'()": "%7E%21%27%28%29", "*-._": "*-._", "é&=": "%C3%A9%26%3D"}
	for in, want := range cases {
		if got := formEncode(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestRefusesDotIdsBeforeBuildingAURL(t *testing.T) {
	for _, id := range []string{"", ".", ".."} {
		if _, err := urlFor("http://h/docs", id); surfaceCode(err) != "INVALID_ARGS" {
			t.Errorf("%q: got %v", id, err)
		}
	}
	if got, _ := urlFor("http://h/docs/", "a.b"); got != "http://h/docs/a.b" {
		t.Errorf("got %q", got)
	}
}

func TestSavesTheGivenBytesAndVersionsThemBySHA256(t *testing.T) {
	dir := t.TempDir()
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	text := []byte("{\n  \"title\": \"<é> 😀\"\n}\n")
	version, err := source.save(context.Background(), "doc", text, nil)
	if err != nil {
		t.Fatal(err)
	}
	written, _ := os.ReadFile(filepath.Join(dir, "doc.json"))
	sum := sha256.Sum256(text)
	if string(written) != string(text) || *version != hex.EncodeToString(sum[:]) {
		t.Fatalf("wrote %q, version %s", written, *version)
	}
}

func TestRefusesASaveWhenTheFileChangedSinceTheLoad(t *testing.T) {
	dir := t.TempDir()
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644)
	stale := "not-the-hash"
	if _, err := source.save(context.Background(), "doc", []byte("{}\n"), &stale); surfaceCode(err) != "DOCUMENT_CHANGED" {
		t.Fatalf("got %v", err)
	}
}

func TestKeepsAFilesModeAcrossASave(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "doc.json")
	_ = os.WriteFile(path, []byte(`{"blocks":[]}`), 0o600)
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	version := sha256Hex([]byte(`{"blocks":[]}`))
	if _, err := source.save(context.Background(), "doc", []byte("{}\n"), &version); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", info.Mode().Perm())
	}
}

func TestWritesThroughASymlinkAndKeepsTheLink(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "target.json"), []byte(`{"blocks":[]}`), 0o644)
	_ = os.Symlink("target.json", filepath.Join(dir, "doc.json"))
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	version := sha256Hex([]byte(`{"blocks":[]}`))
	if _, err := source.save(context.Background(), "doc", []byte("{}\n"), &version); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Lstat(filepath.Join(dir, "doc.json"))
	written, _ := os.ReadFile(filepath.Join(dir, "target.json"))
	if info.Mode()&os.ModeSymlink == 0 || string(written) != "{}\n" {
		t.Fatalf("link kept: %v, target %q", info.Mode()&os.ModeSymlink != 0, written)
	}
}

func TestRefusesALinkToAMissingFile(t *testing.T) {
	dir := t.TempDir()
	_ = os.Symlink("gone.json", filepath.Join(dir, "doc.json"))
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	_, err := source.load(context.Background(), "doc")
	if surfaceCode(err) != "SOURCE_UNAVAILABLE" || err.Error() != "doc.json is a link to a missing file." {
		t.Fatalf("got %v", err)
	}
}

func TestWaitsForAFreshLockThenRefuses(t *testing.T) {
	dir := t.TempDir()
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	_ = os.WriteFile(filepath.Join(dir, ".doc.json.lock"), nil, 0o644)
	started := time.Now()
	_, err := source.save(context.Background(), "doc", []byte("{}\n"), nil)
	if surfaceCode(err) != "SOURCE_UNAVAILABLE" || !strings.Contains(err.Error(), "being saved by another process") {
		t.Fatalf("got %v", err)
	}
	if waited := time.Since(started); waited < lockWait {
		t.Fatalf("gave up after %v", waited)
	}
}

func TestTakesOverALockOlderThanThirtySeconds(t *testing.T) {
	dir := t.TempDir()
	lock := filepath.Join(dir, ".doc.json.lock")
	_ = os.WriteFile(lock, nil, 0o644)
	old := time.Now().Add(-31 * time.Second)
	_ = os.Chtimes(lock, old, old)
	source := newFilesSource(dir, bundle{runtime: idsAreFine()})
	if _, err := source.save(context.Background(), "doc", []byte("{}\n"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(lock); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the lock was left behind")
	}
}

func TestReadsTicketClaimsAsUTF8(t *testing.T) {
	payload := `{"user":"agent:Jöhn:tix","doc":"документ-😀"}`
	token := "h." + strings.TrimRight(base64URL([]byte(payload)), "=") + ".s"
	claims := readTicketClaims(token)
	if claims["user"] != "agent:Jöhn:tix" || claims["doc"] != "документ-😀" {
		t.Fatalf("got %v", claims)
	}
	if readTicketClaims("abc") != nil {
		t.Fatal("a pass without a payload has claims")
	}
}

func TestDecodesBase64URLLikeNodeBuffers(t *testing.T) {
	if got := string(lenientBase64URL("aGVsbG8*!!")); got != "hello" {
		t.Fatalf("got %q", got)
	}
}

func base64URL(bytes []byte) string { return base64.URLEncoding.EncodeToString(bytes) }
