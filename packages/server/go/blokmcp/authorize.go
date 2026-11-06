package blokmcp

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const webhookTimeout = 10 * time.Second

// Webhook is an authorize hook that POSTs {principal, documentId, write} to
// url. It fails closed: anything but a 200 with {"allowed": true} denies.
func Webhook(url string) AuthorizeFunc {
	return func(ctx context.Context, principal, documentID string, write bool) (bool, error) {
		body, _ := marshal(struct {
			Principal  string `json:"principal"`
			DocumentID string `json:"documentId"`
			Write      bool   `json:"write"`
		}{principal, documentID, write})
		answer, err := fetch(ctx, webhookTimeout, http.MethodPost, url, http.Header{"Content-Type": {"application/json"}}, body)
		if err != nil || answer.status != http.StatusOK {
			return false, nil
		}
		var verdict map[string]json.RawMessage
		if json.Unmarshal([]byte(decodeUTF8(answer.body)), &verdict) != nil {
			return false, nil
		}
		return string(verdict["allowed"]) == "true", nil
	}
}
