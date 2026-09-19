using System.Text.RegularExpressions;

namespace Blok.Server.Collab;

/// <summary>One edit turning the stored text into the saved text.</summary>
/// <param name="Index">Offset into the stored text, in UTF-16 code units.</param>
/// <param name="Remove">How many code units to drop at <paramref name="Index"/>.</param>
/// <param name="Insert">What to put there instead.</param>
internal readonly record struct TextEdit(int Index, int Remove, string Insert);

/// <summary>
/// The smallest set of edits turning one string into another.
///
/// Minimal, not single-region, because these edits merge with a peer's. A
/// one-region diff describes "wrap this phrase in a tag" as "delete the phrase,
/// insert the tagged phrase" — so two peers wrapping OVERLAPPING phrases each
/// delete what the other re-inserts, and the shared words land twice while the
/// rest is dropped.
///
/// This is a port of the client's <c>diffText</c>
/// (src/components/modules/yjs/document-store.ts). THE TWO MUST MOVE TOGETHER:
/// a host's /edit push and a browser's save have to describe the same change
/// the same way, or the same document is described differently on the two sides
/// and merges differently. Change one, change the other — the cap, the tiers
/// and the units all have to stay equal.
/// </summary>
internal static partial class TextDiff
{
  /// <summary>
  /// How far each bounded search looks before giving up. Myers costs O(N·D) in
  /// the edit distance: typing is D of about 1 and wrapping a range in tags is
  /// D of about 7, so the cap never bites a real edit, while a whole-string
  /// replacement — a paste over a selection, a tool normalising its own markup
  /// — has a D the size of the text and costs seconds at a few thousand
  /// characters. Past the cap the search is re-run over WORDS, and only past
  /// that does the single-region answer stand.
  ///
  /// Same value as MAX_DIFF_DISTANCE in document-store.ts. Widen the UNITS,
  /// not the cap.
  /// </summary>
  internal const int MaxDiffDistance = 64;

  /// <summary>
  /// JavaScript's <c>\s</c>, spelled out. .NET's differs at both ends — it
  /// counts U+0085 and does not count U+FEFF — and the two sides have to split
  /// words at exactly the same places.
  /// </summary>
  private const string JsWhitespace =
      @"\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

  /// <summary>
  /// The edits turning <paramref name="before"/> into <paramref name="after"/>,
  /// in ascending order of index, every index counting from
  /// <paramref name="before"/>. Apply them BACK TO FRONT.
  /// </summary>
  internal static IReadOnlyList<TextEdit> Diff(string before, string after)
  {
    // Code POINTS, not code units. An emoji is two units, and an edit boundary
    // between them puts the halves in separate CRDT items, which shows the peer
    // (and the writer) a broken character.
    var beforePoints = CodePoints(before);
    var afterPoints = CodePoints(after);
    var charOps = MyersOps(beforePoints, afterPoints);

    if (charOps is not null)
    {
      return charOps;
    }

    // Code units, and surrogate-safe: lib0's own ends roll back off a surrogate
    // boundary, so the region never starts or ends inside a character.
    var (index, remove, insert) = SingleRegion(before, after);

    if (remove == 0 && insert.Length == 0)
    {
      return [];
    }

    // Past the cap by characters: the same search over the WORDS of that one
    // region, so a bulk rewrite is a few narrow edits and a peer's keystroke
    // outside them keeps the neighbours Yjs anchors it to.
    var wordOps = MyersOps(Tokenize(before.Substring(index, remove)), Tokenize(insert));

    return wordOps is null
        ? [new TextEdit(index, remove, insert)]
        : wordOps.Select(op => new TextEdit(op.Index + index, op.Remove, op.Insert)).ToArray();
  }

  /// <summary>
  /// Myers over a sequence, bounded by <see cref="MaxDiffDistance"/>. Null when
  /// the two sequences are further apart than the cap allows it to look.
  /// </summary>
  private static TextEdit[]? MyersOps(string[] before, string[] after)
  {
    var limit = Math.Min(before.Length + after.Length, MaxDiffDistance);
    var v = new Dictionary<int, int> { [1] = 0 };
    var trace = new List<Dictionary<int, int>>();

    for (var depth = 0; depth <= limit; depth++)
    {
      trace.Add(new Dictionary<int, int>(v));

      if (ReachesEnd(before, after, v, depth))
      {
        return ToUnitOps(BacktrackMyers(trace, before, after, depth), before);
      }
    }

    return null;
  }

  /// <summary>
  /// Splits a string into code points. A well-formed surrogate pair is one
  /// entry; a LONE surrogate stays an entry of its own, because dropping or
  /// replacing it would rewrite text the caller never changed. Mirrors
  /// JavaScript's string iterator, which the client splits with.
  /// </summary>
  private static string[] CodePoints(string value)
  {
    var points = new List<string>(value.Length);

    for (var index = 0; index < value.Length; index++)
    {
      if (char.IsHighSurrogate(value[index]) &&
          index + 1 < value.Length &&
          char.IsLowSurrogate(value[index + 1]))
      {
        points.Add(value.Substring(index, 2));
        index++;

        continue;
      }

      points.Add(value[index].ToString());
    }

    return points.ToArray();
  }

