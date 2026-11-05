package convert

import (
	"math"
	"slices"
	"strconv"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/v2/internal/yjs"
)

// The /edit write path, in place (C# YDocConverter.DeepAssign, LOCKSTEP with
// the client's deepAssignYMap/deepAssignYArray/deepAssignYGrid): plain JSON
// assigned onto the containers a block's data already holds, at every
// depth. A container one side replaces wholesale is one the other side's
// concurrent edit was inside. Only containers matter; a changed leaf is
// simply written. Every write was screened while planning, so a failure
// here panics and ApplyOps reports the edit as failed mid-write.

func must(v any, err error) any {
	if err != nil {
		panic(err)
	}
	return v
}

// assignEntry is one key of a live map. depth is the depth of the value,
// counted as plainToYValue counts it. nested is false only for a block's
// top-level data keys, where the ordered-id rule does not apply.
func assignEntry(t *yjs.Transaction, target *yjs.Map, key jsjson.Str, v any, depth int, nested, listSlot bool) {
	existing := mapValue(target, key)
	// An emptied list slot is cleared in place, so a peer's concurrent add
	// survives. A leaf [] (an older client's write) is left alone.
	if empty, ok := v.([]any); ok && listSlot && len(empty) == 0 {
		if slot, ok := existing.(*yjs.Map); ok && isGridMap(slot) {
			assignIdentity(t, slot, empty, depth)
		} else if !sameAsLive(existing, empty, depth) {
			target.Set(t, key, must(plainToIdentityMap(empty, depth)))
		}
		return
	}
	// The keyed grid first: a grid wrapper is a map too.
	if rows, ok := v.([]any); ok {
		if grid, ok := existing.(*yjs.Map); ok && isGridMap(grid) {
			switch {
			case isGridArray(rows):
				assignGrid(t, grid, rows, depth)
			case isIdentityArray(rows):
				assignIdentity(t, grid, rows, depth)
			case !sameAsLive(grid, rows, depth):
				// Neither shape any more: rebuild, as the read path would.
				target.Set(t, key, must(plainToYValue(rows, depth)))
			}
			return
		}
	}
	// An ordered id list is a Y.Array at any depth, so two peers each
	// dropping a block into one cell keep both ids.
	if ids, ok := v.([]any); ok && nested && slices.Contains(orderedIDArrayKeys, key.String()) && !isGridArray(ids) && !isIdentityArray(ids) {
		if live, ok := existing.(*yjs.Array); ok {
			assignArray(t, live, ids, depth)
		} else {
			// A cell written before this rule holds a plain array: promote it.
			target.Set(t, key, must(plainToYArray(ids, depth)))
		}
		return
	}
	if array, ok := v.([]any); ok {
		if live, ok := existing.(*yjs.Array); ok {
			if isConvertibleArray(array) {
				assignArray(t, live, array, depth)
			} else if !sameAsLive(live, array, depth) {
				target.Set(t, key, must(plainToYValue(array, depth)))
			}
			return
		}
	}
	if object, ok := v.(*jsjson.Object); ok {
		slots := !nested && key.String() == listSlotMapKey
		if live, ok := existing.(*yjs.Map); ok {
			assignMap(t, live, object, depth, slots)
			return
		}
		// Unconditional: what is there is not a Y.Map, and leaving it would
		// keep the key unmergeable for good.
		if slots {
			target.Set(t, key, must(plainDataValue(key, object, depth)))
		} else {
			target.Set(t, key, must(plainToYValue(object, depth)))
		}
		return
	}
	if !sameAsLive(existing, v, depth) {
		target.Set(t, key, must(plainToYValue(v, depth)))
	}
}

