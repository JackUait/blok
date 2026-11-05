package convert

import (
	"maps"
	"slices"
	"sort"

	"github.com/JackUait/blok/packages/server/go/v2/internal/jsjson"
)

// TextEdit turns the stored text into the saved text: at Index (UTF-16
// units into the stored text) drop Remove units and put Insert there.
type TextEdit struct {
	Index  int
	Remove int
	Insert jsjson.Str
}

// MaxDiffDistance is how far each bounded search looks (MAX_DIFF_DISTANCE in
// the client's text-diff.ts; the two must stay equal).
const MaxDiffDistance = 64

const (
	anchorAtoms     = 3
	maxEntityLength = 32
	fnvOffsetBasis  = 0x811c9dc5
	fnvPrime        = 0x01000193
)

// Diff is the client's diffText (src/components/modules/yjs/text-diff.ts) as
// C# TextDiff.Diff ports it: Myers over atoms, then anchored gaps past the
// cap, then words, then one region. Edits come back ascending; apply them
// back to front, each insert first.
func Diff(before, after jsjson.Str, markup bool) []TextEdit {
	beforeAtoms := Atomize(before, markup)
	afterAtoms := Atomize(after, markup)
	if ops, ok := myersOps(beforeAtoms, afterAtoms); ok {
		return ops
	}
	beforeUnits := unitOffsets(beforeAtoms)
	afterUnits := unitOffsets(afterAtoms)
	found := anchors(before, after, beforeUnits, afterUnits)
	if len(found) == 0 {
		return coarseOps(before, after)
	}
	// Anchors are split points: each gap's ops turn that gap into its pair on
	// their own, so the result is exactly after whatever the anchors were.
	ops := []TextEdit{}
	beforeFrom, afterFrom := 0, 0
	found = append(found, anchor{len(beforeAtoms), len(afterAtoms)})
	for _, pair := range found {
		beforeText := before[beforeUnits[beforeFrom]:beforeUnits[pair.before]]
		afterText := after[afterUnits[afterFrom]:afterUnits[pair.after]]
		if !slices.Equal(beforeText, afterText) {
			gapOps, ok := myersOps(beforeAtoms[beforeFrom:pair.before], afterAtoms[afterFrom:pair.after])
			if !ok {
				gapOps = coarseOps(beforeText, afterText)
			}
			shift := beforeUnits[beforeFrom]
			for _, op := range gapOps {
				op.Index += shift
				ops = append(ops, op)
			}
		}
		beforeFrom, afterFrom = pair.before, pair.after
	}
	return ops
}

// coarseOps is Myers over the words of the single changed region, or that region.
func coarseOps(before, after jsjson.Str) []TextEdit {
	index, remove, insert := singleRegion(before, after)
	if remove == 0 && len(insert) == 0 {
		return []TextEdit{}
	}
	wordOps, ok := myersOps(tokenize(before[index:index+remove]), tokenize(insert))
	if !ok {
		return []TextEdit{{Index: index, Remove: remove, Insert: insert}}
	}
	for i := range wordOps {
		wordOps[i].Index += index
	}
	return wordOps
}

// Atomize splits text into the units an edit boundary may fall between: a
// complete tag, a complete entity, otherwise one user-visible character.
func Atomize(text jsjson.Str, markup bool) []jsjson.Str {
	interiors := clusterInteriors(text)
	if len(interiors) == 0 && (!markup || (!slices.Contains(text, '<') && !slices.Contains(text, '&'))) {
		return codePoints(text)
	}
	atoms := make([]jsjson.Str, 0, len(text))
	for index := 0; index < len(text); {
		structured := index
		if markup {
			structured = structuredEnd(text, index)
		}
		if structured > index {
			atoms = append(atoms, text[index:structured])
			index = structured
			continue
		}
		end := index + 1
		if isHigh(text[index]) && index+1 < len(text) && isLow(text[index+1]) {
			end++
		}
		// A character never swallows a tag or entity that starts inside it
		// (the Prepend characters cluster with what follows).
		for interiors[end] && (!markup || structuredEnd(text, end) == end) {
			end++
		}
		atoms = append(atoms, text[index:end])
		index = end
	}
	return atoms
}

