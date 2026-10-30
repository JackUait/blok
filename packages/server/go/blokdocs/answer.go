package blokdocs

import (
	"errors"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Reading the runtime's answers the way System.Text.Json's JsonSerializer
// reads them into the C# records: case-sensitive names, unknown members
// ignored, missing ones left zero, a wrong type or a lone-surrogate string
// refused as JSON.

var errShape = errors.New("blokdocs: answer member has the wrong JSON type")

func parseAnswer(output string) (*jsjson.Node, error) {
	node, err := jsjson.ParseNode([]byte(output), jsjson.Options{})
	if err != nil {
		return nil, notJSON(err)
	}
	return node, nil
}

func member(object *jsjson.Node, name string) *jsjson.Node {
	var found *jsjson.Node
	for _, m := range object.Members {
		key, err := m.Key()
		if err == nil && key.String() == name {
			found = m.Value
		}
	}
	return found
}

func readString(node *jsjson.Node) (string, error) {
	switch {
	case node == nil || node.Kind == jsjson.KindNull:
		return "", nil
	case node.Kind != jsjson.KindString:
		return "", notJSON(errShape)
	}
	text, err := node.Text()
	if err != nil {
		return "", notJSON(err)
	}
	return text.String(), nil
}

func readOptionalString(node *jsjson.Node) (*string, error) {
	if node == nil || node.Kind == jsjson.KindNull {
		return nil, nil
	}
	text, err := readString(node)
	return &text, err
}

func readInt(node *jsjson.Node) (int, error) {
	if node == nil {
		return 0, nil
	}
	if node.Kind != jsjson.KindNumber {
		return 0, notJSON(errShape)
	}
	value, err := strconv.ParseInt(string(node.Raw()), 10, 32)
	if err != nil {
		return 0, notJSON(err)
	}
	return int(value), nil
}

func readBool(node *jsjson.Node) (bool, error) {
	switch {
	case node == nil:
		return false, nil
	case node.Kind == jsjson.KindTrue:
		return true, nil
	case node.Kind == jsjson.KindFalse:
		return false, nil
	}
	return false, notJSON(errShape)
}

// readArray calls item for each element. A JSON null array reads as nil.
func readArray(node *jsjson.Node, item func(*jsjson.Node) error) (bool, error) {
	if node == nil || node.Kind == jsjson.KindNull {
		return false, nil
	}
	if node.Kind != jsjson.KindArray {
		return false, notJSON(errShape)
	}
	for _, element := range node.Items {
		if err := item(element); err != nil {
			return true, err
		}
	}
	return true, nil
}

func readStrings(node *jsjson.Node) ([]string, error) {
	var out []string
	present, err := readArray(node, func(element *jsjson.Node) error {
		text, err := readString(element)
		out = append(out, text)
		return err
	})
	if present && out == nil {
		out = []string{}
	}
	return out, err
}

// readObject is nil for JSON null, as Deserialize returns null.
func readObject(node *jsjson.Node) (*jsjson.Node, error) {
	switch {
	case node == nil || node.Kind == jsjson.KindNull:
		return nil, nil
	case node.Kind != jsjson.KindObject:
		return nil, notJSON(errShape)
	}
	return node, nil
}

func readDegradations(node *jsjson.Node) ([]Degradation, error) {
	var out []Degradation
	present, err := readArray(node, func(element *jsjson.Node) error {
		object, err := readObject(element)
		if err != nil || object == nil {
			out = append(out, Degradation{})
			return err
		}
		var d Degradation
		if d.Construct, err = readString(member(object, "construct")); err != nil {
			return err
		}
		if d.Action, err = readString(member(object, "action")); err != nil {
			return err
		}
		if d.Detail, err = readString(member(object, "detail")); err != nil {
			return err
		}
		out = append(out, d)
		return nil
	})
	if present && out == nil {
		out = []Degradation{}
	}
	return out, err
}

// readReport reads {<textKey>, warnings}. ok is false for a JSON null answer.
func readReport(output, textKey string) (text string, warnings []Degradation, ok bool, err error) {
	node, err := parseAnswer(output)
	if err != nil {
		return "", nil, false, err
	}
	object, err := readObject(node)
	if err != nil || object == nil {
		return "", nil, false, err
	}
	if text, err = readString(member(object, textKey)); err != nil {
		return "", nil, false, err
	}
	if warnings, err = readDegradations(member(object, "warnings")); err != nil {
		return "", nil, false, err
	}
	return text, warnings, true, nil
}
