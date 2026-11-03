//go:build windows

package journal

import (
	"errors"
	"io/fs"
	"os"
	"syscall"
)

// openFile opens path with .NET's share modes: none for FileShare.None,
// read and write (and delete) otherwise.
func openFile(path string, flag int, exclusive bool) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	var access uint32
	switch flag & (os.O_RDONLY | os.O_WRONLY | os.O_RDWR) {
	case os.O_RDONLY:
		access = syscall.GENERIC_READ
	case os.O_WRONLY:
		access = syscall.GENERIC_WRITE
	default:
		access = syscall.GENERIC_READ | syscall.GENERIC_WRITE
	}
	var share uint32
	if !exclusive {
		share = syscall.FILE_SHARE_READ | syscall.FILE_SHARE_WRITE | syscall.FILE_SHARE_DELETE
	}
	disposition := uint32(syscall.OPEN_EXISTING)
	if flag&os.O_CREATE != 0 {
		disposition = syscall.OPEN_ALWAYS
	}
	handle, err := syscall.CreateFile(name, access, share, nil, disposition, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		if errors.Is(err, syscall.ERROR_FILE_NOT_FOUND) || errors.Is(err, syscall.ERROR_PATH_NOT_FOUND) {
			err = fs.ErrNotExist
		}
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	file := os.NewFile(uintptr(handle), path)
	if flag&os.O_TRUNC != 0 {
		if err := file.Truncate(0); err != nil {
			file.Close()
			return nil, err
		}
	}
	if flag&os.O_APPEND != 0 {
		if _, err := file.Seek(0, 2); err != nil {
			file.Close()
			return nil, err
		}
	}
	return file, nil
}

// isHeldElsewhere is a sharing or lock violation.
func isHeldElsewhere(err error) bool {
	return errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33))
}

// syncDirectory: Windows has no directory sync, as in C#.
func syncDirectory(string) error { return nil }

// removeFile is File.Delete: a missing file is fine, a directory is an error.
func removeFile(path string) error {
	if info, err := os.Lstat(path); err == nil && info.IsDir() {
		return &os.PathError{Op: "remove", Path: path, Err: syscall.ERROR_ACCESS_DENIED}
	}
	err := os.Remove(path)
	if err == nil || errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}
