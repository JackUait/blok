package blokagent

import (
	"context"
	"strconv"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/lib0"
)

// C# BlokAgentVersionHistoryTests.APeerValueWithNoJsonFormFailsNoCommand: a
// peer's nested bigint in a page map is left out, as the version read
// leaves it out, so no command fails on it.
func TestAPeerValueWithNoJsonFormFailsNoCommand(t *testing.T) {
	for _, name := range []string{"history.read", "history.restore", "restore-before", "history.changes", "text.replace"} {
		t.Run(name, func(t *testing.T) {
			r := newTestRoom(t, false, nil)
			r.docs.hold("d", historySeed)
			before := okIn(t, r, "d", `{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}`).Revision
			big := &jsjson.Object{}
			big.Set(jsjson.FromString("n"), lib0.BigInt(1))
			peer, err := r.manager.Edit(context.Background(), "d", []convert.EditOp{
				convert.PatchMaps{Patches: []convert.MapPatch{{Map: "values", Key: "x", Value: big}}},
			}, newGUID(), make([]byte, 32), "human-2", nil)
			if err != nil || peer.Status != room.EditApplied {
				t.Fatalf("peer %v %v", peer.Status, err)
			}
			head := peer.Receipt.Tag.Lineage + ":" + strconv.FormatUint(peer.Receipt.ServerSequence, 10)
			command := map[string]string{
				"history.changes": `{"name":"history.changes","args":{"from":"` + before + `","to":"` + head + `"}}`,
				"text.replace":    `{"name":"text.replace","args":{"id":"p","with":"Changed"}}`,
				"restore-before":  `{"name":"history.restore","args":{"version":"` + before + `"}}`,
			}[name]
			if command == "" {
				command = `{"name":"` + name + `","args":{"version":"` + head + `"}}`
			}

			okIn(t, r, "d", `{"commands":[`+command+`]}`)
		})
	}
}
