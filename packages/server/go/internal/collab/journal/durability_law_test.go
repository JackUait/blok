package journal

import (
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"maps"
	"os"
	"slices"
	"strings"
	"testing"
)

// The durability law: Go twin of C# CollabDurabilityArchitectureTests. A
// flushed write and an unflushed one read back the same until power is lost,
// so deleting a Sync leaves every behavioural test green. These scans pin that
// the calls are written, in the right place and order; not that the kernel
// honoured them.

// lawFiles are the store's sources. lock_windows.go is read for the shortening
// law only: its syncDirectory is a no-op, like .NET's on Windows.
var lawFiles = []string{"store.go", "files.go", "ledger.go", "lock_flock.go", "lock_windows.go"}

// Every boundary where a completion means durable: (function, handle, the call
// the flush must follow).
var lawBoundaries = []struct{ fn, handle, after string }{
	{"Session.Append", "s.journal", "WriteAt"},
	{"publish", "manifestFile", "WriteAt"},
	{"WriteSealed", "file", "Write"},
	{"Session.Reset", "swapped", "Truncate"},
	{"Store.importWorkingSet", "journal", "Truncate"},
	{"appendLedgerEntry", "file", "Write"},
}

// Each function must call these in this source order. A presence law, not a
// control-flow one: an early return between two steps stays green.
var lawOrders = []struct {
	fn    string
	steps []string
}{
	{"Session.WriteCheckpoint", []string{"WriteSealed", "syncDirectory", "republish"}},
	{"Session.Reset", []string{"WriteSealed", "syncDirectory", "republish"}},
	// The import publishes directly, so it re-checks the fence itself: sealing
	// a whole document is long enough for a new holder to take it.
	{"Store.importWorkingSet", []string{"WriteSealed", "syncDirectory", "requireFence", "publish"}},
	{"Store.Purge", []string{"Sync", "syncDirectory", "removeFile"}},
	{"Session.republish", []string{"requireFence", "publish"}},
	// The second fence check: the first one and the write are not one step.
	{"Session.Append", []string{"requireFence", "WriteAt", "syncJournal", "requireFence"}},
}

// Every function allowed to shorten or remove a file, and whether the cut must
// follow a fence check. An exemption must say why.
var lawShortenings = []struct {
	fn         string
	needsFence bool
	reason     string
}{
	{"openManifest", false, "Only grows a manifest short of its two slots, behind a size check; such a manifest holds no history."},
	{"Store.Purge", false, "The exclusive lock refuses live sessions, and the synced purge marker fences stale ones before any payload goes; lawOrders pins that order."},
	{"Session.WriteCheckpoint", false, "Sweeps, after its publication, only checkpoint names ending in this session's own fence; two holders never share a fence."},
	{"WriteSealed", false, "O_TRUNC can only empty a name this session already abandoned: every baseline and checkpoint name carries the writer's fence."},
	{"Store.DeleteLineage", false, "Deletes only a superseded generation named by the ledger, under the ledger gate, and refuses a purged document and the current generation."},
	{"openFile", false, "The O_TRUNC primitive: it empties only after the lock is held, and every caller passing O_TRUNC is checked here."},
	{"removeFile", false, "The File.Delete primitive; its callers are checked here and pinned by lawRemoveCallers."},
	{"Session.Reset", true, ""},
	{"scanForward", true, ""},
	{"Session.rollBack", true, ""},
	{"Store.importWorkingSet", true, ""},
}

// The only callers of removeFile. A new one would make an exemption's reason
// false while every other law stays green.
var lawRemoveCallers = []string{"Session.WriteCheckpoint", "Store.DeleteLineage", "Store.Purge"}

type lawSource struct {
	funcs   map[string][]*ast.FuncDecl
	parents map[ast.Node]ast.Node
}

func parseLaw(t *testing.T, sources map[string]string) *lawSource {
	t.Helper()
	fset := token.NewFileSet()
	law := &lawSource{funcs: map[string][]*ast.FuncDecl{}, parents: map[ast.Node]ast.Node{}}
	for _, name := range slices.Sorted(maps.Keys(sources)) {
		file, err := parser.ParseFile(fset, name, sources[name], 0)
		if err != nil {
			t.Fatal(err)
		}
		var stack []ast.Node
		ast.Inspect(file, func(node ast.Node) bool {
			if node == nil {
				stack = stack[:len(stack)-1]
				return true
			}
			if len(stack) > 0 {
				law.parents[node] = stack[len(stack)-1]
			}
			stack = append(stack, node)
			return true
		})
		for _, decl := range file.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok {
				law.funcs[funcName(fn)] = append(law.funcs[funcName(fn)], fn)
			}
		}
	}
	return law
}

