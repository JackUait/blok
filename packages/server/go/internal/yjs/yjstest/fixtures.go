// Package yjstest reads the shared yjs-engine fixtures under
// test/unit/server-conformance/fixtures/yjs-engine, the same files
// Blok.Server.Tests reads through YjsEngineFixtures.cs.
package yjstest

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"slices"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/lib0"
)

const fixtureRel = "test/unit/server-conformance/fixtures/yjs-engine"

// RepoRoot walks up from the working directory to the folder that holds
// test/unit/server-conformance. BLOK_REPO_ROOT overrides it.
func RepoRoot() (string, error) {
	if root := os.Getenv("BLOK_REPO_ROOT"); root != "" {
		return root, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for range 16 {
		if info, err := os.Stat(filepath.Join(dir, "test", "unit", "server-conformance")); err == nil && info.IsDir() {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", errors.New("yjstest: no test/unit/server-conformance above the working directory; set BLOK_REPO_ROOT")
}

// Dir is the yjs-engine fixture directory.
func Dir() (string, error) {
	root, err := RepoRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, filepath.FromSlash(fixtureRel)), nil
}

// Load parses one fixture file as JS values, keys in file order.
func Load(name string) (any, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	if err != nil {
		return nil, err
	}
	value, err := jsjson.Parse(data)
	if err != nil {
		return nil, fmt.Errorf("yjstest: %s: %w", name, err)
	}
	return value, nil
}

// Field reads a member of a JS object, or nil.
func Field(value any, key string) any {
	object, ok := value.(*jsjson.Object)
	if !ok {
		return nil
	}
	member, _ := object.Get(jsjson.FromString(key))
	return member
}

// Has reports whether a JS object has the member.
func Has(value any, key string) bool {
	object, ok := value.(*jsjson.Object)
	if !ok {
		return false
	}
	_, found := object.Get(jsjson.FromString(key))
	return found
}

// String reads a string member, or "".
func String(value any, key string) string {
	text, _ := Field(value, key).(jsjson.Str)
	return text.String()
}

// Bool reads a boolean member, or false.
func Bool(value any, key string) bool {
	flag, _ := Field(value, key).(bool)
	return flag
}

// Number reads a number member, or 0.
func Number(value any, key string) float64 {
	number, _ := Field(value, key).(float64)
	return number
}

// Items reads an array member.
func Items(value any, key string) []any {
	items, _ := Field(value, key).([]any)
	return items
}

// Bytes decodes a standard base64 member.
func Bytes(value any, key string) ([]byte, error) {
	text, ok := Field(value, key).(jsjson.Str)
	if !ok {
		return nil, fmt.Errorf("yjstest: %q is not a string", key)
	}
	return base64.StdEncoding.DecodeString(text.String())
}

// Cases reads a file's "cases" array.
func Cases(name string) ([]any, error) {
	file, err := Load(name)
	if err != nil {
		return nil, err
	}
	cases, ok := Field(file, "cases").([]any)
	if !ok {
		return nil, fmt.Errorf("yjstest: %s has no cases array", name)
	}
	return cases, nil
}

// ToEngine turns a fixture value into an engine value, reading the sentinel
// objects $num, $undefined, $bigint and $u8.
func ToEngine(value any) (any, error) {
	switch value := value.(type) {
	case *jsjson.Object:
		if value.Len() == 1 {
			member := value.Members()[0]
			switch member.Key.String() {
			case "$num":
				return sentinelNumber(member.Value)
			case "$undefined":
				return jsjson.Undefined{}, nil
			case "$bigint":
				text, _ := member.Value.(jsjson.Str)
				number, err := strconv.ParseInt(text.String(), 10, 64)
				if err != nil {
					return nil, fmt.Errorf("yjstest: bad $bigint %q", text.String())
				}
				return lib0.BigInt(number), nil
			case "$u8":
				text, _ := member.Value.(jsjson.Str)
				return base64.StdEncoding.DecodeString(text.String())
			}
		}
		object := &jsjson.Object{}
		for _, member := range value.Members() {
			converted, err := ToEngine(member.Value)
			if err != nil {
				return nil, err
			}
			object.Set(member.Key, converted)
		}
		return object, nil
	case []any:
		items := make([]any, len(value))
		for i, item := range value {
			converted, err := ToEngine(item)
			if err != nil {
				return nil, err
			}
			items[i] = converted
		}
		return items, nil
	}
	return value, nil
}

func sentinelNumber(value any) (float64, error) {
	text, _ := value.(jsjson.Str)
	switch text.String() {
	case "NaN":
		return jsjson.NaN(), nil
	case "-0":
		return math.Copysign(0, -1), nil
	case "Infinity":
		return math.Inf(1), nil
	case "-Infinity":
		return math.Inf(-1), nil
	}
	return 0, fmt.Errorf("yjstest: bad $num %q", text.String())
}

// ToFixture is the inverse of ToEngine: the shape scripts/yjs-engine-render.mjs
// writes for an engine value.
func ToFixture(value any) any {
	switch value := value.(type) {
	case float64:
		switch {
		case math.IsNaN(value):
			return sentinel("$num", jsjson.FromString("NaN"))
		case value == 0 && math.Signbit(value):
			return sentinel("$num", jsjson.FromString("-0"))
		case math.IsInf(value, 1):
			return sentinel("$num", jsjson.FromString("Infinity"))
		case math.IsInf(value, -1):
			return sentinel("$num", jsjson.FromString("-Infinity"))
		}
		return value
	case jsjson.Undefined:
		return sentinel("$undefined", true)
	case lib0.BigInt:
		return sentinel("$bigint", jsjson.FromString(big.NewInt(int64(value)).String()))
	case []byte:
		return sentinel("$u8", jsjson.FromString(base64.StdEncoding.EncodeToString(value)))
	case *jsjson.Object:
		object := &jsjson.Object{}
		for _, member := range value.Members() {
			object.Set(member.Key, ToFixture(member.Value))
		}
		return object
	case []any:
		items := make([]any, len(value))
		for i, item := range value {
			items[i] = ToFixture(item)
		}
		return items
	}
	return value
}

func sentinel(key string, value any) *jsjson.Object {
	object := &jsjson.Object{}
	object.Set(jsjson.FromString(key), value)
	return object
}

// Canonical is JSON.stringify(canonicalize(value)) from
// scripts/generate-yjs-engine-fixtures.mjs: keys sorted by UTF-16 units at
// every level.
func Canonical(value any) (string, error) {
	return jsjson.Stringify(canonicalize(value))
}

func canonicalize(value any) any {
	switch value := value.(type) {
	case *jsjson.Object:
		members := slices.Clone(value.Members())
		slices.SortStableFunc(members, func(a, b jsjson.Member) int { return jsjson.Compare(a.Key, b.Key) })
		object := &jsjson.Object{}
		for _, member := range members {
			object.Set(member.Key, canonicalize(member.Value))
		}
		return object
	case []any:
		items := make([]any, len(value))
		for i, item := range value {
			items[i] = canonicalize(item)
		}
		return items
	}
	return value
}
