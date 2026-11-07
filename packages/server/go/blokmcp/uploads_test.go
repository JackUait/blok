package blokmcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// Ports test/unit/mcp/uploads.test.ts: an agent's upload goes through the
// host's own uploader.
type fakeUploader struct {
	mu    sync.Mutex
	files []UploadFile
	err   error
}

func (u *fakeUploader) UploadByFile(_ context.Context, file UploadFile, _ UploadContext) (UploadedAsset, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.files = append(u.files, file)
	if u.err != nil {
		return UploadedAsset{}, u.err
	}
	return UploadedAsset{URL: "https://cdn.test/" + file.Name}, nil
}

func (u *fakeUploader) calls() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.files)
}

type uploadFixture struct {
	dir, files string
	uploader   *fakeUploader
}

func newUploadFixture(t *testing.T) uploadFixture {
	t.Helper()
	dir := t.TempDir()
	files := filepath.Join(dir, "uploads")
	_ = os.Mkdir(files, 0o755)
	_ = os.WriteFile(filepath.Join(files, "cat.png"), []byte("png-bytes"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "doc.json"), []byte(`{"blocks":[]}`), 0o644)
	return uploadFixture{dir: dir, files: files, uploader: &fakeUploader{}}
}

func (f uploadFixture) start(t *testing.T, uploads *Uploads) *Server {
	t.Helper()
	server, err := New(Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: f.dir}, Uploads: uploads})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return server
}

func (f uploadFixture) execute(t *testing.T, server *Server, write bool, commands string) map[string]any {
	t.Helper()
	ctx := context.Background()
	who, _ := server.actorFor(ctx, "alice", nil)
	opened, err := server.dispatch(ctx, &toolCall{name: "blok_open", caller: who,
		arguments: json.RawMessage(`{"documentId":"doc","write":` + map[bool]string{true: "true", false: "false"}[write] + `}`)})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := json.Marshal(structured(t, opened.answer)["handle"])
	ran, err := server.dispatch(ctx, &toolCall{name: "blok_execute", caller: who,
		arguments: json.RawMessage(`{"handle":` + string(handle) + `,"commands":` + commands + `}`)})
	if err != nil {
		t.Fatal(err)
	}
	return structured(t, ran.answer)
}

func (f uploadFixture) saved(t *testing.T) []map[string]any {
	t.Helper()
	var document struct {
		Blocks []map[string]any `json:"blocks"`
	}
	text, _ := os.ReadFile(filepath.Join(f.dir, "doc.json"))
	_ = json.Unmarshal(text, &document)
	return document.Blocks
}

func errorCode(answer map[string]any) string {
	failure, _ := answer["error"].(map[string]any)
	code, _ := failure["code"].(string)
	return code
}

func TestUploadsAPathUnderTheRoot(t *testing.T) {
	f := newUploadFixture(t)
	server := f.start(t, &Uploads{Uploader: f.uploader, Root: f.files})
	answer := f.execute(t, server, true, `[{"name":"image.uploadFile","args":{"path":"cat.png"}}]`)
	if answer["ok"] != true || f.uploader.calls() != 1 || string(f.uploader.files[0].Bytes) != "png-bytes" || f.uploader.files[0].Type != "image/png" {
		t.Fatalf("answer %v, uploads %+v", answer, f.uploader.files)
	}
	blocks := f.saved(t)
	data, _ := json.Marshal(blocks[0]["data"])
	if len(blocks) != 1 || blocks[0]["type"] != "image" || string(data) != `{"fileName":"cat.png","url":"https://cdn.test/cat.png"}` {
		t.Fatalf("saved %v", blocks)
	}
}

func TestUploadsBase64BytesWithAFileName(t *testing.T) {
	f := newUploadFixture(t)
	server := f.start(t, &Uploads{Uploader: f.uploader})
	answer := f.execute(t, server, true, `[{"name":"file.uploadFile","args":{"data":"`+base64.StdEncoding.EncodeToString([]byte("hello"))+`","fileName":"hello.txt"}}]`)
	if answer["ok"] != true || string(f.uploader.files[0].Bytes) != "hello" {
		t.Fatalf("answer %v, uploads %+v", answer, f.uploader.files)
	}
	data, _ := json.Marshal(f.saved(t)[0]["data"])
	if string(data) != `{"fileName":"hello.txt","url":"https://cdn.test/hello.txt"}` {
		t.Fatalf("saved %s", data)
	}
}

