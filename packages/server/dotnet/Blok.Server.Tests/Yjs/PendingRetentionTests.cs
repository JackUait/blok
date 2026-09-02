using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// What the store keeps when an update names clocks it cannot place yet. A
/// peer that received transactions out of order sends exactly these shapes on
/// every sync, so nothing here needs a hostile author.
/// </summary>
public sealed class PendingRetentionTests
{
  private const ulong Peer = 7;

  /// <summary>
  /// A Skip names a hole its sender is not filling. Parking one lets it stand
  /// in for content: the merge that folds a later delivery into the parked set
  /// measures coverage by clock range, so a Skip spanning clocks 18..25 made
  /// the real content for 19..25 look like a duplicate and it was dropped. The
  /// integrator ignores Skips and the diff writer re-derives every hole from
  /// the gaps between parked structs, so a parked Skip has nothing to offer
  /// and one thing to cost.
  /// </summary>
  [Fact]
  public void AParkedSkipDoesNotSwallowContentThatArrivesLater()
  {
    var doc = new YDoc(1000);

    // Item(0,5) integrates; Item(15,3) cannot, so it and the whole tail after
    // it — including the Skip — are parked.
    Apply(doc, [Run(0, "aaaaa"), Skip(5, 10), After(15, 14, "ccc"), Skip(18, 7), After(25, 24, "eeeee")]);

    Assert.DoesNotContain(doc.Store.PendingStructs!, parked => parked is YSkip);

    // The real content for the second hole, from a peer that had it all along.
    Apply(doc, [After(19, 18, "bbbbbb")]);

    Assert.Contains(
        doc.Store.PendingStructs!,
        parked => parked.Id.Clock == 19 && parked.Length == 6);
  }

  /// <summary>
  /// A Skip's length is an int in the store but an unbounded varuint on the
  /// wire, and a peer needs no forgery to park a struct four billion clocks
  /// ahead of what this document holds. Refusing to write the gap took down
  /// every sync answer, every compaction, and — once the pair was in the
  /// working set — every attempt to load the room again.
  /// </summary>
  [Fact]
  public void AGapWiderThanAnIntIsWrittenAsSeveralSkips()
  {
    var doc = new YDoc(1000);

    Apply(doc, [Run(0, "a")]);
    Apply(doc, [Item(4294967295, "b")]);

    var update = doc.EncodeStateAsUpdate();

    Assert.NotEmpty(update);

    var structs = UpdateV1Decoder.Decode(update).Structs[Peer];
    var skips = structs.Where(entry => entry.Kind == DecodedStructKind.Skip).ToList();

    // Together the Skips name the whole hole, and each fits the wire's reader.
    Assert.Equal(2, skips.Count);
    Assert.Equal(4294967294UL, skips.Aggregate(0UL, (total, skip) => total + (ulong)skip.Length));
  }

  /// <summary>
  /// A peer's state vector need not land on a struct boundary, and a diff that
  /// starts mid-run slices the string by UTF-16 code unit — so it can begin on
  /// the low half of an astral character. lib0 substitutes U+FFFD there; this
  /// refused to encode at all, and the sync answer catches only format errors,
  /// so the exception went out to the connection.
  /// </summary>
  [Fact]
  public void ADiffStartingInsideAnAstralCharacterStillEncodes()
  {
    var doc = new YDoc(1000);
    var text = doc.GetText("t");

    doc.Transact(transaction => text.Insert(transaction, 0, "😀"));

    var target = new StateVector();

    target.Set(1000, 1);

    var diff = doc.EncodeStateAsUpdate(target.Encode());

    Assert.Single(UpdateV1Decoder.Decode(diff).Structs);
  }

  private static void Apply(YDoc doc, IReadOnlyList<DecodedStruct> structs)
  {
    doc.ApplyUpdate(new DecodedUpdate(
        new Dictionary<ulong, IReadOnlyList<DecodedStruct>> { [Peer] = structs },
        new DeleteSet()));
  }

  /// <summary>The first item of the run: a root parent and no origin.</summary>
  private static DecodedStruct Run(ulong clock, string text)
  {
    return new DecodedStruct(
        new YId(Peer, clock), text.Length, DecodedStructKind.Item,
        null, null, "t", null, null, new ContentString(text), 0x04);
  }

  /// <summary>An item whose origin is the tick before it.</summary>
  private static DecodedStruct After(ulong clock, ulong origin, string text)
  {
    return new DecodedStruct(
        new YId(Peer, clock), text.Length, DecodedStructKind.Item,
        new YId(Peer, origin), null, null, null, null, new ContentString(text), 0x84);
  }

  private static DecodedStruct Item(ulong clock, string text)
  {
    return Run(clock, text);
  }

  private static DecodedStruct Skip(ulong clock, int length)
  {
    return new DecodedStruct(
        new YId(Peer, clock), length, DecodedStructKind.Skip,
        null, null, null, null, null, null, 10);
  }
}
