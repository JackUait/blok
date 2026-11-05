package docendpoint

import (
	"net/http"
	"strconv"
	"testing"
)

// Twins of C# DocEndpointClientTests cases that had no Go twin.

// A consumer whose record holds sequence 5 refuses an older projection; the
// client reports the 409 instead of counting it as a save.
func TestOlderProjectionCannotOverwriteANewerSequenceWhenConsumerUsesHeaders(t *testing.T) {
	r := &recorder{respond: func(request *http.Request) (*http.Response, error) {
		sent := request.Header.Get(SequenceHeader)
		if sequence, err := strconv.ParseUint(sent, 10, 64); err == nil && sequence > 5 {
			return answer(200, `{"version":"v9"}`, true), nil
		}
		return answer(http.StatusConflict, "", true), nil
	}}
	consumer := client(t, r, setup{})
	document := node(t, `{"blocks":[]}`)

	_, err := consumer.Save(bg, "doc", document, ptr("v5"), &Projection{Lineage: lineage, ServerSequence: 3})
	if e := endpointError(t, err); e.StatusCode != 409 {
		t.Fatalf("stale save: %v", e)
	}
	version, err := consumer.Save(bg, "doc", document, ptr("v5"), &Projection{Lineage: lineage, ServerSequence: 7})
	if err != nil || version == nil || *version != "v9" {
		t.Fatalf("fresh save: %v, %v", version, err)
	}
}
