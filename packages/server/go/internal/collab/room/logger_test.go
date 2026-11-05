package room

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
)

// A Go host logger throws by panicking. The recheck and activity-drop
// cases are in csharp_manager_test.go; this is the pump's.

func loggerManager(t *testing.T, log func(string), activity ActivityObserver) *Manager {
	t.Helper()
	manager := NewManager(ManagerOptions{
		Store: newMemoryStore(), Endpoint: &memoryEndpoint{}, Converter: &convert.DocConverter{Now: time.Now},
		Room:     Options{ExportDebounce: time.Hour, ExportMaxDelay: time.Hour},
		Log:      log,
		Activity: activity,
	})
	t.Cleanup(func() { _ = manager.Drain(context.Background()) })
	return manager
}

// failingObserver fails every call and counts them.
type failingObserver struct {
	mu    sync.Mutex
	kinds []ActivityKind
}

func (o *failingObserver) Record(_ context.Context, _, _ string, _ time.Time, kind ActivityKind) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.kinds = append(o.kinds, kind)
	return errors.New("the activity table is down")
}

// C# AThrowingObserverAndLoggerDoNotStopTheActivityPump.
func TestAThrowingObserverAndLoggerDoNotStopTheActivityPump(t *testing.T) {
	observer := &failingObserver{}
	manager := loggerManager(t, func(message string) {
		if strings.Contains(message, "activity observer failed") {
			panic(errors.New("logger failed"))
		}
	}, observer)
	member := &fakeMember{actor: "user-1", source: collab.SourceClientV1}
	membership := join(t, manager, "doc", member)
	manager.Settle()

	if err := membership.Receive(context.Background(), syncFrame(t, wire.Activity{})); err != nil {
		t.Fatal(err)
	}
	manager.Settle()

	observer.mu.Lock()
	defer observer.mu.Unlock()
	if len(observer.kinds) != 2 || observer.kinds[0] != ActivityJoined || observer.kinds[1] != ActivityActive {
		t.Fatalf("records = %v", observer.kinds)
	}
	if got := member.closed(); len(got) != 0 {
		t.Fatalf("closes = %v", got)
	}
}
