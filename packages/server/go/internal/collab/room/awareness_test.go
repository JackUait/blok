package room

import (
	"bytes"
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

// Twins of the C# CollabRoomTests awareness ownership and identities cases
// (M12, M13): who owns a presence client id, what a leave withdraws, and
// which frame 107 every member sees.

type awarenessRoom struct {
	t       *testing.T
	manager *Manager
	mu      sync.Mutex
	log     []string
}

func newAwarenessRoom(t *testing.T, o Options) *awarenessRoom {
	t.Helper()
	a := &awarenessRoom{t: t}
	o.ExportDebounce, o.ExportMaxDelay = time.Hour, time.Hour
	a.manager = NewManager(ManagerOptions{
		Store:     newMemoryStore(),
		Endpoint:  &memoryEndpoint{},
		Converter: &convert.DocConverter{Now: time.Now},
		Room:      o,
		Log: func(message string) {
			a.mu.Lock()
			defer a.mu.Unlock()
			a.log = append(a.log, message)
		},
	})
	t.Cleanup(func() { _ = a.manager.Drain(context.Background()) })
	return a
}

func (a *awarenessRoom) join(actor string) (*fakeMember, collab.Membership) {
	a.t.Helper()
	member := &fakeMember{actor: actor, source: collab.SourceClientV1, write: true}
	return member, join(a.t, a.manager, "doc", member)
}

func (a *awarenessRoom) send(membership collab.Membership, payload []byte) {
	a.t.Helper()
	if err := membership.Receive(context.Background(), syncFrame(a.t, wire.Awareness{Update: payload})); err != nil {
		a.t.Fatal(err)
	}
}

func (a *awarenessRoom) logged(part string) []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	var lines []string
	for _, line := range a.log {
		if strings.Contains(line, part) {
			lines = append(lines, line)
		}
	}
	return lines
}

func (m *fakeMember) clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.frames = nil
}

func awarenessFor(client, clock uint64, state string) []byte {
	w := &lib0.Writer{}
	w.WriteVarUint(1)
	w.WriteVarUint(client)
	w.WriteVarUint(clock)
	w.WriteVarUint(uint64(len(state)))
	return append(w.Bytes(), state...)
}

func awarenessForBoth(first, second [2]uint64) []byte {
	w := &lib0.Writer{}
	w.WriteVarUint(2)
	for _, entry := range [][2]uint64{first, second} {
		w.WriteVarUint(entry[0])
		w.WriteVarUint(entry[1])
		w.WriteUint8(2)
		w.WriteUint8('{')
		w.WriteUint8('}')
	}
	return w.Bytes()
}

func identitiesFrames(t *testing.T, m *fakeMember) [][]wire.Identity {
	t.Helper()
	var frames [][]wire.Identity
	for _, message := range m.messages(t) {
		if identities, ok := message.(wire.Identities); ok {
			frames = append(frames, identities.Identities)
		}
	}
	return frames
}

func awarenessFrames(t *testing.T, m *fakeMember) [][]byte {
	t.Helper()
	var frames [][]byte
	for _, message := range m.messages(t) {
		if awareness, ok := message.(wire.Awareness); ok {
			frames = append(frames, awareness.Update)
		}
	}
	return frames
}

func onlyIdentities(t *testing.T, m *fakeMember) []wire.Identity {
	t.Helper()
	frames := identitiesFrames(t, m)
	if len(frames) != 1 {
		t.Fatalf("%d identities frames, want 1", len(frames))
	}
	return frames[0]
}

func id(client uint64, actor string) wire.Identity {
	return wire.Identity{ClientID: client, ActorID: actor}
}

func sortedIdentities(identities []wire.Identity) []wire.Identity {
	sorted := slices.Clone(identities)
	slices.SortFunc(sorted, func(a, b wire.Identity) int { return int(a.ClientID) - int(b.ClientID) })
	return sorted
}

func expectWithdrawal(t *testing.T, m *fakeMember, want []byte) {
	t.Helper()
	frames := awarenessFrames(t, m)
	if len(frames) != 1 || !bytes.Equal(frames[0], want) {
		t.Fatalf("awareness frames %x, want one %x", frames, want)
	}
}

func expectNothing(t *testing.T, m *fakeMember) {
	t.Helper()
	if messages := m.messages(t); len(messages) != 0 {
		t.Fatalf("got %d frames, want none: %#v", len(messages), messages)
	}
}

