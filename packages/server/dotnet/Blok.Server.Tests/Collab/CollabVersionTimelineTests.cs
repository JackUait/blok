using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class CollabVersionTimelineTests
{
  private static readonly DateTimeOffset T0 = new(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);

  private static CollabLineageInfo Lineage(string id, DateTimeOffset? createdAt, bool current = false) =>
      new(id, 1, 2, createdAt, current);

  private static CollabRecordHeader Record(ulong sequence, DateTimeOffset at, string? actor = null) =>
      new(sequence, at, actor);

  private static IReadOnlyList<CollabVersion> Group(
      params (CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)[] lineages) =>
      CollabVersionTimeline.Group(lineages);

  [Fact]
  public void ALineageWithNoRecordsYieldsOnlyItsBaseline()
  {
    var versions = Group((Lineage("L1", T0), []));

    var baseline = Assert.Single(versions);
    Assert.Equal("L1", baseline.Lineage);
    Assert.Equal(0UL, baseline.Sequence);
    Assert.Equal(T0, baseline.StartedAt);
    Assert.Equal(T0, baseline.SavedAt);
    Assert.Empty(baseline.Actors);
  }

  [Fact]
  public void ABaselineWithoutACreatedAtHasNoTimes()
  {
    var baseline = Assert.Single(Group((Lineage("L1", null), [])));

    Assert.Null(baseline.StartedAt);
    Assert.Null(baseline.SavedAt);
  }

  [Fact]
  public void AGapOfExactlyTheIdleGapStaysInTheSameGroup()
  {
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0),
        Record(2, T0 + CollabVersionTimeline.IdleGap),
    ]));

    Assert.Equal(2, versions.Count);
    Assert.Equal(2UL, versions[0].Sequence);
    Assert.Equal(T0, versions[0].StartedAt);
    Assert.Equal(T0 + TimeSpan.FromMinutes(2), versions[0].SavedAt);
    Assert.Equal(0UL, versions[1].Sequence);
  }

  [Fact]
  public void AGapOneTickOverTheIdleGapStartsANewGroup()
  {
    var later = T0 + TimeSpan.FromMinutes(2) + TimeSpan.FromTicks(1);
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0),
        Record(2, later),
    ]));

    Assert.Equal([2UL, 1UL, 0UL], versions.Select(v => v.Sequence));
    Assert.Equal(later, versions[0].StartedAt);
    Assert.Equal(later, versions[0].SavedAt);
    Assert.Equal(T0, versions[1].StartedAt);
    Assert.Equal(T0, versions[1].SavedAt);
  }

  [Fact]
  public void ASpanOfExactlyTheMaxSpanStartsANewGroupAtThatRecord()
  {
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0),
        Record(2, T0 + TimeSpan.FromMinutes(2)),
        Record(3, T0 + TimeSpan.FromMinutes(4)),
        Record(4, T0 + TimeSpan.FromMinutes(6)),
        Record(5, T0 + TimeSpan.FromMinutes(8)),
        Record(6, T0 + TimeSpan.FromMinutes(10)),
        Record(7, T0 + TimeSpan.FromMinutes(11)),
    ]));

    Assert.Equal([7UL, 5UL, 0UL], versions.Select(v => v.Sequence));
    Assert.Equal(T0 + TimeSpan.FromMinutes(10), versions[0].StartedAt);
    Assert.Equal(T0 + TimeSpan.FromMinutes(11), versions[0].SavedAt);
    Assert.Equal(T0, versions[1].StartedAt);
    Assert.Equal(T0 + TimeSpan.FromMinutes(8), versions[1].SavedAt);
  }

  [Fact]
  public void ASpanJustUnderTheMaxSpanStaysInTheSameGroup()
  {
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0),
        Record(2, T0 + TimeSpan.FromMinutes(2)),
        Record(3, T0 + TimeSpan.FromMinutes(4)),
        Record(4, T0 + TimeSpan.FromMinutes(6)),
        Record(5, T0 + TimeSpan.FromMinutes(8)),
        Record(6, T0 + TimeSpan.FromMinutes(10) - TimeSpan.FromTicks(1)),
    ]));

    Assert.Equal([6UL, 0UL], versions.Select(v => v.Sequence));
  }

  [Fact]
  public void ANegativeGapCountsAsNoGap()
  {
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0 + TimeSpan.FromMinutes(5)),
        Record(2, T0),
    ]));

    Assert.Equal([2UL, 0UL], versions.Select(v => v.Sequence));
    Assert.Equal(T0 + TimeSpan.FromMinutes(5), versions[0].StartedAt);
    Assert.Equal(T0, versions[0].SavedAt);
  }

  [Fact]
  public void ActorsAreDistinctInFirstSeenOrderAndSkipNulls()
  {
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0, "bob"),
        Record(2, T0, null),
        Record(3, T0, "alice"),
        Record(4, T0, "bob"),
        Record(5, T0, "carol"),
    ]));

    Assert.Equal(["bob", "alice", "carol"], versions[0].Actors);
  }

  [Fact]
  public void ActorsBelongOnlyToTheirOwnGroup()
  {
    var versions = Group((Lineage("L1", T0), [
        Record(1, T0, "bob"),
        Record(2, T0 + TimeSpan.FromMinutes(5), "alice"),
    ]));

    Assert.Equal(["alice"], versions[0].Actors);
    Assert.Equal(["bob"], versions[1].Actors);
  }

  [Fact]
  public void OutputIsNewestFirstAcrossLineages()
  {
    var later = T0 + TimeSpan.FromHours(1);
    var versions = Group(
        (Lineage("old", T0), [Record(1, T0), Record(2, T0 + TimeSpan.FromMinutes(5))]),
        (Lineage("new", later, current: true), [Record(1, later)]));

    Assert.Equal(
        [("new", 1UL), ("new", 0UL), ("old", 2UL), ("old", 1UL), ("old", 0UL)],
        versions.Select(v => (v.Lineage, v.Sequence)));
  }

  [Fact]
  public void EachLineageStartsItsOwnGrouping()
  {
    var versions = Group(
        (Lineage("old", T0), [Record(1, T0)]),
        (Lineage("new", T0), [Record(1, T0 + TimeSpan.FromMinutes(1))]));

    Assert.Equal(
        [("new", 1UL), ("new", 0UL), ("old", 1UL), ("old", 0UL)],
        versions.Select(v => (v.Lineage, v.Sequence)));
  }
}
