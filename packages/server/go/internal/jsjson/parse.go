package jsjson

import (
	"errors"
	"strconv"
)

// ParseMaxDepth is the depth C# validates JSON.parse input at
// (YContent.JsonLimits); a browser has no limit.
const ParseMaxDepth = 512

// Parse is JSON.parse as C# JsJson.Parse does it: refused past depth 512,
// every number a float64, a repeated key keeps its first place and last
// value, and an escaped lone surrogate stays one.
func Parse(data []byte) (any, error) {
	node, err := ParseNode(data, Options{MaxDepth: ParseMaxDepth})
	if err != nil {
		return nil, err
	}
	return node.js(), nil
}

func (n *Node) js() any {
	switch n.Kind {
	case KindNull:
		return nil
	case KindTrue:
		return true
	case KindFalse:
		return false
	case KindNumber:
		// Out of range reads as ±Infinity or 0, as in JS.
		number, err := strconv.ParseFloat(string(n.raw), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			panic("jsjson: validated number did not parse: " + string(n.raw))
		}
		return number
	case KindString:
		text, _ := decodeJS(n.raw)
		return text
	case KindArray:
		items := make([]any, len(n.Items))
		for i, item := range n.Items {
			items[i] = item.js()
		}
		return items
	}
	object := &Object{}
	for _, member := range n.Members {
		key, _ := decodeJS(member.raw)
		object.Set(key, member.Value.js())
	}
	return object
}
