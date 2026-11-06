package blokmcp

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"sync"

	"github.com/JackUait/blok/packages/server/go/v2/blokagent"
)

// roomSession is a live handle on a room of the same process: each call
// runs in the room lane through the server's agent executor
// (blokserver.Server.AgentExecutor), so there is no socket and no ticket.
type roomSession struct {
	server     *Server
	documentID string
	write      bool
	readOnly   map[string]bool
	mu         sync.Mutex
	latched    bool
}

// roomContract reads which commands write, from the executor's room
// contract.
func (s *Server) roomReadOnly(ctx context.Context) (map[string]bool, error) {
	s.roomOnce.Do(func() {
		var contract struct {
			Commands []struct {
				Name     string `json:"name"`
				ReadOnly bool   `json:"readOnly"`
			} `json:"commands"`
		}
		written, err := s.options.Rooms.RoomContract(ctx, s.agentOptions())
		if err == nil {
			err = json.Unmarshal([]byte(written), &contract)
		}
		s.roomErr = err
		s.roomCommands = map[string]bool{}
		for _, command := range contract.Commands {
			s.roomCommands[command.Name] = command.ReadOnly
		}
	})
	return s.roomCommands, s.roomErr
}

// agentOptions are the executor options the start options imply.
func (s *Server) agentOptions() *blokagent.Options {
	options := &blokagent.Options{DisableBuiltInComments: s.options.Comments != nil && !*s.options.Comments}
	if len(s.options.Manifest) > 0 {
		text := string(s.options.Manifest)
		options.CustomToolsJSON = &text
	}
	if len(s.options.Overrides) > 0 {
		text := string(s.options.Overrides)
		options.OverridesJSON = &text
	}
	return options
}

func (s *Server) openRoom(ctx context.Context, documentID string, write bool) (session, error) {
	readOnly, err := s.roomReadOnly(ctx)
	if err != nil {
		return nil, err
	}
	return &roomSession{server: s, documentID: documentID, write: write, readOnly: readOnly}, nil
}

func (r *roomSession) openInfo() map[string]any {
	info := map[string]any{
		"mode": "live", "write": r.write, "durability": "acknowledged",
		"contractRevision": r.server.surface.ContractRevision.Live,
	}
	var unavailable []json.RawMessage
	if json.Unmarshal(r.server.surface.LiveUnavailableCommands, &unavailable) == nil && len(unavailable) > 0 {
		info["unavailableCommands"] = r.server.surface.LiveUnavailableCommands
	}
	return info
}

func blokActor(raw json.RawMessage) blokagent.Actor {
	var actor struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		OnBehalfOf *string `json:"onBehalfOf"`
	}
	_ = json.Unmarshal(raw, &actor)
	return blokagent.Actor{ID: actor.ID, Name: actor.Name, OnBehalfOf: actor.OnBehalfOf}
}

type roomResult struct {
	OK       bool              `json:"ok"`
	Results  []json.RawMessage `json:"results"`
	Error    json.RawMessage   `json:"error"`
	Revision string            `json:"revision"`
}

func (r *roomSession) run(ctx context.Context, call *callContext, batch json.RawMessage) (string, roomResult, error) {
	execution, err := r.server.options.Rooms.ExecuteInRoom(ctx, r.documentID, string(batch), blokActor(call.actor), r.server.agentOptions())
	if err != nil {
		return "", roomResult{}, err
	}
	var result roomResult
	err = json.Unmarshal([]byte(execution.ResultJSON), &result)
	return execution.ResultJSON, result, err
}

func (r *roomSession) read(ctx context.Context, call *callContext, view json.RawMessage) (json.RawMessage, error) {
	if len(view) == 0 {
		view = json.RawMessage("{}")
	}
	batch, _ := marshal(map[string]any{"commands": []map[string]any{{"name": "doc.read", "args": view}}})
	_, result, err := r.run(ctx, call, batch)
	if err != nil {
		return nil, err
	}
	if !result.OK || len(result.Results) == 0 {
		return r.server.errorAnswer(ctx, "blok_read", rawError(result.Error))
	}
	return r.server.plainAnswer(result.Results[0]).answer, nil
}

func (r *roomSession) describe(ctx context.Context, call *callContext, query json.RawMessage) (json.RawMessage, error) {
	return r.server.answerOf(ctx, "mcpDescribe", map[string]any{
		"mcp": r.server.mcpFlags("live", r.write), "document": emptyDocument, "actor": call.actor, "query": query,
	})
}

// writes is Node's isWriteBatch: a known command whose readOnly is false.
func (r *roomSession) writes(batch json.RawMessage) bool {
	var envelope struct {
		Commands []struct {
			Name string `json:"name"`
		} `json:"commands"`
	}
	_ = json.Unmarshal(batch, &envelope)
	for _, command := range envelope.Commands {
		if readOnly, known := r.readOnly[command.Name]; known && !readOnly {
			return true
		}
	}
	return false
}

func (r *roomSession) execute(ctx context.Context, call *callContext, batch json.RawMessage) (*executed, error) {
	r.mu.Lock()
	readOnly := !r.write || r.latched
	r.mu.Unlock()
	writing := r.writes(batch)
	if writing && readOnly {
		answer, err := r.server.executeAnswer(ctx, map[string]any{
			"result": json.RawMessage(`{"ok":false,"warnings":[]}`),
			"failed": map[string]any{"helper": "surface", "error": map[string]string{"code": "READ_ONLY", "message": "This handle cannot write to the room."}},
		})
		return &executed{answer: answer}, err
	}
	written, result, err := r.run(ctx, call, batch)
	if err != nil {
		return nil, err
	}
	input := map[string]any{"result": json.RawMessage(written)}
	if !result.OK {
		var failure struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(result.Error, &failure) == nil && failure.Code == "APPLY_FAILED" {
			r.mu.Lock()
			r.latched = true
			r.mu.Unlock()
		}
	} else if writing {
		// The room lane applied and journaled the batch before answering.
		var sequence any
		if _, after, found := strings.Cut(result.Revision, ":"); found {
			if number, parseErr := strconv.ParseUint(after, 10, 64); parseErr == nil {
				sequence = number
			}
		}
		input["delivery"] = map[string]any{"durable": true, "pending": false, "serverSequence": sequence, "savedVersion": nil}
	}
	answer, err := r.server.executeAnswer(ctx, input)
	return &executed{answer: answer}, err
}

func (r *roomSession) close() (int, bool) { return 0, false }
