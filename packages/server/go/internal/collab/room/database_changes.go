package room

import "github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"

// DescribeDatabaseChange is CollabDatabaseChanges.Describe: the extra row
// fields for one changed block. properties for a database row, schema and
// views for a database; each is left out when empty. Keys and ids only, in
// document order; values compare as the changes diff does.
func DescribeDatabaseChange(typeName *jsjson.Str, before, after *jsjson.Object) *jsjson.Object {
	fields := &jsjson.Object{}
	if before == nil || after == nil || typeName == nil {
		return fields
	}
	switch typeName.String() {
	case "database-row":
		beforeProps, _ := dataMember(before, "properties").(*jsjson.Object)
		afterProps, _ := dataMember(after, "properties").(*jsjson.Object)
		if properties := propertyChanges(beforeProps, afterProps); len(properties) > 0 {
			fields.Set(jsjson.FromString("properties"), properties)
		}
	case "database":
		beforeSchema, _ := dataMember(before, "schema").([]any)
		afterSchema, _ := dataMember(after, "schema").([]any)
		beforeViews, _ := dataMember(before, "views").([]any)
		afterViews, _ := dataMember(after, "views").([]any)
		if schema := entryChanges(beforeSchema, afterSchema, true); len(schema) > 0 {
			fields.Set(jsjson.FromString("schema"), schema)
		}
		if views := entryChanges(beforeViews, afterViews, false); len(views) > 0 {
			fields.Set(jsjson.FromString("views"), views)
		}
	}
	return fields
}

func dataMember(block *jsjson.Object, key string) any {
	data, _ := block.Get(jsjson.FromString("data"))
	object, ok := data.(*jsjson.Object)
	if !ok {
		return nil
	}
	value, _ := object.Get(jsjson.FromString(key))
	return value
}

// propertyChanges: after's keys in order, then the keys only before had.
func propertyChanges(before, after *jsjson.Object) []any {
	var keys []jsjson.Str
	if after != nil {
		for _, m := range after.Members() {
			keys = append(keys, m.Key)
		}
	}
	if before != nil {
		for _, m := range before.Members() {
			if after == nil {
				keys = append(keys, m.Key)
			} else if _, ok := after.Get(m.Key); !ok {
				keys = append(keys, m.Key)
			}
		}
	}
	changes := []any{}
	for _, key := range keys {
		var old, now any
		had, has := false, false
		if before != nil {
			old, had = before.Get(key)
		}
		if after != nil {
			now, has = after.Get(key)
		}
		if had && has && sameData(old, now) {
			continue
		}
		entry := &jsjson.Object{}
		entry.Set(jsjson.FromString("id"), key)
		if had {
			entry.Set(jsjson.FromString("before"), old)
		}
		if has {
			entry.Set(jsjson.FromString("after"), now)
		}
		changes = append(changes, entry)
	}
	return changes
}

// MaxDatabaseEntries is the most schema or view entries one side may hold
// for a breakdown. Past it the list is left out, so one changes call stays
// cheap.
const MaxDatabaseEntries = 500

// byID: entries with a string id, the first of a repeated id kept, in order.
func byID(entries []any) ([]jsjson.Str, map[string]*jsjson.Object) {
	var order []jsjson.Str
	index := map[string]*jsjson.Object{}
	for _, item := range entries {
		entry, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		raw, _ := entry.Get(jsjson.FromString("id"))
		id, ok := raw.(jsjson.Str)
		if !ok {
			continue
		}
		key := string(utf16Key(id))
		if _, seen := index[key]; seen {
			continue
		}
		index[key] = entry
		order = append(order, id)
	}
	return order, index
}

func utf16Key(id jsjson.Str) []byte {
	b := make([]byte, 0, 2*len(id))
	for _, unit := range id {
		b = append(b, byte(unit>>8), byte(unit))
	}
	return b
}

// entryChanges: after's order, then the deleted ones. Empty when either
// side is past the cap.
func entryChanges(before, after []any, withName bool) []any {
	changes := []any{}
	if len(before) > MaxDatabaseEntries || len(after) > MaxDatabaseEntries {
		return changes
	}
	oldOrder, old := byID(before)
	nowOrder, now := byID(after)
	add := func(id jsjson.Str, named *jsjson.Object, action string) {
		entry := &jsjson.Object{}
		entry.Set(jsjson.FromString("id"), id)
		if withName {
			if name, ok := named.Get(jsjson.FromString("name")); ok {
				if text, ok := name.(jsjson.Str); ok {
					entry.Set(jsjson.FromString("name"), text)
				}
			}
		}
		entry.Set(jsjson.FromString("action"), jsjson.FromString(action))
		changes = append(changes, entry)
	}
	for _, id := range nowOrder {
		entry := now[string(utf16Key(id))]
		previous, had := old[string(utf16Key(id))]
		switch {
		case !had:
			add(id, entry, "created")
		case !sameData(previous, entry):
			add(id, entry, "updated")
		}
	}
	for _, id := range oldOrder {
		if _, has := now[string(utf16Key(id))]; !has {
			add(id, old[string(utf16Key(id))], "deleted")
		}
	}
	return changes
}
