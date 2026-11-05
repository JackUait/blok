// Package synchttp is GET /sync/{doc}: the handshake, the connection caps,
// the inbound budget and the socket member a room talks to. It ports
// Blok.Server.AspNetCore/Collab/Sync*.cs. The room itself is behind
// collab.Rooms.
package synchttp

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/auth"
	"github.com/JackUait/blok/packages/server/go/v2/internal/collab"
	"github.com/JackUait/blok/packages/server/go/v2/internal/route"
	"github.com/JackUait/blok/packages/server/go/v2/internal/ws"
)

// outboundQueueFactor: the backlog budget is this many inbound messages.
const outboundQueueFactor = 8

// rejectedCloseGrace: a rejected client has nothing left to say, so a flood
// of bad passes cannot park sockets on the server.
const rejectedCloseGrace = 250 * time.Millisecond

// Config is what the endpoint reads from the server's options and services.
type Config struct {
	Auth   string
	Secret string
	// OriginAllowed is BlokServerCors.IsAllowed over the allowed origins.
	OriginAllowed func(origin string) bool
	// RateLimit is the server's shared fixed-window limiter.
	RateLimit func(key string) bool
	// Clock is the ticket clock.
	Clock func() time.Time
	// Authorization nil means no hook.
	Authorization auth.Authorization
	Rooms         collab.Rooms
	// HasOperationStore lets the handshake select blok-sync.v2.
	HasOperationStore bool
	MaxMessageBytes   int
	// KeepAliveInterval 0 turns pings off; an unanswered ping aborts after 2x.
	KeepAliveInterval time.Duration
	Connections       *ConnectionTable
	Budget            BudgetOptions
	// BudgetClock nil means time.Now (monotonic).
	BudgetClock func() time.Time
}

// Endpoint serves GET /sync/{doc}.
type Endpoint struct{ config Config }

func NewEndpoint(config Config) *Endpoint {
	if config.BudgetClock == nil {
		config.BudgetClock = time.Now
	}
	return &Endpoint{config: config}
}

func (e *Endpoint) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	doc := r.PathValue("doc")
	switch result := e.negotiate(r, doc).(type) {
	case refused:
		refuse(w, result.status, result.body)
	case rejected:
		e.acceptThenClose(w, r, result)
	case accepted:
		e.serve(w, r, doc, result)
	case hookFailed:
		internalError(w)
	}
}

func refuse(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	route.StartStream(w, status)
	_, _ = w.Write([]byte(body))
}

// internalError is what the host answers when a handler throws.
func internalError(w http.ResponseWriter) {
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(http.StatusInternalServerError)
}

func (e *Endpoint) upgrade(w http.ResponseWriter, r *http.Request, subProtocol string) (*ws.Conn, error) {
	options := ws.Options{SubProtocol: subProtocol, KeepAliveInterval: e.config.KeepAliveInterval}
	if e.config.KeepAliveInterval > 0 {
		options.KeepAliveTimeout = 2 * e.config.KeepAliveInterval
	}
	conn, err := ws.Upgrade(w, r, options)
	if errors.Is(err, ws.ErrAcceptKey) || errors.Is(err, ws.ErrNotHijacked) {
		// Before the hijack: .NET throws building the accept key, and
		// Kestrel throws past its upgrade limit.
		internalError(w)
	}
	return conn, err
}

func (e *Endpoint) serve(w http.ResponseWriter, r *http.Request, doc string, a accepted) {
	// Held until the request ends; the per-principal lease is freed earlier,
	// before the close is answered.
	slot := e.config.Connections.TryEnter()
	if slot == nil {
		refuse(w, http.StatusServiceUnavailable, "too many connections on this server\n")
		return
	}
	defer slot.Release()

	var lease *Lease
	if a.principal != "" {
		if lease = e.config.Connections.TryReserve(doc, a.principal); lease == nil {
			refuse(w, http.StatusTooManyRequests, "too many connections\n")
			return
		}
	}
	defer lease.Release()

	var recheck func(context.Context) (bool, error)
	if hook := e.config.Authorization; hook != nil {
		// C# rechecks with the handshake's principal; here that is the
		// request's values, under the recheck's own cancellation.
		values := context.WithoutCancel(r.Context())
		recheck = func(ctx context.Context) (bool, error) {
			ctx = requestValues{Context: ctx, values: values}
			if ok, err := hook.CanReadDocument(ctx, a.user, doc); err != nil || !ok {
				return false, err
			}
			if !a.canWrite {
				return true, nil
			}
			return hook.CanWriteDocument(ctx, a.user, doc)
		}
	}
	member := NewSocketMember(MemberOptions{
		CanWrite:             a.canWrite,
		AcceptsControlFrames: a.subProtocol != "",
		MaxQueuedBytes:       outboundQueueFactor * int64(e.config.MaxMessageBytes),
		Inbound:              NewInboundBudget(e.config.Budget, e.config.BudgetClock),
		ActorID:              a.actor,
		ProtocolSource:       a.source,
		Recheck:              recheck,
	})

	// Join before the upgrade: a draining server can still answer 503, and
	// the room's first frames wait in the member's queue.
	join, err := e.config.Rooms.Join(r.Context(), doc, member)
	if err != nil {
		if r.Context().Err() == nil {
			internalError(w)
		}
		return
	}
	switch join.Status {
	case collab.JoinDraining:
		refuse(w, http.StatusServiceUnavailable, "shutting down\n")
		return
	case collab.JoinForbidden, collab.JoinPurged:
		refuse(w, http.StatusForbidden, "forbidden\n")
		return
	}

	conn, err := e.upgrade(w, r, a.subProtocol)
	if err != nil {
		if join.Membership != nil {
			join.Membership.Leave()
		}
		return
	}
	defer conn.Abort()
	if join.Status == collab.JoinSeedFailed || join.Status == collab.JoinUnavailable {
		member.RequestClose(CloseSeedFailed)
	}
	// A hijacked socket outlives the request's own deadline and context.
	member.Run(context.WithoutCancel(r.Context()), conn, join.Membership, e.config.MaxMessageBytes, lease)
}

func (e *Endpoint) acceptThenClose(w http.ResponseWriter, r *http.Request, result rejected) {
	conn, err := e.upgrade(w, r, result.subProtocol)
	if err != nil {
		return
	}
	defer conn.Abort()
	member := NewSocketMember(MemberOptions{CloseGrace: rejectedCloseGrace})
	member.RequestClose(result.close)
	member.Run(context.WithoutCancel(r.Context()), conn, nil, e.config.MaxMessageBytes, nil)
}

// requestValues is ctx with the upgrade request's values looked up first.
type requestValues struct {
	context.Context
	values context.Context
}

func (c requestValues) Value(key any) any {
	if value := c.values.Value(key); value != nil {
		return value
	}
	return c.Context.Value(key)
}