// assignMap removes the keys the object lacks (only those the doc holds
// now, so a peer's concurrent key survives), then assigns each key.
func assignMap(t *yjs.Transaction, target *yjs.Map, source *jsjson.Object, depth int, listSlots bool) {
	for _, key := range target.Keys() {
		if _, ok := source.Get(key); !ok {
			target.Delete(t, key)
		}
	}
	for _, m := range source.Members() {
		assignEntry(t, target, m.Key, m.Value, depth+1, true, listSlots)
	}
}

// assignArray is a two-ended diff: equal ends are skipped, equal-length
// middles are assigned element by element, unequal ones are paired by
// content (inserts and deletes only), else replaced by one splice.
func assignArray(t *yjs.Transaction, target *yjs.Array, source []any, depth int) {
	items := target.Values()
	prefix, suffix := commonEnds(len(items), len(source), func(i, j int) bool {
		return sameAsLive(items[i], source[j], depth+1)
	})
	targetMiddle := len(items) - prefix - suffix
	sourceMiddle := len(source) - prefix - suffix
	if targetMiddle == 0 && sourceMiddle == 0 {
		return
	}
	if targetMiddle == sourceMiddle {
		for offset := 0; offset < sourceMiddle; offset++ {
			assignElement(t, target, prefix+offset, source[prefix+offset], depth+1)
		}
		return
	}
	assignment := pairRows(targetMiddle, sourceMiddle,
		func(i, j int) bool { return sameAsLive(items[prefix+i], source[prefix+j], depth+1) },
		func(i, j int) int { return rowSimilarity(items[prefix+i], source[prefix+j], depth+1) },
		true)
	var paired []int
	for _, index := range assignment {
		if index >= 0 {
			paired = append(paired, index)
		}
	}
	reordered := false
	for rank := 1; rank < len(paired); rank++ {
		if paired[rank] <= paired[rank-1] {
			reordered = true
		}
	}
	if len(paired) > 0 && !reordered {
		// Backwards, so an earlier delete cannot shift a later offset.
		for offset := targetMiddle - 1; offset >= 0; offset-- {
			if !slices.Contains(paired, offset) {
				target.Delete(t, prefix+offset, 1)
			}
		}
		for offset := 0; offset < sourceMiddle; offset++ {
			if assignment[offset] < 0 {
				target.Insert(t, prefix+offset, []any{must(plainToYValue(source[prefix+offset], depth+1))})
				continue
			}
			assignElement(t, target, prefix+offset, source[prefix+offset], depth+1)
		}
		return
	}
	// Nothing pairs, or the pairing is a reorder: one splice.
	if targetMiddle > 0 {
		target.Delete(t, prefix, targetMiddle)
	}
	if sourceMiddle > 0 {
		values := make([]any, sourceMiddle)
		for i := range values {
			values[i] = must(plainToYValue(source[prefix+i], depth+1))
		}
		target.Insert(t, prefix, values)
	}
}

// assignElement is one array element in place, recursing into containers.
func assignElement(t *yjs.Transaction, target *yjs.Array, index int, v any, depth int) {
	existing := target.Get(index)
	if rows, ok := v.([]any); ok {
		if grid, ok := existing.(*yjs.Map); ok && isGridMap(grid) {
			if isGridArray(rows) {
				assignGrid(t, grid, rows, depth)
				return
			}
			if isIdentityArray(rows) {
				assignIdentity(t, grid, rows, depth)
				return
			}
		}
	}
	if object, ok := v.(*jsjson.Object); ok {
		if live, ok := existing.(*yjs.Map); ok {
			assignMap(t, live, object, depth, false)
			return
		}
	}
	if array, ok := v.([]any); ok {
		if live, ok := existing.(*yjs.Array); ok && isConvertibleArray(array) {
			assignArray(t, live, array, depth)
			return
		}
	}
	if sameAsLive(existing, v, depth) {
		return
	}
	target.Delete(t, index, 1)
	target.Insert(t, index, []any{must(plainToYValue(v, depth))})
}

