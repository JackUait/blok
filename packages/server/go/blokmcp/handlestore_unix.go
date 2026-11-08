//go:build !windows

package blokmcp

import (
	"io/fs"
	"os"
	"syscall"
)

// privateDirectory: no group or world access, owned by this user.
func privateDirectory(info fs.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode().Perm()&0o077 == 0 && int(stat.Uid) == os.Getuid()
}
