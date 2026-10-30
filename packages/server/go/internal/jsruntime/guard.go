package jsruntime

import (
	"runtime/metrics"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// Interrupt values, so a stopped call can say which limit stopped it.
type interruptReason int

const (
	interruptTimeout interruptReason = iota + 1
	interruptBudget
	interruptCancel
)

// heapMetric is the live heap the last GC marked, process-wide.
//
// The memory budget is approximate, unlike Jint's per-engine allocation
// count:
//   - It is process-wide, so concurrent calls add up and the call that
//     crosses the line is the one stopped.
//   - It measures live heap, not churn. goja allocates far more than Jint
//     counts (blocksToHtml of a 700 KB article allocated 554 MiB), so churn
//     would refuse documents C# converts. Heap objects including unswept
//     garbage peaked 738 MiB above the start on a 3 MiB data URL to
//     Markdown; live heap peaked 429 MiB (measured).
//   - It moves only when a GC ends, and an interrupt lands only between JS
//     instructions, never inside a long native builtin.
const heapMetric = "/gc/heap/live:bytes"

const pollEvery = time.Millisecond

func heapInUse() int64 {
	sample := []metrics.Sample{{Name: heapMetric}}
	metrics.Read(sample)
	return int64(sample[0].Value.Uint64())
}

// guard stops one engine run at its deadline, its memory budget, or done.
type guard struct {
	vm       *goja.Runtime
	mu       sync.Mutex
	finished bool
	timer    *time.Timer
	stop     chan struct{}
	watching sync.WaitGroup
}

func arm(vm *goja.Runtime, timeout time.Duration, budget int64, done <-chan struct{}) *guard {
	g := &guard{vm: vm, stop: make(chan struct{})}
	g.timer = time.AfterFunc(timeout, func() { g.interrupt(interruptTimeout) })
	start := heapInUse()
	g.watching.Add(1)
	go func() {
		defer g.watching.Done()
		ticker := time.NewTicker(pollEvery)
		defer ticker.Stop()
		for {
			select {
			case <-g.stop:
				return
			case <-done:
				g.interrupt(interruptCancel)
				return
			case <-ticker.C:
				if heapInUse()-start > budget {
					g.interrupt(interruptBudget)
					return
				}
			}
		}
	}()
	return g
}

// interrupt is a no-op once the run is over, so a late timer or watchdog
// cannot stop the next caller's run on this engine.
func (g *guard) interrupt(reason interruptReason) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.finished {
		g.vm.Interrupt(reason)
	}
}

// disarm must run before the engine goes back to the pool.
func (g *guard) disarm() {
	g.mu.Lock()
	g.finished = true
	g.mu.Unlock()
	g.timer.Stop()
	close(g.stop)
	g.watching.Wait()
	g.vm.ClearInterrupt()
}
