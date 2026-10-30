package outbound

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The Go analogue of OutboundClientArchitectureTests: outbound networking
// may only be owned by the guarded fetcher. The S3 store reaches only the
// operator's endpoint, never a caller's URL, so it is exempt for exactly one
// client, one transport and one dialer. The doc-endpoint client will get
// the same pinned exemption when collab adds it.

// restricted names what opens a connection, by import path.
var restricted = map[string]map[string]bool{
	"net/http": {
		"Client": true, "Transport": true, "DefaultClient": true, "DefaultTransport": true,
		"Get": true, "Head": true, "Post": true, "PostForm": true,
	},
	"net":        {"Dial": true, "DialTimeout": true, "Dialer": true, "DialTCP": true, "DialUDP": true, "DialIP": true, "DialUnix": true},
	"crypto/tls": {"Dial": true, "DialWithDialer": true, "Client": true, "Dialer": true},
}

const guardOwner = "internal/outbound/fetcher.go"

// pinned owners may make one of each, and nothing else restricted.
var pinned = map[string]map[string]int{
	"internal/blob/s3.go": {"http.Client": 1, "http.Transport": 1, "net.Dialer": 1},
}

type use struct {
	file, name string
	line       int
}

// findUses lists every restricted name a Go file touches.
func findUses(path string, source []byte) ([]use, error) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, source, parser.SkipObjectResolution)
	if err != nil {
		return nil, err
	}
	imports := map[string]string{}
	for _, spec := range file.Imports {
		importPath, _ := strconv.Unquote(spec.Path.Value)
		if _, watched := restricted[importPath]; !watched {
			continue
		}
		name := importPath[strings.LastIndexByte(importPath, '/')+1:]
		if spec.Name != nil {
			name = spec.Name.Name
		}
		if name == "." {
			return []use{{path, importPath + " dot import", fileSet.Position(spec.Pos()).Line}}, nil
		}
		imports[name] = importPath
	}
	var uses []use
	var parents []ast.Node
	ast.Inspect(file, func(node ast.Node) bool {
		if node == nil {
			parents = parents[:len(parents)-1]
			return true
		}
		parents = append(parents, node)
		selector, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		ident, ok := selector.X.(*ast.Ident)
		if !ok {
			return true
		}
		// A pointer type names a client without making one; a value type,
		// a literal, new() or a call makes one.
		if len(parents) >= 2 {
			if _, isPointer := parents[len(parents)-2].(*ast.StarExpr); isPointer {
				return true
			}
		}
		importPath, ok := imports[ident.Name]
		if ok && restricted[importPath][selector.Sel.Name] {
			short := importPath[strings.LastIndexByte(importPath, '/')+1:]
			uses = append(uses, use{path, short + "." + selector.Sel.Name, fileSet.Position(selector.Pos()).Line})
		}
		return true
	})
	return uses, nil
}

// violations applies the owner rules to every non-test source.
func violations(sources map[string][]byte) ([]string, error) {
	var found []string
	for path, source := range sources {
		uses, err := findUses(path, source)
		if err != nil {
			return nil, err
		}
		if path == guardOwner {
			continue
		}
		allowed, isPinned := pinned[path]
		counts := map[string]int{}
		for _, u := range uses {
			counts[u.name]++
			if !isPinned || counts[u.name] > allowed[u.name] {
				found = append(found, fmt.Sprintf("%s:%d uses %s", u.file, u.line, u.name))
			}
		}
	}
	sort.Strings(found)
	return found, nil
}

func moduleSources(t *testing.T) map[string][]byte {
	t.Helper()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	sources := map[string][]byte{}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, _ := filepath.Rel(root, path)
		sources[filepath.ToSlash(relative)] = data
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return sources
}

func TestOnlyTheGuardedFetcherOwnsOutboundClients(t *testing.T) {
	sources := moduleSources(t)
	if _, ok := sources[guardOwner]; !ok {
		t.Fatalf("%s moved: update the law", guardOwner)
	}
	for owner := range pinned {
		if _, ok := sources[owner]; !ok {
			t.Fatalf("%s moved: update the law", owner)
		}
	}
	found, err := violations(sources)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) > 0 {
		t.Fatalf("outbound networking may only be owned by the guarded fetcher or the pinned S3 store:\n%s",
			strings.Join(found, "\n"))
	}
}

func TestTheLawCatchesPlantedViolations(t *testing.T) {
	cases := map[string]string{
		"a client literal":        "package p\nimport \"net/http\"\nvar c = &http.Client{}",
		"an aliased transport":    "package p\nimport h \"net/http\"\nvar t = h.Transport{}",
		"the default client":      "package p\nimport \"net/http\"\nfunc f() { http.Get(\"x\") }",
		"a raw dial":              "package p\nimport \"net\"\nfunc f() { net.Dial(\"tcp\", \"x\") }",
		"a TLS dial":              "package p\nimport \"crypto/tls\"\nfunc f() { tls.Dial(\"tcp\", \"x\", nil) }",
		"a dot import":            "package p\nimport . \"net/http\"\nvar c = Client{}",
		"a second client in S3":   "package blob\nimport \"net/http\"\nvar a, b = &http.Client{}, &http.Client{}",
		"a new restricted name":   "package p\nimport \"net/http\"\nvar c = new(http.Client)",
		"a client in a new place": "package p\nimport \"net/http\"\nvar c http.Client",
		"a pointer then a call":   "package p\nimport \"net/http\"\nvar c *http.Client = http.DefaultClient",
	}
	for name, source := range cases {
		path := "internal/somewhere/x.go"
		if strings.Contains(name, "S3") {
			path = "internal/blob/s3.go"
		}
		found, err := violations(map[string][]byte{path: []byte(source)})
		if err != nil {
			t.Fatal(err)
		}
		if len(found) == 0 {
			t.Errorf("%s: not caught", name)
		}
	}
	// Names in comments and strings are not code.
	found, _ := violations(map[string][]byte{"x.go": []byte("package p\n// http.Client\nvar s = \"http.Get\"")})
	if len(found) != 0 {
		t.Errorf("comment or string caught: %v", found)
	}
}
