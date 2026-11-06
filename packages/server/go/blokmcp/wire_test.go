package blokmcp

import (
	"encoding/json"
	"testing"
)

func TestKeepsOnlyBareReplyObjectsAsNodesSDKDoes(t *testing.T) {
	got := acceptedReplies(json.RawMessage(`{"a":{"action":"accept"},"b":"yes","c":[1],"d":null,"e":{"method":"elicitation/create"},"f":{"result":{}}}`))
	written, _ := json.Marshal(got)
	if string(written) != `{"a":{"action":"accept"}}` {
		t.Fatalf("got %s", written)
	}
}

func TestRepliesThatAreNotAnObjectKeepNothing(t *testing.T) {
	for _, raw := range []string{`"yes"`, `[]`, `null`} {
		if got := acceptedReplies(json.RawMessage(raw)); len(got) != 0 {
			t.Fatalf("%s kept %v", raw, got)
		}
	}
}

func TestLiftsInputResponsesIntoMeta(t *testing.T) {
	got := liftInputResponses(json.RawMessage(`{"name":"x","inputResponses":{"k":"yes"},"_meta":{"m":1}}`))
	var params struct {
		InputResponses json.RawMessage            `json:"inputResponses"`
		Meta           map[string]json.RawMessage `json:"_meta"`
	}
	if err := json.Unmarshal(got, &params); err != nil {
		t.Fatal(err)
	}
	if params.InputResponses != nil || string(params.Meta[rawResponsesKey]) != `{"k":"yes"}` || string(params.Meta["m"]) != "1" {
		t.Fatalf("got %s", got)
	}
}
