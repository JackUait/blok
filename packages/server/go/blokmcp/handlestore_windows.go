//go:build windows

package blokmcp

import "io/fs"

// privateDirectory is never reached on Windows: the files store refuses to
// start there (storePlatform).
func privateDirectory(fs.FileInfo) bool { return false }
