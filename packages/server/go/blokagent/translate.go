package blokagent

import (
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/collab/convert"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// translate is C# RoomEditTranslator.Translate: the planner's edits as room
// ops. after is the document the bundle returned, result its AgentResult.
func translate(edits, after, result *jsjson.Node) ([]convert.EditOp, error) {
	blocks := map[string]*jsjson.Node{}
	listed, err := field(after, "blocks")
	if err != nil {
		return nil, err
	}
	if listed != nil && listed.Kind == jsjson.KindArray {
		for _, block := range listed.Items {
			if block.Kind != jsjson.KindObject {
				continue
			}
			id, ok, err := stringField(block, "id")
			if err != nil {
				return nil, err
			}
			if ok {
				blocks[id] = block
			}
		}
	}

	// Data edits collapse into one Update at the last one, carrying the
	// final data: the room replaces data wholesale, so a patch alone would
	// lose keys.
	lastDataEdit := map[string]int{}
	for i, edit := range edits.Items {
		op, _, err := stringField(edit, "op")
		if err != nil {
			return nil, err
		}
		if op != "setData" && op != "setRichText" {
			continue
		}
		id, ok, err := stringField(edit, "id")
		if err != nil {
			return nil, err
		}
		if ok {
			lastDataEdit[id] = i
		}
	}

	var ops []convert.EditOp
	for i, edit := range edits.Items {
		if edit.Kind != jsjson.KindObject {
			return nil, invalidData("An agent edit is not an object.")
		}
		id, hasID, err := stringField(edit, "id")
		if err != nil {
			return nil, err
		}
		op, _, err := stringField(edit, "op")
		if err != nil {
			return nil, err
		}
		switch {
		case op == "insert":
			planned, err := objectField(edit, "block")
			if err != nil {
				return nil, err
			}
			parent, err := optionalString(edit, "parentId")
			if err != nil {
				return nil, err
			}
			afterID, err := optionalString(edit, "afterId")
			if err != nil {
				return nil, err
			}
			if ops, err = insertTree(planned, parent, afterID, blocks, ops); err != nil {
				return nil, err
			}
		case op == "remove" && hasID:
			// The bundle lifts the children into the slot; Remove alone
			// takes the subtree.
			withChildren, err := get(edit, "withChildren")
			if err != nil {
				return nil, err
			}
			if withChildren == nil || withChildren.Kind != jsjson.KindTrue {
				ops = append(ops, convert.Lift{ID: id})
			}
			ops = append(ops, convert.Remove{ID: id})
		case op == "move" && hasID:
			afterID, err := optionalString(edit, "afterId")
			if err != nil {
				return nil, err
			}
			parent, err := optionalString(edit, "parentId")
			if err != nil {
				return nil, err
			}
			ops = append(ops, convert.Move{ID: id, After: afterID, Parent: parent})
		case (op == "setData" || op == "setRichText") && hasID && lastDataEdit[id] == i && blocks[id] != nil:
			data, err := objectField(blocks[id], "data")
			if err != nil {
				return nil, err
			}
			ops = append(ops, convert.Update{ID: id, Data: data.Clone()})
		case op == "setTunes" && hasID && blocks[id] != nil:
			named, err := objectField(edit, "tunes")
			if err != nil {
				return nil, err
			}
			current, err := field(blocks[id], "tunes")
			if err != nil {
				return nil, err
			}
			// The final value of each tune the edit named; null where the
			// batch removed it.
			tunes := jsjson.NewObject()
			for _, m := range named.Members {
				key, err := m.Key()
				if err != nil {
					return nil, fromJSON(err)
				}
				value, err := field(current, key.String())
				if err != nil {
					return nil, err
				}
				if value == nil {
					value = jsjson.NewNull()
				} else {
					value = value.Clone()
				}
				if err := tunes.Set(key.String(), value); err != nil {
					return nil, fromJSON(err)
				}
			}
			ops = append(ops, convert.SetTunes{ID: id, Tunes: tunes})
		case op == "replaceType" && hasID && blocks[id] != nil:
			kind, ok, err := stringField(blocks[id], "type")
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, invalidData(`Block "` + id + `" has no type.`)
			}
			data, err := objectField(blocks[id], "data")
			if err != nil {
				return nil, err
			}
			ops = append(ops, convert.Retype{ID: id, Type: kind, Data: data.Clone()})
		case op == "setPageField":
			key, ok, err := stringField(edit, "key")
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, invalidData("A page field edit has no key.")
			}
			value, err := get(edit, "value")
			if err != nil {
				return nil, err
			}
			if value != nil {
				value = value.Clone()
			}
			ops = append(ops, convert.SetPageField{Key: key, Value: value})
		}
	}

	// Every block the bundle stamped: created, updated, moved and lifted.
	changed, err := field(result, "changed")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, kind := range []string{"created", "updated", "moved"} {
		list, err := field(changed, kind)
		if err != nil {
			return nil, err
		}
		if list == nil || list.Kind != jsjson.KindArray {
			continue
		}
		for _, item := range list.Items {
			stamped, ok, err := stringOrNot(item)
			if err != nil {
				return nil, err
			}
			if !ok || seen[stamped] {
				continue
			}
			seen[stamped] = true
			block := blocks[stamped]
			if block == nil {
				continue
			}
			by, ok, err := stringField(block, "lastEditedBy")
			if err != nil || !ok {
				if err != nil {
					return nil, err
				}
				continue
			}
			at, err := get(block, "lastEditedAt")
			if err != nil {
				return nil, err
			}
			if at == nil || at.Kind != jsjson.KindNumber {
				continue
			}
			time, err := strconv.ParseFloat(string(at.Raw()), 64)
			if err != nil {
				return nil, &InvalidOperationError{Message: "The JSON value is either too large or too small for a Double."}
			}
			with, err := optionalString(block, "lastEditedWith")
			if err != nil {
				return nil, err
			}
			ops = append(ops, convert.SetMetadata{ID: stamped, LastEditedAt: time, LastEditedBy: by, LastEditedWith: with})
		}
	}
	return ops, nil
}

