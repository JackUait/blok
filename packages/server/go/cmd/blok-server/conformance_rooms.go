//go:build conformance

package main

import (
	"context"

	"github.com/JackUait/blok/packages/server/go/internal/collab"
)

// standInRooms admits every join and drops every frame. It lets the
// transport contract (sync-transport-contract) drive the real sync door,
// socket and budget before the room lane lands; replace it with the room
// manager then. It never ships: only -tags conformance builds it.
type standInRooms struct{}

func (standInRooms) Join(context.Context, string, collab.Member) (collab.JoinResult, error) {
	return collab.JoinResult{Status: collab.JoinJoined, Membership: standInMembership{}}, nil
}

type standInMembership struct{}

func (standInMembership) Receive(context.Context, []byte) error { return nil }
func (standInMembership) Leave()                                {}
