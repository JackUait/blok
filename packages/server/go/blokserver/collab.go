package blokserver

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/JackUait/blok/packages/server/go/blokagent"
	"github.com/JackUait/blok/packages/server/go/blokdocs"
	"github.com/JackUait/blok/packages/server/go/internal/blob"
	"github.com/JackUait/blok/packages/server/go/internal/collab"
	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/collab/docendpoint"
	"github.com/JackUait/blok/packages/server/go/internal/collab/journal"
	"github.com/JackUait/blok/packages/server/go/internal/collab/room"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsruntime"
)

// CollabLogCategory is the category every room warning carries, as C#'s
// ILogger category. A host filters on it.
const CollabLogCategory = "Blok.Server.Collab"

// docEndpointRequestTimeout is DocEndpointRequestTimeout: 30 s per request.
const docEndpointRequestTimeout = 30 * time.Second

// collabRooms builds the room manager on first use, as C# resolves its
// singletons: a host that never opens a room never touches the directory.
type collabRooms struct {
	server  *Server
	once    sync.Once
	manager *room.Manager
	err     error
}

func (c *collabRooms) get() (*room.Manager, error) {
	c.once.Do(func() { c.manager, c.err = c.server.buildRoomManager() })
	return c.manager, c.err
}

func (c *collabRooms) Join(ctx context.Context, doc string, member collab.Member) (collab.JoinResult, error) {
	manager, err := c.get()
	if err != nil {
		return collab.JoinResult{}, err
	}
	return manager.Join(ctx, doc, member)
}

// hasJournal is CollabOperationStoreSource answering a store.
func (s *Server) hasJournal() bool {
	return s.options.CollabEnabled &&
		(s.options.CollabOperationStore != nil || s.options.CollabJournal || s.conformanceJournal)
}

func (s *Server) collabLog(message string) {
	if logger := s.options.Logger; logger != nil {
		logger.Warn(message, slog.String("category", CollabLogCategory))
	}
}

func (s *Server) corruptLog(doc string) {
	if logger := s.options.Logger; logger != nil {
		logger.Error(`collab: a stored version of "`+doc+`" could not be read`, slog.String("category", CollabLogCategory))
	}
}

func (s *Server) buildRoomManager() (*room.Manager, error) {
	o := &s.options
	var store room.WorkingSetStore
	if o.CollabS3Prefix != "" {
		objects, err := blob.NewS3(&blob.S3{
			Endpoint: o.S3Endpoint, Region: o.S3Region, Bucket: o.S3Bucket, AccessKey: o.S3AccessKey,
			SecretKey: o.S3SecretKey, PublicURL: o.S3BucketURL, Addressing: o.S3Addressing,
			MaxSpoolBytes: o.MaxUploadBytes, Now: s.clock,
		})
		if err != nil {
			return nil, err
		}
		s3, err := workingset.NewS3Store(objects, o.CollabS3Prefix, s.collabLog)
		if err != nil {
			return nil, err
		}
		store = s3
	} else {
		store = workingset.NewLocalStore(o.CollabDirectory, s.collabLog)
	}

	endpoint, _ := dotnet.ParseAbsoluteURI(o.DocEndpoint)
	client := docendpoint.New(docendpoint.Options{
		Endpoint:       endpoint,
		Authorization:  o.DocEndpointAuth,
		RequestTimeout: docEndpointRequestTimeout,
	}, nil)

	fields, err := convert.NewRichTextFields(richTextFieldEntries(o.RichTextFields))
	if err != nil {
		return nil, err
	}
	converter := &convert.DocConverter{
		Now:    func() time.Time { return s.clock() },
		HTML:   convert.RuntimeHTMLReader{Runtime: s.runtime},
		Fields: fields,
		Log:    s.collabLog,
	}

	roomOptions := room.Options{
		AnnouncedMaxMessageBytes: int64(o.CollabMaxMessageBytes),
		Now:                      func() time.Time { return s.clock() },
	}
	var operations room.OperationStore
	if o.CollabOperationStore != nil {
		// Only the built-in journal states its append limit.
		operations = o.CollabOperationStore
	} else if s.hasJournal() {
		// The built-in journal on its default limit, as C# constructs it.
		local, err := journal.NewStore(o.CollabDirectory, journal.StoreOptions{Log: s.collabLog})
		if err != nil {
			return nil, err
		}
		operations = room.LocalJournal{Store: local}
		roomOptions.MaxUpdateBytes = local.MaxUpdateBytes()
	}
	return room.NewManager(room.ManagerOptions{
		Store:      store,
		Endpoint:   client,
		Converter:  converter,
		Room:       roomOptions,
		Log:        s.collabLog,
		Operations: operations,
		Activity:   o.CollabActivityObserver,
	}), nil
}

// richTextFieldEntries orders the map by block type: a Go map has no input
// order to keep.
func richTextFieldEntries(fields map[string][]string) []convert.RichTextFieldEntry {
	types := make([]string, 0, len(fields))
	for kind := range fields {
		types = append(types, kind)
	}
	slices.Sort(types)
	entries := make([]convert.RichTextFieldEntry, 0, len(types))
	for _, kind := range types {
		entries = append(entries, convert.RichTextFieldEntry{Type: kind, Fields: fields[kind]})
	}
	return entries
}

// lazyRuntime builds the engine pool on its first use (an HTML read or an
// agent call): C# registers the runtime but does not warm it for a
// collaboration host.
type lazyRuntime struct {
	options jsruntime.Options
	once    sync.Once
	pool    *jsruntime.Pool
	err     error
}

