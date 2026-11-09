package room

import (
	"encoding/base64"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/wire"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// Twin of C# CollabNoOpRecordsCaptureTests: v2 operations that change
// nothing, from fixtures/collab-history/noop-records.json.
func TestNoOpRecordsFixture(t *testing.T) {
	fixture := readRepoJSON(t, "test", "unit", "server-conformance", "fixtures", "collab-history", "noop-records.json")
	seed := text(t, fixture, "seed")
	for _, c := range historyFixture(t, "noop-records.json") {
		t.Run(text(t, c, "name"), func(t *testing.T) {
			r := ra1NewRoom()
			r.endpoint.Holds(t, testDoc, seed, nil)
			manager := r.manager(t, ra1Quiet(), true)
			writer, other := ra1V2(""), ra1Writer()
			membership, lineage := ra1JoinLineage(t, manager, writer)
			ra1Join(t, manager, other)

			steps, _ := member(t, c, "steps").([]any)
			for i, item := range steps {
				step := item.(*jsjson.Object)
				update, err := base64.StdEncoding.DecodeString(text(t, step, "update"))
				if err != nil {
					t.Fatal(err)
				}
				writer.clear()
				other.clear()

				ra1Send(t, membership, ra1Op(lineage, text(t, step, "operationId"), update))

				frames, _ := member(t, step, "frames").([]any)
				var want []string
				for _, frame := range frames {
					want = append(want, noopExpectedFrame(t, frame.(*jsjson.Object)))
				}
				var got []string
				for _, message := range writer.messages(t) {
					got = append(got, noopFrame(message))
				}
				if strings.Join(got, ", ") != strings.Join(want, ", ") {
					t.Fatalf("step %d: writer got [%s], want [%s]", i, strings.Join(got, ", "), strings.Join(want, ", "))
				}
				relayed, _ := member(t, step, "relayed").(bool)
				if gotRelayed := len(other.messages(t)) > 0; gotRelayed != relayed {
					t.Fatalf("step %d: relayed %v, want %v", i, gotRelayed, relayed)
				}
			}

			journal, _ := member(t, c, "journal").([]any)
			var want []string
			for _, item := range journal {
				record := item.(*jsjson.Object)
				want = append(want, text(t, record, "sequence")+":"+text(t, record, "operationId"))
			}
			var got []string
			for _, record := range r.committed() {
				got = append(got, strconv.FormatUint(record.Sequence, 10)+":"+record.OperationID)
			}
			if strings.Join(got, ", ") != strings.Join(want, ", ") {
				t.Fatalf("journal [%s], want [%s]", strings.Join(got, ", "), strings.Join(want, ", "))
			}
		})
	}
}

func noopExpectedFrame(t *testing.T, frame *jsjson.Object) string {
	t.Helper()
	switch kind := text(t, frame, "type"); kind {
	case "acknowledgement":
		return "ack " + text(t, frame, "operationId") + " " + text(t, frame, "serverSequence")
	case "rejection":
		return "reject " + text(t, frame, "operationId") + " " + text(t, frame, "code")
	default:
		return kind
	}
}

func noopFrame(message wire.Message) string {
	switch m := message.(type) {
	case wire.SyncUpdate:
		return "update"
	case wire.Acknowledgement:
		return "ack " + m.OperationID + " " + strconv.FormatUint(m.ServerSequence, 10)
	case wire.Rejection:
		return "reject " + m.OperationID + " " + m.Code
	default:
		return "other"
	}
}
