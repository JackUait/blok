package blokmcp

import (
	"encoding/json"
	"testing"
)

const customCallout = `{"formatVersion":1,"blocks":[{"name":"callout_x","description":{"summary":"A callout.","data":{"type":"object"}},` +
	`"statics":{"toolbox":[],"richTextFields":["body"],"acceptsChildren":false,"ownsChildren":false,"isLayout":false,` +
	`"deletesChildren":false,"selfPlacesChildren":false,"restrictedInTableCell":false,"conversion":{},` +
	`"convertible":{"import":false,"export":false},"hasPrepareInsert":false},` +
	`"sanitize":{"body":{"strong":true},"enabled":true}}]}`

// Node's live serializer reads a type's rich fields from the contract's
// manifest, so a --manifest tool's fields convert to segments in the room.
// --rich-text-fields only counts for a type the manifest lacks.
func TestTheLiveConverterKnowsCustomToolFields(t *testing.T) {
	server, err := New(Options{
		Transport: Transport{Kind: "stdio"}, Auth: Auth{Kind: "none"}, Sync: &Sync{URL: "ws://127.0.0.1:1/sync"}, Tickets: &Tickets{Kind: "secret", Secret: "0123456789abcdef0123456789abcdef"},
		Manifest:       json.RawMessage(customCallout),
		RichTextFields: map[string][]string{"callout_x": {"extra"}, "paragraph": {"caption"}, "note": {"title"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	fields := server.liveConverter().Fields
	if fields == nil || !fields.IsRich("callout_x", "body") {
		t.Fatal("callout_x.body is not rich")
	}
	if fields.IsRich("callout_x", "extra") || fields.IsRich("paragraph", "caption") {
		t.Fatal("--rich-text-fields won over the manifest")
	}
	if !fields.IsRich("note", "title") || !fields.IsRich("paragraph", "text") {
		t.Fatal("a type outside the manifest, or a built-in, lost its fields")
	}
}
