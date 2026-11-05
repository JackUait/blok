//go:build darwin || linux || freebsd || dragonfly

package main

import (
	"os"
	"syscall"
	"time"
	"unsafe"
)

// dieBySignal sets the OS default action back and raises sig, so the
// parent sees death by sig. signal.Reset cannot: it hands sig back to Go's
// own handler. All zero is SIG_DFL with no flags and no mask on each OS.
func dieBySignal(sig syscall.Signal) {
	var action [4]uint64
	setDefaultAction(sig, uintptr(unsafe.Pointer(&action)))
	_ = syscall.Kill(os.Getpid(), sig)
	time.Sleep(time.Second)
	os.Exit(2)
}
