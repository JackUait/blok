package blokagent

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// The Go reader of test/fixtures/agent-server-scenarios. The runner
// contract is written on the C# reader, AgentServerScenarioTests.cs.

const scenarioRoot = "test/fixtures/agent-server-scenarios"

var scenarioActor = func() Actor {
	person := "human-1"
	return Actor{ID: "agent-cs", Name: "Server agent", OnBehalfOf: &person}
}()

type scenarioHost struct {
	t        *testing.T
	scenario *jsjson.Node
	stored   map[string]string
	resolved []string
	saved    []string
	created  []string
}

func newScenarioHost(t *testing.T, scenario *jsjson.Node) *scenarioHost {
	h := &scenarioHost{t: t, scenario: scenario, stored: map[string]string{}, resolved: []string{}, created: []string{}}
	if pages := lookup(scenario, "pages"); pages != nil {
		for _, m := range pages.Members {
			key, _ := m.Key()
			if stored := lookup(m.Value, "stored"); stored != nil {
				h.stored[key.String()], _ = write(stored)
			}
		}
	}
	return h
}

func sameActor(t *testing.T, actor Actor) {
	t.Helper()
	if actor.ID != scenarioActor.ID || actor.Name != scenarioActor.Name || actor.OnBehalfOf == nil || *actor.OnBehalfOf != *scenarioActor.OnBehalfOf {
		t.Errorf("host got actor %+v", actor)
	}
}

func (h *scenarioHost) Resolve(_ context.Context, pageID string, actor Actor) (PageLocation, error) {
	sameActor(h.t, actor)
	h.resolved = append(h.resolved, pageID)
	if room, ok := stringOf(lookup(lookup(lookup(h.scenario, "pages"), pageID), "room")); ok {
		return RoomPage{DocID: room}, nil
	}
	if _, ok := h.stored[pageID]; !ok {
		return nil, nil
	}
	return StoredPage{
		Load: func(context.Context) (string, error) { return h.stored[pageID], nil },
		Save: func(_ context.Context, document string) error {
			h.stored[pageID] = document
			h.saved = append(h.saved, document)
			return nil
		},
	}, nil
}

type scenarioCreator struct{ *scenarioHost }

func (c scenarioCreator) Create(_ context.Context, actor Actor) (string, error) {
	sameActor(c.t, actor)
	at := len(c.created)
	pageID := "host-" + strconv.Itoa(at+1)
	if script := lookup(c.scenario, "create"); script != nil && at < len(script.Items) {
		pageID, _ = stringOf(script.Items[at])
	}
	if pageID != "" {
		c.created = append(c.created, pageID)
	}
	return pageID, nil
}

func scenarioOptions(t *testing.T, node *jsjson.Node, host *scenarioHost) *Options {
	if node == nil || node.Kind != jsjson.KindObject {
		return nil
	}
	options := &Options{}
	options.PageTitles = lookup(node, "pageTitles") != nil && lookup(node, "pageTitles").Kind == jsjson.KindTrue
	if tools, ok := stringOf(lookup(node, "customTools")); ok {
		options.CustomToolsJSON = &tools
	}
	if overrides, ok := stringOf(lookup(node, "overrides")); ok {
		options.OverridesJSON = &overrides
	}
	if comments := lookup(node, "builtInComments"); comments != nil {
		options.DisableBuiltInComments = comments.Kind == jsjson.KindFalse
	}
	switch target, _ := stringOf(lookup(node, "target")); target {
	case "":
	case "plain":
		options.PageTarget = host
	case "creator":
		options.PageTarget = scenarioCreator{host}
	default:
		t.Fatalf("unknown target %s", target)
	}
	return options
}

// pointer follows a JSON pointer; false when a step is missing.
func pointer(root *jsjson.Node, path string) (*jsjson.Node, bool) {
	found := root
	for _, part := range strings.Split(path, "/")[1:] {
		switch {
		case found != nil && found.Kind == jsjson.KindObject:
			next, err := found.Lookup(part)
			if err != nil || next == nil {
				return nil, false
			}
			found = next
		case found != nil && found.Kind == jsjson.KindArray:
			at, err := strconv.Atoi(part)
			if err != nil || at < 0 || at >= len(found.Items) {
				return nil, false
			}
			found = found.Items[at]
		default:
			return nil, false
		}
	}
	return found, true
}

