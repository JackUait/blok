package jsruntime

import (
	"errors"
	"runtime/metrics"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"
)

// Interrupt values, so a stopped call can say which limit stopped it.
type interruptReason int

const (
	interruptTimeout interruptReason = iota + 1
	interruptBudget
	interruptCancel
	interruptHeap
)

// allocMetric is every heap byte the process has allocated so far.
//
// A run is charged the heap bytes allocated while it runs, as Jint charges
// every allocation of an engine entry: churn, not what is still held.
//   - Go counts allocations for the whole process. Each sample's growth is
//     split evenly among the runs going at that moment, so runs that overlap
//     are each charged about their own part. Allocations by the rest of the
//     process land on whatever runs.
//   - goja allocates more than Jint for the same work, so a run is charged
//     chargeNum/chargeDen of what it allocates (see the constants).
//   - The count moves when a span is refilled, and an interrupt lands only
//     between JS instructions, never inside a long native builtin.
const allocMetric = "/gc/heap/allocs:bytes"

// goja allocated 1.9x to 3.1x what Jint charges on most shared big
// documents, 0.9x on the smallest, and 10x to 13x on a 3 MiB URL, where
// goja's regexp copies the string into runes on every match (all measured).
// 3/8 is the one factor that makes all eleven big documents in ops.json,
// and a 32 MiB image, convert or stop as in C# at 64 MiB and at 512 MiB:
// it must lie between 0.35 (big.marked.text stops at 64 MiB) and 0.40
// (big.url.bookmark.markdown converts at 512 MiB).
const (
	chargeNum = 3
	chargeDen = 8
)

const pollEvery = time.Millisecond

// HeapBackstop bounds how far the process live heap may grow during one run,
// whatever the run was charged. The even split above can charge a heavy run
// that overlaps light ones as little as 1/N of its bytes, so this keeps the
// process from running out of memory. 1 GiB, the old live-heap default.
var HeapBackstop int64 = 1 << 30

// ErrHeapBackstop is a run stopped by HeapBackstop, not by its own budget.
var ErrHeapBackstop = errors.New("jsruntime: the process live heap grew past the 1 GiB backstop during the call")

// liveHeap is the live heap the last GC marked, process-wide. Tests swap it.
var liveHeap = func() int64 {
	sample := []metrics.Sample{{Name: "/gc/heap/live:bytes"}}
	metrics.Read(sample)
	return int64(sample[0].Value.Uint64())
}

// running counts the guarded runs, to split each sample among them.
var running atomic.Int64

func heapAllocated() uint64 {
	sample := []metrics.Sample{{Name: allocMetric}}
	metrics.Read(sample)
	return sample[0].Value.Uint64()
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
	running.Add(1)
	heapStart := liveHeap()
	last := heapAllocated()
	var spent uint64
	g.watching.Add(1)
	go func() {
		defer g.watching.Done()
		defer running.Add(-1)
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
				now := heapAllocated()
				spent += (now - last) / uint64(max(running.Load(), 1))
				last = now
				if spent/chargeDen*chargeNum > uint64(budget) {
					g.interrupt(interruptBudget)
					return
				}
				if liveHeap()-heapStart > HeapBackstop {
					g.interrupt(interruptHeap)
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