func TestWithdrawsTheClientsOfAMemberThatLeftWithoutSayingGoodbye(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, leaver := a.join("")
	other, _ := a.join("")
	a.send(leaver, awarenessFor(42, 3, "{}"))
	other.clear()

	leaver.Leave()

	expectWithdrawal(t, other, awarenessFor(42, 3, "null"))
}

func TestWithdrawsNothingForAMemberThatNeverPublishedPresence(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, leaver := a.join("")
	other, _ := a.join("")
	other.clear()

	leaver.Leave()

	expectNothing(t, other)
}

func TestDoesNotWithdrawAClientAMemberOnlyRelayed(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, owner := a.join("")
	_, relay := a.join("")
	other, _ := a.join("")
	a.send(owner, awarenessFor(42, 3, "{}"))
	a.send(relay, awarenessFor(42, 3, "{}"))
	other.clear()

	relay.Leave()

	expectNothing(t, other)
}

func TestDoesNotClaimAClientFirstSeenInsideAReplayOfTheRoom(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, owner := a.join("")
	_, replay := a.join("")
	other, _ := a.join("")
	a.send(replay, awarenessForBoth([2]uint64{7, 1}, [2]uint64{42, 3}))
	a.send(owner, awarenessFor(42, 3, "{}"))
	other.clear()

	replay.Leave()
	expectNothing(t, other)

	owner.Leave()
	expectWithdrawal(t, other, awarenessFor(42, 3, "null"))
}

func TestWithdrawsNothingTwiceWhenTheClientSaidGoodbyeItself(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, leaver := a.join("")
	other, _ := a.join("")
	a.send(leaver, awarenessFor(42, 3, "{}"))
	a.send(leaver, awarenessFor(42, 3, "null"))
	other.clear()

	leaver.Leave()

	expectNothing(t, other)
}

func TestAJoiningMemberReceivesTheFullVerifiedIdentitiesMap(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, named := a.join("user-1")
	a.send(named, awarenessFor(42, 3, "{}"))

	joiner, _ := a.join("user-2")

	if got := onlyIdentities(t, joiner); !slices.Equal(got, []wire.Identity{id(42, "user-1")}) {
		t.Fatalf("identities %v", got)
	}
}

func TestAMemberWithNoVerifiedIdentityAppearsInNoIdentitiesEntry(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	anonymous, anonymousMembership := a.join("")
	a.send(anonymousMembership, awarenessFor(42, 3, "{}"))
	_, named := a.join("user-1")
	a.send(named, awarenessFor(43, 3, "{}"))

	joiner, _ := a.join("user-2")

	if got := onlyIdentities(t, joiner); !slices.Equal(got, []wire.Identity{id(43, "user-1")}) {
		t.Fatalf("identities %v", got)
	}
	if closes := anonymous.closed(); len(closes) != 0 {
		t.Fatalf("the anonymous member was closed: %v", closes)
	}
}

func TestBindingANewClientIdBroadcastsTheWholeMapToEveryoneIncludingTheSender(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	named, membership := a.join("user-1")
	other, _ := a.join("")
	named.clear()
	other.clear()

	a.send(membership, awarenessFor(42, 3, "{}"))

	want := []wire.Identity{id(42, "user-1")}
	if got := onlyIdentities(t, named); !slices.Equal(got, want) {
		t.Fatalf("the sender saw %v", got)
	}
	if got := onlyIdentities(t, other); !slices.Equal(got, want) {
		t.Fatalf("the other saw %v", got)
	}
	if len(named.messages(t)) != 1 {
		t.Fatal("the sender got its own awareness back")
	}
}

func TestAnAnonymousBindBroadcastsNoIdentitiesFrame(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, membership := a.join("")
	observer, _ := a.join("")
	observer.clear()

	a.send(membership, awarenessFor(42, 3, "{}"))

	if frames := identitiesFrames(t, observer); len(frames) != 0 {
		t.Fatalf("identities frames %v", frames)
	}
}

func TestAnOwnershipTransferFromAnonymousToVerifiedBroadcastsTheChange(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, anonymous := a.join("")
	a.send(anonymous, awarenessFor(42, 1, "{}"))
	_, verified := a.join("user-1")
	observer, _ := a.join("")
	observer.clear()

	a.send(verified, awarenessFor(42, 2, "{}"))

	if got := onlyIdentities(t, observer); !slices.Equal(got, []wire.Identity{id(42, "user-1")}) {
		t.Fatalf("identities %v", got)
	}
}

