//go:build freebsd || dragonfly

package main

import "syscall"

// Both kernels take sigaction(2) as a raw syscall, as Go's runtime calls it.
func setDefaultAction(sig syscall.Signal, action uintptr) {
	_, _, _ = syscall.Syscall(syscall.SYS_SIGACTION, uintptr(sig), action, 0)
}