func checkPointers(t *testing.T, where string, root, pointers *jsjson.Node) {
	t.Helper()
	if pointers == nil {
		return
	}
	for _, m := range pointers.Members {
		key, _ := m.Key()
		path := key.String()
		want := m.Value
		got, exists := pointer(root, path)
		switch {
		case lookup(want, "absent") != nil:
			if exists {
				t.Errorf("%s: %s should be absent, got %s", where, path, stable(t, got))
			}
		case lookup(want, "length") != nil:
			count, _ := strconv.Atoi(string(lookup(want, "length").Raw()))
			if !exists || got.Kind != jsjson.KindArray || len(got.Items) != count {
				t.Errorf("%s: %s length, got %v", where, path, got)
			}
		default:
			if !exists || !deepEquals(want, got) {
				t.Errorf("%s: %s = %v, want %s", where, path, got, stable(t, want))
			}
		}
	}
}

func checkContract(t *testing.T, where string, contract, expect *jsjson.Node) {
	t.Helper()
	for _, list := range []string{"commands", "blocks"} {
		wanted := lookup(expect, list)
		if wanted == nil {
			continue
		}
		entries := lookup(contract, "commands")
		if list == "blocks" {
			entries = lookup(lookup(contract, "manifest"), "blocks")
		}
		for _, m := range wanted.Members {
			key, _ := m.Key()
			name := key.String()
			var entry *jsjson.Node
			for _, candidate := range records(entries) {
				if value, _ := stringOf(lookup(candidate, "name")); value == name {
					entry = candidate
				}
			}
			if lookup(m.Value, "absent") != nil {
				if entry != nil {
					t.Errorf("%s: %s %s should be absent", where, list, name)
				}
				continue
			}
			if entry == nil {
				t.Errorf("%s: %s has no %s", where, list, name)
				continue
			}
			fields := jsjson.NewObject()
			for _, field := range m.Value.Members {
				fieldKey, _ := field.Key()
				fields.Members = append(fields.Members, jsjson.NewMember("/"+fieldKey.String(), field.Value))
			}
			checkPointers(t, where+" "+name, entry, fields)
		}
	}
}

func indexed(node *jsjson.Node, repeat int) *jsjson.Node {
	copied := node.Clone()
	var walk func(n *jsjson.Node)
	walk = func(n *jsjson.Node) {
		for _, item := range n.Items {
			walk(item)
		}
		for i, m := range n.Members {
			if value, ok := stringOf(m.Value); ok {
				n.Members[i].Value = str(strings.ReplaceAll(value, "{i}", strconv.Itoa(repeat)))
			} else {
				walk(m.Value)
			}
		}
	}
	walk(copied)
	return copied
}

