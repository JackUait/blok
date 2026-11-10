package room

import (
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// SignalBlock is CollabSignalBlock: one block, added, removed, changed or
// moved over the window.
type SignalBlock struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

// SignalProperties is CollabSignalProperties: the property ids that changed
// on one database row.
type SignalProperties struct {
	RowID string   `json:"rowId"`
	IDs   []string `json:"ids"`
}

// SignalSchema is CollabSignalSchema: one schema entry of one database,
// created, updated or deleted over the window.
type SignalSchema struct {
	DatabaseID string  `json:"databaseId"`
	ID         string  `json:"id"`
	Name       *string `json:"name"`
	Action     string  `json:"action"`
}

// SignalAuthor is CollabSignalAuthor. Kind is nil when no note was written.
type SignalAuthor struct {
	ID   string  `json:"id"`
	Kind *string `json:"kind"`
}

// ChangeSignal is CollabChangeSignal: what changed in one document during
// one window, by id only. Signals can be lost; a host that must not miss a
// change reconciles through /history/changes and olderEnd.
type ChangeSignal struct {
	DocID, Lineage           string
	FromSequence, ToSequence uint64
	WindowStart, WindowEnd   time.Time
	Blocks                   []SignalBlock
	Page                     []string
	Properties               []SignalProperties
	Schema                   []SignalSchema
	Authors                  []SignalAuthor
}

// SignalRecord is one journal record as the change signals read it.
type SignalRecord struct {
	Lineage     string
	Sequence    uint64
	CommittedAt time.Time
	Actor       *string
	Note        *RecordNote
	Blocks      []SignalBlock
	Page        []string
	Properties  []SignalProperties
	Schema      []SignalSchema
}

const (
	signalAdded   = "added"
	signalRemoved = "removed"
	signalChanged = "changed"
	signalMoved   = "moved"
)

// FoldSignals is CollabChangeSignals.Fold: records in commit order, split
// into windows that start at their first record and hold each next record
// on the same lineage committed before the window ends, each collapsed.
func FoldSignals(docID string, records []SignalRecord, window time.Duration) []ChangeSignal {
	signals := []ChangeSignal{}
	start := 0
	for r := 1; r <= len(records); r++ {
		if r < len(records) && records[r].Lineage == records[start].Lineage &&
			records[r].CommittedAt.Before(records[start].CommittedAt.Add(window)) {
			continue
		}
		at := records[start].CommittedAt
		if signal := CollapseSignal(docID, at, at.Add(window), records[start:r]); signal != nil {
			signals = append(signals, *signal)
		}
		start = r
	}
	return signals
}

type schemaKey struct{ database, id string }

// CollapseSignal is CollabChangeSignals.Collapse: one window's records,
// oldest first, as one signal; nil when nothing is left. A block added and
// removed in the window is gone, with its properties and schema entries.
func CollapseSignal(docID string, windowStart, windowEnd time.Time, records []SignalRecord) *ChangeSignal {
	if len(records) == 0 {
		return nil
	}
	var blockOrder, page, rowOrder, authorOrder []string
	blocks := map[string]*string{}
	rows := map[string][]string{}
	var schemaOrder []schemaKey
	schema := map[schemaKey]*SignalSchema{}
	kinds := map[string]*string{}

	for _, record := range records {
		for _, block := range record.Blocks {
			seen, ok := blocks[block.ID]
			if !ok {
				blockOrder = append(blockOrder, block.ID)
			}
			kind := block.Kind
			if seen == nil {
				blocks[block.ID] = &kind
			} else {
				blocks[block.ID] = combineSignalKind(*seen, kind)
			}
		}
		for _, key := range record.Page {
			if !containsString(page, key) {
				page = append(page, key)
			}
		}
		for _, row := range record.Properties {
			ids, ok := rows[row.RowID]
			if !ok {
				rowOrder = append(rowOrder, row.RowID)
				ids = []string{}
			}
			for _, id := range row.IDs {
				if !containsString(ids, id) {
					ids = append(ids, id)
				}
			}
			rows[row.RowID] = ids
		}
		for _, entry := range record.Schema {
			key := schemaKey{entry.DatabaseID, entry.ID}
			seen, ok := schema[key]
			if !ok {
				schemaOrder = append(schemaOrder, key)
			}
			if seen == nil {
				copied := entry
				schema[key] = &copied
			} else {
				schema[key] = combineSignalSchema(*seen, entry)
			}
		}
		visible := len(record.Blocks) > 0 || len(record.Page) > 0 || len(record.Properties) > 0 || len(record.Schema) > 0
		if visible && record.Actor != nil {
			actor := *record.Actor
			if _, ok := kinds[actor]; !ok {
				authorOrder = append(authorOrder, actor)
				kinds[actor] = nil
			}
			// The actor's first note, as the version list reads it.
			if kinds[actor] == nil && record.Note != nil {
				kind := record.Note.Kind
				kinds[actor] = &kind
			}
		}
	}

	gone := func(id string) bool {
		kind, ok := blocks[id]
		return ok && kind == nil
	}
	signal := ChangeSignal{
		DocID: docID, Lineage: records[0].Lineage,
		FromSequence: records[0].Sequence, ToSequence: records[len(records)-1].Sequence,
		WindowStart: windowStart, WindowEnd: windowEnd,
		Blocks: []SignalBlock{}, Page: append([]string{}, page...), Properties: []SignalProperties{},
		Schema: []SignalSchema{}, Authors: []SignalAuthor{},
	}
	for _, id := range blockOrder {
		if kind := blocks[id]; kind != nil {
			signal.Blocks = append(signal.Blocks, SignalBlock{ID: id, Kind: *kind})
		}
	}
	for _, id := range rowOrder {
		if !gone(id) && len(rows[id]) > 0 {
			signal.Properties = append(signal.Properties, SignalProperties{RowID: id, IDs: rows[id]})
		}
	}
	for _, key := range schemaOrder {
		if entry := schema[key]; entry != nil && !gone(key.database) {
			signal.Schema = append(signal.Schema, *entry)
		}
	}
	for _, id := range authorOrder {
		signal.Authors = append(signal.Authors, SignalAuthor{ID: id, Kind: kinds[id]})
	}
	if len(signal.Blocks) == 0 && len(signal.Page) == 0 && len(signal.Properties) == 0 && len(signal.Schema) == 0 {
		return nil
	}
	return &signal
}

// combineSignalKind is a block over two changes; nil when added then removed.
func combineSignalKind(older, newer string) *string {
	kind := signalChanged
	switch {
	case older == signalAdded && newer == signalRemoved:
		return nil
	case older == signalAdded:
		kind = signalAdded
	case newer == signalRemoved:
		kind = signalRemoved
	case older == signalMoved && newer == signalMoved:
		kind = signalMoved
	}
	return &kind
}

func combineSignalSchema(older, newer SignalSchema) *SignalSchema {
	action := "updated"
	switch {
	case older.Action == "created" && newer.Action == "deleted":
		return nil
	case older.Action == "created":
		action = "created"
	case newer.Action == "deleted":
		action = "deleted"
	}
	combined := newer
	if combined.Name == nil {
		combined.Name = older.Name
	}
	combined.Action = action
	return &combined
}

func containsString(list []string, value string) bool {
	for _, have := range list {
		if have == value {
			return true
		}
	}
	return false
}

// signalRecordOf is CollabChangeSignals.FromChanges: one record of a changes
// read, ids only.
func signalRecordOf(lineage string, record RecordChanges, note *RecordNote) SignalRecord {
	out := SignalRecord{
		Lineage: lineage, Sequence: record.Sequence, CommittedAt: record.CommittedAt, Actor: record.ActorID,
		Note: note, Page: record.Page,
	}
	for _, block := range record.Blocks {
		id := block.ID.String()
		out.Blocks = append(out.Blocks, SignalBlock{ID: id, Kind: blockChangeKindName(block.Kind)})
		if block.Kind != BlockChanged {
			continue
		}
		fields := DescribeDatabaseChange(block.Type, block.Before, block.After)
		if properties, ok := fields.Get(jsjson.FromString("properties")); ok {
			row := SignalProperties{RowID: id}
			for _, entry := range properties.([]any) {
				row.IDs = append(row.IDs, entryText(entry.(*jsjson.Object), "id"))
			}
			out.Properties = append(out.Properties, row)
		}
		if entries, ok := fields.Get(jsjson.FromString("schema")); ok {
			for _, item := range entries.([]any) {
				entry := item.(*jsjson.Object)
				schema := SignalSchema{DatabaseID: id, ID: entryText(entry, "id"), Action: entryText(entry, "action")}
				if _, named := entry.Get(jsjson.FromString("name")); named {
					name := entryText(entry, "name")
					schema.Name = &name
				}
				out.Schema = append(out.Schema, schema)
			}
		}
	}
	return out
}

func entryText(object *jsjson.Object, key string) string {
	value, _ := object.Get(jsjson.FromString(key))
	text, _ := value.(jsjson.Str)
	return text.String()
}

func blockChangeKindName(kind BlockChangeKind) string {
	switch kind {
	case BlockAdded:
		return signalAdded
	case BlockRemoved:
		return signalRemoved
	case BlockMoved:
		return signalMoved
	}
	return signalChanged
}
