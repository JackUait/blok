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
/// Three steps, each narrower than the next is wide:
///
/// 1. Myers over ATOMS — a whole tag, a whole entity, otherwise a code point
///    (see <see cref="Atomize"/>).
/// 2. Once the atom distance passes the cap, SPLIT both texts at runs of atoms
///    that occur exactly once on both sides — they can only be each other — and
///    answer each gap between two anchors on its own.
/// 3. Per gap, <see cref="CoarseOps"/>: the words of that gap, then the gap's
///    single region. With no anchors at all the single gap spans everything and
///    the answer is exactly what it was before the anchor tier existed.
///
/// This is a port of the client's <c>diffText</c>
/// (src/components/modules/yjs/text-diff.ts). THE TWO MUST MOVE TOGETHER: a
/// host's /edit push and a browser's save have to describe the same change the
/// same way, or the same document is described differently on the two sides and
/// merges differently. Change one, change the other — the cap, the tiers, the
/// units, the anchor hash and the fusing all have to stay equal.
/// </summary>
internal static partial class TextDiff
{
  /// <summary>
  /// How far each bounded search looks before giving up. Myers costs O(N·D) in
  /// the edit distance: typing is D of about 1 and wrapping a range in tags is
  /// D of about 2 — a complete tag is ONE unit here — so the cap never bites a
  /// real edit, while a whole-string replacement — a paste over a selection, a
  /// tool normalising its own markup — has a D the size of the text and costs
  /// seconds at a few thousand characters. Past the cap both texts are split at
  /// anchors and every gap is answered on its own (<see cref="Diff"/>).
  ///
  /// Same value as MAX_DIFF_DISTANCE in text-diff.ts. Widen the UNITS, not the
  /// cap.
  /// </summary>
  internal const int MaxDiffDistance = 64;

  /// <summary>
  /// How many atoms an anchor is measured over. A single atom is almost never
  /// unique — every <c>e</c> in the paragraph is the same atom — so anchoring
  /// on one finds nothing in ordinary prose. Three consecutive atoms is the
  /// shortest run that is unique in everyday text.
  /// </summary>
  private const int AnchorAtoms = 3;

  /// <summary>
  /// Longest an entity reference may be before the scanner gives up and treats
  /// the <c>&amp;</c> as ordinary text.
  /// <c>&amp;CounterClockwiseContourIntegral;</c> is the longest named
  /// reference HTML defines, at 31 characters plus the ampersand.
  /// </summary>
  private const int MaxEntityLength = 32;

  private const uint FnvOffsetBasis = 0x811c9dc5;
  private const uint FnvPrime = 0x01000193;

  /// <summary>
  /// JavaScript's <c>\s</c>, spelled out. .NET's differs at both ends — it
  /// counts U+0085 and does not count U+FEFF — and the two sides have to split
  /// words at exactly the same places.
  /// </summary>
  private const string JsWhitespace =
      @"\t\n\v\f\r    -     　﻿";

  /// <summary>
  /// The edits turning <paramref name="before"/> into <paramref name="after"/>,
  /// in ascending order of index, every index counting from
  /// <paramref name="before"/>. Apply them BACK TO FRONT, and each one INSERT
  /// FIRST (see <c>YDocConverter.EditText</c>).
  /// </summary>
  internal static IReadOnlyList<TextEdit> Diff(string before, string after)
  {
    var beforeAtoms = Atomize(before);
    var afterAtoms = Atomize(after);
    var atomOps = MyersOps(beforeAtoms, afterAtoms);

    if (atomOps is not null)
    {
      return atomOps;
    }

    var beforeUnits = UnitOffsets(beforeAtoms);
    var afterUnits = UnitOffsets(afterAtoms);
    var found = Anchors(before, after, beforeUnits, afterUnits);

    if (found.Count == 0)
    {
      return CoarseOps(before, after);
    }

    // Anchors are SPLIT POINTS, not consumed matches: every atom stays inside
    // some gap, and each gap's ops turn that gap of `before` into that gap of
    // `after` on their own. The result is then exactly `after` whatever the
    // anchors were — a bad pairing can only cost a worse answer, never a wrong
    // one.
    var ops = new List<TextEdit>();
    var beforeFrom = 0;
    var afterFrom = 0;

    foreach (var (beforeIndex, afterIndex) in
        found.Append((beforeAtoms.Length, afterAtoms.Length)))
    {
      var beforeText = before[beforeUnits[beforeFrom]..beforeUnits[beforeIndex]];
      var afterText = after[afterUnits[afterFrom]..afterUnits[afterIndex]];

      if (!string.Equals(beforeText, afterText, StringComparison.Ordinal))
      {
        var gapOps = MyersOps(beforeAtoms[beforeFrom..beforeIndex], afterAtoms[afterFrom..afterIndex]) ??
            CoarseOps(beforeText, afterText);
        var shift = beforeUnits[beforeFrom];

        ops.AddRange(gapOps.Select(op => op with { Index = op.Index + shift }));
      }

      beforeFrom = beforeIndex;
      afterFrom = afterIndex;
    }

    return ops;
  }

