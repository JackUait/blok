package blokagent

import (
	"context"
	"errors"

	"github.com/JackUait/blok/packages/server/go/v2/internal/agentbridge"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// The MCP's seams, reached through internal/agentbridge only.
func init() {
	agentbridge.RoomOps = func(editsJSON, afterJSON, resultJSON string) ([]convert.EditOp, error) {
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
	agentbridge.RoomCall = func(ctx context.Context, executor any, docID, batchJSON string, actor any, options any, mcpJSON, approvalJSON *string) (string, string, *string, error) {
		e, ok := executor.(*Executor)
		who, okActor := actor.(Actor)
		opts, okOptions := options.(*Options)
		if !ok || !okActor || !okOptions || opts == nil {
			return "", "", nil, errors.New("agentbridge: RoomCall takes an *Executor, an Actor and *Options")
		}
		withHost := *opts
		withHost.mcpJSON, withHost.approvalJSON = mcpJSON, approvalJSON
		execution, err := e.ExecuteInRoom(ctx, docID, batchJSON, who, &withHost)
		return execution.ResultJSON, execution.Revision, execution.askJSON, err
	}
}
