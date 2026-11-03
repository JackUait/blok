package blokagent

import (
	"errors"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// JSON the way the C# executor handles it: JsonNode.Parse with default
// options (depth 64, repeats kept), JsonObject indexers, ToJsonString.

func parse(text string) (*jsjson.Node, error) {
	node, err := jsjson.ParseNode([]byte(text), jsjson.Options{})
	if err != nil {
		return nil, fromJSON(err)
	}
	return node, nil
}

// present is a member C# reads as non-null: JSON null is null there.
func present(node *jsjson.Node) bool { return node != nil && node.Kind != jsjson.KindNull }

func get(node *jsjson.Node, key string) (*jsjson.Node, error) {
	found, err := node.Lookup(key)
	if err != nil {
		return nil, fromJSON(err)
	}
	if !present(found) {
		return nil, nil
	}
	return found, nil
}

// field is `node?[key]`. Unlike get, it fails on a node that is not an
// object, as the JsonObject indexer throws.
func field(node *jsjson.Node, key string) (*jsjson.Node, error) {
	if !present(node) {
		return nil, nil
	}
	if node.Kind != jsjson.KindObject {
		return nil, &InvalidOperationError{Message: "The node must be of type 'JsonObject'."}
	}
	return get(node, key)
}

// first is `node?[0]`: a list's first item, or an object's first member.
// Both throw when empty, and any other kind throws.
func first(node *jsjson.Node) (*jsjson.Node, error) {
	if !present(node) {
		return nil, nil
	}
	var item *jsjson.Node
	switch node.Kind {
	case jsjson.KindArray:
		if len(node.Items) == 0 {
			return nil, &ArgumentError{Param: "index", Message: "Index was out of range. Must be non-negative and less than the size of the collection."}
		}
		item = node.Items[0]
	case jsjson.KindObject:
		if len(node.Members) == 0 {
			return nil, &ArgumentError{Param: "index", Message: "Specified argument was out of the range of valid values."}
		}
		item = node.Members[0].Value
	default:
		return nil, &InvalidOperationError{Message: "The node must be of type 'JsonArray, JsonObject'."}
	}
	if !present(item) {
		return nil, nil
	}
	return item, nil
}

// object is `node[key] as JsonObject`.
func object(node *jsjson.Node, key string) (*jsjson.Node, error) {
	found, err := get(node, key)
	if err != nil || found == nil || found.Kind != jsjson.KindObject {
		return nil, err
	}
	return found, nil
}

func set(node *jsjson.Node, key string, value *jsjson.Node) error {
	return fromJSON(node.Set(key, value))
}

func write(node *jsjson.Node) (string, error) {
	out, err := node.AppendJSON(nil)
	if err != nil {
		return "", fromJSON(err)
	}
	return string(out), nil
}

// text is `TryGetValue<string>`: a string's value, or false. A lone
// surrogate escape throws there, as it does here.
func text(node *jsjson.Node) (string, bool, error) {
	if node == nil || node.Kind != jsjson.KindString {
		return "", false, nil
	}
	value, err := node.Text()
	if errors.Is(err, jsjson.ErrLoneSurrogate) {
		return "", false, fromJSON(err)
	}
	if err != nil {
		return "", false, nil
	}
	return value.String(), true, nil
}

// stringValue is `?.GetValue<string>()`: "" for null, an error for a non-string.
func stringValue(node *jsjson.Node) (string, error) {
	if !present(node) {
		return "", nil
	}
	value, ok, err := text(node)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", wrongType(node, "String")
	}
	return value, nil
}

// isTrue is `?["ok"]?.GetValue<bool>() == true`.
func isTrue(node *jsjson.Node, key string) (bool, error) {
	found, err := field(node, key)
	if err != nil || found == nil {
		return false, err
	}
	switch found.Kind {
	case jsjson.KindTrue:
		return true, nil
	case jsjson.KindFalse:
		return false, nil
	}
	return false, wrongType(found, "Boolean")
}

