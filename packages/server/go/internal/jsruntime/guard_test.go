package jsruntime

import (
	"testing"
	"time"
)

// An interrupt that lands as a run ends is cleared before the engine is reused.
func TestDisarmClearsAnInterruptThatLandedAfterTheRun(t *testing.T) {
	vm := newVM()
	g := arm(vm, time.Minute, DefaultMemoryBudget, nil)
	g.interrupt(interruptTimeout)
	g.disarm()
	if _, err := vm.RunString("1 + 1"); err != nil {
		t.Fatalf("the next run was interrupted: %v", err)
	}
}

// A timer or watchdog that fires after disarm must not reach the next run.
func TestALateInterruptAfterDisarmIsIgnored(t *testing.T) {
	vm := newVM()
	g := arm(vm, time.Minute, DefaultMemoryBudget, nil)
	g.disarm()
	g.interrupt(interruptTimeout)
	if _, err := vm.RunString("1 + 1"); err != nil {
		t.Fatalf("the next run was interrupted: %v", err)
	}
}
