package main

import (
	"context"
	"reflect"
	"testing"

	"github.com/JackUait/blok/packages/server/go/v2/blokmcp"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func identify(t *testing.T, hook func(context.Context, *mcp.CallToolRequest) (*blokmcp.CallerIdentity, error), token *auth.TokenInfo) *blokmcp.CallerIdentity {
	t.Helper()
	if hook == nil {
		t.Fatal("no caller hook")
	}
	who, err := hook(context.Background(), &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: token}})
	if err != nil {
		t.Fatal(err)
	}
	return who
}

// --example-caller-scopes gives the caller exactly those scopes; "" is
// none at all, and without the flag scopes stay nil (no checks).
func TestTheCallerScopesFlag(t *testing.T) {
	for _, test := range []struct {
		args   []string
		scopes []string
	}{
		{nil, nil},
		{[]string{"--example-caller-scopes", ""}, []string{}},
		{[]string{"--example-caller-scopes", "blok.read"}, []string{"blok.read"}},
		{[]string{"--example-caller-scopes", "blok.read,blok.write"}, []string{"blok.read", "blok.write"}},
	} {
		example, _, err := splitArgs(test.args)
		if err != nil {
			t.Fatal(err)
		}
		stdio := identify(t, callerHook(example, true), nil)
		if stdio.Principal != "local" || !reflect.DeepEqual(stdio.Scopes, test.scopes) || (stdio.Scopes == nil) != (test.scopes == nil) {
			t.Fatalf("%v stdio: %+v", test.args, stdio)
		}
		if test.args == nil {
			if callerHook(example, false) != nil {
				t.Fatal("over HTTP without the flag the default caller reads the token")
			}
			continue
		}
		http := callerHook(example, false)
		if who := identify(t, http, &auth.TokenInfo{UserID: "ana", Scopes: []string{"other"}}); who.Principal != "ana" || !reflect.DeepEqual(who.Scopes, test.scopes) || who.Scopes == nil {
			t.Fatalf("%v http: %+v", test.args, who)
		}
		if who := identify(t, http, nil); who != nil {
			t.Fatalf("%v anonymous: %+v", test.args, who)
		}
	}
}