func readLaw(t *testing.T, files ...string) *lawSource {
	t.Helper()
	sources := map[string]string{}
	for _, name := range files {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		sources[name] = string(data)
	}
	return parseLaw(t, sources)
}

func funcName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	recv := fn.Recv.List[0].Type
	if star, ok := recv.(*ast.StarExpr); ok {
		recv = star.X
	}
	return types.ExprString(recv) + "." + fn.Name.Name
}

func callName(call *ast.CallExpr) string {
	switch fun := call.Fun.(type) {
	case *ast.Ident:
		return fun.Name
	case *ast.SelectorExpr:
		return fun.Sel.Name
	}
	return ""
}

func callReceiver(call *ast.CallExpr) string {
	if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
		return types.ExprString(sel.X)
	}
	return ""
}

func calls(node ast.Node) []*ast.CallExpr {
	var found []*ast.CallExpr
	ast.Inspect(node, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok {
			found = append(found, call)
		}
		return true
	})
	return found
}

func (l *lawSource) single(name string) (*ast.FuncDecl, string) {
	if fns := l.funcs[name]; len(fns) == 1 {
		return fns[0], ""
	}
	return nil, "there is no single " + name + " to check"
}

func (l *lawSource) owner(node ast.Node) string {
	for at := node; at != nil; at = l.parents[at] {
		if fn, ok := at.(*ast.FuncDecl); ok {
			return funcName(fn)
		}
	}
	return "<no function>"
}

// resultUsed is whether an error-returning call's result is kept: returned,
// assigned to a name, or tested.
func (l *lawSource) resultUsed(call *ast.CallExpr) bool {
	switch parent := l.parents[call].(type) {
	case *ast.ExprStmt:
		return false
	case *ast.AssignStmt:
		for _, lhs := range parent.Lhs {
			if ident, ok := lhs.(*ast.Ident); !ok || ident.Name != "_" {
				return true
			}
		}
		return false
	}
	return true
}

func (l *lawSource) flushViolations(fnName, handle, after string) []string {
	fn, missing := l.single(fnName)
	if fn == nil {
		return []string{missing}
	}
	var write *ast.CallExpr
	for _, call := range calls(fn) {
		if callName(call) == after && callReceiver(call) == handle {
			write = call
			break
		}
	}
	if write == nil {
		return []string{fnName + " no longer calls " + handle + "." + after}
	}
	for _, call := range calls(fn) {
		flush := callName(call) == "Sync" && callReceiver(call) == handle ||
			callName(call) == "syncJournal" && len(call.Args) == 1 && types.ExprString(call.Args[0]) == handle
		if flush && call.Pos() > write.Pos() && l.resultUsed(call) && l.block(call) == l.block(write) {
			return nil
		}
	}
	return []string{fnName + " must call " + handle + ".Sync() after its " + handle + "." + after + ", in the same block, and keep its result"}
}

// block is the nearest block holding node. An "if err == nil {" body counts
// as the block around it: that is Go's way of running the next step only when
// the last one worked, so it is the same straight line as C#'s one block.
func (l *lawSource) block(node ast.Node) *ast.BlockStmt {
	for at := l.parents[node]; at != nil; at = l.parents[at] {
		block, ok := at.(*ast.BlockStmt)
		if !ok {
			continue
		}
		chain, ok := l.parents[block].(*ast.IfStmt)
		if !ok || chain.Body != block || chain.Init != nil || chain.Else != nil || types.ExprString(chain.Cond) != "err == nil" {
			return block
		}
	}
	return nil
}

func (l *lawSource) orderViolations(fnName string, steps []string) []string {
	fn, missing := l.single(fnName)
	if fn == nil {
		return []string{missing}
	}
	previous := token.NoPos
	for _, step := range steps {
		index := slices.IndexFunc(calls(fn), func(call *ast.CallExpr) bool {
			return callName(call) == step && call.Pos() > previous
		})
		if index < 0 {
			return []string{fnName + " must call " + strings.Join(steps, " then ") + "; " + step + " is missing or out of order"}
		}
		previous = calls(fn)[index].Pos()
	}
	return nil
}

