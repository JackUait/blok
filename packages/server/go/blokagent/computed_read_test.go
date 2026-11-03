package blokagent

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// A port of C# JintComputedReadTests.AFullReadOfALargeDatabaseFinishes: a
// read of one row in a 1500-row database computes every row and must finish
// inside the production 10 s budget (jsruntime.DefaultTimeout), not time out.
func TestAFullReadOfALargeDatabaseFinishes(t *testing.T) {
	const rows = 1500
	var blocks, content strings.Builder
	for i := range rows {
		if i > 0 {
			content.WriteByte(',')
		}
		content.WriteString(strconv.Quote("r" + strconv.Itoa(i)))
		fmt.Fprintf(&blocks, `,{"id":"r%d","type":"database-row","parent":"db","data":{"position":"a%05d","properties":{"t":"Row %d","n":%d}}}`, i, i, i, i)
	}
	document := `{"blocks":[{"id":"db","type":"database","data":{"title":"Big","activeViewId":"v1",` +
		`"views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],` +
		`"schema":[{"id":"t","name":"Name","type":"title","position":"a0"},{"id":"n","name":"Est","type":"number","position":"a1"},` +
		`{"id":"f","name":"Double","type":"formula","position":"a2","formula":{"expression":"prop(\"Est\") * 2"}},` +
		`{"id":"uid","name":"ID","type":"uniqueId","position":"a3"}]},"content":[` + content.String() + `]}` + blocks.String() + `]}`

	execution, err := sharedExecutor(t).Execute(context.Background(), document, `{"commands":[{"name":"doc.read","args":{"ids":["r1499"]}}]}`, Actor{ID: "agent-cs", Name: "Server agent"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := mustParse(t, execution.ResultJSON)
	if got, _ := pointer(result, "/ok"); stable(t, got) != "true" {
		t.Fatalf("not ok: %.2000s", execution.ResultJSON)
	}
	if count, _ := pointer(result, "/results/0/blocks"); count == nil || len(count.Items) != 1 {
		t.Fatalf("want one block: %.2000s", execution.ResultJSON)
	}
	computed, _ := pointer(result, "/results/0/blocks/0/computed")
	if got := stable(t, computed); got != stable(t, mustParse(t, `{"f":2998,"uid":1500}`)) {
		t.Fatalf("computed %s", got)
	}
}