// clusterInteriors is every offset inside a user-visible character: StringInfo's
// elements, with GB9c conjuncts joined on top.
func clusterInteriors(text jsjson.Str) map[int]bool {
	starts := textElementStarts(text)
	inside := map[int]bool{}
	var conjunct conjunctState
	for index, start := range starts {
		end := len(text)
		if index+1 < len(starts) {
			end = starts[index+1]
		}
		// The joined character keeps its start, so a second conjunct chains on.
		if index > 0 && inRanges(conjunctConsonants, codePointAt(text, start)) && conjunct.joins() {
			inside[start] = true
		} else {
			conjunct = conjunctState{clusterStart: start}
		}
		conjunct.take(text, start, end)
		for at := start + 1; at < end; at++ {
			inside[at] = true
		}
	}
	return inside
}

// conjunctState is GB9c: Consonant (Extend | Linker)* Linker (Extend | Linker)* × Consonant.
// Read backwards from a boundary, the first code point that is not a linker
// and is the character's first or a breaker decides: it must be a consonant
// with a linker after it. Anything else counts as an extender. The state keeps
// that stop as the character grows; walking back at every boundary was
// quadratic. C# ConjunctState is the same.
type conjunctState struct {
	clusterStart    int
	stopIsConsonant bool
	linkedAfterStop bool
}

func (c *conjunctState) joins() bool {
	return c.stopIsConsonant && c.linkedAfterStop
}

// take adds the element [start, end), cut into code points from the end as
// the backward read cuts them.
func (c *conjunctState) take(text jsjson.Str, start, end int) {
	var points []int
	for at := end; at > start; {
		if at-1 > c.clusterStart && isLow(text[at-1]) && isHigh(text[at-2]) {
			at -= 2
		} else {
			at--
		}
		points = append(points, at)
	}
	for i := len(points) - 1; i >= 0; i-- {
		code := codePointAt(text, points[i])
		switch {
		case inRanges(conjunctLinkers, code):
			c.linkedAfterStop = true
		case points[i] == c.clusterStart || inRanges(conjunctBreakers, code):
			c.stopIsConsonant = inRanges(conjunctConsonants, code)
			c.linkedAfterStop = false
		}
	}
}

func inRanges(ranges []rune, code rune) bool {
	for at := 0; at < len(ranges); at += 2 {
		if code <= ranges[at+1] {
			return code >= ranges[at]
		}
	}
	return false
}

func codePointAt(text jsjson.Str, index int) rune {
	if isHigh(text[index]) && index+1 < len(text) && isLow(text[index+1]) {
		return 0x10000 + (rune(text[index])-0xD800)<<10 + rune(text[index+1]) - 0xDC00
	}
	return rune(text[index])
}

func structuredEnd(text jsjson.Str, start int) int {
	switch text[start] {
	case '<':
		return tagEnd(text, start)
	case '&':
		return entityEnd(text, start)
	}
	return start
}

// tagEnd scans through quoted attribute values: serializing does not escape
// > inside one.
func tagEnd(text jsjson.Str, start int) int {
	index := start + 1
	if charAt(text, index) == '/' {
		index++
	}
	name := charAt(text, index)
	if !(name >= 'A' && name <= 'Z' || name >= 'a' && name <= 'z') {
		return start
	}
	var quote uint16
	for ; index < len(text); index++ {
		code := text[index]
		wasQuoted := quote != 0
		quote = nextQuote(code, quote)
		if !wasQuoted && quote == 0 && code == '>' {
			return index + 1
		}
		if !wasQuoted && quote == 0 && code == '<' {
			return start
		}
	}
	return start
}

func nextQuote(code, quote uint16) uint16 {
	if quote != 0 {
		if code == quote {
			return 0
		}
		return quote
	}
	if code == '"' || code == '\'' {
		return code
	}
	return 0
}

func entityEnd(text jsjson.Str, start int) int {
	index := start + 1
	if charAt(text, index) == '#' {
		index++
	}
	limit := min(len(text), start+maxEntityLength)
	for ; index < limit; index++ {
		code := text[index]
		if code == ';' {
			if index > start+1 {
				return index + 1
			}
			return start
		}
		if !(code >= '0' && code <= '9' || code >= 'A' && code <= 'Z' || code >= 'a' && code <= 'z') {
			return start
		}
	}
	return start
}

