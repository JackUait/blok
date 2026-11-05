package synchttp

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/auth"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
)

// gatedHook holds every read check once held, as C# GatedAuthorization does.
type gatedHook struct {
	mu      sync.Mutex
	gate    chan struct{}
	entered chan struct{}
	once    sync.Once
}

func (h *gatedHook) hold() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.gate = make(chan struct{})
}

func (h *gatedHook) release() { close(h.gate) }

func (h *gatedHook) CanReadDocument(context.Context, auth.User, string) (bool, error) {
	h.mu.Lock()
	gate := h.gate
	h.mu.Unlock()
	if gate != nil {
		h.once.Do(func() { close(h.entered) })
		<-gate
	}
	return true, nil
}

func (h *gatedHook) CanWriteDocument(context.Context, auth.User, string) (bool, error) {
	return true, nil
}

// SyncDroppedPeerTests: the recheck runs inside the room lane, so a held
// hook holds the lane while the peer's frame waits behind it.
func droppedPeerText(t *testing.T, drop string) string {
	hook := &gatedHook{entered: make(chan struct{})}
	app := syn2Start(t, syn2Options{hook: hook})
	peer := app.open(t)

	hook.hold()
	recheck := make(chan struct{})
	go func() {
		defer close(recheck)
		_, _ = app.manager.RecheckAccess(context.Background(), synDoc)
	}()
	<-hook.entered

	peer.send(t, wire.SyncUpdate{Update: synAppend(synNewDoc(), "late")})
	time.Sleep(300 * time.Millisecond)
	if drop != "" {
		tcp := peer.conn.(*net.TCPConn)
		if drop == "rst" {
			_ = tcp.SetLinger(0)
			_ = tcp.Close()
		} else {
			_ = tcp.CloseWrite()
		}
		time.Sleep(time.Second)
	}
	hook.release()
	<-recheck

	reader := app.open(t)
	doc := synNewDoc()
	reader.send(t, wire.SyncStep1{StateVector: doc.EncodeStateVector()})
	synApply(t, doc, synNext[wire.SyncStep2](t, reader).Update)
	return synText(doc)
}

func TestAFrameWaitingOnABusyRoomIsDroppedWhenThePeerConnectionDrops(t *testing.T) {
	for _, drop := range []string{"fin", "rst"} {
		t.Run(drop, func(t *testing.T) {
			if got := droppedPeerText(t, drop); got != "seeded" {
				t.Fatalf("text %q", got)
			}
		})
	}
}

func TestAFrameWaitingOnABusyRoomIsAppliedWhenThePeerStays(t *testing.T) {
	if got := droppedPeerText(t, ""); got == "seeded" {
		t.Fatalf("text %q", got)
	}
}
