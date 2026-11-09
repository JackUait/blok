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

type idEntry struct {
	id    jsjson.Str
	entry *jsjson.Object
}

// byID: entries with a string id, the first of a repeated id kept.
func byID(entries []any) []idEntry {
	var list []idEntry
	for _, item := range entries {
		entry, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		raw, _ := entry.Get(jsjson.FromString("id"))
		id, ok := raw.(jsjson.Str)
		if !ok || findID(list, id) != nil {
			continue
		}
		list = append(list, idEntry{id, entry})
	}
	return list
}

func findID(list []idEntry, id jsjson.Str) *jsjson.Object {
	for _, item := range list {
		if jsjson.Compare(item.id, id) == 0 {
			return item.entry
		}
	}
	return nil
}

// entryChanges: after's order, then the deleted ones.
func entryChanges(before, after []any, withName bool) []any {
	old, now := byID(before), byID(after)
	changes := []any{}
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
	for _, item := range now {
		previous := findID(old, item.id)
		switch {
		case previous == nil:
			add(item.id, item.entry, "created")
		case !sameData(previous, item.entry):
			add(item.id, item.entry, "updated")
		}
	}
	for _, item := range old {
		if findID(now, item.id) == nil {
			add(item.id, item.entry, "deleted")
		}
	}
	return changes
}
