package room

import (
	"unicode"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// RestoreGuard is CollabRestoreGuard: one reason a restore needs a person's
// yes. ViewID is set for a share guard only.
type RestoreGuard struct {
	Kind    string
	BlockID string
	ViewID  *string
}

// JSON is {kind, blockId, viewId?}.
func (g RestoreGuard) JSON() *jsjson.Object {
	object := &jsjson.Object{}
	object.Set(jsjson.FromString("kind"), jsjson.FromString(g.Kind))
	object.Set(jsjson.FromString("blockId"), jsjson.FromString(g.BlockID))
	if g.ViewID != nil {
		object.Set(jsjson.FromString("viewId"), jsjson.FromString(*g.ViewID))
	}
	return object
}

// The guard kinds; each one a request may confirm.
const (
	GuardShare         = "share"
	GuardUnlock        = "unlock"
	GuardLockedReshape = "lockedReshape"
)

// ConfirmableGuards are the kinds a request may confirm.
var ConfirmableGuards = []string{GuardShare, GuardUnlock, GuardLockedReshape}

// lockProtectedFields is LOCK_PROTECTED_FIELDS in src/shared/tool-actions/database.ts.
var lockProtectedFields = []string{"schema", "views", "automations", "source", "hideDataSourceTitles", "starter"}

var submissionAccess = []string{"none", "view", "comment", "edit", "full"}

// The agent's question names the calendar in full: a longer id is not one it can show.
const maxCalendarID = 64

type indexedBlocks struct {
	order []string
	byID  map[string]*jsjson.Object
}

// RestoreGuards is CollabRestoreGuards.Of: the guards a restore of target
// over current raises, both as exported blocks. Lock guards come first in
// current's order, then share guards in target's. The oracle is
// fixtures/collab-history/restore-guards.json.
func RestoreGuards(currentBlocks, targetBlocks []any) []RestoreGuard {
	now := indexBlocks(currentBlocks)
	target := indexBlocks(targetBlocks)
	lockedNow := lockedIn(now)
	lockedTarget := lockedIn(target)
	var guards []RestoreGuard
	for _, id := range now.order {
		block := now.byID[id]
		if textOf(block, "type") != "database" || !lockedOrHeld(now, id, lockedNow, map[string]bool{}) {
			continue
		}
		after, kept := target.byID[id]
		if kept && textOf(after, "type") == "database" && sameProtected(objectAt(block, "data"), objectAt(after, "data")) {
			continue
		}
		kind := GuardLockedReshape
		if lockedNow[id] && kept && !lockedTarget[id] {
			kind = GuardUnlock
		}
		guards = append(guards, RestoreGuard{Kind: kind, BlockID: id})
	}
	for _, id := range target.order {
		after := target.byID[id]
		if textOf(after, "type") != "database" {
			continue
		}
		was := map[string]*jsjson.Object{}
		if before, ok := now.byID[id]; ok && textOf(before, "type") == "database" {
			// Last wins, as a Map built from entries does.
			for _, view := range viewsIn(before) {
				if viewID, ok := stringAt(view, "id"); ok {
					was[viewID] = view
				}
			}
		}
		for _, view := range viewsIn(after) {
			viewID, _ := stringAt(view, "id")
			var previous *jsjson.Object
			if viewID != "" {
				previous = was[viewID]
			}
			if shareChanges(previous, view) {
				guards = append(guards, RestoreGuard{Kind: GuardShare, BlockID: id, ViewID: &viewID})
			}
		}
	}
	return guards
}

// indexBlocks: the blocks by id in first-seen order; a later repeat wins.
func indexBlocks(blocks []any) indexedBlocks {
	index := indexedBlocks{byID: map[string]*jsjson.Object{}}
	for _, item := range blocks {
		block, ok := item.(*jsjson.Object)
		if !ok {
			continue
		}
		id, ok := stringAt(block, "id")
		if !ok || id == "" {
			continue
		}
		if _, seen := index.byID[id]; !seen {
			index.order = append(index.order, id)
		}
		index.byID[id] = block
	}
	return index
}

func memberOf(object *jsjson.Object, key string) (any, bool) {
	if object == nil {
		return nil, false
	}
	value, ok := object.Get(jsjson.FromString(key))
	if _, undefined := value.(jsjson.Undefined); undefined {
		return nil, false
	}
	return value, ok
}

func stringAt(object *jsjson.Object, key string) (string, bool) {
	value, _ := memberOf(object, key)
	s, ok := value.(jsjson.Str)
	return s.String(), ok
}

func textOf(object *jsjson.Object, key string) string {
	s, _ := stringAt(object, key)
	return s
}

func trueAt(object *jsjson.Object, key string) bool {
	value, _ := memberOf(object, key)
	flag, ok := value.(bool)
	return ok && flag
}

func objectAt(object *jsjson.Object, key string) *jsjson.Object {
	value, _ := memberOf(object, key)
	o, _ := value.(*jsjson.Object)
	return o
}

// lockedIn: blocks of any type whose schema has a title property with
// databaseLocked true.
func lockedIn(blocks indexedBlocks) map[string]bool {
	locked := map[string]bool{}
	for _, id := range blocks.order {
		value, _ := memberOf(objectAt(blocks.byID[id], "data"), "schema")
		schema, _ := value.([]any)
		for _, property := range schema {
			title, ok := property.(*jsjson.Object)
			if ok && textOf(title, "type") == "title" && trueAt(title, "databaseLocked") {
				locked[id] = true
				break
			}
		}
	}
	return locked
}

// lockedOrHeld: its own lock, or a locked database up its chain of
// database parents.
func lockedOrHeld(blocks indexedBlocks, id string, locked, seen map[string]bool) bool {
	if locked[id] {
		return true
	}
	parent, ok := stringAt(blocks.byID[id], "parent")
	if !ok || parent == id || seen[parent] {
		return false
	}
	holder, ok := blocks.byID[parent]
	if !ok || textOf(holder, "type") != "database" {
		return false
	}
	next := map[string]bool{id: true}
	for key := range seen {
		next[key] = true
	}
	return lockedOrHeld(blocks, parent, locked, next)
}

// sameProtected: every field the lock protects is the same; missing and
// null differ, as undefined and null do.
func sameProtected(before, after *jsjson.Object) bool {
	for _, field := range lockProtectedFields {
		if !sameMember(before, after, field) {
			return false
		}
	}
	return true
}

func sameMember(left, right *jsjson.Object, key string) bool {
	a, hadA := memberOf(left, key)
	b, hadB := memberOf(right, key)
	return hadA == hadB && (!hadA || sameData(a, b))
}

func viewsIn(block *jsjson.Object) []*jsjson.Object {
	value, _ := memberOf(objectAt(block, "data"), "views")
	list, _ := value.([]any)
	var views []*jsjson.Object
	for _, item := range list {
		if view, ok := item.(*jsjson.Object); ok {
			views = append(views, view)
		}
	}
	return views
}

// shareChanges: the view's sharing differs from previous (nil is the
// defaults), or a raw value changed that Blok cannot read as the Share
// panel does, which fails closed.
func shareChanges(previous, view *jsjson.Object) bool {
	if sameRawShare(previous, view) {
		return false
	}
	return !readableShare(view) || shareOf(previous) != shareOf(view)
}

// sameRawShare compares rawShare: whether form is missing or an object, the
// four form values and calendarSync as stored.
func sameRawShare(left, right *jsjson.Object) bool {
	formState := func(view *jsjson.Object) bool {
		value, present := memberOf(view, "form")
		_, isObject := value.(*jsjson.Object)
		return !present || isObject
	}
	if formState(left) != formState(right) {
		return false
	}
	leftForm, rightForm := objectAt(left, "form"), objectAt(right, "form")
	for _, key := range []string{"closed", "public", "anonymous", "submissionAccess"} {
		if !sameMember(leftForm, rightForm, key) {
			return false
		}
	}
	return sameMember(left, right, "calendarSync")
}

type viewShare struct {
	access        string
	anonymous     bool
	submission    string
	syncEnabled   bool
	calendarID    string
	hasCalendarID bool
}

// shareOf: the settings with defaults filled in. Closed wins over public.
func shareOf(view *jsjson.Object) viewShare {
	form := objectAt(view, "form")
	sync := objectAt(view, "calendarSync")
	share := viewShare{access: "workspace", submission: "none"}
	if named, ok := stringAt(form, "submissionAccess"); ok && contains(submissionAccess, named) {
		share.submission = named
	}
	if trueAt(form, "closed") {
		share.access = "closed"
	} else if trueAt(form, "public") {
		share.access = "public"
	}
	share.anonymous = trueAt(form, "anonymous")
	share.syncEnabled = trueAt(sync, "enabled")
	if id, ok := stringAt(sync, "calendarId"); ok && id != "" {
		share.calendarID, share.hasCalendarID = id, true
	}
	return share
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// readableShare: every sharing value is one Blok reads the one way the
// Share panel does.
func readableShare(view *jsjson.Object) bool {
	formValue, hasForm := memberOf(view, "form")
	syncValue, hasSync := memberOf(view, "calendarSync")
	form, isForm := formValue.(*jsjson.Object)
	sync, isSync := syncValue.(*jsjson.Object)
	if (hasForm && !isForm) || (hasSync && !isSync) {
		return false
	}
	isBool := func(value any) bool { _, ok := value.(bool); return ok }
	return optionalMember(form, "closed", isBool) && optionalMember(form, "public", isBool) &&
		optionalMember(form, "anonymous", isBool) &&
		optionalMember(form, "submissionAccess", func(value any) bool {
			s, ok := value.(jsjson.Str)
			return ok && contains(submissionAccess, s.String())
		}) &&
		optionalMember(sync, "enabled", isBool) &&
		optionalMember(sync, "calendarId", func(value any) bool {
			s, ok := value.(jsjson.Str)
			return ok && IsPlainLine(s.String())
		})
}

func optionalMember(owner *jsjson.Object, key string, valid func(any) bool) bool {
	value, present := memberOf(owner, key)
	return !present || valid(value)
}

// IsPlainLine is plainLine(id, 64) === id: 1 to 64 code points, no
// control, format, line or paragraph separator, no space but U+0020, and
// no leading, trailing or doubled space.
func IsPlainLine(id string) bool {
	count := 0
	previousSpace := true
	for _, r := range id {
		count++
		if r == ' ' {
			if previousSpace {
				return false
			}
			previousSpace = true
			continue
		}
		previousSpace = false
		if unicode.In(r, unicode.Cc, unicode.Cf, unicode.Zl, unicode.Zp, unicode.Zs) {
			return false
		}
	}
	return count > 0 && count <= maxCalendarID && !previousSpace
}
