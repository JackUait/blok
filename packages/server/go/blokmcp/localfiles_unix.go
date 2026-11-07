//go:build unix

package blokmcp

import (
	"errors"
	"os"
	"syscall"
)

// openNoFollow refuses a symlink as the last part, and a FIFO never blocks
// the open.
const openNoFollow = syscall.O_NOFOLLOW | syscall.O_NONBLOCK

func linkCount(_ *os.File, info os.FileInfo) (uint64, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, errors.New("no link count")
	}
	return uint64(stat.Nlink), nil
}
