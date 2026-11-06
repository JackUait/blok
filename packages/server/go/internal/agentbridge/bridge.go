// Package agentbridge reaches blokagent's host-only seams for blokmcp
// without new public API: blokagent fills these at init, and only
// packages in this module can import this one.
package agentbridge

import (
	"context"

	"github.com/JackUait/blok/packages/server/go/v2/internal/collab/convert"
)

// RoomOps turns an agentExecute answer's edits into room ops.
var RoomOps func(editsJSON, afterJSON, resultJSON string) ([]convert.EditOp, error)

// RoomCall runs ExecuteInRoom on executor (a *blokagent.Executor) with the
// MCP's mcp and approval bundle inputs; actor and options are a
// blokagent.Actor and *blokagent.Options. ask is the question a person must
// answer first, with nothing applied.
var RoomCall func(ctx context.Context, executor any, docID, batchJSON string, actor any, options any, mcpJSON, approvalJSON *string) (resultJSON, revision string, ask *string, err error)