// isFenceCheck is a statement that takes a fence check's error: err := f(),
// err = f(), or if err := f(); err != nil.
func isFenceCheck(stmt ast.Stmt) bool {
	if ifStmt, ok := stmt.(*ast.IfStmt); ok && ifStmt.Init != nil {
		stmt = ifStmt.Init
	}
	assign, ok := stmt.(*ast.AssignStmt)
	if !ok || len(assign.Rhs) != 1 {
		return false
	}
	call, ok := assign.Rhs[0].(*ast.CallExpr)
	return ok && strings.Contains(callName(call), "Fence")
}

// statementIn is the statement holding node that sits directly in a block.
func (l *lawSource) statementIn(node ast.Node) (ast.Stmt, *ast.BlockStmt) {
	for at := node; at != nil; at = l.parents[at] {
		if block, ok := l.parents[at].(*ast.BlockStmt); ok {
			if stmt, ok := at.(ast.Stmt); ok {
				return stmt, block
			}
		}
	}
	return nil, nil
}

// guarded is whether the fence check is the statement right before the cut,
// or right before an "if err == nil {" whose first statement is the cut. A
// method's entry check is not enough: the fence can move after it.
func (l *lawSource) guarded(cut ast.Node) bool {
	stmt, block := l.statementIn(cut)
	if stmt == nil {
		return false
	}
	index := slices.Index(block.List, stmt)
	if index > 0 && isFenceCheck(block.List[index-1]) {
		return true
	}
	ifStmt, ok := l.parents[block].(*ast.IfStmt)
	if !ok || index != 0 || ifStmt.Body != block || ifStmt.Init != nil || types.ExprString(ifStmt.Cond) != "err == nil" {
		return false
	}
	outer, outerBlock := l.statementIn(ifStmt)
	if outer != ifStmt {
		return false
	}
	at := slices.Index(outerBlock.List, outer)
	return at > 0 && isFenceCheck(outerBlock.List[at-1])
}

func (l *lawSource) truncationViolations() []string {
	needs := map[string]bool{}
	for _, entry := range lawShortenings {
		needs[entry.fn] = entry.needsFence
	}
	var violations []string
	for _, name := range slices.Sorted(maps.Keys(l.funcs)) {
		for _, fn := range l.funcs[name] {
			ast.Inspect(fn, func(node ast.Node) bool {
				operation, guardable := "", false
				switch n := node.(type) {
				case *ast.CallExpr:
					switch callName(n) {
					case "Truncate", "removeFile", "Remove", "RemoveAll", "Unlink":
						operation, guardable = callName(n), true
					}
				case *ast.SelectorExpr:
					// flag&os.O_TRUNC tests the flag and flag&^os.O_TRUNC clears it.
					binary, ok := l.parents[n].(*ast.BinaryExpr)
					masks := ok && binary.Y == n && (binary.Op == token.AND || binary.Op == token.AND_NOT)
					if types.ExprString(n) == "os.O_TRUNC" && !masks {
						operation = "os.O_TRUNC"
					}
				}
				if operation == "" {
					return true
				}
				needsFence, allowed := needs[name]
				switch {
				case !allowed:
					violations = append(violations, name+" destroys data ("+operation+"), which only the lawShortenings functions may do")
				case needsFence && guardable && !l.guarded(node):
					violations = append(violations, name+" must check the fence in the statement right before its "+operation)
				}
				return true
			})
		}
	}
	return violations
}

func (l *lawSource) directorySyncViolations() []string {
	fn, missing := l.single("syncDirectory")
	if fn == nil {
		return []string{missing}
	}
	for _, call := range calls(fn) {
		if callName(call) != "Sync" {
			continue
		}
		stmt, _ := l.statementIn(call)
		ifStmt, ok := stmt.(*ast.IfStmt)
		if !ok || ifStmt.Init == nil || types.ExprString(ifStmt.Cond) != "err != nil" {
			break
		}
		returns := false
		ast.Inspect(ifStmt.Body, func(node ast.Node) bool {
			if ret, ok := node.(*ast.ReturnStmt); ok && slices.ContainsFunc(ret.Results, func(e ast.Expr) bool { return types.ExprString(e) == "err" }) {
				returns = true
			}
			return true
		})
		if returns {
			return nil
		}
		break
	}
	return []string{"syncDirectory must test its Sync result and return the error"}
}

// discardedDirectorySyncs are call sites that drop syncDirectory's error.
func (l *lawSource) discardedDirectorySyncs() []string {
	var violations []string
	for name, fns := range l.funcs {
		for _, fn := range fns {
			for _, call := range calls(fn) {
				if callName(call) == "syncDirectory" && !l.resultUsed(call) {
					violations = append(violations, name+" drops the result of syncDirectory")
				}
			}
		}
	}
	return violations
}