  /// <summary>
  /// The coarse answer for one span: Myers over its WORDS, and the single
  /// region when even that is further than the cap allows.
  ///
  /// What the single-region answer costs is not characters — the length stays
  /// exact — it is POSITION: the one region deletes every character a
  /// concurrent keystroke sat between, so the engine has no surviving
  /// neighbour to anchor it to and it surfaces at the edge of the span.
  /// </summary>
  private static TextEdit[] CoarseOps(string before, string after)
  {
    // Code units, and surrogate-safe: lib0's own ends roll back off a surrogate
    // boundary, so the region never starts or ends inside a character.
    var (index, remove, insert) = SingleRegion(before, after);

    if (remove == 0 && insert.Length == 0)
    {
      return [];
    }

    var wordOps = MyersOps(Tokenize(before.Substring(index, remove)), Tokenize(insert));

    return wordOps is null
        ? [new TextEdit(index, remove, insert)]
        : wordOps.Select(op => op with { Index = op.Index + index }).ToArray();
  }

  /// <summary>
  /// The units the diff may put an edit boundary between: a COMPLETE tag, a
  /// complete entity reference, otherwise one code point.
  ///
  /// This is what stops the merge treating markup as spellable text. A block's
  /// <c>text</c> is the tool's innerHTML — markup and content in one string
  /// with no boundary — and Myers is minimal, so over code points it happily
  /// expresses "bold this word" as "insert <c>&lt;</c>, REUSE the word's own
  /// <c>b</c>, insert <c>&gt;</c>…". The tag then owns a letter of the word,
  /// and the peer fixing that letter is editing the inside of the tag. Whole
  /// tags cannot be half-edited and never share a character with content.
  ///
  /// Code points, never code units: an edit boundary inside a surrogate pair
  /// puts the halves in separate CRDT items and the engine replaces both with
  /// U+FFFD.
  /// </summary>
  internal static string[] Atomize(string text)
  {
    // Nothing structured to protect: split code points in one pass.
    if (!text.Contains('<') && !text.Contains('&'))
    {
      return CodePoints(text);
    }

    var atoms = new List<string>(text.Length);
    var index = 0;

    while (index < text.Length)
    {
      var structured = StructuredEnd(text, index, text[index]);

      if (structured > index)
      {
        atoms.Add(text[index..structured]);
        index = structured;

        continue;
      }

      var size = char.IsHighSurrogate(text[index]) &&
          index + 1 < text.Length &&
          char.IsLowSurrogate(text[index + 1])
        ? 2
        : 1;

      atoms.Add(text.Substring(index, size));
      index += size;
    }

    return atoms.ToArray();
  }

  /// <summary>
  /// Where the structure starting at <paramref name="start"/> ends — a tag, an
  /// entity — or <paramref name="start"/> when nothing structured starts there.
  /// </summary>
  private static int StructuredEnd(string text, int start, char code)
  {
    if (code == '<')
    {
      return TagEnd(text, start);
    }

    return code == '&' ? EntityEnd(text, start) : start;
  }

