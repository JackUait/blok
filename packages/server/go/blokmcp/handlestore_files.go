package blokmcp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// FilesHandleStore is the reference HandleStore (--handle-store
// files:<dir>), for tests and for several blok-mcp processes on one
// machine. It keeps Node's layout and lock protocol, but nobody points two
// languages at one directory:
//
//	<handle>.record.json   the record.
//	<handle>.meta.json     {"v":1,"principal","lastUsedMs"}: the handle
//	                       exists while this file does.
//	<handle>.lease         the lease: held while it exists; its text is the
//	                       holder's random token.
//	principal-<sha256 hex>.lock  held while TryAdd counts and adds.
//
// Each JSON file is written to a temp file and renamed over the target.
// A lock is created exclusively. One whose mtime is older than the stale
// time (30 s) belonged to a holder that died or stopped renewing. One
// breaker at a time takes <lock>.break exclusively (a .break older than the
// stale time is removed), reads the lock again, and deletes it only if it
// still has the token and the old mtime it saw; then it creates the lock
// again. Renew touches the lease's mtime; Blok calls it every 5 s, and the
// store keeps no timer. Save, Renew and Remove check the token first
// (ErrLeaseLost otherwise). The check and the write are two steps, so a
// holder paused between them can still write once: the source's version
// check keeps that from losing a save.
//
// Sweep deletes idle unleased handles of every principal, and crash
// leftovers older than the stale time: temp files, .break files, records
// or leases no meta names, and principal locks (through the breaker).
//
// Privacy: records hold documents, undo steps and principals. The store is
// POSIX only: on Windows it refuses to start. At start the path is cleaned
// (so a trailing slash cannot make lstat follow a link), the directory made
// (0700) and checked once: a directory, not a link, no group or world
// access, owned by the effective user (root too). Nothing makes it again
// later. Every file is 0600.
type FilesHandleStore struct {
	dir   string
	stale time.Duration
}

// storePlatform and effectiveUID are what the start checks read; tests
// swap them.
var (
	storePlatform = runtime.GOOS
	effectiveUID  = os.Geteuid
)

var storeHandle = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

const (
	leaseStale = 30 * time.Second
	lockPoll   = 25 * time.Millisecond
	// principalWait bounds TryAdd's lock: one scan and two small writes.
	principalWait = 10 * time.Second
)

// NewFilesHandleStore makes and checks dir. A refusal is a *ConfigError.
func NewFilesHandleStore(dir string) (*FilesHandleStore, error) {
	return newFilesHandleStore(dir, leaseStale)
}

func newFilesHandleStore(dir string, stale time.Duration) (*FilesHandleStore, error) {
	if storePlatform == "windows" {
		return nil, &ConfigError{Message: "--handle-store files: is not supported on Windows; use your own store"}
	}
	// Cleaned first: "link/" would lstat the link's target.
	if absolute, err := filepath.Abs(dir); err == nil {
		dir = absolute
	}
	dir = filepath.Clean(dir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		if _, statErr := os.Lstat(dir); statErr != nil {
			return nil, &ConfigError{Message: fmt.Sprintf("--handle-store cannot create %s: %v", dir, err)}
		}
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return nil, &ConfigError{Message: fmt.Sprintf("--handle-store cannot create %s: %v", dir, err)}
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() || !privateDirectory(info) {
		return nil, &ConfigError{Message: fmt.Sprintf("--handle-store directory %s must be a directory (not a link) owned by this user, with no group or world access (chmod 700)", dir)}
	}
	return &FilesHandleStore{dir: dir, stale: stale}, nil
}

func (f *FilesHandleStore) path(name string) string { return filepath.Join(f.dir, name) }

type storeMeta struct {
	V          int     `json:"v"`
	Principal  string  `json:"principal"`
	LastUsedMs float64 `json:"lastUsedMs"`
}

func nowMs() float64 { return float64(time.Now().UnixNano()) / 1e6 }

func readFile(path string) ([]byte, bool, error) {
	text, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	return text, err == nil, err
}

func (f *FilesHandleStore) meta(handle string) (*storeMeta, error) {
	text, ok, err := readFile(f.path(handle + ".meta.json"))
	if err != nil || !ok {
		return nil, err
	}
	var read struct {
		Principal  *string  `json:"principal"`
		LastUsedMs *float64 `json:"lastUsedMs"`
	}
	// A meta file that does not read is no handle.
	if json.Unmarshal(text, &read) != nil || read.Principal == nil || read.LastUsedMs == nil {
		return nil, nil
	}
	return &storeMeta{V: 1, Principal: *read.Principal, LastUsedMs: *read.LastUsedMs}, nil
}

func (f *FilesHandleStore) expired(meta *storeMeta, idle time.Duration) bool {
	return nowMs()-meta.LastUsedMs > float64(idle)/float64(time.Millisecond)
}

// writeAtomic writes a temp file next to path and renames it over path.
func (f *FilesHandleStore) writeAtomic(path string, text []byte) error {
	temp := f.path("." + filepath.Base(path) + "." + randomHex(6) + ".tmp")
	file, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, err = file.Write(text)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temp, path)
	}
	if err != nil {
		_ = os.Remove(temp)
	}
	return err
}

