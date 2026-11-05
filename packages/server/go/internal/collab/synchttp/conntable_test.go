package synchttp

import (
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
)

func TestTheProcessCeilingRefusesPastItAndFreesOnRelease(t *testing.T) {
	table := NewConnectionTable(2, 8)
	first, second := table.TryEnter(), table.TryEnter()
	if first == nil || second == nil {
		t.Fatal("refused under the ceiling")
	}
	if table.TryEnter() != nil {
		t.Fatal("allowed past the ceiling")
	}
	first.Release()
	first.Release()
	if table.TryEnter() == nil {
		t.Fatal("a released slot was not freed")
	}
	if table.TryEnter() != nil {
		t.Fatal("a double release freed two slots")
	}
}

func TestACeilingOfZeroIsNoCeiling(t *testing.T) {
	table := NewConnectionTable(0, 8)
	for range 5000 {
		if table.TryEnter() == nil {
			t.Fatal("a zero ceiling refused")
		}
	}
}

func TestThePerUserCapCountsPerDocumentAndPrincipal(t *testing.T) {
	table := NewConnectionTable(0, 2)
	a1, a2 := table.TryReserve("doc", "user:a"), table.TryReserve("doc", "user:a")
	if a1 == nil || a2 == nil {
		t.Fatal("refused under the cap")
	}
	if table.TryReserve("doc", "user:a") != nil {
		t.Fatal("allowed a third for one user and doc")
	}
	if table.TryReserve("doc", "user:b") == nil || table.TryReserve("other", "user:a") == nil {
		t.Fatal("the cap leaked across users or documents")
	}
	a1.Release()
	a1.Release()
	if table.TryReserve("doc", "user:a") == nil {
		t.Fatal("a released lease was not freed")
	}
	if table.TryReserve("doc", "user:a") != nil {
		t.Fatal("a double release freed two leases")
	}
}

func TestEveryRoomReasonMapsToItsClose(t *testing.T) {
	cases := map[collab.CloseReason]CloseFrame{
		collab.CloseReset:             {4409, "document reset"},
		collab.CloseForbidden:         {4403, "forbidden"},
		collab.CloseDraining:          {1001, "server shutting down"},
		collab.CloseBadAwareness:      {1008, "malformed awareness"},
		collab.CloseCommitUnavailable: {4503, "commit unavailable, retry"},
		collab.CloseRawWriteOnV2:      {1008, "raw write on a v2 session"},
		collab.CloseReason(99):        {1011, "internal error"},
		collab.CloseReason(-1):        {1011, "internal error"},
	}
	for reason, want := range cases {
		if got := closeFor(reason); got != want {
			t.Errorf("reason %d: got %+v, want %+v", reason, got, want)
		}
	}
	if CloseCommitUnavailable.Status != CloseSeedFailed.Status || CloseCommitUnavailable.Reason == CloseSeedFailed.Reason {
		t.Error("commit unavailable must share 4503 with seed failed but not its text")
	}
}

func TestTheEndpointClosesCarryTheirExactText(t *testing.T) {
	cases := map[CloseFrame]CloseFrame{
		CloseNormal:              {1000, ""},
		CloseTooBig:              {1009, "message too big"},
		CloseInboundRateExceeded: {1008, "inbound rate exceeded"},
		CloseSlowConsumer:        {1008, "outbound queue overflow"},
		CloseBadDocument:         {4400, "document ids must be a single path segment"},
		CloseMissingPass:         {4401, "missing pass"},
		CloseInvalidPass:         {4401, "invalid pass"},
		CloseOtherDocument:       {4401, "pass is for another document"},
		CloseUserlessPass:        {4401, "pass names no user"},
		CloseTextFrame:           {1003, "binary frames only"},
		CloseSeedFailed:          {4503, "document unavailable"},
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %+v, want %+v", got, want)
		}
	}
}