// charAt is JS charCodeAt with 0 past the end.
func charAt(text jsjson.Str, index int) uint16 {
	if index >= 0 && index < len(text) {
		return text[index]
	}
	return 0
}

// codePoints keeps a lone surrogate as its own entry, like JS's string iterator.
func codePoints(text jsjson.Str) []jsjson.Str {
	points := make([]jsjson.Str, 0, len(text))
	for index := 0; index < len(text); index++ {
		if isHigh(text[index]) && index+1 < len(text) && isLow(text[index+1]) {
			points = append(points, text[index:index+2])
			index++
			continue
		}
		points = append(points, text[index:index+1])
	}
	return points
}

func myersOps(before, after []jsjson.Str) ([]TextEdit, bool) {
	limit := min(len(before)+len(after), MaxDiffDistance)
	v := map[int]int{1: 0}
	var trace []map[int]int
	for depth := 0; depth <= limit; depth++ {
		trace = append(trace, maps.Clone(v))
		if reachesEnd(before, after, v, depth) {
			return toUnitOps(backtrackMyers(trace, before, after, depth), before), true
		}
	}
	return nil, false
}

// isJSWhitespace is JavaScript's \s, which differs from .NET's at U+0085 and U+FEFF.
func isJSWhitespace(unit uint16) bool {
	switch {
	case unit >= '\t' && unit <= '\r', unit == ' ', unit == 0xA0, unit == 0x1680,
		unit >= 0x2000 && unit <= 0x200A, unit == 0x2028, unit == 0x2029, unit == 0x202F,
		unit == 0x205F, unit == 0x3000, unit == 0xFEFF:
		return true
	}
	return false
}

// tokenize is whitespace runs and non-whitespace runs.
func tokenize(text jsjson.Str) []jsjson.Str {
	var tokens []jsjson.Str
	for start := 0; start < len(text); {
		space := isJSWhitespace(text[start])
		end := start + 1
		for end < len(text) && isJSWhitespace(text[end]) == space {
			end++
		}
		tokens = append(tokens, text[start:end])
		start = end
	}
	return tokens
}

func reachesEnd(before, after []jsjson.Str, v map[int]int, depth int) bool {
	for k := -depth; k <= depth; k += 2 {
		down := k == -depth || (k != depth && v[k-1] < v[k+1])
		start := v[k-1] + 1
		if down {
			start = v[k+1]
		}
		x := slideDiagonal(before, after, start, start-k)
		v[k] = x
		if x >= len(before) && x-k >= len(after) {
			return true
		}
	}
	return false
}

func slideDiagonal(before, after []jsjson.Str, fromX, fromY int) int {
	reach := min(len(before)-fromX, len(after)-fromY)
	matched := 0
	for matched < reach && slices.Equal(before[fromX+matched], after[fromY+matched]) {
		matched++
	}
	return fromX + matched
}

// backtrackMyers walks the trace into edits, then fuses neighbours so a typed
// word is one insert and a delete with an insert at its end is one replacement.
func backtrackMyers(trace []map[int]int, before, after []jsjson.Str, depth int) []TextEdit {
	ops := make([]TextEdit, 0, depth)
	x, y := len(before), len(after)
	for step := depth; step > 0; step-- {
		previous := trace[step]
		k := x - y
		down := k == -step || (k != step && previous[k-1] < previous[k+1])
		previousK := k - 1
		if down {
			previousK = k + 1
		}
		previousX := previous[previousK]
		previousY := previousX - previousK
		if down {
			ops = append(ops, TextEdit{Index: previousX, Insert: after[previousY]})
		} else {
			ops = append(ops, TextEdit{Index: previousX, Remove: 1, Insert: jsjson.Str{}})
		}
		x, y = previousX, previousY
	}
	slices.Reverse(ops)
	fused := make([]TextEdit, 0, len(ops))
	for _, op := range ops {
		if len(fused) == 0 {
			fused = append(fused, op)
			continue
		}
		last := &fused[len(fused)-1]
		abuts := last.Index+last.Remove == op.Index
		switch {
		case abuts && len(last.Insert) == 0 && op.Remove == 0:
			last.Insert = op.Insert
		case abuts && last.Remove == 0 && len(op.Insert) == 0:
			last.Remove = op.Remove
		case abuts && (len(last.Insert) == 0) == (len(op.Insert) == 0):
			last.Remove += op.Remove
			last.Insert = append(slices.Clip(last.Insert), op.Insert...)
		default:
			fused = append(fused, op)
		}
	}
	return fused
}