  /// <summary>
  /// Where the tag that starts at <paramref name="start"/> ends, or
  /// <paramref name="start"/> when the text does not carry a complete tag
  /// there.
  ///
  /// Quoted attribute values are scanned through, because serializing an
  /// element does NOT escape <c>&gt;</c> inside an attribute value —
  /// <c>&lt;a title="a&gt;b"&gt;</c> is a single tag and splitting it at the
  /// first <c>&gt;</c> would hand half of it to the diff.
  /// </summary>
  private static int TagEnd(string text, int start)
  {
    var index = start + 1;

    if (CharAt(text, index) == '/')
    {
      index++;
    }

    var nameStart = CharAt(text, index);

    // `<` followed by anything but a tag name is a literal character the user
    // typed, and must stay one — an atom per code point, exactly as before.
    if (!((nameStart >= 'A' && nameStart <= 'Z') || (nameStart >= 'a' && nameStart <= 'z')))
    {
      return start;
    }

    var quote = '\0';

    while (index < text.Length)
    {
      var code = text[index];
      var wasQuoted = quote != '\0';

      quote = NextQuote(code, quote);

      if (!wasQuoted && quote == '\0' && code == '>')
      {
        return index + 1;
      }

      // A second `<` before any `>`: the first one was literal text.
      if (!wasQuoted && quote == '\0' && code == '<')
      {
        return start;
      }

      index++;
    }

    // Unclosed — a half-typed tag, or text that merely contains a `<`.
    return start;
  }

  /// <summary>
  /// The quote character a tag scanner is inside of after reading
  /// <paramref name="code"/>, or NUL when it is not inside one.
  /// </summary>
  private static char NextQuote(char code, char quote)
  {
    if (quote != '\0')
    {
      return code == quote ? '\0' : quote;
    }

    return code == '"' || code == '\'' ? code : '\0';
  }

  /// <summary>
  /// Where the entity reference that starts at <paramref name="start"/> ends,
  /// or <paramref name="start"/> when there is no complete one there.
  /// </summary>
  private static int EntityEnd(string text, int start)
  {
    var index = start + 1;

    if (CharAt(text, index) == '#')
    {
      index++;
    }

    var limit = Math.Min(text.Length, start + MaxEntityLength);

    for (; index < limit; index++)
    {
      var code = text[index];

      if (code == ';')
      {
        // `&;` is not a reference.
        return index > start + 1 ? index + 1 : start;
      }

      var alphanumeric = (code >= '0' && code <= '9') ||
          (code >= 'A' && code <= 'Z') ||
          (code >= 'a' && code <= 'z');

      if (!alphanumeric)
      {
        return start;
      }
    }

    return start;
  }

  /// <summary>
  /// The character at <paramref name="index"/>, or NUL past the end — what
  /// JavaScript's <c>charCodeAt</c> answers there, which every scanner above
  /// compares against.
  /// </summary>
  private static char CharAt(string text, int index)
  {
    return index >= 0 && index < text.Length ? text[index] : '\0';
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
  /// so a typed word is one insert and not one per character, and so a delete
  /// with an insert against its end is ONE replacement.
  ///
  /// The delete+insert pair matters: applied separately the new text is
  /// anchored to the RIGHT of the run it replaces, so a peer's concurrent
  /// keystroke inside that run — whose own anchor is a character now
  /// tombstoned — surfaces BEFORE all of it.
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
      if (fused.Count == 0)
      {
        fused.Add(op);

        continue;
      }

      var last = fused[^1];
      var abuts = last.Index + last.Remove == op.Index;

      if (abuts && last.Insert.Length == 0 && op.Remove == 0)
      {
        fused[^1] = last with { Insert = op.Insert };

        continue;
      }

      if (abuts && last.Remove == 0 && op.Insert.Length == 0)
      {
        fused[^1] = last with { Remove = op.Remove };

        continue;
      }

      if (abuts && (last.Insert.Length == 0) == (op.Insert.Length == 0))
      {
        fused[^1] = last with
        {
          Remove = last.Remove + op.Remove,
          Insert = last.Insert + op.Insert,
        };

        continue;
      }

      fused.Add(op);
    }