  /// <summary>
  /// Whitespace runs and non-whitespace runs, in order, concatenating back to
  /// <paramref name="text"/>. A word is one element, so a bulk edit that
  /// rewrites words has an edit distance the size of the words it touched
  /// rather than the characters.
  /// </summary>
  private static string[] Tokenize(string text)
  {
    return WordRuns().Matches(text).Select(match => match.Value).ToArray();
  }

  [GeneratedRegex($"[{JsWhitespace}]+|[^{JsWhitespace}]+")]
  private static partial Regex WordRuns();

  /// <summary>
  /// One step of the search: extend every diagonal reachable at
  /// <paramref name="depth"/>, recording how far each one got. True once a path
  /// has consumed both sequences.
  /// </summary>
  private static bool ReachesEnd(string[] before, string[] after, Dictionary<int, int> v, int depth)
  {
    for (var k = -depth; k <= depth; k += 2)
    {
      var down = k == -depth || (k != depth && Reach(v, k - 1) < Reach(v, k + 1));
      var start = down ? Reach(v, k + 1) : Reach(v, k - 1) + 1;
      var x = SlideDiagonal(before, after, start, start - k);

      v[k] = x;

      if (x >= before.Length && x - k >= after.Length)
      {
        return true;
      }
    }

    return false;
  }

  private static int Reach(Dictionary<int, int> v, int k)
  {
    return v.TryGetValue(k, out var x) ? x : 0;
  }

  /// <summary>
  /// How far a Myers step can run along the diagonal: the two sequences agree
  /// element for element from (fromX, fromY) until they do not.
  /// </summary>
  private static int SlideDiagonal(string[] before, string[] after, int fromX, int fromY)
  {
    var reach = Math.Min(before.Length - fromX, after.Length - fromY);
    var matched = 0;

    while (matched < reach &&
           string.Equals(before[fromX + matched], after[fromY + matched], StringComparison.Ordinal))
    {
      matched++;
    }

    return fromX + matched;
  }

  /// <summary>
  /// Walks a Myers trace back into edits, oldest first, then fuses neighbours
  /// so a typed word is one insert and not one per character.
  /// </summary>
  private static List<TextEdit> BacktrackMyers(
      List<Dictionary<int, int>> trace, string[] before, string[] after, int depth)
  {
    var ops = new List<TextEdit>();
    var x = before.Length;
    var y = after.Length;

    for (var step = depth; step > 0; step--)
    {
      var previous = trace[step];
      var k = x - y;
      var down = k == -step || (k != step && Reach(previous, k - 1) < Reach(previous, k + 1));
      var previousK = down ? k + 1 : k - 1;
      var previousX = Reach(previous, previousK);
      var previousY = previousX - previousK;

      ops.Add(down
          ? new TextEdit(previousX, 0, after[previousY])
          : new TextEdit(previousX, 1, string.Empty));

      x = previousX;
      y = previousY;
    }

    ops.Reverse();

    var fused = new List<TextEdit>(ops.Count);

    foreach (var op in ops)
    {
      var last = fused.Count == 0 ? (TextEdit?)null : fused[^1];
      var adjacent = last is not null &&
          last.Value.Index + last.Value.Remove == op.Index &&
          (last.Value.Insert.Length == 0) == (op.Insert.Length == 0);

      if (adjacent && last is not null)
      {
        fused[^1] = new TextEdit(
            last.Value.Index,
            last.Value.Remove + op.Remove,
            last.Value.Insert + op.Insert);

        continue;
      }

      fused.Add(op);
    }

    return fused;
  }

  /// <summary>
  /// Re-expresses edits counted in whole units — code points, or words — as the
  /// code-unit offsets <c>YText</c> indexes by.
  /// </summary>
  private static TextEdit[] ToUnitOps(List<TextEdit> ops, string[] beforeUnits)
  {
    var unitAt = new int[beforeUnits.Length + 1];

    for (var index = 0; index < beforeUnits.Length; index++)
    {
      unitAt[index + 1] = unitAt[index] + beforeUnits[index].Length;
    }

    return ops
        .Select(op => new TextEdit(
            unitAt[op.Index],
            unitAt[op.Index + op.Remove] - unitAt[op.Index],
            op.Insert))
        .ToArray();
  }

  /// <summary>
  /// The one changed region: everything between the common prefix and the
  /// common suffix, both ends rolled back off a surrogate pair. Mirrors
  /// <c>lib0</c>'s <c>simpleDiffString</c>, which the client uses here.
  /// </summary>
  private static (int Index, int Remove, string Insert) SingleRegion(string before, string after)
  {
    var shortest = Math.Min(before.Length, after.Length);
    var prefix = 0;

    while (prefix < shortest && before[prefix] == after[prefix])
    {
      prefix++;
    }

    if (prefix > 0 && char.IsHighSurrogate(before[prefix - 1]))
    {
      prefix--;
    }

    var suffix = 0;

    while (suffix < shortest - prefix &&
           before[before.Length - 1 - suffix] == after[after.Length - 1 - suffix])
    {
      suffix++;
    }

    if (suffix > 0 && char.IsLowSurrogate(before[before.Length - suffix]))
    {
      suffix--;
    }

    return (prefix,
        before.Length - prefix - suffix,
        after.Substring(prefix, after.Length - prefix - suffix));
  }
}
