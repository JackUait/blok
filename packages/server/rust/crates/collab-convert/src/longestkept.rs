/// C# CollabLongestKeptOrder.Of: the indexes into `positions` of a longest
/// strictly increasing run, the blocks a move leaves in place. Among runs of
/// one length it keeps the one the tie rule of the shared lis-cases.json
/// fixture names, so the TS diff, C#, Go and Rust keep the same.
pub fn longest_kept_order(positions: &[i64]) -> Vec<usize> {
    // tails[k] is the index of the smallest-position end of a run of length k+1.
    let mut tails: Vec<usize> = Vec::new();
    let mut previous: Vec<Option<usize>> = vec![None; positions.len()];
    for (i, &position) in positions.iter().enumerate() {
        // The first tail at or above this position keeps the run strict.
        let low = tails.partition_point(|&tail| positions[tail] < position);
        if low > 0 {
            previous[i] = Some(tails[low - 1]);
        }
        if low == tails.len() {
            tails.push(i);
        } else {
            tails[low] = i;
        }
    }
    let mut kept = Vec::with_capacity(tails.len());
    let mut cursor = tails.last().copied();
    while let Some(index) = cursor {
        kept.push(index);
        cursor = previous[index];
    }
    kept.reverse();
    kept
}
