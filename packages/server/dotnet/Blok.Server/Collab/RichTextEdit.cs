using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>One write <see cref="RichTextEdit.Plan"/> asks a formatted text for.</summary>
internal abstract record RichTextOp
{
  /// <summary><c>insert(index, text, attributes)</c>; attributes never null.</summary>
  internal sealed record Insert(int Index, string Text, AnyObject Attributes) : RichTextOp;

  /// <summary><c>insertEmbed(index, embed, attributes)</c>.</summary>
  internal sealed record InsertEmbed(int Index, AnyObject Embed, AnyObject Attributes) : RichTextOp;

  /// <summary><c>delete(index, length)</c>.</summary>
  internal sealed record Delete(int Index, int Length) : RichTextOp;

  /// <summary><c>format(index, length, attributes)</c>; a null value removes that mark.</summary>
  internal sealed record Format(int Index, int Length, AnyObject Attributes) : RichTextOp;
}

/// <summary>
/// Turns a live formatted text into new canonical segments with the fewest
/// writes, so characters outside the change keep their CRDT identity and a
/// peer's concurrent typing or formatting there survives.
///
/// LOCKSTEP with the client's rich write path (document-store.ts
/// <c>updateBlockData</c>): both sides must issue the SAME ops for the same
/// change. The shared fixtures under
/// test/unit/server-conformance/fixtures/rich-text-edits/ pin the ops; their
/// README states the rules this class implements.
/// </summary>
internal static class RichTextEdit
{
  /// <summary>Stands for one embed (or foreign item) in the diffed projection.</summary>
  private const char EmbedUnit = '￼';

  /// <summary>
  /// The ops, in the order to apply them: content edits back to front (each
  /// region's inserts, then its delete), then format calls front to back.
  /// None when the canonical segments are unchanged.
  /// </summary>
  internal static IReadOnlyList<RichTextOp> Plan(IReadOnlyList<YTextDelta> live, AnyArray next)
  {
    // A respelling (attribute order, an extra link key, bold:false) must write
    // nothing, or two peers re-saving it ping-pong forever.
    if (JsJson.Stringify(RichText.FromDelta(live)) == JsJson.Stringify(next))
    {
      return [];
    }

    // From the RAW delta: an item the canonical form drops (a nested type, a
    // non-object embed) still takes one index in Yjs.
    var before = LiveUnits(live);
    var after = NextUnits(next);
    var edits = TextDiff.Diff(Project(before), Project(after));
    var (matchBefore, matchAfter) = Align(before, after, edits);
    var ops = new List<RichTextOp>();

    foreach (var region in Enumerable.Reverse(Regions(matchBefore, matchAfter)))
    {
      var position = region.Before;
      var index = region.After;
      var end = region.After + region.Inserted;

      while (index < end)
      {
        var unit = after[index];

        if (unit.Embed is AnyObject embed)
        {
          ops.Add(new RichTextOp.InsertEmbed(position, embed, RichText.Normalize(unit.Marks)));
          position++;
          index++;

          continue;
        }

        var stop = index;

        while (stop < end && after[stop].Embed is null && after[stop].Segment == unit.Segment)
        {
          stop++;
        }

        var text = string.Concat(after.Skip(index).Take(stop - index).Select(part => part.Character));

        ops.Add(new RichTextOp.Insert(position, text, RichText.Normalize(unit.Marks)));
        position += stop - index;
        index = stop;
      }

      if (region.Removed > 0)
      {
        ops.Add(new RichTextOp.Delete(region.Before + region.Inserted, region.Removed));
      }
    }

    ops.AddRange(FormatOps(before, after, matchAfter));

    return ops;
  }

  internal static void Apply(YTransaction transaction, YTextBase text, IReadOnlyList<RichTextOp> ops)
  {
    foreach (var op in ops)
    {
      switch (op)
      {
        case RichTextOp.Insert insert:
          text.Insert(transaction, insert.Index, insert.Text, insert.Attributes);
          break;

        case RichTextOp.InsertEmbed embed:
          text.InsertEmbed(transaction, embed.Index, embed.Embed, embed.Attributes);
          break;

        case RichTextOp.Delete delete:
          text.Delete(transaction, delete.Index, delete.Length);
          break;

        case RichTextOp.Format format:
          text.Format(transaction, format.Index, format.Length, format.Attributes);
          break;

        default:
          throw new InvalidOperationException($"collab: unknown rich text op {op.GetType().Name}.");
      }
    }
  }

  /// <summary>
  /// One UTF-16 unit, or one embed. <paramref name="Embed"/> is the embed
  /// object; <paramref name="Foreign"/> marks a live item no segment can name,
  /// which never matches anything. Marks are canonical.
  /// </summary>
  private readonly record struct Unit(
      char Character, AnyObject? Embed, bool Foreign, AnyObject? Marks, int Segment);

  private static List<Unit> LiveUnits(IReadOnlyList<YTextDelta> live)
  {
    var units = new List<Unit>();

    foreach (var op in live)
    {
      var marks = RichText.CanonicalMarks(op.Attributes);

      if (op.Insert is string text)
      {
        units.AddRange(text.Select(character => new Unit(character, null, false, marks, -1)));
      }
      else
      {
        units.Add(new Unit(EmbedUnit, op.Insert as AnyObject, op.Insert is not AnyObject, marks, -1));
      }
    }

    return units;
  }