// assignGrid re-associates keyless plain rows with the keys in the doc, so
// a paired row is diffed in place and only the order array records a move.
// The row wrapper costs two levels.
func assignGrid(t *yjs.Transaction, grid *yjs.Map, source []any, depth int) {
	rows := mapValue(grid, str(gridRowsKey)).(*yjs.Map)
	order := mapValue(grid, str(gridOrderKey)).(*yjs.Array)
	currentKeys := gridRowKeys(grid, rows)
	currentRows := make([]any, len(currentKeys))
	for i, key := range currentKeys {
		currentRows[i] = mapValue(rows, key)
	}
	rowDepth := depth + 2
	assignment := pairRowsByID(currentKeys, currentRows, source, rowDepth)
	paired := map[int]bool{}
	for _, index := range assignment {
		if index >= 0 {
			paired[index] = true
		}
	}
	for i, key := range currentKeys {
		if !paired[i] {
			rows.Delete(t, key)
		}
	}
	// After the removals, as on the client: a freed key may be reused.
	taken := map[string]bool{}
	for _, key := range rows.Keys() {
		taken[unitKey(key)] = true
	}
	var nextKeys []jsjson.Str
	for i, row := range source {
		if assignment[i] < 0 {
			minted := newGridRowKey(row, taken)
			taken[unitKey(minted)] = true
			rows.Set(t, minted, must(plainToYValue(row, rowDepth)))
			nextKeys = append(nextKeys, minted)
			continue
		}
		key := currentKeys[assignment[i]]
		// Through assignEntry: the row's live value may be anything.
		assignEntry(t, rows, key, row, rowDepth, true, false)
		nextKeys = append(nextKeys, key)
	}
	keySequence(t, order, nextKeys)
}

// assignIdentity: each element carries its own key, so a reorder is just a
// new order array and every element's map survives it.
func assignIdentity(t *yjs.Transaction, target *yjs.Map, source []any, depth int) {
	rows := mapValue(target, str(gridRowsKey)).(*yjs.Map)
	order := mapValue(target, str(gridOrderKey)).(*yjs.Array)
	nextKeys := make([]jsjson.Str, len(source))
	kept := map[string]bool{}
	for i, element := range source {
		id, _ := getString(element.(*jsjson.Object), "id")
		nextKeys[i] = id
		kept[unitKey(id)] = true
	}
	for _, key := range rows.Keys() {
		if !kept[unitKey(key)] {
			rows.Delete(t, key)
		}
	}
	for i, element := range source {
		assignEntry(t, rows, nextKeys[i], element, depth+2, true, false)
	}
	keySequence(t, order, nextKeys)
}

// pairRowsByID pairs a saved row with the doc row whose key is the row id
// it carries, then the rest by content. Mirrors pairGridRowsById.
func pairRowsByID(currentKeys []jsjson.Str, currentRows []any, source []any, rowDepth int) []int {
	indexByKey := map[string]int{}
	for i, key := range currentKeys {
		if _, ok := indexByKey[unitKey(key)]; !ok {
			indexByKey[unitKey(key)] = i
		}
	}
	claimed := map[int]bool{}
	assignment := make([]int, len(source))
	for i, row := range source {
		assignment[i] = -1
		if id := gridRowID(row); id != nil {
			if target, ok := indexByKey[unitKey(id)]; ok && !claimed[target] {
				claimed[target] = true
				assignment[i] = target
			}
		}
	}
	var restSources, restTargets []int
	for i := range source {
		if assignment[i] < 0 {
			restSources = append(restSources, i)
		}
	}
	for i := range currentKeys {
		if !claimed[i] {
			restTargets = append(restTargets, i)
		}
	}
	rest := pairRows(len(restTargets), len(restSources),
		func(c, s int) bool { return sameAsLive(currentRows[restTargets[c]], source[restSources[s]], rowDepth) },
		func(c, s int) int {
			return rowSimilarity(currentRows[restTargets[c]], source[restSources[s]], rowDepth)
		},
		false)
	for rank, paired := range rest {
		if paired < 0 {
			assignment[restSources[rank]] = -1
		} else {
			assignment[restSources[rank]] = restTargets[paired]
		}
	}
	return assignment
}

