package dotnet

import (
	"reflect"
	"testing"
)

// The status codes these lists lead to are pinned against the C# host by
// collab-http-contract's "like ASP.NET" cases.
func TestQueryAllReadsTheQueryLikeASPNET(t *testing.T) {
	for _, c := range []struct {
		raw  string
		want []string
	}{
		{"group=1", []string{"1"}},
		{"GROUP=7", []string{"7"}},
		{"group=1&Group=15", []string{"1", "15"}},
		{"group=1;x=1", []string{"1;x=1"}},
		{"group=%zz", []string{"%zz"}},
		{"group=1%00", []string{"1\x00"}},
		{"group=%31+", []string{"1 "}},
		{"x=1&&group=", []string{""}},
		{"x=1", nil},
		{"", nil},
	} {
		if got := QueryAll(c.raw, "group"); !reflect.DeepEqual(got, c.want) {
			t.Errorf("QueryAll(%q) = %q, want %q", c.raw, got, c.want)
		}
	}
}