// newCollabRuntime is a variable so a test can count the builds.
var newCollabRuntime = jsruntime.NewPool

func (l *lazyRuntime) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	l.once.Do(func() { l.pool, l.err = newCollabRuntime(l.options) })
	if l.err != nil {
		return "", l.err
	}
	return l.pool.Invoke(ctx, op, input, timeout)
}

// ErrCollabDisabled: a collab call on a server built without CollabEnabled.
var ErrCollabDisabled = errors.New("Collaboration is disabled.")

// ErrNoAuthorize: PurgeDocument needs its authorize callback.
var ErrNoAuthorize = errors.New("collab: document purge needs an authorize callback.")

// PurgeDocument's and RecheckAccess's refusals, matched with errors.Is.
// They stand in for C#'s exception types:
//   - ErrEmptyDocID and ErrNotSingleSegment: ArgumentException;
//   - ErrPurgeNotAuthorized: UnauthorizedAccessException;
//   - ErrPurgeUnsupported: NotSupportedException (a CollabOperationStore
//     that is not also a collabstore.PurgeStore).
var (
	ErrEmptyDocID         = room.ErrEmptyDocID
	ErrNotSingleSegment   = room.ErrNotSingleSegment
	ErrPurgeNotAuthorized = room.ErrPurgeNotAuthorized
	ErrPurgeUnsupported   = room.ErrPurgeUnsupported
)

// PurgeOutcome is CollabDocumentPurgeOutcome.
type PurgeOutcome int

const (
	// Purged: the document is gone, and its id is refused until the process
	// restarts.
	Purged PurgeOutcome = iota
	// PurgeOpenElsewhere: another live process holds the journal.
	PurgeOpenElsewhere
)

// RecheckAccess is ICollabRoomManager.RecheckAccessAsync: it rechecks every
// member of a loaded document against the Authorization hook and closes the
// ones that fail with 4403. It answers how many were closed.
func (s *Server) RecheckAccess(ctx context.Context, doc string) (int, error) {
	if s.collab == nil {
		return 0, ErrCollabDisabled
	}
	manager, err := s.collab.get()
	if err != nil {
		return 0, err
	}
	return manager.RecheckAccess(ctx, doc)
}

// PurgeDocument is ICollabDocumentPurger.PurgeDocumentAsync: authorize
// runs first; then open sockets close 4403 and the working set and journal
// are deleted.
func (s *Server) PurgeDocument(ctx context.Context, doc string, authorize func(context.Context) (bool, error)) (PurgeOutcome, error) {
	if s.collab == nil {
		return 0, ErrCollabDisabled
	}
	// C# checks the id before the callback.
	if doc == "" {
		return 0, ErrEmptyDocID
	}
	if authorize == nil {
		return 0, ErrNoAuthorize
	}
	manager, err := s.collab.get()
	if err != nil {
		return 0, err
	}
	outcome, err := manager.Purge(ctx, doc, authorize)
	if err != nil {
		return 0, err
	}
	if outcome == journal.PurgeOpenElsewhere {
		return PurgeOpenElsewhere, nil
	}
	return Purged, nil
}

// warnOpenSyncRoutes is the open-routes warning, under the host category:
// the standalone host prints only the room category, so it never shows it.
func (s *Server) warnOpenSyncRoutes(prefix string) {
	logger := s.options.Logger
	if logger == nil {
		return
	}
	history := []string{
		"GET " + prefix + "/sync/{doc}/history",
		"GET " + prefix + "/sync/{doc}/history/{lineage}/{sequence}",
		"DELETE " + prefix + "/sync/{doc}/history/{lineage}",
		"POST " + prefix + "/sync/{doc}/history/{lineage}/{sequence}/restore",
		"GET " + prefix + "/sync/{doc}/history/{lineage}/{sequence}/changes",
	}
	logger.Warn(`collab: no authorization hook is set and Auth is "none", so GET `+prefix+`/sync/{doc}, POST `+prefix+
		`/sync/{doc}/reset, POST `+prefix+`/sync/{doc}/edit, GET `+prefix+`/sync/{doc}/state and `+strings.Join(history, ", ")+
		` are open to anyone who can reach this app unless the host puts its own auth in front; set Options.Authorization or set Auth to "ticket"`,
		slog.String("category", "Blok.Server.AspNetCore"))
}

// DocumentConverter is the server's IBlokDocumentConverter: one converter
// over the engine pool AgentExecutor and the rooms use, as C# AddBlokServer
// registers it. Nothing is built until the first conversion.
func (s *Server) DocumentConverter() *blokdocs.Converter {
	s.documentsOnce.Do(func() { s.documents = blokdocs.NewOnRuntime(s.runtime) })
	return s.documents
}

// AgentExecutor is the server's IBlokAgentExecutor: one executor over the
// server's engine pool that edits its live rooms when collaboration is on,
// as C# AddBlokDocuments registers it. No route calls it; a host embedding
// the server does. Nothing is built until the first call.
func (s *Server) AgentExecutor() (*blokagent.Executor, error) {
	s.agentOnce.Do(func() {
		var rooms *blokagent.Rooms
		if s.collab != nil {
			manager, err := s.collab.get()
			if err != nil {
				s.agentErr = err
				return
			}
			rooms = blokagent.NewRooms(manager)
		}
		s.agent = blokagent.NewOnRuntime(s.runtime, rooms)
	})
	return s.agent, s.agentErr
}
