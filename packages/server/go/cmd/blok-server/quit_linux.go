package main

import "syscall"

// The 8 is the kernel's sigset size.
func setDefaultAction(sig syscall.Signal, action uintptr) {
	_, _, _ = syscall.RawSyscall6(syscall.SYS_RT_SIGACTION, uintptr(sig), action, 0, 8, 0, 0)
}