  private static List<Unit> NextUnits(AnyArray next)
  {
    var units = new List<Unit>();

    for (var index = 0; index < next.Count; index++)
    {
      var segment = (AnyObject)next[index]!;

      segment.TryGet("marks", out var marks);

      if (segment.TryGet("text", out var text) && text is string characters)
      {
        units.AddRange(characters.Select(character =>
            new Unit(character, null, false, marks as AnyObject, index)));
      }
      else if (segment.TryGet("embed", out var embed) && embed is AnyObject value)
      {
        units.Add(new Unit(EmbedUnit, value, false, marks as AnyObject, index));
      }
    }

    return units;
  }

  private static string Project(List<Unit> units)
  {
    return string.Concat(units.Select(unit => unit.Character));
  }

  /// <summary>
  /// Which unit each retained unit pairs with, from the text diff of the
  /// projections — then a pair whose units are not the same content (a text
  /// U+FFFC against an embed, two different embeds, a foreign item) is
  /// unpaired, so it becomes a replacement instead of a silent keep.
  /// </summary>
  private static (int[] Before, int[] After) Align(
      List<Unit> before, List<Unit> after, IReadOnlyList<TextEdit> edits)
  {
    var matchBefore = Enumerable.Repeat(-1, before.Count).ToArray();
    var matchAfter = Enumerable.Repeat(-1, after.Count).ToArray();
    var b = 0;
    var a = 0;

    void Keep(int until)
    {
      while (b < until)
      {
        if (SameContent(before[b], after[a]))
        {
          matchBefore[b] = a;
          matchAfter[a] = b;
        }

        b++;
        a++;
      }
    }

    foreach (var edit in edits)
    {
      Keep(edit.Index);
      b += edit.Remove;
      a += edit.Insert.Length;
    }

    Keep(before.Count);

    return (matchBefore, matchAfter);
  }

  private static bool SameContent(Unit live, Unit next)
  {
    if (live.Embed is null && next.Embed is null)
    {
      return !live.Foreign;
    }

    return !live.Foreign &&
        live.Embed is not null &&
        next.Embed is not null &&
        RichText.SameValue(live.Embed, next.Embed);
  }

  private readonly record struct Region(int Before, int Removed, int After, int Inserted);

  /// <summary>Each maximal run of unpaired units on either side, front to back.</summary>
  private static List<Region> Regions(int[] matchBefore, int[] matchAfter)
  {
    var regions = new List<Region>();
    var b = 0;
    var a = 0;

    while (b < matchBefore.Length || a < matchAfter.Length)
    {
      if (b < matchBefore.Length && a < matchAfter.Length && matchBefore[b] == a)
      {
        b++;
        a++;

        continue;
      }

      var startBefore = b;
      var startAfter = a;

      while (b < matchBefore.Length && matchBefore[b] < 0)
      {
        b++;
      }

      while (a < matchAfter.Length && matchAfter[a] < 0)
      {
        a++;
      }

      regions.Add(new Region(startBefore, b - startBefore, startAfter, a - startAfter));
    }

    return regions;
  }

  /// <summary>
  /// Over the kept units, in final positions: only the mark keys whose
  /// canonical value changed, sorted, null for a removed one. Adjacent units
  /// with the same change share one call.
  /// </summary>
  private static List<RichTextOp> FormatOps(List<Unit> before, List<Unit> after, int[] matchAfter)
  {
    var ops = new List<RichTextOp>();
    var start = -1;
    var length = 0;
    AnyObject? pending = null;
    string? pendingKey = null;

    void Flush()
    {
      if (pending is not null)
      {
        ops.Add(new RichTextOp.Format(start, length, pending));
      }

      pending = null;
      pendingKey = null;
    }

    for (var index = 0; index < after.Count; index++)
    {
      var changes = matchAfter[index] < 0
        ? null
        : Changes(before[matchAfter[index]].Marks, after[index].Marks);

      if (changes is null)
      {
        Flush();

        continue;
      }

      var key = JsJson.Stringify(changes);

      if (pending is not null && key == pendingKey && start + length == index)
      {
        length++;

        continue;
      }

      Flush();
      pending = changes;
      pendingKey = key;
      start = index;
      length = 1;
    }

    Flush();

    return ops;
  }

  private static AnyObject? Changes(AnyObject? live, AnyObject? next)
  {
    var keys = (live ?? new AnyObject()).Select(entry => entry.Key)
        .Concat((next ?? new AnyObject()).Select(entry => entry.Key))
        .Distinct(StringComparer.Ordinal)
        .Order(StringComparer.Ordinal);
    var changes = new AnyObject();

    foreach (var key in keys)
    {
      object? liveValue = null;
      object? nextValue = null;
      var inLive = live is not null && live.TryGet(key, out liveValue);
      var inNext = next is not null && next.TryGet(key, out nextValue);

      if (inLive == inNext && RichText.SameValue(liveValue, nextValue))
      {
        continue;
      }

      changes.Add(key, inNext ? RichText.NormalizeValue(nextValue) : null);
    }

    return changes.Count == 0 ? null : changes;
  }
}