// pairRows re-associates keyless rows with the doc's rows: equal ends,
// then exact matches, then (only when the counts differ) cell similarity
// within a rank window, then by rank. Under enforceOrder a rank pair must
// keep the pairing monotonic. Returns, per source row, the doc row or -1.
func pairRows(currentCount, sourceCount int, rowsEqual func(int, int) bool, similarity func(int, int) int, enforceOrder bool) []int {
	assignment := make([]int, sourceCount)
	for i := range assignment {
		assignment[i] = -1
	}
	taken := map[int]bool{}
	pair := func(sourceIndex, currentIndex int) {
		assignment[sourceIndex] = currentIndex
		taken[currentIndex] = true
	}
	prefix, suffix := commonEnds(currentCount, sourceCount, rowsEqual)
	for i := 0; i < prefix; i++ {
		pair(i, i)
	}
	for i := 0; i < suffix; i++ {
		pair(sourceCount-1-i, currentCount-1-i)
	}
	var middleSources, middleTargets []int
	for i := 0; i < sourceCount; i++ {
		if assignment[i] < 0 {
			middleSources = append(middleSources, i)
		}
	}
	for i := 0; i < currentCount; i++ {
		if !taken[i] {
			middleTargets = append(middleTargets, i)
		}
	}
	for _, sourceIndex := range middleSources {
		for _, index := range middleTargets {
			if !taken[index] && rowsEqual(index, sourceIndex) {
				pair(sourceIndex, index)
				break
			}
		}
	}
	var restSources, restTargets []int
	for _, i := range middleSources {
		if assignment[i] < 0 {
			restSources = append(restSources, i)
		}
	}
	for _, i := range middleTargets {
		if !taken[i] {
			restTargets = append(restTargets, i)
		}
	}
	// An unmatched row can only have shifted by the unmatched count around it.
	window := abs(len(restSources)-len(restTargets)) + 1
	if len(restSources) != len(restTargets) {
		for rank, sourceIndex := range restSources {
			var free []int
			for targetRank, index := range restTargets {
				if !taken[index] && abs(targetRank-rank) <= window {
					free = append(free, index)
				}
			}
			if match := mostSimilar(free, sourceIndex, similarity); match >= 0 {
				pair(sourceIndex, match)
			}
		}
	}
	// Reads assignment live, so a pair taken here constrains the next.
	keepsOrder := func(sourceIndex, currentIndex int) bool {
		for index, paired := range assignment {
			if paired < 0 {
				continue
			}
			ordered := paired > currentIndex
			if index < sourceIndex {
				ordered = paired < currentIndex
			}
			if !ordered {
				return false
			}
		}
		return true
	}
	// Taken once, so rank keeps its 1:1 meaning.
	var finalTargets, rest []int
	for _, i := range restTargets {
		if !taken[i] {
			finalTargets = append(finalTargets, i)
		}
	}
	for _, i := range restSources {
		if assignment[i] < 0 {
			rest = append(rest, i)
		}
	}
	for rank := 0; rank < len(rest) && rank < len(finalTargets); rank++ {
		if !enforceOrder || keepsOrder(rest[rank], finalTargets[rank]) {
			pair(rest[rank], finalTargets[rank])
		}
	}
	return assignment
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// mostSimilar is the candidate sharing the most cells, or -1 when none
// shares any.
func mostSimilar(candidates []int, sourceIndex int, similarity func(int, int) int) int {
	best, bestScore := -1, 0
	for _, candidate := range candidates {
		if score := similarity(candidate, sourceIndex); score > bestScore {
			best, bestScore = candidate, score
		}
	}
	return best
}

// rowSimilarity is the common cell prefix plus suffix of two rows, measured
// from both ends so a column added at the front still matches. Two objects
// score what they both carry. The live side is read as the export reads it.
func rowSimilarity(current, source any, depth int) int {
	plain, ok := tryPlain(current, depth)
	if !ok {
		return 0
	}
	return similarityScore(plain, source)
}

func similarityScore(live, v any) int {
	if items, ok := live.([]any); ok {
		if cells, ok := v.([]any); ok {
			prefix, suffix := commonEnds(len(items), len(cells), func(i, j int) bool { return jsonEqual(items[i], cells[j]) })
			return prefix + suffix
		}
	}
	if fields, ok := live.(*jsjson.Object); ok {
		if values, ok := v.(*jsjson.Object); ok {
			sum := 0
			for _, m := range fields.Members() {
				if other, ok := values.Get(m.Key); ok {
					sum += similarityScore(m.Value, other)
				}
			}
			return sum
		}
	}
	if jsonEqual(live, v) {
		return 1
	}
	return 0
}

// keySequence rewrites a grid's key order with one two-ended splice. Keys
// the read path normalised away are absent from keys and get spliced out.
func keySequence(t *yjs.Transaction, order *yjs.Array, keys []jsjson.Str) {
	current := order.Values()
	prefix, suffix := commonEnds(len(current), len(keys), func(i, j int) bool {
		key, ok := current[i].(jsjson.Str)
		return ok && slices.Equal(key, keys[j])
	})
	currentMiddle := len(current) - prefix - suffix
	nextMiddle := len(keys) - prefix - suffix
	if currentMiddle > 0 {
		order.Delete(t, prefix, currentMiddle)
	}
	if nextMiddle > 0 {
		values := make([]any, nextMiddle)
		for i := range values {
			values[i] = keys[prefix+i]
		}
		order.Insert(t, prefix, values)
	}
}

// commonEnds is the equal prefix, then the equal suffix past it, so the two
// never overlap.
func commonEnds(left, right int, equalAt func(int, int) bool) (int, int) {
	maxPrefix := min(left, right)
	prefix := 0
	for prefix < maxPrefix && equalAt(prefix, prefix) {
		prefix++
	}
	maxSuffix := maxPrefix - prefix
	suffix := 0
	for suffix < maxSuffix && equalAt(left-1-suffix, right-1-suffix) {
		suffix++
	}
	return prefix, suffix
}

// sameAsLive: whether the live value already is the plain value. A shape
// this writer cannot produce answers no, which costs a redundant write and
// never drops an edit.
func sameAsLive(live, v any, depth int) bool {
	plain, ok := tryPlain(live, depth)
	return ok && jsonEqual(plain, v)
}

// tryPlain is the live value as the export would write it, or false.
func tryPlain(live any, depth int) (any, bool) {
	// Past the cap the export writes null, so nothing compares honestly.
	if depth > MaxValueDepth {
		return nil, false
	}
	switch v := live.(type) {
	case nil:
		return nil, true
	case *yjs.Map:
		if isGridMap(v) {
			rows := mapValue(v, str(gridRowsKey)).(*yjs.Map)
			keys := gridRowKeys(v, rows)
			values := make([]any, len(keys))
			for i, key := range keys {
				values[i] = mapValue(rows, key)
			}
			// The keyed wrapper costs the two levels the write side spends.
			return tryPlainItems(values, depth+2)
		}
		result := &jsjson.Object{}
		for _, key := range v.Keys() {
			plain, ok := tryPlain(mapValue(v, key), depth+1)
			if !ok {
				return nil, false
			}
			result.Set(key, plain)
		}
		return result, true
	case *jsjson.Object:
		result := &jsjson.Object{}
		for _, m := range v.Members() {
			plain, ok := tryPlain(m.Value, depth+1)
			if !ok {
				return nil, false
			}
			result.Set(m.Key, plain)
		}
		return result, true
	case *yjs.Array:
		return tryPlainItems(v.Values(), depth+1)
	case []any:
		return tryPlainItems(v, depth+1)
	case *yjs.XmlText:
		plain, err := toJSONNode(FromDelta(v.ToDelta()))
		return plain, err == nil
	case *yjs.Text:
		return v.Units(), true
	case jsjson.Str, bool:
		return v, true
	case float64:
		return numberNode(v), true
	}
	return nil, false
}

func tryPlainItems(items []any, depth int) (any, bool) {
	result := make([]any, len(items))
	for i, item := range items {
		plain, ok := tryPlain(item, depth)
		if !ok {
			return nil, false
		}
		result[i] = plain
	}
	return result, true
}

// jsonEqual is JsonNode.DeepEquals between a live plain value and a request
// value: objects ignore key order, and numbers compare as .NET does (see
// numberEqual).
func jsonEqual(plain, v any) bool {
	switch p := plain.(type) {
	case nil:
		return v == nil
	case bool:
		other, ok := v.(bool)
		return ok && other == p
	case jsjson.Str:
		other, ok := v.(jsjson.Str)
		return ok && slices.Equal(p, other)
	case float64:
		return numberEqual(p, v)
	case []any:
		other, ok := v.([]any)
		if !ok || len(other) != len(p) {
			return false
		}
		for i := range p {
			if !jsonEqual(p[i], other[i]) {
				return false
			}
		}
		return true
	case *jsjson.Object:
		other, ok := v.(*jsjson.Object)
		if !ok || other.Len() != p.Len() {
			return false
		}
		for _, m := range p.Members() {
			value, ok := other.Get(m.Key)
			if !ok || !jsonEqual(m.Value, value) {
				return false
			}
		}
		return true
	}
	return false
}

// numberEqual: the live number is a long when it is an integer within 2^53
// (NumberNode), and .NET compares a long to the request's number text by
// exact decimal value (100 = 1.00e2, 5 != 5.0000000000000000001); any other
// live number is compared to GetDouble of the text. Probed on .NET 10.
func numberEqual(live float64, v any) bool {
	switch v := v.(type) {
	case sourceNumber:
		if live == math.Trunc(live) && math.Abs(live) <= maxSafeInteger {
			return decimalIsInteger(v.raw, int64(live))
		}
		return v.value == live
	case float64:
		return v == live
	}
	return false
}

// decimalIsInteger reports whether a JSON number's text is exactly n.
func decimalIsInteger(raw []byte, n int64) bool {
	negative := len(raw) > 0 && raw[0] == '-'
	if negative {
		raw = raw[1:]
	}
	var digits []byte
	exponent := 0
	i := 0
	for i < len(raw) && raw[i] >= '0' && raw[i] <= '9' {
		digits = append(digits, raw[i])
		i++
	}
	if i < len(raw) && raw[i] == '.' {
		i++
		for i < len(raw) && raw[i] >= '0' && raw[i] <= '9' {
			digits = append(digits, raw[i])
			exponent--
			i++
		}
	}
	if i < len(raw) && (raw[i] == 'e' || raw[i] == 'E') {
		e, err := strconv.Atoi(string(raw[i+1:]))
		if err != nil {
			// Too large for an int: no integer within 2^53 has such a scale,
			// unless the digits are all zero.
			e = math.MaxInt32
			if raw[i+1] == '-' {
				e = math.MinInt32
			}
		}
		exponent += e
	}
	for len(digits) > 0 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 0 {
		return n == 0
	}
	for digits[len(digits)-1] == '0' {
		digits = digits[:len(digits)-1]
		exponent++
	}
	if n == 0 || negative != (n < 0) {
		return false
	}
	want := strconv.FormatInt(n, 10)
	if n < 0 {
		want = want[1:]
	}
	zeros := 0
	for want[len(want)-1] == '0' {
		want = want[:len(want)-1]
		zeros++
	}
	return string(digits) == want && exponent == zeros
}
