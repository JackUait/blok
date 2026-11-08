//go:build windows

package blokmcp

import "io/fs"

// privateDirectory: Go on Windows makes the mode bits up from the
// read-only flag, so they say nothing about access. The directory's ACL is
// the operator's job there.
func privateDirectory(fs.FileInfo) bool { return true }