func (f *FilesHandleStore) tryCreate(path, token string) (bool, error) {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = file.WriteString(token)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err == nil, err
}

func (f *FilesHandleStore) fresh(info fs.FileInfo) bool { return time.Since(info.ModTime()) <= f.stale }

// breakStale deletes the stale lock at path whose text was seen, one
// breaker at a time, and never a lock taken since. It says whether the
// lock is gone.
func (f *FilesHandleStore) breakStale(path, seen string) bool {
	guard := path + ".break"
	mine := randomHex(16)
	if taken, err := f.tryCreate(guard, mine); err != nil || !taken {
		if held, err := os.Stat(guard); err == nil && !f.fresh(held) {
			_ = os.Remove(guard)
		}
		return false
	}
	defer f.dropLock(guard, mine)
	now, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return true
	}
	if err != nil || f.fresh(now) {
		return false
	}
	if text, ok, _ := readFile(path); !ok || string(text) != seen {
		return false
	}
	return os.Remove(path) == nil
}

func (f *FilesHandleStore) takeLock(ctx context.Context, path, token string, wait time.Duration) (bool, error) {
	deadline := time.Now().Add(wait)
	for {
		taken, err := f.tryCreate(path, token)
		if err != nil || taken {
			return taken, err
		}
		seen, _, _ := readFile(path)
		if held, err := os.Stat(path); err == nil && !f.fresh(held) && f.breakStale(path, string(seen)) {
			continue
		}
		if !time.Now().Before(deadline) {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(lockPoll):
		}
	}
}

func (f *FilesHandleStore) owns(path, token string) bool {
	text, ok, _ := readFile(path)
	return ok && string(text) == token
}

func (f *FilesHandleStore) dropLock(path, token string) {
	if f.owns(path, token) {
		_ = os.Remove(path)
	}
}

func (f *FilesHandleStore) forget(handle string) {
	_ = os.Remove(f.path(handle + ".meta.json"))
	_ = os.Remove(f.path(handle + ".record.json"))
}

// Count implements HandleStore. An expired handle whose lease is free is
// deleted on the way.
func (f *FilesHandleStore) Count(ctx context.Context, principal string, idle time.Duration) (int, error) {
	handles, err := f.handles()
	if err != nil {
		return 0, err
	}
	count := 0
	for _, handle := range handles {
		meta, err := f.meta(handle)
		if err != nil {
			return 0, err
		}
		if meta == nil || meta.Principal != principal {
			continue
		}
		if !f.expired(meta, idle) {
			count++
			continue
		}
		reaped, err := f.reap(ctx, handle, idle)
		if err != nil {
			return 0, err
		}
		if !reaped {
			count++
		}
	}
	return count, nil
}

func (f *FilesHandleStore) handles() ([]string, error) {
	entries, err := os.ReadDir(f.dir)
	if err != nil {
		return nil, err
	}
	var handles []string
	for _, entry := range entries {
		if handle, ok := strings.CutSuffix(entry.Name(), ".meta.json"); ok && storeHandle.MatchString(handle) {
			handles = append(handles, handle)
		}
	}
	return handles, nil
}

// reap deletes an expired handle when its lease is free.
func (f *FilesHandleStore) reap(ctx context.Context, handle string, idle time.Duration) (bool, error) {
	lease := f.path(handle + ".lease")
	token := randomHex(16)
	taken, err := f.takeLock(ctx, lease, token, 0)
	if err != nil || !taken {
		return false, err
	}
	defer f.dropLock(lease, token)
	meta, err := f.meta(handle)
	if err != nil {
		return false, err
	}
	if meta != nil && !f.expired(meta, idle) {
		return false, nil
	}
	f.forget(handle)
	return true, nil
}

// TryAdd implements HandleStore.
func (f *FilesHandleStore) TryAdd(ctx context.Context, handle string, record HandleRecord, maxPerPrincipal int, idle time.Duration) (bool, error) {
	if !storeHandle.MatchString(handle) {
		return false, fmt.Errorf("blok-mcp handle store: %q is not a handle", handle)
	}
	sum := sha256.Sum256([]byte(record.Principal))
	lock := f.path("principal-" + hex.EncodeToString(sum[:]) + ".lock")
	token := randomHex(16)
	taken, err := f.takeLock(ctx, lock, token, principalWait)
	if err != nil {
		return false, err
	}
	if !taken {
		return false, errors.New("blok-mcp handle store: another process holds the principal lock")
	}
	defer f.dropLock(lock, token)
	if _, ok, err := readFile(f.path(handle + ".meta.json")); err != nil || ok {
		if err == nil {
			err = fmt.Errorf("blok-mcp handle store: handle %s is taken", handle)
		}
		return false, err
	}
	if maxPerPrincipal <= 0 {
		return false, nil
	}
	if count, err := f.Count(ctx, record.Principal, idle); err != nil || count >= maxPerPrincipal {
		return false, err
	}
	text, err := json.Marshal(record)
	if err != nil {
		return false, err
	}
	// The record first: a crash leaves at most a record no meta names.
	if err := f.writeAtomic(f.path(handle+".record.json"), text); err != nil {
		return false, err
	}
	meta, _ := json.Marshal(storeMeta{V: 1, Principal: record.Principal, LastUsedMs: nowMs()})
	if err := f.writeAtomic(f.path(handle+".meta.json"), meta); err != nil {
		return false, err
	}
	return true, nil
}