func TestUploadRefusalsNeverCallTheUploader(t *testing.T) {
	cases := []struct {
		name, commands string
		setup          func(f uploadFixture) *Uploads
		code           string
	}{
		{"a path out of the root", `[{"name":"image.uploadFile","args":{"path":"../secret.png"}}]`, func(f uploadFixture) *Uploads {
			_ = os.WriteFile(filepath.Join(f.dir, "secret.png"), []byte("secret"), 0o644)
			return &Uploads{Uploader: f.uploader, Root: f.files}
		}, "PRECONDITION_FAILED"},
		{"a hidden file", `[{"name":"file.uploadFile","args":{"path":".env"}}]`, func(f uploadFixture) *Uploads {
			_ = os.WriteFile(filepath.Join(f.files, ".env"), []byte("SECRET=1"), 0o644)
			return &Uploads{Uploader: f.uploader, Root: f.files}
		}, "PRECONDITION_FAILED"},
		{"a file whose type is not the fileName's", `[{"name":"image.uploadFile","args":{"path":"notes.txt","fileName":"cat.png"}}]`, func(f uploadFixture) *Uploads {
			_ = os.WriteFile(filepath.Join(f.files, "notes.txt"), []byte("not an image"), 0o644)
			return &Uploads{Uploader: f.uploader, Root: f.files}
		}, ""},
		{"the host's limits", `[{"name":"image.uploadFile","args":{"path":"cat.png"}}]`, func(f uploadFixture) *Uploads {
			return &Uploads{Uploader: f.uploader, Root: f.files, Limits: map[string]UploadLimit{"image": {MaxSize: 4}}}
		}, "PRECONDITION_FAILED"},
		{"a path with no root", `[{"name":"image.uploadFile","args":{"path":"/tmp/cat.png"}}]`, func(f uploadFixture) *Uploads {
			return &Uploads{Uploader: f.uploader}
		}, "COMMAND_UNAVAILABLE"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newUploadFixture(t)
			server := f.start(t, c.setup(f))
			answer := f.execute(t, server, true, c.commands)
			if answer["ok"] != false || (c.code != "" && errorCode(answer) != c.code) || f.uploader.calls() != 0 {
				t.Fatalf("answer %v, %d uploads", answer, f.uploader.calls())
			}
		})
	}
}

func TestUploadsNeverRunOnAReadOnlyHandle(t *testing.T) {
	f := newUploadFixture(t)
	server := f.start(t, &Uploads{Uploader: f.uploader, Root: f.files})
	answer := f.execute(t, server, false, `[{"name":"image.uploadFile","args":{"path":"cat.png"}}]`)
	if errorCode(answer) != "READ_ONLY" || f.uploader.calls() != 0 {
		t.Fatalf("answer %v", answer)
	}
}

func TestWithoutAnUploaderUploadIsUnavailable(t *testing.T) {
	f := newUploadFixture(t)
	server := f.start(t, nil)
	answer := f.execute(t, server, true, `[{"name":"image.uploadFile","args":{"data":"eA==","fileName":"a.png"}}]`)
	failure, _ := answer["error"].(map[string]any)
	details, _ := failure["details"].(map[string]any)
	if errorCode(answer) != "COMMAND_UNAVAILABLE" || details["reason"] != "host" {
		t.Fatalf("answer %v", answer)
	}
}

// Node's prepare step words an uploader's throw as TOOL_ACTION_FAILED.
func TestAFailedUploadFailsTheBatch(t *testing.T) {
	f := newUploadFixture(t)
	f.uploader.err = errors.New("the CDN is down")
	server := f.start(t, &Uploads{Uploader: f.uploader})
	answer := f.execute(t, server, true, `[{"name":"file.uploadFile","args":{"data":"eA==","fileName":"a.txt"}}]`)
	failure, _ := answer["error"].(map[string]any)
	if errorCode(answer) != "TOOL_ACTION_FAILED" || failure["message"] != "A prepare step failed: the CDN is down" || len(f.saved(t)) != 0 {
		t.Fatalf("answer %v", answer)
	}
}

func TestUploadOptionsAreCheckedAsNodeChecksThem(t *testing.T) {
	uploader := &fakeUploader{}
	http := Options{Transport: Transport{Kind: "http", Listen: "127.0.0.1:0"}, Auth: Auth{Kind: "none"}, Source: &Source{Kind: "files", Dir: "."},
		Authorize: func(context.Context, string, string, bool) (bool, error) { return true, nil }}
	stdio := Options{Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}}
	refused := func(options Options, uploads *Uploads, want string) {
		t.Helper()
		options.Uploads = uploads
		server, err := New(options)
		if err == nil {
			server.Close()
			t.Fatalf("%+v was taken", uploads)
		}
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("%v, want %q", err, want)
		}
	}
	refused(http, &Uploads{Uploader: uploader, Root: "."}, "uploads.root reads local files, so it works over stdio only")
	refused(stdio, &Uploads{}, "uploads.uploader needs an uploadByFile function")
	refused(stdio, &Uploads{Uploader: uploader, Limits: map[string]UploadLimit{"pdf": {MaxSize: 10}}}, "uploads.limits.pdf is not a kind")
	refused(stdio, &Uploads{Uploader: uploader, Limits: map[string]UploadLimit{"image": {MaxSize: -1}}}, "uploads.limits.image.maxSize must be a positive whole number of bytes")
	refused(stdio, &Uploads{Uploader: uploader, Root: filepath.Join(t.TempDir(), "missing")}, "is not a folder")
	http.Uploads = &Uploads{Uploader: uploader}
	if server, err := New(http); err != nil {
		t.Fatal(err)
	} else {
		server.Close()
	}
}
