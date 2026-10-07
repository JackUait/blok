namespace Blok.Server.Collab;

/// <summary>
/// Which blocks stay put when a document is reordered: the longest strictly
/// increasing run of current positions, as indexes into <c>positions</c>.
///
/// The tie-break must match src/view/longest-kept-order.ts, or the server and
/// the client keep different blocks. Both run
/// test/fixtures/version-history/lis-cases.json.
/// </summary>
internal static class CollabLongestKeptOrder
{
  internal static int[] Of(IReadOnlyList<int> positions)
  {
    // tails[k] = index of the smallest-position end of a run of length k + 1.
    var tails = new List<int>();
    var previous = new int[positions.Count];

    for (var i = 0; i < positions.Count; i++)
    {
      // First tail whose position is >= this one; that keeps the run strict.
      var low = 0;
      var high = tails.Count;

      while (low < high)
      {
        var mid = (low + high) / 2;

        if (positions[tails[mid]] < positions[i])
        {
          low = mid + 1;
        }
        else
        {
          high = mid;
        }
      }

      previous[i] = low > 0 ? tails[low - 1] : -1;

      if (low == tails.Count)
      {
        tails.Add(i);
      }
      else
      {
        tails[low] = i;
      }
    }

    var kept = new int[tails.Count];
    var cursor = tails.Count > 0 ? tails[^1] : -1;

    for (var k = kept.Length - 1; k >= 0; k--)
    {
      kept[k] = cursor;
      cursor = previous[cursor];
    }

    return kept;
  }
}
