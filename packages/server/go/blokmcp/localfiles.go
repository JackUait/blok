package blokmcp

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

// maxLocalPath is Node's MAX_PATH, in UTF-16 units as JS counts them.
const maxLocalPath = 4096

// agentFailure is an agent error the host raises inside a prepare step, as
// Node's failure() builds it.
type agentFailure struct {
	Code    string
	Message string
	Path    string
}

func (f *agentFailure) Error() string { return f.Message }

func (f *agentFailure) errorJSON() map[string]any {
	failure := map[string]any{"code": f.Code, "message": f.Message, "retryable": false}
	if f.Path != "" {
		failure["path"] = f.Path
	}
	return failure
}

func pathRefusal(message string) *agentFailure {
	return &agentFailure{Code: "PRECONDITION_FAILED", Message: message, Path: "/path"}
}

func tooLarge(size, maxBytes int64) *agentFailure {
	return pathRefusal(fmt.Sprintf("The file is too large: %d bytes, and this host takes at most %d.", size, maxBytes))
}

// localReader is Node's createLocalFileReader: it reads files under one
// folder for uploads. A path that resolves outside it (through .., a
// symlink or a parent swapped during the read) is refused, and so is a
// hard-linked file, whose other name may be outside, and a hidden file such
// as .env. Only regular files are read: a FIFO or a device could block or
// never end.
type localReader struct {
	root string
	// afterResolve is a test seam between resolving and opening, where a
	// swap would land.
	afterResolve func()
}

func newLocalReader(root string) (*localReader, error) {
	real, err := filepath.EvalSymlinks(root)
	if err == nil {
		real, err = filepath.Abs(real)
	}
	if err == nil {
		var info os.FileInfo
		if info, err = os.Stat(real); err == nil && !info.IsDir() {
			err = errors.New("not a folder")
		}
	}
	if err != nil {
		return nil, &ConfigError{Message: `The upload root "` + root + `" is not a folder`}
	}
	return &localReader{root: real}, nil
}

func (r *localReader) inside(real string) bool {
	return real == r.root || strings.HasPrefix(real, strings.TrimSuffix(r.root, string(filepath.Separator))+string(filepath.Separator))
}

// notHere is one answer for missing and outside, so a refusal tells
// nothing about the rest of the disk.
func notHere(path string) *agentFailure {
	return pathRefusal(`"` + path + `" is not a file under the upload folder.`)
}

func (r *localReader) resolveInside(path string) (string, error) {
	joined := path
	if !filepath.IsAbs(joined) {
		joined = filepath.Join(r.root, path)
	}
	real, err := filepath.EvalSymlinks(joined)
	if err == nil {
		real, err = filepath.Abs(real)
	}
	if err != nil || !r.inside(real) {
		return "", notHere(path)
	}
	// Checked on the resolved path, so a symlink to .env is refused too.
	// Above the root, a dot folder is the user's choice.
	if rel, err := filepath.Rel(r.root, real); err == nil && rel != "." {
		for _, part := range strings.Split(rel, string(filepath.Separator)) {
			if strings.HasPrefix(part, ".") {
				return "", pathRefusal(`"` + path + `" is a hidden file or in a hidden folder, and uploads never read those.`)
			}
		}
	}
	return real, nil
}

// read answers the file's bytes and its base name, or an *agentFailure.
func (r *localReader) read(path string, maxBytes int64) ([]byte, string, error) {
	if path == "" || len(utf16.Encode([]rune(path))) > maxLocalPath || strings.ContainsRune(path, 0) {
		return nil, "", &agentFailure{Code: "INVALID_ARGS", Message: fmt.Sprintf("path must be 1 to %d characters with no NUL byte.", maxLocalPath), Path: "/path"}
	}
	real, err := r.resolveInside(path)
	if err != nil {
		return nil, "", err
	}
	if r.afterResolve != nil {
		r.afterResolve()
	}
	before, err := os.Stat(real)
	if err != nil {
		return nil, "", notHere(path)
	}
	if !before.Mode().IsRegular() {
		return nil, "", pathRefusal(`"` + path + `" is not a regular file.`)
	}
	if before.Size() > maxBytes {
		return nil, "", tooLarge(before.Size(), maxBytes)
	}
	// The no-follow flag guards only the last part of the path, so the open
	// file is checked again below.
	file, err := os.OpenFile(real, os.O_RDONLY|openNoFollow, 0)
	if err != nil {
		return nil, "", pathRefusal(`"` + path + `" could not be opened.`)
	}
	defer file.Close()
	opened, err := file.Stat()
	links, linksErr := linkCount(file, opened)
	if err != nil || !opened.Mode().IsRegular() || linksErr != nil || links != 1 {
		return nil, "", pathRefusal(`"` + path + `" is not a regular file with one name.`)
	}
	// The open file must be the one the path names now, from inside the
	// root. With one link, that inside name is its only name.
	again, err := r.resolveInside(path)
	if err != nil {
		return nil, "", err
	}
	named, err := os.Lstat(again)
	if err != nil {
		return nil, "", notHere(path)
	}
	if !os.SameFile(named, opened) {
		return nil, "", pathRefusal(`"` + path + `" changed while it was being read.`)
	}
	// One byte past the cap tells a file that grew meanwhile from one that fits.
	bytes, err := io.ReadAll(io.LimitReader(file, min(opened.Size(), maxBytes)+1))
	if err != nil {
		return nil, "", pathRefusal(`"` + path + `" could not be opened.`)
	}
	if int64(len(bytes)) > maxBytes {
		return nil, "", tooLarge(int64(len(bytes)), maxBytes)
	}
	return bytes, filepath.Base(again), nil
}
