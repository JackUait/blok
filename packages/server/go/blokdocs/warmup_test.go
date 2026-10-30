package blokdocs

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type blockingRuntime struct {
	release chan struct{}
	ops     chan string
	inputs  chan string
	err     error
}

func (b *blockingRuntime) Invoke(_ context.Context, op, input string, _ time.Duration) (string, error) {
	b.ops <- op
	b.inputs <- input
	<-b.release
	return "", b.err
}

// Startup must not wait for the warm-up, and the warm-up must convert a real-sized article.
func TestWarmsUpOffTheStartupPathWithALongArticle(t *testing.T) {
	runtime := &blockingRuntime{release: make(chan struct{}), ops: make(chan string, 1), inputs: make(chan string, 1)}
	c := newConverter(runtime)
	start := time.Now()
	done := c.warmUpInBackground()
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("starting the warm-up took %v", elapsed)
	}
	if op := <-runtime.ops; op != "blocksToPlainText" {
		t.Fatalf("op = %s", op)
	}
	if blocks := strings.Count(<-runtime.inputs, `"type":`); blocks != 220 {
		t.Fatalf("warm-up document has %d blocks, want 220", blocks)
	}
	close(runtime.release)
	<-done
}

func TestIgnoresAWarmUpThatFails(t *testing.T) {
	runtime := &blockingRuntime{release: make(chan struct{}), ops: make(chan string, 1), inputs: make(chan string, 1), err: errors.New("slow host")}
	close(runtime.release)
	select {
	case <-newConverter(runtime).warmUpInBackground():
	case <-time.After(5 * time.Second):
		t.Fatal("a failed warm-up never finished")
	}
}

func TestWarmsUpOnlyWhenAsked(t *testing.T) {
	cold, err := New(Options{PoolSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if cold.warmed != nil {
		t.Fatal("warmed without being asked")
	}
	warm, err := New(Options{PoolSize: 1, WarmUp: true})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-warm.warmed:
	case <-time.After(30 * time.Second):
		t.Fatal("the warm-up never finished")
	}
}
