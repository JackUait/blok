package convert

// LongestKeptOrder is C# CollabLongestKeptOrder.Of: the indexes into positions
// of a longest strictly increasing run, the blocks a move leaves in place.
// Among runs of one length it keeps the one the tie rule of the shared
// lis-cases.json fixture names, so the TS diff, C# and Go keep the same.
func LongestKeptOrder(positions []int) []int {
	// tails[k] is the index of the smallest-position end of a run of length k+1.
	var tails []int
	previous := make([]int, len(positions))
	for i, position := range positions {
		// The first tail at or above this position keeps the run strict.
		low, high := 0, len(tails)
		for low < high {
			mid := (low + high) / 2
			if positions[tails[mid]] < position {
				low = mid + 1
			} else {
				high = mid
			}
		}
		previous[i] = -1
		if low > 0 {
			previous[i] = tails[low-1]
		}
		if low == len(tails) {
			tails = append(tails, i)
		} else {
			tails[low] = i
		}
	}
	kept := make([]int, len(tails))
	cursor := -1
	if len(tails) > 0 {
		cursor = tails[len(tails)-1]
	}
	for k := len(kept) - 1; k >= 0; k-- {
		kept[k] = cursor
		cursor = previous[cursor]
	}
	return kept
}
