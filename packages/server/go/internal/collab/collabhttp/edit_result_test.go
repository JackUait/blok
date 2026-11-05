package collabhttp

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/workingset"
)

// E7: every edit result as C# EditEndpoint.WriteResultAsync answers it
// (EditEndpoint.cs:137-228), texts copied from there.
func TestEveryEditResultIsAnsweredAsCSharpAnswersIt(t *testing.T) {
	head := &room.Receipt{Tag: workingset.Tag{Lineage: "0123456789abcdef0123456789abcdef"}, ServerSequence: 7}
	for _, c := range []struct {
		result   room.EditResult
		status   int
		body     string
		sequence string
		retry    string
	}{
		{room.EditResult{Status: room.EditApplied, Receipt: head}, 204, "", "7", ""},
		{room.EditResult{Status: room.EditPreconditionFailed, Receipt: head}, 412, "the document is no longer at the If-Match head\n", "7", ""},
		{room.EditResult{Status: room.EditPreconditionRequired}, 428, "If-Match needs the operation journal, and this server keeps none\n", "", ""},
		{room.EditResult{Status: room.EditConflict}, 409, "the idempotency key was already used for a different edit\n", "", ""},
		{room.EditResult{Status: room.EditInvalid, Err: errors.New("collab: bad op.")}, 422, "collab: bad op.\n", "", ""},
		{room.EditResult{Status: room.EditInvalid}, 422, "collab: the edit was refused.\n", "", ""},
		{room.EditResult{Status: room.EditOverloaded}, 503, "the server ran past its limits reading this edit's rich text, retry\n", "", "3"},
		{room.EditResult{Status: room.EditTooLarge}, 413, "collab: the edit's rich text is too large to read.\n", "", ""},
		{room.EditResult{Status: room.EditPurged}, 403, "forbidden\n", "", ""},
		{room.EditResult{Status: room.EditUnavailable}, 503, "the document is unavailable, retry\n", "", ""},
		{room.EditResult{Status: room.EditDraining}, 503, "the document could not be loaded\n", "", ""},
		{room.EditResult{Status: room.EditSeedFailed}, 503, "the document could not be loaded\n", "", ""},
	} {
		recorder := httptest.NewRecorder()
		WriteEditResult(recorder, c.result, 2500*time.Millisecond)
		if recorder.Code != c.status || recorder.Body.String() != c.body ||
			recorder.Header().Get("Blok-Doc-Sequence") != c.sequence || recorder.Header().Get("Retry-After") != c.retry {
			t.Errorf("%v: %d %q, sequence %q, retry %q; want %d %q %q %q", c.result.Status, recorder.Code, recorder.Body.String(),
				recorder.Header().Get("Blok-Doc-Sequence"), recorder.Header().Get("Retry-After"), c.status, c.body, c.sequence, c.retry)
		}
	}
}
