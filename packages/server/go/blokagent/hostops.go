package blokagent

import "github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"

// RoomOps turns an agentExecute answer's edits into the ops a room applies,
// as ExecuteInRoom does. It is for blokmcp, whose remote live handles apply
// them to their own Y doc; convert's types keep it inside this module.
func RoomOps(editsJSON, afterJSON, resultJSON string) ([]convert.EditOp, error) {
	edits, err := parse(editsJSON)
	if err != nil {
		return nil, err
	}
	after, err := parse(afterJSON)
	if err != nil {
		return nil, err
	}
	result, err := parse(resultJSON)
	if err != nil {
		return nil, err
	}
	return translate(edits, after, result)
}
