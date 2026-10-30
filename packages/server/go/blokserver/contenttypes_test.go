package blokserver

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// contenttypes.go is generated from this file, which ContentTypeFixtureTests
// pins to ASP.NET's FileExtensionContentTypeProvider.
func TestContentTypesMatchAspNet(t *testing.T) {
	data, err := os.ReadFile("../../../../test/unit/server-conformance/fixtures/content-types.json")
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]string
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(contentTypes, want) {
		t.Fatal("contenttypes.go is stale: regenerate it from content-types.json")
	}
	if contentTypeFor("0123456789abcdef0123456789abcdef.HTML") != "text/html" || contentTypeFor("x.unknownext") != "application/octet-stream" {
		t.Fatal("lookup")
	}
}