func TestLeavingBroadcastsTheRemainingMapWithoutTheClientIdsItOwned(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, staying := a.join("user-1")
	_, leaving := a.join("user-2")
	observer, _ := a.join("")
	a.send(staying, awarenessFor(10, 1, "{}"))
	a.send(leaving, awarenessFor(20, 1, "{}"))
	observer.clear()

	leaving.Leave()

	if got := onlyIdentities(t, observer); !slices.Equal(got, []wire.Identity{id(10, "user-1")}) {
		t.Fatalf("identities %v", got)
	}
}

func TestAnAnonymousMemberLeavingBroadcastsNoIdentitiesFrame(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, leaving := a.join("")
	observer, _ := a.join("")
	a.send(leaving, awarenessFor(42, 3, "{}"))
	observer.clear()

	leaving.Leave()

	if frames := identitiesFrames(t, observer); len(frames) != 0 {
		t.Fatalf("identities frames %v", frames)
	}
}

func TestAnAwarenessClientIdPastTheSafeIntegerCeilingIsNeverMapped(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, membership := a.join("user-1")
	observer, _ := a.join("")
	observer.clear()

	a.send(membership, awarenessFor(1<<53, 1, "{}"))

	if frames := identitiesFrames(t, observer); len(frames) != 0 {
		t.Fatalf("identities frames %v", frames)
	}
	if len(awarenessFrames(t, observer)) != 1 {
		t.Fatal("the frame was not relayed")
	}
	if len(a.logged("past the safe-integer ceiling")) == 0 {
		t.Fatal("nothing was logged")
	}
	joiner, _ := a.join("")
	if got := onlyIdentities(t, joiner); len(got) != 0 {
		t.Fatalf("identities %v", got)
	}
}

func TestAFrameOfFabricatedClientIdsIsLoggedOncePerFrameWithItsCount(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, membership := a.join("user-1")

	a.send(membership, awarenessForBoth([2]uint64{1 << 53, 1}, [2]uint64{1<<53 + 1, 1}))

	lines := a.logged("safe-integer ceiling")
	if len(lines) != 1 || !strings.Contains(lines[0], "ignored 2 awareness client id") {
		t.Fatalf("logged %q", lines)
	}
}

func TestTheLargestSafeAwarenessClientIdStillBinds(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, membership := a.join("user-1")

	a.send(membership, awarenessFor(1<<53-1, 1, "{}"))

	joiner, _ := a.join("")
	if got := onlyIdentities(t, joiner); !slices.Equal(got, []wire.Identity{id(1<<53-1, "user-1")}) {
		t.Fatalf("identities %v", got)
	}
}

func TestARelayedFrameTransferringTwoClientIdsBroadcastsIdentitiesOnce(t *testing.T) {
	a := newAwarenessRoom(t, DefaultOptions())
	_, first := a.join("user-1")
	a.send(first, awarenessFor(1, 1, "{}"))
	a.send(first, awarenessFor(2, 1, "{}"))
	_, second := a.join("user-2")
	observer, _ := a.join("")
	observer.clear()

	a.send(second, awarenessForBoth([2]uint64{1, 2}, [2]uint64{2, 2}))

	got := sortedIdentities(onlyIdentities(t, observer))
	if !slices.Equal(got, []wire.Identity{id(1, "user-2"), id(2, "user-2")}) {
		t.Fatalf("identities %v", got)
	}
}

func TestTheIdentitiesFrameNeverExceedsTheAwarenessClientCap(t *testing.T) {
	a := newAwarenessRoom(t, OptionsWith(func(ro *Options) { ro.MaxAwarenessClients = 2 }))
	_, first := a.join("user-1")
	_, second := a.join("user-2")
	_, third := a.join("user-3")
	a.send(first, awarenessFor(1, 1, "{}"))
	a.send(second, awarenessFor(2, 1, "{}"))
	a.send(third, awarenessFor(3, 1, "{}"))

	joiner, _ := a.join("")

	if got := onlyIdentities(t, joiner); len(got) != 2 {
		t.Fatalf("identities %v", got)
	}
}