// intValue is `?.GetValue<int>() ?? 0`.
func intValue(node *jsjson.Node) (int, error) {
	if !present(node) {
		return 0, nil
	}
	if node.Kind == jsjson.KindNumber {
		if value, err := strconv.ParseInt(string(node.Raw()), 10, 32); err == nil {
			return int(value), nil
		}
	}
	return 0, wrongType(node, "Int32")
}

// wrongType is what GetValue<T> throws on a parsed node of another kind.
func wrongType(node *jsjson.Node, target string) error {
	kind := ""
	switch node.Kind {
	case jsjson.KindArray, jsjson.KindObject:
		return &InvalidOperationError{Message: "The node must be of type 'JsonValue'."}
	case jsjson.KindFalse:
		kind = "False"
	case jsjson.KindTrue:
		kind = "True"
	case jsjson.KindNumber:
		kind = "Number"
	case jsjson.KindString:
		kind = "String"
	}
	return &InvalidOperationError{Message: "An element of type '" + kind + "' cannot be converted to a 'System." + target + "'."}
}

func str(value string) *jsjson.Node { return jsjson.NewString(jsjson.FromString(value)) }

func member(key string, value *jsjson.Node) jsjson.NodeMember { return jsjson.NewMember(key, value) }

// common is C#'s Common: the option keys every operation sends, in order.
func common(options *Options) (*jsjson.Node, error) {
	if options == nil {
		options = &Options{}
	}
	services := jsjson.NewArray()
	if options.PageTitles && options.PageTarget != nil {
		services.Items = append(services.Items, str("pageBackend"))
	}
	input := jsjson.NewObject(member("services", services))
	// The bundle inserts a page only with ids made first (createdPages), so
	// it lists page as prepared.
	if _, creates := options.PageTarget.(PageCreator); options.PageTitles && creates {
		input.Members = append(input.Members, member("prepares", jsjson.NewArray(str("page"))))
	}
	if options.CustomToolsJSON != nil {
		tools, err := parse(*options.CustomToolsJSON)
		if err != nil {
			return nil, err
		}
		input.Members = append(input.Members, member("customTools", tools))
	}
	if options.OverridesJSON != nil {
		overrides, err := parse(*options.OverridesJSON)
		if err != nil {
			return nil, err
		}
		input.Members = append(input.Members, member("overrides", overrides))
	}
	if options.DisableBuiltInComments {
		input.Members = append(input.Members, member("comments", jsjson.NewBool(false)))
	}
	return input, nil
}

func actorNode(actor Actor) *jsjson.Node {
	node := jsjson.NewObject(member("id", str(actor.ID)), member("name", str(actor.Name)), member("kind", str("agent")))
	if actor.OnBehalfOf != nil {
		node.Members = append(node.Members, member("onBehalfOf", str(*actor.OnBehalfOf)))
	}
	return node
}

// failure is C#'s Failure: ok, error, warnings, then revision when not empty.
func failure(code, message string, retryable bool, details *jsjson.Node, revision string) (Execution, error) {
	errorNode := jsjson.NewObject(member("code", str(code)), member("message", str(message)), member("retryable", jsjson.NewBool(retryable)))
	if details != nil {
		errorNode.Members = append(errorNode.Members, member("details", details))
	}
	result := jsjson.NewObject(member("ok", jsjson.NewBool(false)), member("error", errorNode), member("warnings", jsjson.NewArray()))
	if revision != "" {
		result.Members = append(result.Members, member("revision", str(revision)))
	}
	written, err := write(result)
	return Execution{ResultJSON: written, Revision: revision}, err
}

// unavailable is C#'s Unavailable: ok, error, warnings, never a revision.
func unavailable(message string) (Execution, error) {
	return failure("COMMAND_UNAVAILABLE", message, false, jsjson.NewObject(member("reason", str("runtime"))), "")
}

// sourceExecution is C#'s SourceExecution: the result as written, no document.
func sourceExecution(result *jsjson.Node) (Execution, error) {
	written, err := write(result)
	if err != nil {
		return Execution{}, err
	}
	revision, err := revisionOf(result)
	return Execution{ResultJSON: written, Revision: revision}, err
}

func revisionOf(result *jsjson.Node) (string, error) {
	node, err := get(result, "revision")
	if err != nil {
		return "", err
	}
	return stringValue(node)
}
