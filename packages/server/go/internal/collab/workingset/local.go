package workingset

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

const temporaryPrefix = ".blok-collab-"

var randRead = rand.Read

// LocalStore keeps one working-set file per document under a directory
// (C# LocalCollabStore): atomic temp-and-rename, the directory fsynced,
// modes 0600/0700, and an unreadable file moved aside.
type LocalStore struct {
	directory  string
	log        func(string)
	modeWarned atomic.Bool
	now        func() time.Time
}

// NewLocalStore sweeps temporary files older than a minute, left by a crash.
func NewLocalStore(directory string, log func(string)) *LocalStore {
	s := &LocalStore{directory: directory, log: log, now: time.Now}
	s.sweepTemporaryFiles()
	return s
}

func (s *LocalStore) logf(format string, args ...any) {
	if s.log != nil {
		s.log(fmt.Sprintf(format, args...))
	}
}

func (s *LocalStore) pathFor(docID string) string {
	return filepath.Join(s.directory, DocKey(docID))
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// Read is nil for an absent document; an unreadable file is moved aside so
// the epoch guard no longer sees its header.
func (s *LocalStore) Read(ctx context.Context, docID string) (*Set, error) {
	var stored *Set
	err := Guard(ctx, docID, "read", func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		path := s.pathFor(docID)
		if isDir(path) {
			s.logf("collab: the working-set path for \"%s\" is a directory; treating it as absent", docID)
			return nil
		}
		document, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		stored = DecodeOrAbsent(docID, document, s.log)
		if stored == nil {
			s.moveAside(docID, path)
		}
		return nil
	})
	return stored, err
}

func (s *LocalStore) moveAside(docID, path string) {
	// yyyyMMddTHHmmssfffZ: Go's layout needs the dot before the milliseconds.
	aside := path + ".unreadable-" + strings.Replace(s.now().UTC().Format("20060102T150405.000Z"), ".", "", 1)
	if err := os.Rename(path, aside); err != nil {
		s.logf("collab: could not move the unreadable working set for \"%s\" aside: %v", docID, err)
		return
	}
	s.logf("collab: moved the unreadable working set for \"%s\" to %s", docID, filepath.Base(aside))
}

// Write replaces the working set; it never lowers the stored epoch.
func (s *LocalStore) Write(ctx context.Context, docID string, updates []byte, tag Tag) error {
	return Guard(ctx, docID, "write", func() error {
		document, err := EncodeDocument(tag, updates)
		if err != nil {
			return err
		}
		if err := EnsureWriteDoesNotLowerEpoch(docID, s.readTag(docID), tag); err != nil {
			return err
		}
		return s.replaceAtomically(ctx, docID, document)
	})
}

// Reset rewrites an empty log under a strictly higher epoch.
func (s *LocalStore) Reset(ctx context.Context, docID string, tag Tag) error {
	return Guard(ctx, docID, "reset", func() error {
		document, err := EncodeDocument(tag, nil)
		if err != nil {
			return err
		}
		if err := EnsureResetRaisesEpoch(docID, s.readTag(docID), tag); err != nil {
			return err
		}
		return s.replaceAtomically(ctx, docID, document)
	})
}

// Retire removes a readable working set once a journal holds its content.
// An unreadable one stays for repair.
func (s *LocalStore) Retire(ctx context.Context, docID string) error {
	return Guard(ctx, docID, "retire", func() error {
		path := s.pathFor(docID)
		if isDir(path) {
			return nil
		}
		document, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if DecodeOrAbsent(docID, document, s.log) == nil {
			return nil
		}
		if err := os.Remove(path); err != nil {
			return err
		}
		syncDirectory(s.directory)
		return nil
	})
}

