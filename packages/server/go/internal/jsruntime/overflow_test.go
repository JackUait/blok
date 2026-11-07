package jsruntime

import "testing"

// Node's JSON.parse reads a number past float64 as Infinity; goja's refuses it.
func TestJSONParseReadsAnOverflowingNumberAsInfinity(t *testing.T) {
	vm := newVM()
	got, err := vm.RunString(`const v = JSON.parse('{"a":1e400,"b":[-1E+999,2],"s":"1e400"}');
		[v.a === Infinity, v.b[0] === -Infinity, v.b[1], v.s,
		 JSON.parse('[1e400]', function (k, x) { return k === '0' ? String(x) : x; })[0]].join(',')`)
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != "true,true,2,1e400,Infinity" {
		t.Fatalf("got %s", got)
	}
}
