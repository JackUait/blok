//go:build darwin || linux

package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"
)

// Measured on the C# host (FIX-host.md H#2): a SIGQUIT before StartAsync
// kills the process by the signal; after it, the stop is graceful. The
// helper below stands in for the host: it arms the early QUIT, then waits,
// either before or after the point where the bind would run.
func TestASigquitBeforeTheBindDiesByTheSignalAndAfterItStopsGracefully(t *testing.T) {
	for _, c := range []struct {
		stage  string
		signal syscall.Signal
		exit   int
	}{
		{"before-bind", syscall.SIGQUIT, -1},
		{"after-bind", 0, 0},
	} {
		command := exec.Command(os.Args[0], "-test.run=^TestQuitHelper$")
		command.Env = append(os.Environ(), "BLOK_QUIT_HELPER="+c.stage)
		ready, err := command.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		buffer := make([]byte, 5)
		if _, err := ready.Read(buffer); err != nil {
			t.Fatalf("%s: the helper never got ready: %v", c.stage, err)
		}
		_ = command.Process.Signal(syscall.SIGQUIT)
		err = command.Wait()
		var exit *exec.ExitError
		if err != nil && !errors.As(err, &exit) {
			t.Fatal(err)
		}
		state := command.ProcessState.Sys().(syscall.WaitStatus)
		if c.signal != 0 {
			if !state.Signaled() || state.Signal() != c.signal {
				t.Errorf("%s: %v, want death by %v", c.stage, command.ProcessState, c.signal)
			}
			continue
		}
		if state.Signaled() || state.ExitStatus() != c.exit {
			t.Errorf("%s: %v, want exit %d", c.stage, command.ProcessState, c.exit)
		}
	}
}

func TestQuitHelper(t *testing.T) {
	stage := os.Getenv("BLOK_QUIT_HELPER")
	if stage == "" {
		t.Skip("run by TestASigquitBeforeTheBindDiesByTheSignalAndAfterItStopsGracefully")
	}
	armEarlyQuit()
	if stage == "before-bind" {
		os.Stdout.WriteString("ready")
		time.Sleep(10 * time.Second)
		os.Exit(3)
	}
	ctx, stop := notifyShutdown(context.Background())
	defer stop()
	os.Stdout.WriteString("ready")
	select {
	case <-ctx.Done():
		os.Exit(0)
	case <-time.After(10 * time.Second):
		os.Exit(3)
	}
}

// The flag that silences the early SIGQUIT is set only once NotifyContext
// holds SIGQUIT: in between, a SIGQUIT would reach no one.
func TestShutdownTakesSigquitBeforeTheEarlyHandlerStandsDown(t *testing.T) {
	saved := notifyContext
	t.Cleanup(func() {
		notifyContext = saved
		quitBound.Store(false)
	})
	quitBound.Store(false)
	var boundAtRegistration bool
	notifyContext = func(ctx context.Context, signals ...os.Signal) (context.Context, context.CancelFunc) {
		boundAtRegistration = quitBound.Load()
		return saved(ctx, signals...)
	}

	_, stop := notifyShutdown(context.Background())
	defer stop()
	if boundAtRegistration {
		t.Fatal("quitBound was set before SIGQUIT was registered")
	}
	if !quitBound.Load() {
		t.Fatal("quitBound was never set")
	}
}
