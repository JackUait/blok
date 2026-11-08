//go:build !windows

package blokmcp

import (
	"io/fs"
	"syscall"
)

// privateDirectory: no group or world access, owned by the effective user.
// Root runs as 0, so it refuses another user's directory too.
func privateDirectory(info fs.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode().Perm()&0o077 == 0 && int(stat.Uid) == effectiveUID()
}
