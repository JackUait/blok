package blokserver

import (
	"context"
	"log/slog"
	"slices"
	"sync"
	"time"

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
	return s.options.CollabEnabled && (s.options.CollabJournal || s.conformanceJournal)
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
		HTML:   convert.RuntimeHTMLReader{Runtime: &lazyRuntime{}},
		Fields: fields,
		Log:    s.collabLog,
	}

	roomOptions := room.Options{AnnouncedMaxMessageBytes: int64(o.CollabMaxMessageBytes)}
	var operations room.OperationStore
	if s.hasJournal() {
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

// lazyRuntime builds the engine pool on the first HTML read: C# registers
// the runtime but does not warm it for a collaboration host.
type lazyRuntime struct {
	once sync.Once
	pool *jsruntime.Pool
	err  error
}

func (l *lazyRuntime) Invoke(ctx context.Context, op, input string, timeout time.Duration) (string, error) {
	l.once.Do(func() { l.pool, l.err = jsruntime.NewPool(jsruntime.Options{}) })
	if l.err != nil {
		return "", l.err
	}
	return l.pool.Invoke(ctx, op, input, timeout)
}
