using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>Changes by time range through the room manager: one budget across lineages.</summary>
public sealed partial class CollabHistoryManagerTests
{
  private static readonly DateTimeOffset Start = DateTimeOffset.MinValue;
  private static readonly DateTimeOffset End = DateTimeOffset.MaxValue;

  // Two lineages whose rows together pass the byte cap: the older lineage
  // replays with what the newer one left, so the answer stops at the cap.
  [Fact]
  public async Task ChangesBetweenKeepsOneByteBudgetAcrossLineages()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "old one"));
    await EditAsync(manager, Update("a", "old two"));
    await ResetAsync(manager);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "new one"));
    var current = Lineage();
    var all = await manager.ChangesBetweenAsync(DocId, Start, End, null);

    Assert.Equal(3, all.Records.Count);
    Assert.False(all.Truncated);

    var budget = CollabVersionChanges.RecordBytes(all.Records[0].Changes) +
        CollabVersionChanges.RecordBytes(all.Records[1].Changes) / 2;
    var result = await manager.ChangesBetweenAsync(DocId, Start, End, null, maxBytes: (int)budget);

    Assert.True(result.Truncated);
    Assert.Equal([current], result.Records.Select(record => record.Lineage));
  }

  // A lineage cut by its own replay ends the answer: an older lineage that
  // would still fit must not follow it, or the cut rows would be skipped.
  [Fact]
  public async Task ChangesBetweenStopsAtALineageItsOwnReplayCut()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "s"));
    await ResetAsync(manager);
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", new string('x', 1000)));
    await EditAsync(manager, Update("a", new string('y', 1000)));
    var current = Lineage();
    var all = await manager.ChangesBetweenAsync(DocId, Start, End, null);

    Assert.Equal(3, all.Records.Count);

    var budget = CollabVersionChanges.RecordBytes(all.Records[0].Changes) +
        CollabVersionChanges.RecordBytes(all.Records[2].Changes);
    var result = await manager.ChangesBetweenAsync(DocId, Start, End, null, maxBytes: (int)budget);

    Assert.True(result.Truncated);
    Assert.Equal([(current, 2UL)], result.Records.Select(record => (record.Lineage, record.Changes.Sequence)));
  }

  [Fact]
  public async Task ChangesBetweenReadsAtMostEightLineages()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    var lineages = new List<string>();

    for (var i = 0; i <= CollabHistoryTime.MaxRangeLineages; i++)
    {
      if (i > 0)
      {
        await ResetAsync(manager);
        await LoadAsync(manager);
      }

      await EditAsync(manager, Update("a", $"v{i}"));
      lineages.Add(Lineage());
    }

    var result = await manager.ChangesBetweenAsync(DocId, Start, End, null);

    Assert.True(result.Truncated);
    Assert.Equal(lineages.Skip(1).Reverse(), result.Records.Select(record => record.Lineage));
  }
}
