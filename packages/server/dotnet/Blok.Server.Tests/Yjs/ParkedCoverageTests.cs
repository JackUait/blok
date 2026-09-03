using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// What <see cref="ApplyResult.Changed"/> reports for an update that only
/// parks. A caller journals, relays and persists on this answer, so a false
/// FALSE means an update applied to the live document and recorded nowhere.
///
/// These live at the engine, not in the room's tests, because the room cannot
/// express them in wire bytes: <see cref="UpdateV1Decoder"/> advances the
/// clock per struct and refuses a client listed twice, so no single v1 update
/// can carry overlapping struct runs.
/// </summary>
public sealed class ParkedCoverageTests
{
  private const ulong Peer = 7;

  /// <summary>
  /// Overlapping parked runs both survive: <c>MergeParked</c> drops only a run
  /// FULLY covered by one kept before it. Summing lengths therefore counts the
  /// shared clocks twice, and this arrival — which replaces the covered run
  /// with one of the SAME total length further along — keeps the sum at 8
  /// while the clocks actually parked go from 5 to 8.
  /// </summary>
  [Fact]
  public void AnArrivalThatWidensOverlappingParkedRunsIsAChange()
  {
    var doc = new YDoc(1000);

    // (5,5) and (6,3): raw 8, but only clocks 5..9 are parked. Both readings
    // are asserted, because the raw one is the fixture's PREMISE — if
    // MergeParked ever folded these two at park time it would silently become
    // 5, and the trap this test exercises would stop existing unnoticed.
    Apply(doc, [Run(5, "aaaaa"), Run(6, "bbb")]);
    Assert.Equal(8UL, RawParkedLength(doc));
    Assert.Equal(5UL, ParkedUnion(doc));

    var arrival = Apply(doc, [Run(10, "ccc")]);

    // (6,3) is dropped as covered and (10,3) takes its place: raw 8 either way.
    Assert.Equal(8UL, RawParkedLength(doc));
    Assert.Equal(8UL, ParkedUnion(doc));
    Assert.True(arrival.Changed, "three newly parked clocks were reported as no change");
  }

  /// <summary>
  /// The struct half and the delete half are measured as SEPARATE unions and
  /// added. A clock parked as a struct and then named by a parked deletion is
  /// two different facts about that clock; folding both into one set would
  /// leave the total at 4 across this deletion and swallow it.
  /// </summary>
  [Fact]
  public void AParkedDeletionOfAlreadyParkedClocksIsAChange()
  {
    var doc = new YDoc(1000);

    Apply(doc, [Run(1, "aaaa")]);
    Assert.Equal(4UL, ParkedUnion(doc));

    var deletions = new DeleteSet();
    deletions.Add(Peer, 1, 4);
    var arrival = Apply(doc, [], deletions);

    Assert.Equal(8UL, ParkedUnion(doc));
    Assert.True(arrival.Changed, "a deletion of already-parked clocks was reported as no change");
  }

  /// <summary>
  /// The invariant behind both cases above, swept over real doc-produced
  /// updates: an apply that grows what the document has parked must report a
  /// change. This is the search that produced the "729 combinations, no
  /// counter-example" claim in the task report — kept as a running test so the
  /// number can be checked rather than taken on trust.
  /// </summary>
  [Fact]
  public void NoApplyThatGrowsParkedContentReportsNoChange()
  {
    var stray = new YDoc((uint)Peer);
    var text = stray.GetText("content");
    Insert(stray, "a");
    Insert(stray, "bcdefgh");
    stray.Transact(transaction => text.Delete(transaction, 3, 2));
    Insert(stray, "ijkl");
    Insert(stray, "mnop");

    ulong[] cuts = [1, 2, 3, 4, 5, 6, 8, 9, 10];
    var updates = cuts.ToDictionary(cut => cut, cut => stray.EncodeStateAsUpdate(StateVectorAt(cut)));
    var swept = 0;

    foreach (var first in cuts)
    {
      foreach (var second in cuts)
      {
        foreach (var third in cuts)
        {
          var doc = new YDoc(1000);
          doc.ApplyUpdate(updates[first]);
          doc.ApplyUpdate(updates[second]);
          var before = ParkedUnion(doc);
          var result = doc.ApplyUpdate(updates[third]);
          swept++;

          if (ParkedUnion(doc) > before)
          {
            Assert.True(
                result.Changed,
                $"{first},{second} -> {third} parked more and reported no change");
          }
        }
      }
    }

    Assert.Equal(729, swept);
  }

  private static ApplyResult Apply(
      YDoc doc,
      IReadOnlyList<DecodedStruct> structs,
      DeleteSet? deletions = null)
  {
    return doc.ApplyUpdate(new DecodedUpdate(
        new Dictionary<ulong, IReadOnlyList<DecodedStruct>> { [Peer] = structs },
        deletions ?? new DeleteSet()));
  }

  /// <summary>The first item of a run: a root parent and no origin.</summary>
  private static DecodedStruct Run(ulong clock, string text)
  {
    return new DecodedStruct(
        new YId(Peer, clock), text.Length, DecodedStructKind.Item,
        null, null, "t", null, null, new ContentString(text), 0x04);
  }

  private static void Insert(YDoc doc, string chunk)
  {
    var text = doc.GetText("content");

    doc.Transact(transaction => text.Insert(transaction, text.ToString().Length, chunk));
  }

  private static byte[] StateVectorAt(ulong clock)
  {
    var vector = new StateVector();
    vector.Set(Peer, clock);

    return vector.Encode();
  }

  private static ulong RawParkedLength(YDoc doc)
  {
    var raw = 0UL;

    foreach (var waiting in doc.Store.PendingStructs ?? [])
    {
      raw += (ulong)waiting.Length;
    }

    return raw;
  }

  /// <summary>
  /// The measure ParkedCoverage implements, restated here so a test failure
  /// names the quantity rather than the implementation: two unions, added.
  /// </summary>
  private static ulong ParkedUnion(YDoc doc)
  {
    var structs = new DeleteSet();

    foreach (var waiting in doc.Store.PendingStructs ?? [])
    {
      structs.Add(waiting.Id.Client, waiting.Id.Clock, (ulong)waiting.Length);
    }

    var deletions = new DeleteSet();

    if (doc.Store.PendingDs is { } parked)
    {
      foreach (var (client, ranges) in parked.Clients)
      {
        foreach (var range in ranges)
        {
          deletions.Add(client, range.Clock, range.Length);
        }
      }
    }

    return UnionLength(structs) + UnionLength(deletions);
  }

  private static ulong UnionLength(DeleteSet ranges)
  {
    ranges.SortAndMerge();

    var length = 0UL;

    foreach (var (_, merged) in ranges.Clients)
    {
      foreach (var range in merged)
      {
        length += range.Length;
      }
    }

    return length;
  }
}
