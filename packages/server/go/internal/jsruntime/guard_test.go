package jsruntime

import (
	"context"
	"runtime"
	"strings"
	"sync/atomic"
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

// allocateElsewhere allocates and drops about 100 MB a second in other
// goroutines, as rooms and HTTP bodies do, until stop is closed.
func allocateElsewhere(stop <-chan struct{}) *atomic.Int64 {
	var total atomic.Int64
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				chunk := make([]byte, 1<<20)
				for i := 0; i < len(chunk); i += 4096 {
					chunk[i] = 1
				}
				total.Add(int64(len(chunk)))
			}
		}
	}()
	return &total
}

// Garbage made by other goroutines must not stop a conversion that fits
// its budget. This outline grows the live heap by about 83 MiB. A guard
// that charged the process's allocations to the running call (3/8 of them,
// as one tried) converted it at 384 MiB on a quiet process and stopped it
// under this load (both measured).
func TestAConversionPassesWhileTheRestOfTheProcessAllocates(t *testing.T) {
	if testing.Short() || raceEnabled {
		t.Skip("slow")
	}
	p, err := NewPool(Options{PoolSize: new(1), Timeout: 2 * time.Minute, MemoryBudget: 384 << 20})
	if err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	total := allocateElsewhere(stop)
	start := time.Now()
	got, err := p.Invoke(context.Background(), "blocksToMarkdown", nestedOutline(3000), 0)
	close(stop)
	elapsed := time.Since(start)
	if err != nil || !strings.Contains(got, "level 2999") {
		t.Fatalf("err = %v, has level 2999 = %v", err, strings.Contains(got, "level 2999"))
	}
	if rate := float64(total.Load()) / elapsed.Seconds() / 1e6; rate < 50 {
		t.Fatalf("the load allocated only %.0f MB/s", rate)
	}
}

// A call that holds memory is stopped near its budget. The live heap moves
// only when a GC ends, and Go starts a GC when the heap reaches about twice
// what the last one kept (GOGC=100). So a call can hold up to about twice
// the heap at its start plus twice its budget before it is seen.
func TestTheBudgetBoundsTheHeapACallHolds(t *testing.T) {
	const budget = 64 << 20
	p := newCountingPool(t, 1, 30*time.Second, budget)
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	start := int64(before.HeapAlloc)
	var peak atomic.Int64
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			if held := int64(m.HeapAlloc) - start; held > peak.Load() {
				peak.Store(held)
			}
			time.Sleep(time.Millisecond)
		}
	}()
	_, err := invoke(t, p, "grow", "")
	close(stop)
	<-done
	wantKind(t, err, KindDocumentTooLarge)
	if limit := 2*start + 2*budget + 16<<20; peak.Load() > limit {
		t.Fatalf("the heap grew %d MiB during the call; the bound is %d MiB (start %d MiB, budget %d MiB)",
			peak.Load()>>20, limit>>20, start>>20, budget>>20)
	}
	t.Logf("heap grew %d MiB; start %d MiB, budget %d MiB", peak.Load()>>20, start>>20, budget>>20)
}