// Delete purges one document's working set, its moved-aside files and its
// keyed temporaries. An unkeyed temporary may hold any document, so it
// blocks the purge until it is gone.
func (s *LocalStore) Delete(ctx context.Context, docID string) error {
	return Guard(ctx, docID, "delete", func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		entries, err := os.ReadDir(s.directory)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			if !entry.IsDir() && strings.HasPrefix(name, temporaryPrefix) && isGUIDN(name[len(temporaryPrefix):]) {
				return fmt.Errorf("collab: cannot purge \"%s\" while %s may hold its working set.", docID, name)
			}
		}
		key := DocKey(docID)
		if err := removeFile(filepath.Join(s.directory, key)); err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !(strings.HasPrefix(name, key+".unreadable-") || strings.HasPrefix(name, temporaryPrefix+key+"-")) {
				continue
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := removeFile(filepath.Join(s.directory, name)); err != nil {
				return err
			}
		}
		syncDirectory(s.directory)
		return nil
	})
}

// removeFile is File.Delete: a missing file is fine, a directory is an error.
func removeFile(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		return &fs.PathError{Op: "remove", Path: path, Err: syscall.EISDIR}
	}
	return os.Remove(path)
}

// isGUIDN is Guid.TryParseExact(value, "N"): 32 hex digits.
func isGUIDN(value string) bool {
	if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// syncDirectory makes a rename or delete durable; failures are ignored, as in C#.
func syncDirectory(path string) {
	dir, err := os.Open(path)
	if err != nil {
		return
	}
	_ = dir.Sync()
	_ = dir.Close()
}

func (s *LocalStore) sweepTemporaryFiles() {
	entries, err := os.ReadDir(s.directory)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err != nil {
		s.logf("collab: could not sweep temporary working-set files: %v", err)
		return
	}
	cutoff := s.now().Add(-time.Minute)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), temporaryPrefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			s.logf("collab: could not sweep temporary working-set files: %v", err)
			return
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(s.directory, entry.Name())); err != nil {
				s.logf("collab: could not sweep temporary working-set files: %v", err)
				return
			}
			s.logf("collab: removed the orphaned temporary working-set file %s", entry.Name())
		}
	}
}

// readTag reads only the header; anything unreadable is no stored tag.
func (s *LocalStore) readTag(docID string) *Set {
	file, err := os.Open(s.pathFor(docID))
	if err != nil {
		return nil
	}
	defer file.Close()
	header := make([]byte, HeaderLength)
	if _, err := io.ReadFull(file, header); err != nil {
		return nil
	}
	tag, _, ok := DecodeHeader(header)
	if !ok {
		return nil
	}
	return &Set{Updates: []byte{}, Tag: tag}
}

func (s *LocalStore) replaceAtomically(ctx context.Context, docID string, document []byte) error {
	if err := os.MkdirAll(s.directory, 0o700); err != nil {
		return err
	}
	s.tightenExistingDirectory()
	final := s.pathFor(docID)
	var suffix [16]byte
	if _, err := randRead(suffix[:]); err != nil {
		return err
	}
	temporary := filepath.Join(s.directory, temporaryPrefix+DocKey(docID)+"-"+hex.EncodeToString(suffix[:]))
	err := func() error {
		file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return err
		}
		if _, err := file.Write(document); err != nil {
			file.Close()
			return err
		}
		if err := file.Sync(); err != nil {
			file.Close()
			return err
		}
		if err := file.Close(); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if isDir(final) {
			// rename(2) onto an empty directory fails on Linux but not
			// everywhere; File.Move always refuses it.
			return &fs.PathError{Op: "rename", Path: final, Err: syscall.EISDIR}
		}
		if err := os.Rename(temporary, final); err != nil {
			return err
		}
		syncDirectory(s.directory)
		return nil
	}()
	if err != nil {
		if cleanup := os.Remove(temporary); cleanup != nil && !errors.Is(cleanup, fs.ErrNotExist) {
			return fmt.Errorf("collab: the working-set write failed and cleanup also failed: %w", errors.Join(err, cleanup))
		}
	}
	return err
}

// tightenExistingDirectory: the private mode applies only at creation, so a
// pre-made directory is chmodded, warned about once if not ours.
func (s *LocalStore) tightenExistingDirectory() {
	if err := os.Chmod(s.directory, 0o700); err != nil && errors.Is(err, fs.ErrPermission) {
		if !s.modeWarned.Swap(true) {
			s.logf("collab: could not make \"%s\" private (this process does not own it); its mode is left as found.", s.directory)
		}
	}
}