func toUnitOps(ops []TextEdit, beforeAtoms []jsjson.Str) []TextEdit {
	unitAt := unitOffsets(beforeAtoms)
	out := make([]TextEdit, len(ops))
	for i, op := range ops {
		out[i] = TextEdit{Index: unitAt[op.Index], Remove: unitAt[op.Index+op.Remove] - unitAt[op.Index], Insert: op.Insert}
	}
	return out
}

func unitOffsets(atoms []jsjson.Str) []int {
	offsets := make([]int, len(atoms)+1)
	for i, atom := range atoms {
		offsets[i+1] = offsets[i] + len(atom)
	}
	return offsets
}

// singleOccurrences maps the FNV-1a hash of each run of anchorAtoms atoms to
// where it starts, or -1 when it repeats.
func singleOccurrences(text jsjson.Str, unitAt []int) map[uint32]int {
	found := map[uint32]int{}
	for index := 0; index < len(unitAt)-anchorAtoms; index++ {
		hash := uint32(fnvOffsetBasis)
		for at := unitAt[index]; at < unitAt[index+anchorAtoms]; at++ {
			hash = (hash ^ uint32(text[at])) * fnvPrime
		}
		if _, seen := found[hash]; seen {
			found[hash] = -1
		} else {
			found[hash] = index
		}
	}
	return found
}

type anchor struct{ before, after int }

// anchors is patience diff's anchor step over atoms: runs unique on both
// sides, longest increasing run only.
func anchors(before, after jsjson.Str, beforeUnits, afterUnits []int) []anchor {
	uniqueInBefore := singleOccurrences(before, beforeUnits)
	uniqueInAfter := singleOccurrences(after, afterUnits)
	var pairs []anchor
	for hash, index := range uniqueInBefore {
		inAfter, ok := uniqueInAfter[hash]
		if !ok || index < 0 || inAfter < 0 {
			continue
		}
		// The hash can collide; the runs decide.
		if slices.Equal(before[beforeUnits[index]:beforeUnits[index+anchorAtoms]], after[afterUnits[inAfter]:afterUnits[inAfter+anchorAtoms]]) {
			pairs = append(pairs, anchor{index, inAfter})
		}
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i].before < pairs[j].before })
	var piles, tails []int
	previous := make([]int, len(pairs))
	for pairIndex, pair := range pairs {
		low, high := 0, len(piles)
		for low < high {
			middle := (low + high) >> 1
			if piles[middle] < pair.after {
				low = middle + 1
			} else {
				high = middle
			}
		}
		if low == len(piles) {
			piles = append(piles, pair.after)
			tails = append(tails, pairIndex)
		} else {
			piles[low] = pair.after
			tails[low] = pairIndex
		}
		previous[pairIndex] = -1
		if low > 0 {
			previous[pairIndex] = tails[low-1]
		}
	}
	var chosen []anchor
	if len(piles) > 0 {
		for at := tails[len(piles)-1]; at >= 0; at = previous[at] {
			chosen = append(chosen, pairs[at])
		}
	}
	slices.Reverse(chosen)
	return chosen
}

// singleRegion is lib0's simpleDiffString: the span between the common
// prefix and suffix, both rolled back off a surrogate pair.
func singleRegion(before, after jsjson.Str) (int, int, jsjson.Str) {
	shortest := min(len(before), len(after))
	prefix := 0
	for prefix < shortest && before[prefix] == after[prefix] {
		prefix++
	}
	if prefix > 0 && isHigh(before[prefix-1]) {
		prefix--
	}
	suffix := 0
	for suffix < shortest-prefix && before[len(before)-1-suffix] == after[len(after)-1-suffix] {
		suffix++
	}
	if suffix > 0 && isLow(before[len(before)-suffix]) {
		suffix--
	}
	return prefix, len(before) - prefix - suffix, slices.Clone(after[prefix : len(after)-suffix])
}
