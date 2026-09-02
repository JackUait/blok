using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Documents nested far deeper than any editor produces. A peer can build one
/// out of ordinary shallow updates, so no per-update screen can refuse it, and
/// a walk that recurses per level would take the process down with it: .NET
/// cannot catch a StackOverflowException, which is the abort-by-document-data
/// failure this engine exists to remove.
/// </summary>
public sealed class DeepDocumentTests
{
  /// <summary>
  /// Real yjs dies at roughly two thousand levels on node's default stack, so
  /// this sits well past any plausible CLR frame budget.
  /// </summary>
  private const int Depth = 10_000;

  [Fact]
  public void DeletingADeeplyNestedChainDoesNotRecursePerLevel()
  {
    var doc = new YDoc(1000);
    var blocks = doc.GetMap("blocks");

    Nest(doc, blocks, Depth);

    doc.Transact(transaction => blocks.Remove(transaction, "c"));

    Assert.Equal(0, blocks.Count);
    Assert.False(blocks.TryGet("c", out _));
    Assert.False(doc.HasPending);
  }

  /// <summary>
  /// Content GC runs in the same transaction as the delete, on a document the
  /// delete has just marked from top to bottom, so it walks the same depth.
  /// </summary>
  [Fact]
  public void CollectingADeeplyNestedChainDoesNotRecursePerLevel()
  {
    var doc = new YDoc(1000) { Gc = true };
    var blocks = doc.GetMap("blocks");

    Nest(doc, blocks, Depth);

    doc.Transact(transaction => blocks.Clear(transaction));

    Assert.Equal(0, blocks.Count);
  }

  /// <summary>
  /// A remote peer's chain, one level per update, is what makes this reachable:
  /// every update is shallow, so <see cref="UpdateInspector"/> sees nothing.
  /// </summary>
  [Fact]
  public void AChainBuiltOneLevelPerUpdateIsAcceptedAndThenDeletable()
  {
    var author = new YDoc(1000);
    var updates = new List<byte[]>();

    Nest(author, author.GetMap("blocks"), Depth, updates);

    var peer = new YDoc(1001);

    foreach (var update in updates)
    {
      Assert.Equal(UpdateVerdict.Ok, UpdateInspector.Inspect(update).Verdict);
      Assert.Equal(ApplyOutcome.Applied, peer.ApplyUpdate(update).Outcome);
    }

    var blocks = peer.GetMap("blocks");

    peer.Transact(transaction => blocks.Remove(transaction, "c"));

    Assert.Equal(0, blocks.Count);
  }

  private static void Nest(YDoc doc, YMap root, int levels, List<byte[]>? updates = null)
  {
    var cursor = root;

    for (var level = 0; level < levels; level++)
    {
      var child = new YMap();
      var owner = cursor;
      var update = doc.Transact(transaction => owner.Set(transaction, "c", child));

      if (update is not null)
      {
        updates?.Add(update);
      }

      cursor = child;
    }
  }
}