func (l *lawSource) removeCallers() []string {
	var callers []string
	for name, fns := range l.funcs {
		for _, fn := range fns {
			for _, call := range calls(fn) {
				if callName(call) == "removeFile" && !slices.Contains(callers, name) {
					callers = append(callers, name)
				}
			}
		}
	}
	slices.Sort(callers)
	return callers
}

func TestEveryDurabilityBoundaryFlushesToDisk(t *testing.T) {
	law := readLaw(t, lawFiles[:4]...)
	for _, boundary := range lawBoundaries {
		for _, violation := range law.flushViolations(boundary.fn, boundary.handle, boundary.after) {
			t.Error(violation)
		}
	}
}

func TestEveryTruncationOfALiveJournalChecksTheFenceFirst(t *testing.T) {
	for _, violation := range readLaw(t, lawFiles...).truncationViolations() {
		t.Error(violation)
	}
}

func TestTheDirectorySyncChecksItsResult(t *testing.T) {
	law := readLaw(t, lawFiles[:4]...)
	for _, violation := range append(law.directorySyncViolations(), law.discardedDirectorySyncs()...) {
		t.Error(violation)
	}
}

func TestEveryPublicationCallsItsDurableStepsInOrder(t *testing.T) {
	law := readLaw(t, lawFiles[:4]...)
	for _, order := range lawOrders {
		for _, violation := range law.orderViolations(order.fn, order.steps) {
			t.Error(violation)
		}
	}
}

func TestTheOnlyRemoverCallersAreTheExemptOnes(t *testing.T) {
	if got := readLaw(t, lawFiles...).removeCallers(); !slices.Equal(got, lawRemoveCallers) {
		t.Fatalf("removeFile is called from %v, want %v", got, lawRemoveCallers)
	}
}

func TestEveryExemptionCarriesAReason(t *testing.T) {
	for _, entry := range lawShortenings {
		if !entry.needsFence && strings.TrimSpace(entry.reason) == "" {
			t.Errorf("%s is exempt from the fence check with no reason", entry.fn)
		}
	}
}

// The detectors, on small sources, so a law that can no longer fail is caught.

func lawOf(t *testing.T, body string) *lawSource {
	return parseLaw(t, map[string]string{"x.go": "package journal\n" + body})
}

func TestTheLawDetectsAMissingDurableStep(t *testing.T) {
	law := lawOf(t, `func (s *Session) Reset() { WriteSealed(p); s.republish(n) }`)
	if got := law.orderViolations("Session.Reset", []string{"WriteSealed", "syncDirectory", "republish"}); len(got) != 1 || !strings.Contains(got[0], "syncDirectory") {
		t.Fatal(got)
	}
}

func TestTheLawDetectsDurableStepsOutOfOrder(t *testing.T) {
	law := lawOf(t, `func (s *Session) Reset() { WriteSealed(p); s.republish(n); syncDirectory(d) }`)
	if got := law.orderViolations("Session.Reset", []string{"WriteSealed", "syncDirectory", "republish"}); len(got) != 1 {
		t.Fatal(got)
	}
}

func TestTheLawDetectsARemoveInAFunctionThatMayNotDestroyData(t *testing.T) {
	law := lawOf(t, `func (s *Session) WriteCheckpointLater() { removeFile(p) }`)
	if got := law.truncationViolations(); len(got) != 1 || !strings.Contains(got[0], "WriteCheckpointLater") {
		t.Fatal(got)
	}
}

func TestTheLawDetectsATruncatingOpenInAFunctionThatMayNotShorten(t *testing.T) {
	law := lawOf(t, `func readBaseline() { openFile(p, os.O_RDWR|os.O_TRUNC, false) }`)
	if got := law.truncationViolations(); len(got) != 1 || !strings.Contains(got[0], "os.O_TRUNC") {
		t.Fatal(got)
	}
}

func TestTheLawDetectsAnUnguardedCut(t *testing.T) {
	for _, body := range []string{
		`func (s *Session) rollBack() { s.journal.Truncate(0) }`,
		`func (s *Session) rollBack() { s.journal.Truncate(0); err := s.requireFence() }`,
		`func (s *Session) rollBack() { err := s.requireFence(); x(); s.journal.Truncate(0) }`,
		`func (s *Session) rollBack() { s.requireFence(); s.journal.Truncate(0) }`,
		`func (s *Session) rollBack() { err := s.requireFence(); if ok { err = s.journal.Truncate(0) } }`,
		`func (s *Session) rollBack() { err := s.requireFence(); if err == nil { x(); err = s.journal.Truncate(0) } }`,
		`func (s *Session) rollBack() { if fast { err := s.requireFence() }; s.journal.Truncate(0) }`,
	} {
		if got := lawOf(t, body).truncationViolations(); len(got) != 1 {
			t.Errorf("%s: %v", body, got)
		}
	}
}