    return fused;
  }

  /// <summary>
  /// Re-expresses edits counted in whole units — atoms, or words — as the
  /// code-unit offsets <c>YText</c> indexes by.
  /// </summary>
  private static TextEdit[] ToUnitOps(List<TextEdit> ops, string[] beforeAtoms)
  {
    var unitAt = UnitOffsets(beforeAtoms);

    return ops
        .Select(op => new TextEdit(
            unitAt[op.Index],
            unitAt[op.Index + op.Remove] - unitAt[op.Index],
            op.Insert))
        .ToArray();
  }

  /// <summary>
  /// Where each atom starts, in the code-unit offsets <c>YText</c> indexes by,
  /// with one extra entry for the end of the string.
  /// </summary>
  private static int[] UnitOffsets(string[] atoms)
  {
    var offsets = new int[atoms.Length + 1];

    for (var index = 0; index < atoms.Length; index++)
    {
      offsets[index + 1] = offsets[index] + atoms[index].Length;
    }

    return offsets;
  }

  /// <summary>
  /// Runs of <see cref="AnchorAtoms"/> atoms that occur exactly once, keyed by
  /// an FNV-1a hash of the run and valued with the atom index it starts at. A
  /// repeated run maps to -1, so a lookup answers "unique, and here" in one
  /// step.
  ///
  /// Hashes, not the runs themselves: slicing a key string per position is far
  /// more expensive on a large rewrite. A hash can collide, so
  /// <see cref="Anchors"/> re-reads the two runs and compares them before
  /// trusting a pair.
  /// </summary>
  private static Dictionary<uint, int> SingleOccurrences(string text, int[] unitAt)
  {
    var found = new Dictionary<uint, int>();
    var last = unitAt.Length - AnchorAtoms;

    for (var index = 0; index < last; index++)
    {
      var hash = FnvOffsetBasis;

      for (var at = unitAt[index]; at < unitAt[index + AnchorAtoms]; at++)
      {
        unchecked
        {
          hash = (hash ^ text[at]) * FnvPrime;
        }
      }

      found[hash] = found.ContainsKey(hash) ? -1 : index;
    }

    return found;
  }

  /// <summary>
  /// Where the two texts can only be each other: runs of atoms occurring
  /// exactly once on both sides, longest increasing run only so the matches
  /// stay in order. Patience diff's anchor step, over atoms rather than lines —
  /// a block has no lines, and a CJK one has no words either.
  /// </summary>
  private static List<(int Before, int After)> Anchors(
      string before, string after, int[] beforeUnits, int[] afterUnits)
  {
    var uniqueInBefore = SingleOccurrences(before, beforeUnits);
    var uniqueInAfter = SingleOccurrences(after, afterUnits);
    var pairs = new List<(int Before, int After)>();

    foreach (var (run, index) in uniqueInBefore)
    {
      var inAfter = uniqueInAfter.TryGetValue(run, out var found) ? found : -1;

      if (index < 0 || inAfter < 0)
      {
        continue;
      }

      // The hash can collide; the runs themselves decide.
      if (string.Equals(
              before[beforeUnits[index]..beforeUnits[index + AnchorAtoms]],
              after[afterUnits[inAfter]..afterUnits[inAfter + AnchorAtoms]],
              StringComparison.Ordinal))
      {
        pairs.Add((index, inAfter));
      }
    }

    // Every surviving run starts at an index of its own, so ordering by the
    // `before` index is total and the pass does not depend on how the hash
    // table enumerates.
    pairs.Sort((left, right) => left.Before.CompareTo(right.Before));

    // Patience sort: `piles[length - 1]` is the smallest `after` index any
    // increasing run of that length can end on, and `previous` chains the run
    // back so the winner can be walked out.
    var piles = new List<int>();
    var tails = new List<int>();
    var previous = new int[pairs.Count];

    for (var pairIndex = 0; pairIndex < pairs.Count; pairIndex++)
    {
      var afterIndex = pairs[pairIndex].After;
      var low = 0;
      var high = piles.Count;

      while (low < high)
      {
        var middle = (low + high) >> 1;

        if (piles[middle] < afterIndex)
        {
          low = middle + 1;
        }
        else
        {
          high = middle;
        }
      }

      if (low == piles.Count)
      {
        piles.Add(afterIndex);
        tails.Add(pairIndex);
      }
      else
      {
        piles[low] = afterIndex;
        tails[low] = pairIndex;
      }

      previous[pairIndex] = low > 0 ? tails[low - 1] : -1;
    }

    var chosen = new List<(int Before, int After)>();

    for (var at = piles.Count == 0 ? -1 : tails[piles.Count - 1]; at >= 0; at = previous[at])
    {
      chosen.Add(pairs[at]);
    }

    chosen.Reverse();

    return chosen;
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