func TestMatchesTheAgentServerScenarios(t *testing.T) {
	executor := sharedExecutor(t)
	entries, err := os.ReadDir(filepath.Join(repoRoot, scenarioRoot))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		if name, ok := strings.CutSuffix(entry.Name(), ".json"); ok {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	if len(names) == 0 {
		t.Fatal("no scenarios")
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			scenario := mustParse(t, readRepoFile(t, filepath.Join(scenarioRoot, name+".json")))
			host := newScenarioHost(t, scenario)
			options := scenarioOptions(t, lookup(scenario, "options"), host)
			seed, _ := write(lookup(scenario, "seed"))
			last := seed
			byStep := map[int]string{}
			sessions := map[string]*Session{}
			reference := func(ref string) string {
				switch {
				case ref == "@seed":
					return seed
				case ref == "@last":
					return last
				case strings.HasPrefix(ref, "@step:"):
					at, _ := strconv.Atoi(strings.TrimPrefix(ref, "@step:"))
					return byStep[at]
				}
				t.Fatalf("unknown document %s", ref)
				return ""
			}
			for index, step := range lookup(scenario, "steps").Items {
				run, _ := stringOf(lookup(step, "run"))
				expect := lookup(step, "expect")
				times := 1
				if node := lookup(step, "times"); node != nil {
					times, _ = strconv.Atoi(string(node.Raw()))
				}
				for repeat := range times {
					where := name + " step " + strconv.Itoa(index) + "#" + strconv.Itoa(repeat)
					if strings.HasPrefix(run, "contract:") {
						var contract string
						var err error
						switch run {
						case "contract:plain":
							contract, err = executor.Contract(ctx, options)
						case "contract:session":
							contract, err = executor.OpenSession(scenarioActor, options).Contract(ctx)
						case "contract:room":
							contract, err = executor.RoomContract(ctx, options)
						}
						if err != nil {
							t.Fatalf("%s: %v", where, err)
						}
						checkContract(t, where, mustParse(t, contract), expect)
						continue
					}

					spec := lookup(step, "document")
					var document string
					if ref, ok := stringOf(spec); ok {
						document = reference(ref)
					} else {
						base, _ := stringOf(lookup(spec, "from"))
						from := mustParse(t, reference(base))
						for _, m := range lookup(spec, "set").Members {
							key, _ := m.Key()
							parts := strings.Split(key.String(), "/")[1:]
							parent, _ := pointer(from, "/"+strings.Join(parts[:len(parts)-1], "/"))
							if len(parts) == 1 {
								parent = from
							}
							setMember(parent, parts[len(parts)-1], m.Value.Clone())
						}
						document, _ = write(from)
					}
					batch, _ := write(indexed(lookup(step, "batch"), repeat))
					var execution Execution
					var err error
					if run == "plain" {
						execution, err = executor.Execute(ctx, document, batch, scenarioActor, options)
					} else {
						session, ok := sessions[run]
						if !ok {
							session = executor.OpenSession(scenarioActor, options)
							sessions[run] = session
						}
						execution, err = session.Execute(ctx, document, batch)
					}
					if err != nil {
						t.Fatalf("%s: %v", where, err)
					}
					result := mustParse(t, execution.ResultJSON)
					if want := lookup(expect, "ok"); want != nil {
						if got, _ := isTrue(result, "ok"); got != (want.Kind == jsjson.KindTrue) {
							t.Fatalf("%s: ok\n%s", where, execution.ResultJSON)
						}
					}
					if want, ok := stringOf(lookup(expect, "code")); ok {
						if got, _ := stringOf(lookup(lookup(result, "error"), "code")); got != want {
							t.Fatalf("%s: code %s, want %s\n%s", where, got, want, execution.ResultJSON)
						}
					}
					if want := lookup(expect, "saved"); want != nil && (execution.DocumentJSON != nil) != (want.Kind == jsjson.KindTrue) {
						t.Fatalf("%s: saved\n%s", where, execution.ResultJSON)
					}
					if revision, _ := stringOf(lookup(result, "revision")); revision != execution.Revision {
						t.Errorf("%s: revision %q, result says %q", where, execution.Revision, revision)
					}
					checkPointers(t, where+" result", result, lookup(expect, "result"))
					if pointers := lookup(expect, "document"); pointers != nil {
						checkPointers(t, where+" document", mustParse(t, *execution.DocumentJSON), pointers)
					}
					if want := lookup(expect, "revisionEqualsRead"); want != nil && want.Kind == jsjson.KindTrue {
						read, err := executor.Execute(ctx, document, `{"commands":[{"name":"doc.read","args":{"detail":"outline"}}]}`, scenarioActor, nil)
						if err != nil || read.Revision != execution.Revision {
							t.Errorf("%s: revision %q, a read gives %q (%v)", where, execution.Revision, read.Revision, err)
						}
					}
					if execution.DocumentJSON != nil {
						last = *execution.DocumentJSON
						byStep[index] = last
					}
				}
			}

			expectHost := lookup(scenario, "host")
			for key, list := range map[string][]string{"resolved": host.resolved, "created": host.created} {
				if want := lookup(expectHost, key); want != nil {
					var names []string
					for _, item := range want.Items {
						value, _ := stringOf(item)
						names = append(names, value)
					}
					if !slices.Equal(names, list) && len(names)+len(list) > 0 {
						t.Errorf("%s: %s %v, want %v", name, key, list, names)
					}
				}
			}
			if saves := lookup(expectHost, "saved"); saves != nil {
				if len(saves.Items) != len(host.saved) {
					t.Fatalf("%s: %d saves, want %d", name, len(host.saved), len(saves.Items))
				}
				for i, want := range saves.Items {
					checkPointers(t, name+" save "+strconv.Itoa(i), mustParse(t, host.saved[i]), want)
				}
			}
		})
	}
}