// Acquire implements HandleStore.
func (f *FilesHandleStore) Acquire(ctx context.Context, handle string, idle, wait time.Duration) (HandleLease, error) {
	if !storeHandle.MatchString(handle) {
		return nil, ErrHandleUnknown
	}
	// No waiting on a handle that does not exist.
	if _, ok, err := readFile(f.path(handle + ".meta.json")); err != nil || !ok {
		if err == nil {
			err = ErrHandleUnknown
		}
		return nil, err
	}
	leasePath := f.path(handle + ".lease")
	token := randomHex(16)
	taken, err := f.takeLock(ctx, leasePath, token, wait)
	if err != nil {
		return nil, err
	}
	if !taken {
		return nil, ErrHandleBusy
	}
	meta, err := f.meta(handle)
	var text []byte
	found := false
	if err == nil && meta != nil {
		text, found, err = readFile(f.path(handle + ".record.json"))
	}
	if err != nil {
		f.dropLock(leasePath, token)
		return nil, err
	}
	if meta == nil || !found || f.expired(meta, idle) {
		f.forget(handle)
		f.dropLock(leasePath, token)
		return nil, ErrHandleUnknown
	}
	var record HandleRecord
	// A record that does not read is no handle, as a meta that does not.
	if err := json.Unmarshal(text, &record); err != nil {
		f.dropLock(leasePath, token)
		return nil, ErrHandleUnknown
	}
	return &filesLease{store: f, handle: handle, path: leasePath, token: token, record: record}, nil
}

// Sweep implements HandleStore: expired handles whose lease is free, and
// temp files, moved-aside locks and records no meta names that are older
// than the stale time.
func (f *FilesHandleStore) Sweep(ctx context.Context, idle time.Duration) error {
	handles, err := f.handles()
	if err != nil {
		return err
	}
	for _, handle := range handles {
		meta, err := f.meta(handle)
		if err != nil {
			return err
		}
		if meta != nil && f.expired(meta, idle) {
			if _, err := f.reap(ctx, handle, idle); err != nil {
				return err
			}
		}
	}
	entries, err := os.ReadDir(f.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		left := strings.HasSuffix(name, ".tmp") || strings.HasSuffix(name, ".break")
		for _, suffix := range []string{".record.json", ".lease"} {
			if handle, ok := strings.CutSuffix(name, suffix); ok {
				_, metaFound, _ := readFile(f.path(handle + ".meta.json"))
				left = !metaFound
			}
		}
		if info, err := entry.Info(); err == nil && !f.fresh(info) {
			switch {
			case strings.HasPrefix(name, "principal-") && strings.HasSuffix(name, ".lock"):
				// Through the breaker, so a TryAdd taking it now keeps it.
				seen, _, _ := readFile(f.path(name))
				f.breakStale(f.path(name), string(seen))
			case left:
				_ = os.Remove(f.path(name))
			}
		}
	}
	return nil
}

// filesLease is one holder's lease file.
type filesLease struct {
	store  *FilesHandleStore
	handle string
	path   string
	token  string
	record HandleRecord

	mu    sync.Mutex
	ended bool
}

func (l *filesLease) Record() HandleRecord { return l.record }

func (l *filesLease) held() error {
	l.mu.Lock()
	ended := l.ended
	l.mu.Unlock()
	if ended || !l.store.owns(l.path, l.token) {
		return ErrLeaseLost
	}
	return nil
}

func (l *filesLease) end() {
	l.mu.Lock()
	l.ended = true
	l.mu.Unlock()
}

func (l *filesLease) Renew(context.Context) error {
	if err := l.held(); err != nil {
		return err
	}
	now := time.Now()
	return os.Chtimes(l.path, now, now)
}

func (l *filesLease) Save(_ context.Context, record HandleRecord) error {
	if err := l.held(); err != nil {
		return err
	}
	text, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return l.store.writeAtomic(l.store.path(l.handle+".record.json"), text)
}

// Release does nothing once the lease is gone: it is the new holder's.
func (l *filesLease) Release(context.Context) error {
	if l.held() != nil {
		l.end()
		return nil
	}
	l.end()
	meta, err := l.store.meta(l.handle)
	if err == nil && meta != nil {
		meta.LastUsedMs = nowMs()
		text, _ := json.Marshal(meta)
		err = l.store.writeAtomic(l.store.path(l.handle+".meta.json"), text)
	}
	l.store.dropLock(l.path, l.token)
	return err
}

func (l *filesLease) Remove(context.Context) error {
	if err := l.held(); err != nil {
		l.end()
		return err
	}
	l.end()
	l.store.forget(l.handle)
	l.store.dropLock(l.path, l.token)
	return nil
}
