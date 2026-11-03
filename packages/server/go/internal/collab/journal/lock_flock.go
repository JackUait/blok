//go:build darwin || linux || freebsd || netbsd || openbsd || dragonfly

package journal

import (
	"errors"
	"os"
	"syscall"
)

// openFile opens path the way .NET's FileStream does on Unix: after the open
// it takes flock(2), LOCK_EX for FileShare.None and LOCK_SH for any other
// share, never waiting. Probed on macOS with .NET 10: a C# store and a Go store
// on one directory refuse each other's live hold because both use flock.
func openFile(path string, flag int, exclusive bool) (*os.File, error) {
	file, err := os.OpenFile(path, flag&^os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	how := syscall.LOCK_SH
	if exclusive {
		how = syscall.LOCK_EX
	}
	if err := syscall.Flock(int(file.Fd()), how|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, &os.PathError{Op: "flock", Path: path, Err: err}
	}
	// .NET truncates only once the lock is held, so a refused open never
	// empties a file somebody else holds.
	if flag&os.O_TRUNC != 0 {
		if err := file.Truncate(0); err != nil {
			file.Close()
			return nil, err
		}
	}
	return file, nil
}

// isHeldElsewhere is C#'s errno 11 (Linux) or 35 (macOS): EWOULDBLOCK.
func isHeldElsewhere(err error) bool {
	return errors.Is(err, syscall.EWOULDBLOCK)
}

// syncDirectory makes new directory entries durable. Its failure is returned,
// because it runs where a completion means durable.
func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	if err := dir.Sync(); err != nil {
		dir.Close()
		return err
	}
	return dir.Close()
}

// removeFile is File.Delete: a missing file is fine, a directory is an error.
func removeFile(path string) error {
	err := syscall.Unlink(path)
	if err == nil || errors.Is(err, syscall.ENOENT) {
		return nil
	}
	return &os.PathError{Op: "unlink", Path: path, Err: err}
}