func TestTheLawAcceptsAGuardedCut(t *testing.T) {
	for _, body := range []string{
		`func (s *Session) rollBack() { err := s.requireFence(); if err == nil { err = s.journal.Truncate(0) } }`,
		`func (s *Session) rollBack() { if err := s.requireFence(); err != nil { return }; if err := s.journal.Truncate(0); err != nil { return } }`,
		`func scanForward() { if err := confirmFence(); err != nil { return }; journal.Truncate(0) }`,
	} {
		if got := lawOf(t, body).truncationViolations(); len(got) != 0 {
			t.Errorf("%s: %v", body, got)
		}
	}
}

func TestTheLawDetectsAMissingOrMisplacedFlush(t *testing.T) {
	for _, body := range []string{
		`func publish() { manifestFile.WriteAt(b, 0) }`,
		`func publish() { manifestFile.Sync(); manifestFile.WriteAt(b, 0) }`,
		`func publish() { manifestFile.WriteAt(b, 0); other.Sync() }`,
		`func publish() { manifestFile.WriteAt(b, 0); manifestFile.Sync() }`,
		`func publish() { manifestFile.WriteAt(b, 0); _ = manifestFile.Sync() }`,
	} {
		if got := lawOf(t, body).flushViolations("publish", "manifestFile", "WriteAt"); len(got) != 1 {
			t.Errorf("%s: %v", body, got)
		}
	}
	if got := lawOf(t, `func publish() error { manifestFile.WriteAt(b, 0); return manifestFile.Sync() }`).flushViolations("publish", "manifestFile", "WriteAt"); len(got) != 0 {
		t.Error(got)
	}
}

func TestTheLawDetectsADirectorySyncThatDropsItsResult(t *testing.T) {
	for _, body := range []string{
		`func syncDirectory(p string) error { dir.Sync(); return nil }`,
		`func syncDirectory(p string) error { if err := dir.Sync(); err != nil { log(err) }; return nil }`,
		`func syncDirectory(p string) error { return nil }`,
	} {
		if got := lawOf(t, body).directorySyncViolations(); len(got) != 1 {
			t.Errorf("%s: %v", body, got)
		}
	}
	if got := lawOf(t, `func (s *Session) Reset() { syncDirectory(d) }`).discardedDirectorySyncs(); len(got) != 1 {
		t.Error(got)
	}
}

func TestTheLawDetectsAFlushStrandedInAnotherBlock(t *testing.T) {
	for _, body := range []string{
		`func publish() error { manifestFile.WriteAt(b, 0); if verbose { return manifestFile.Sync() }; return nil }`,
		`func publish() error { if fast { manifestFile.WriteAt(b, 0) }; return manifestFile.Sync() }`,
		`func publish() (err error) { _, err = manifestFile.WriteAt(b, 0); if err != nil { err = manifestFile.Sync() }; return }`,
	} {
		if got := lawOf(t, body).flushViolations("publish", "manifestFile", "WriteAt"); len(got) != 1 {
			t.Errorf("%s: %v", body, got)
		}
	}
}

func TestTheLawAcceptsAFlushChainedOnTheWritesError(t *testing.T) {
	for _, body := range []string{
		`func publish() (err error) { _, err = manifestFile.WriteAt(b, 0); if err == nil { err = manifestFile.Sync() }; return }`,
		`func publish() (err error) { err = check(); if err == nil { _, err = manifestFile.WriteAt(b, 0) }; if err == nil { err = manifestFile.Sync() }; return }`,
	} {
		if got := lawOf(t, body).flushViolations("publish", "manifestFile", "WriteAt"); len(got) != 0 {
			t.Errorf("%s: %v", body, got)
		}
	}
}

func TestTheLawIgnoresATruncateFlagThatIsOnlyTestedOrCleared(t *testing.T) {
	for _, body := range []string{
		`func canCreate(flag int) bool { return flag&os.O_TRUNC != 0 }`,
		`func openPlain(flag int) { os.OpenFile(p, flag&^os.O_TRUNC, 0o600) }`,
	} {
		if got := lawOf(t, body).truncationViolations(); len(got) != 0 {
			t.Errorf("%s: %v", body, got)
		}
	}
}
