//go:build !darwin && !linux && !freebsd && !dragonfly

package main

import (
	"os"
	"syscall"
)

// Exit as Go's default would. Windows has no SIGQUIT. OpenBSD's
// syscall.Syscall answers ENOSYS for sigaction, NetBSD's needs a signal
// trampoline Go does not export, and the others reach sigaction only
// through libc.
func dieBySignal(syscall.Signal) { os.Exit(2) }
