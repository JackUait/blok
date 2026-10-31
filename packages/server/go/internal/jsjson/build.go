package jsjson

import (
	"fmt"
	"slices"
)

// Building and editing nodes the way JsonObject and JsonArray do, for hosts
// that assemble JSON in C#'s key order.

// NewString is JsonValue.Create(string).
func NewString(s Str) *Node {
	quoted := AppendQuoted(nil, s)
	return &Node{Kind: KindString, raw: quoted[1 : len(quoted)-1]}
}

// NewBool is JsonValue.Create(bool).
func NewBool(value bool) *Node {
	if value {
		return &Node{Kind: KindTrue}
	}
	return &Node{Kind: KindFalse}
}

// NewNull is a JSON null, as a null member of a JsonObject writes.
func NewNull() *Node { return &Node{Kind: KindNull} }

// NewNumber is a number written as text, which must be a JSON number.
func NewNumber(text string) *Node { return &Node{Kind: KindNumber, raw: []byte(text)} }

// NewArray is a JsonArray of items.
func NewArray(items ...*Node) *Node {
	return &Node{Kind: KindArray, Items: append([]*Node{}, items...)}
}

// NewObject is a JsonObject with members in this order.
func NewObject(members ...NodeMember) *Node {
	return &Node{Kind: KindObject, Members: append([]NodeMember{}, members...)}
}

// NewMember is one object member.
func NewMember(key string, value *Node) NodeMember {
	quoted := AppendQuoted(nil, FromString(key))
	return NodeMember{raw: quoted[1 : len(quoted)-1], Value: value}
}

// Clone is DeepClone.
func (n *Node) Clone() *Node {
	if n == nil {
		return nil
	}
	copied := &Node{Kind: n.Kind, raw: slices.Clone(n.raw)}
	if n.Items != nil {
		copied.Items = make([]*Node, len(n.Items))
		for i, item := range n.Items {
			copied.Items[i] = item.Clone()
		}
	}
	if n.Members != nil {
		copied.Members = make([]NodeMember, len(n.Members))
		for i, member := range n.Members {
			copied.Members[i] = NodeMember{raw: slices.Clone(member.raw), Value: member.Value.Clone()}
		}
	}
	return copied
}

// index reads every key, as a JsonObject does the first time it is
// indexed: a lone-surrogate key or a repeated key fails the whole lookup.
// Invalid UTF-8 reads as U+FFFD, as it does in a .NET string.
func (n *Node) index(key string) (int, error) {
	seen := make(map[string]struct{}, len(n.Members))
	at := -1
	for i, member := range n.Members {
		name, err := decodeForWrite(member.raw)
		if err != nil {
			return -1, err
		}
		text := name.String()
		if _, dup := seen[text]; dup {
			return -1, fmt.Errorf("%w: An item with the same key has already been added. Key: %s", ErrDuplicate, text)
		}
		seen[text] = struct{}{}
		if text == key {
			at = i
		}
	}
	return at, nil
}

// Lookup is JsonNode?["key"] read as `as JsonObject`-guarded code reads it:
// nil when n is not an object or has no such member. A JSON null member is a
// KindNull node, so test for it where C# would see null.
func (n *Node) Lookup(key string) (*Node, error) {
	if n == nil || n.Kind != KindObject {
		return nil, nil
	}
	at, err := n.index(key)
	if err != nil || at < 0 {
		return nil, err
	}
	return n.Members[at].Value, nil
}

// Set is the JsonObject indexer setter: the value replaces the member in
// place, or is added at the end.
func (n *Node) Set(key string, value *Node) error {
	at, err := n.index(key)
	if err != nil {
		return err
	}
	if at >= 0 {
		n.Members[at].Value = value
		return nil
	}
	n.Members = append(n.Members, NewMember(key, value))
	return nil
}

// Remove drops the member named key and reports whether there was one.
func (n *Node) Remove(key string) bool {
	at, err := n.index(key)
	if err != nil || at < 0 {
		return false
	}
	n.Members = slices.Delete(n.Members, at, at+1)
	return true
}
