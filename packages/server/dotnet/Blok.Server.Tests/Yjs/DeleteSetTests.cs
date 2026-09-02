using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Applying a delete set to a struct store, driven by hand-built items so the
/// edges are exact: a range names clocks, not items, so both edges of the
/// items it lands in have to be cut before anything is marked.
/// </summary>
public sealed class DeleteSetTests
{
  private const ulong Author = 9;

  [Fact]
  public void DeleteRangeSplitsBothEdgesAndParksTheUnappliableTail()
  {
    var doc = new YDoc(1);
    var parent = doc.GetArray("list");
    var run = Run(doc, parent, "a", "b", "c", "d", "e");
    var transaction = new YTransaction(doc, local: false);
    var inside = new DeleteSet();

    inside.Add(Author, 1, 2);

    Assert.Null(inside.Apply(transaction, doc.Store));

    var structs = doc.Store.Clients[Author];

    Assert.Equal(3, structs.Count);
    Assert.Equal([(0UL, 1, false), (1UL, 2, true), (3UL, 2, false)], Shape(structs));

    // The split halves are wired into the chain, not just into the store.
    Assert.Same(run, structs[0]);
    Assert.Same(structs[1], ((YItem)structs[0]).Right);
    Assert.Same(structs[2], ((YItem)structs[1]).Right);
    Assert.Equal(3, parent.Count);

    var past = new DeleteSet();

    past.Add(Author, 3, 5);

    var parked = past.Apply(transaction, doc.Store);

    // The head is inside what the store knows and dies; only the tail waits.
    Assert.Equal([(0UL, 1, false), (1UL, 2, true), (3UL, 2, true)], Shape(doc.Store.Clients[Author]));
    Assert.NotNull(parked);
    Assert.Equal([new DeleteRange(5, 3)], parked.Clients.Single().Value);
    Assert.Equal(Author, parked.Clients.Single().Key);

    // "a" is left: the second range starts at clock 3, not at the head.
    Assert.Equal(1, parent.Count);
  }

  [Fact]
  public void AWholeRangePastTheStateIsParked()
  {
    var doc = new YDoc(1);
    var parent = doc.GetArray("list");

    Run(doc, parent, "a", "b");

    var transaction = new YTransaction(doc, local: false);
    var unknown = new DeleteSet();

    unknown.Add(Author, 2, 4);
    unknown.Add(Author + 1, 0, 1);

    var parked = unknown.Apply(transaction, doc.Store);

    Assert.NotNull(parked);
    Assert.Equal(2, parked.Count);
    Assert.Equal([new DeleteRange(2, 4)], parked.Clients.Single(client => client.Key == Author).Value);
    Assert.Equal([(0UL, 2, false)], Shape(doc.Store.Clients[Author]));
    Assert.True(transaction.DeleteSet.IsEmpty);
  }

  [Fact]
  public void AddThenSortAndMergeFoldsTouchingRanges()
  {
    var set = new DeleteSet();

    set.Add(Author, 6, 2);
    set.Add(Author, 0, 2);
    set.Add(Author, 2, 1);
    set.Add(Author, 1, 4);
    set.Add(Author + 1, 3, 1);

    set.SortAndMerge();

    Assert.Equal(
        [new DeleteRange(0, 5), new DeleteRange(6, 2)],
        set.Clients.Single(client => client.Key == Author).Value);
    Assert.Equal(
        [new DeleteRange(3, 1)],
        set.Clients.Single(client => client.Key == Author + 1).Value);
  }

  private static YItem Run(YDoc doc, YArray parent, params object?[] values)
  {
    var item = new YItem
    {
      Id = new YId(Author, 0),
      Length = values.Length,
      Parent = parent,
      Content = new ContentAny(values),
    };

    doc.Store.AddStruct(item);
    parent.Start = item;
    parent.Length = values.Length;

    return item;
  }

  private static (ulong Clock, int Length, bool Deleted)[] Shape(IEnumerable<YStruct> structs)
  {
    return [.. structs.Select(entry => (entry.Id.Clock, entry.Length, entry.IsDeleted))];
  }
}
