package blokmcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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

// captureLog swaps the package log for a buffer until the test ends.
func captureLog(t *testing.T) *strings.Builder {
	t.Helper()
	logged := &strings.Builder{}
	before := logOutput
	logOutput = logged
	t.Cleanup(func() { logOutput = before })
	return logged
}

// As in Node, the agent sees a generic TOOL_ACTION_FAILED, never the uploader's
// own text, and the full error goes to stderr.
func TestAFailedUploadFailsTheBatch(t *testing.T) {
	logged := captureLog(t)
	f := newUploadFixture(t)
	f.uploader.err = errors.New("connect ECONNREFUSED db.internal:5432 (password=hunter2)")
	server := f.start(t, &Uploads{Uploader: f.uploader})
	answer := f.execute(t, server, true, `[{"name":"file.uploadFile","args":{"data":"eA==","fileName":"a.txt"}}]`)
	raw, _ := json.Marshal(answer)
	if strings.Contains(string(raw), "hunter2") {
		t.Fatalf("the agent saw the host's text: %s", raw)
	}
	failure, _ := answer["error"].(map[string]any)
	if errorCode(answer) != "TOOL_ACTION_FAILED" || failure["message"] != "The upload failed." || len(f.saved(t)) != 0 {
		t.Fatalf("answer %v", answer)
	}
	if !strings.Contains(logged.String(), "blok-mcp: the host uploader failed: connect ECONNREFUSED db.internal:5432 (password=hunter2)") {
		t.Fatalf("log %q", logged.String())
	}
}

// Node's agentMessage: an UploadError's AgentMessage is the text the agent sees.
func TestAnUploadErrorShowsTheAgentItsAgentMessage(t *testing.T) {
	logged := captureLog(t)
	f := newUploadFixture(t)
	f.uploader.err = fmt.Errorf("wrapped: %w", &UploadError{Err: errors.New("quota exceeded for tenant 42"), AgentMessage: "Your storage quota is full."})
	server := f.start(t, &Uploads{Uploader: f.uploader})
	answer := f.execute(t, server, true, `[{"name":"file.uploadFile","args":{"data":"eA==","fileName":"a.txt"}}]`)
	failure, _ := answer["error"].(map[string]any)
	if errorCode(answer) != "TOOL_ACTION_FAILED" || failure["message"] != "Your storage quota is full." || failure["retryable"] != false {
		t.Fatalf("answer %v", answer)
	}
	if !strings.Contains(logged.String(), "quota exceeded for tenant 42") {
		t.Fatalf("log %q", logged.String())
	}
}

// A blank AgentMessage says nothing, so the agent gets the generic text.
func TestABlankAgentMessageKeepsTheGenericText(t *testing.T) {
	captureLog(t)
	f := newUploadFixture(t)
	f.uploader.err = &UploadError{Err: errors.New("secret"), AgentMessage: "  "}
	server := f.start(t, &Uploads{Uploader: f.uploader})
	answer := f.execute(t, server, true, `[{"name":"file.uploadFile","args":{"data":"eA==","fileName":"a.txt"}}]`)
	failure, _ := answer["error"].(map[string]any)
	if failure["message"] != "The upload failed." {
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

// An upload must be alone in its batch, so one behind another command never
// reaches the uploader, and bad base64 is refused before any upload.
func TestUploadBytesAreOnlyTheCheckedCommands(t *testing.T) {
	f := newUploadFixture(t)
	server := f.start(t, &Uploads{Uploader: f.uploader})
	answer := f.execute(t, server, true, `[{"name":"doc.setTitle","args":{"title":"T"}},{"name":"file.uploadFile","args":{"data":"aGVsbG8=","fileName":"a.txt"}}]`)
	if errorCode(answer) != "INVALID_ARGS" || f.uploader.calls() != 0 {
		t.Fatalf("two commands: %v, %d uploads", answer, f.uploader.calls())
	}
	answer = f.execute(t, server, true, `[{"name":"file.uploadFile","args":{"data":"a$bc","fileName":"a.txt"}}]`)
	if errorCode(answer) != "INVALID_ARGS" || f.uploader.calls() != 0 {
		t.Fatalf("bad base64: %v, %d uploads", answer, f.uploader.calls())
	}
}

// The host decodes the data the bundle named, and refuses bytes that are
// not the size the bundle checked or base64 that does not decode.
func TestRunUploadRefusesBytesTheBatchDidNotCheck(t *testing.T) {
	f := newUploadFixture(t)
	server := f.start(t, &Uploads{Uploader: f.uploader})
	data := base64.StdEncoding.EncodeToString([]byte("hello"))
	for name, call := range map[string]*hostUpload{
		"wrong size": {Op: "uploadByFile", FileName: "a.txt", Size: 4, Data: &data},
		"bad base64": {Op: "uploadByFile", FileName: "a.txt", Size: 3, Data: new(string)},
		"no bytes":   {Op: "uploadByFile", FileName: "a.txt", Size: 5},
		"no read":    {Op: "uploadByFile", FileName: "a.txt", Size: 5, Local: new(int)},
	} {
		if name == "bad base64" {
			*call.Data = "a$bc"
		}
		answer, _ := server.runUpload(context.Background(), call, &uploadRun{reads: map[int][]byte{}}).(map[string]any)
		if _, failed := answer["error"]; !failed {
			t.Fatalf("%s: %v", name, answer)
		}
	}
	if f.uploader.calls() != 0 {
		t.Fatalf("%d uploads", f.uploader.calls())
	}
	ok := server.runUpload(context.Background(), &hostUpload{Op: "uploadByFile", FileName: "a.txt", Size: 5, Data: &data}, &uploadRun{reads: map[int][]byte{}})
	if answer, _ := ok.(map[string]any); answer["url"] != "https://cdn.test/a.txt" || string(f.uploader.files[0].Bytes) != "hello" {
		t.Fatalf("%v", ok)
	}
}
