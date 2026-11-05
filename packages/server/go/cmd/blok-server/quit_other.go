//go:build !darwin && !linux

package main

import (
	"os"
	"syscall"
)

// No SIGQUIT reaches a process here; exit as Go's default would.
func dieBySignal(syscall.Signal) { os.Exit(2) }
