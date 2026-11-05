//go:build !darwin

package sectrust

// Available reports whether trustd can verify here.
const Available = false

// Guarded is never called off macOS.
func Guarded([][]byte, string, [][]byte) bool { return false }

// Operator is never called off macOS.
func Operator([][]byte, string, [][]byte) bool { return false }
