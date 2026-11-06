using System.Diagnostics;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Live;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class LiveAwarenessTests
{
  private long time = 1_000_000;

  [Fact]
  public void ADepartedPeerStateIsGoneAtOnce()
  {
    var awareness = new LiveAwareness(1, () => time);

    awareness.Apply(Update((7, 1, "{\"user\":{\"id\":\"bob\"}}")), "remote");
    awareness.Apply(Update((7, 2, "null")), "remote");

    Assert.Null(awareness.StateOf(7));
    Assert.DoesNotContain(7UL, awareness.Clients);
    Assert.Equal(1, awareness.StateCount);
  }

  [Fact]
  public void ATombstoneIsPrunedAtTheFirstApplyAfterItsTtl()
  {
    var awareness = new LiveAwareness(1, () => time);

    awareness.Apply(Update((7, 1, "{}")), "remote");
    awareness.Apply(Update((7, 2, "null")), "remote");
    Assert.True(awareness.HasMeta(7));

    time += LiveAwareness.TombstoneTtlMs + 1;
    awareness.Apply(Update((8, 1, "{}")), "remote");

    Assert.False(awareness.HasMeta(7));
    Assert.Equal(2, awareness.MetaCount);
  }

  [Fact]
  public void AStaleRelayInsideTheTtlDoesNotBringADepartedPeerBack()
  {
    var awareness = new LiveAwareness(1, () => time);

    awareness.Apply(Update((7, 3, "{\"n\":1}")), "remote");
    awareness.Apply(Update((7, 4, "null")), "remote");
    time += LiveAwareness.TombstoneTtlMs - 1;
    awareness.Apply(Update((7, 3, "{\"n\":1}")), "remote");

    Assert.Null(awareness.StateOf(7));
  }

  [Fact]
  public void APeerCannotRemoveTheLocalState()
  {
    var awareness = new LiveAwareness(1, () => time);

    awareness.SetLocalStateField("user", JsonValue.Create("me"));
    awareness.Apply(Update((1, 9, "null")), "remote");

    Assert.NotNull(awareness.LocalState);
  }

  [Fact]
  public void AFullEncodeCarriesEveryStateInJoinOrder()
  {
    var awareness = new LiveAwareness(1, () => time);

    awareness.Apply(Update((9, 2, "{\"user\":{\"id\":\"alice\"}}")), "remote");
    var entries = Read(awareness.Encode(null));

    Assert.Equal([1UL, 9UL], entries.Select(entry => entry.Client));
    Assert.Equal("{\"user\":{\"id\":\"alice\"}}", entries[1].Json);
    Assert.Equal(2UL, entries[1].Clock);
  }

  [Fact]
  public void TheDepartureIsTheLocalNullStateAtItsClock()
  {
    var awareness = new LiveAwareness(5, () => time);

    awareness.SetLocalStateField("user", JsonValue.Create("me"));
    var departure = Read(awareness.EncodeLocalDeparture()!);

    Assert.Equal([(5UL, 1UL, "null")], departure);
  }

  [Fact]
  public void TenThousandClientsJoinAndLeaveQuickly()
  {
    var awareness = new LiveAwareness(1, () => time);
    var join = Enumerable.Range(2, 10_000).Select(id => ((ulong)id, 1UL, "{\"user\":{}}")).ToArray();
    var leave = Enumerable.Range(2, 10_000).Select(id => ((ulong)id, 2UL, "null")).ToArray();
    var watch = Stopwatch.StartNew();

    awareness.Apply(Update(join), "remote");
    awareness.Encode(null);
    awareness.Apply(Update(leave), "remote");
    time += LiveAwareness.TombstoneTtlMs + 1;
    awareness.Apply(Update(), "remote");

    Assert.True(watch.ElapsedMilliseconds < 2_000, $"took {watch.ElapsedMilliseconds} ms");
    Assert.Equal(1, awareness.StateCount);
    Assert.Equal(1, awareness.MetaCount);
  }

  [Fact]
  public void TheCheckRenewsTheLocalStateAndDropsSilentPeers()
  {
    var awareness = new LiveAwareness(1, () => time);
    var updates = new List<AwarenessChange>();

    awareness.Apply(Update((7, 1, "{}")), "remote");
    awareness.Updated += (change, _) => updates.Add(change);
    time += LiveAwareness.OutdatedTimeoutMs;
    awareness.Check();

    Assert.Equal([1UL], updates[0].Updated);
    Assert.Equal([7UL], updates[1].Removed);
    Assert.Null(awareness.StateOf(7));
  }

  private static byte[] Update(params (ulong Client, ulong Clock, string Json)[] entries)
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint((ulong)entries.Length);
    foreach (var (client, clock, json) in entries)
    {
      writer.WriteVarUint(client);
      writer.WriteVarUint(clock);
      writer.WriteVarString(json);
    }

    return writer.ToArray();
  }

  private static List<(ulong Client, ulong Clock, string Json)> Read(byte[] update)
  {
    var reader = new Lib0Reader(update);
    var count = reader.ReadVarUint();
    var entries = new List<(ulong, ulong, string)>();

    for (ulong index = 0; index < count; index++)
    {
      entries.Add((reader.ReadVarUint(), reader.ReadVarUint(), reader.ReadVarString()));
    }

    return entries;
  }
}