func insertTree(planned *jsjson.Node, parent, after *string, blocks map[string]*jsjson.Node, ops []convert.EditOp) ([]convert.EditOp, error) {
	id, ok, err := stringField(planned, "id")
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, invalidData("A planned block has no id.")
	}
	kind, err := get(planned, "type")
	if err != nil {
		return nil, err
	}
	if kind == nil {
		kind = jsjson.NewNull()
	}
	data, err := objectField(planned, "data")
	if err != nil {
		return nil, err
	}
	block := jsjson.NewObject(member("type", kind.Clone()), member("data", data.Clone()))
	if tunes, err := get(planned, "tunes"); err != nil {
		return nil, err
	} else if tunes != nil && tunes.Kind == jsjson.KindObject {
		block.Members = append(block.Members, member("tunes", tunes.Clone()))
	}

	// The creation stamp the bundle wrote, so the room saves the same
	// metadata. createdWith only travels with createdBy.
	if drafted := blocks[id]; drafted != nil {
		createdAt, err := get(drafted, "createdAt")
		if err != nil {
			return nil, err
		}
		if createdAt != nil && createdAt.Kind == jsjson.KindNumber {
			block.Members = append(block.Members, member("createdAt", createdAt.Clone()))
		}
		createdBy, ok, err := stringField(drafted, "createdBy")
		if err != nil {
			return nil, err
		}
		if ok {
			block.Members = append(block.Members, member("createdBy", str(createdBy)))
			createdWith, ok, err := stringField(drafted, "createdWith")
			if err != nil {
				return nil, err
			}
			if ok {
				block.Members = append(block.Members, member("createdWith", str(createdWith)))
			}
		}
	}
	ops = append(ops, convert.Insert{ID: id, Block: block, After: after, Parent: parent})

	children, err := get(planned, "children")
	if err != nil {
		return nil, err
	}
	if children == nil || children.Kind != jsjson.KindArray {
		return ops, nil
	}
	var previous *string
	for _, child := range children.Items {
		if child.Kind != jsjson.KindObject {
			return nil, invalidData("An agent edit field is not an object.")
		}
		if ops, err = insertTree(child, &id, previous, blocks, ops); err != nil {
			return nil, err
		}
		if previous, err = optionalString(child, "id"); err != nil {
			return nil, err
		}
	}
	return ops, nil
}

// stringOrNot is the translator's Text: a string's value, or false for any
// other kind.
func stringOrNot(node *jsjson.Node) (string, bool, error) { return text(node) }

// stringField is Text(node[key]); like the JsonObject indexer it fails on
// a node that is not an object.
func stringField(node *jsjson.Node, key string) (string, bool, error) {
	found, err := field(node, key)
	if err != nil {
		return "", false, err
	}
	return text(found)
}

func optionalString(node *jsjson.Node, key string) (*string, error) {
	value, ok, err := stringField(node, key)
	if err != nil || !ok {
		return nil, err
	}
	return &value, nil
}

// objectField is the translator's Object(node[key]).
func objectField(node *jsjson.Node, key string) (*jsjson.Node, error) {
	found, err := field(node, key)
	if err != nil {
		return nil, err
	}
	if found == nil || found.Kind != jsjson.KindObject {
		return nil, invalidData("An agent edit field is not an object.")
	}
	return found, nil
}
