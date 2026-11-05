package main

import (
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
)

// quitBound is set when notifyShutdown takes SIGQUIT over.
var quitBound atomic.Bool

// armEarlyQuit is .NET before StartAsync: a SIGQUIT then kills the process
// by the signal, not by Go's goroutine dump and exit 2. notifyShutdown takes
// it over just before the bind, where C# registers its handlers.
func armEarlyQuit() {
	early := make(chan os.Signal, 1)
	signal.Notify(early, syscall.SIGQUIT)
	go func() {
		for range early {
			if !quitBound.Load() {
				dieBySignal(syscall.SIGQUIT)
			}
		}
	}()
}
