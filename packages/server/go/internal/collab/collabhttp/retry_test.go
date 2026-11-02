package collabhttp

import (
	"net/http/httptest"
	"testing"
	"time"
)

// R9: whole seconds, rounded up, at least 1.
func TestRetryAfterIsWholeSecondsRoundedUpAndAtLeastOne(t *testing.T) {
	for _, c := range []struct {
		wait time.Duration
		want string
	}{{2 * time.Second, "2"}, {2100 * time.Millisecond, "3"}, {0, "1"}, {time.Millisecond, "1"}} {
		recorder := httptest.NewRecorder()
		refuseRetryLater(recorder, c.wait, "retry\n")
		if got := recorder.Header().Get("Retry-After"); got != c.want || recorder.Code != 503 || recorder.Body.String() != "retry\n" {
			t.Fatalf("%s: Retry-After %q, %d %q; want %q", c.wait, got, recorder.Code, recorder.Body.String(), c.want)
		}
	}
}
