package main

import "syscall"

func setDefaultAction(sig syscall.Signal, action uintptr) {
	_, _, _ = syscall.Syscall(syscall.SYS_SIGACTION, uintptr(sig), action, 0)
}
