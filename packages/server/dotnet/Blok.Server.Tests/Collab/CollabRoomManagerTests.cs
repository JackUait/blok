using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;

namespace Blok.Server.Tests.Collab;

/// <summary>Room lifecycle: load-or-seed, the single lane, eviction, reset and drain.</summary>
public sealed class CollabRoomManagerTests
{
  private const string DocId = "doc-1";
  private readonly FakeWorkingSetStore store = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeDocConverter converter = new();
  private readonly ManualTimeProvider time = new();

  [Fact]
  public async Task TheFirstJoinSeedsFromTheEndpointExactlyOnceEvenUnderConcurrentJoins()
  {
    endpoint.Holds(DocId, "seeded");
    endpoint.LoadGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager();
    var members = Enumerable.Range(0, 8).Select(_ => new FakeMember()).ToArray();

    var joins = members
        .Select(member => manager.JoinAsync(DocId, member, CancellationToken.None).AsTask())
        .ToArray();
    await Waits.UntilAsync(() => endpoint.Loads == 1, "the seed load to start");
    endpoint.LoadGate.SetResult();
    var results = await Task.WhenAll(joins);

    Assert.All(results, result => Assert.Equal(CollabJoinStatus.Joined, result.Status));
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal(1, converter.Seeds);
    Assert.Equal(1, store.Writes);
    var frames = store.FramesOf(DocId);
    Assert.Single(frames);
    Assert.Equal(new CollabWorkingSetTag(CollabWorkingSetTag.SchemaV2, 0), store.Stored(DocId).Tag);
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, frames[0]);
    Assert.Equal("seeded", YDocs.Text(replica));
  }

  [Fact]
  public async Task AStoredWorkingSetHydratesTheRoomWithoutTouchingTheEndpoint()
  {
    using var source = YDocs.NewClient();
    var updates = new List<byte[]>
    {
      YDocs.UpdateAppending(source, "from "),
      YDocs.UpdateAppending(source, "disk"),
    };
    store.Seed(DocId, updates, new CollabWorkingSetTag(1, 3));
    var manager = CreateManager();
    var member = new FakeMember();

    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);
    await result.Membership!.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame([0])),
        CancellationToken.None);

    Assert.Equal(0, endpoint.Loads);
    Assert.Equal(0, converter.Seeds);
    Assert.Equal(new CollabWorkingSetTag(1, 3), result.Membership.Tag);
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, Assert.IsType<SyncStep2Frame>(member.Received[0]).Update);
    Assert.Equal("from disk", YDocs.Text(replica));
  }

  [Fact]
  public async Task AnEmptyStoredLogAfterAResetReseedsUnderTheStoredEpoch()
  {
    store.Seed(DocId, [], new CollabWorkingSetTag(1, 5));
    endpoint.Holds(DocId, "fresh");
    var manager = CreateManager();

    var result = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal(new CollabWorkingSetTag(1, 5), result.Membership!.Tag);
    Assert.Equal(new CollabWorkingSetTag(1, 5), store.Stored(DocId).Tag);
    Assert.Single(store.FramesOf(DocId));
  }

  [Fact]
  public async Task ASeedFailureReportsSeedFailedWritesNothingAndRetriesOnTheNextJoin()
  {
    endpoint.LoadFailure = new DocEndpointException("collab: the doc endpoint GET returned 503.", 503);
    var manager = CreateManager();
    var member = new FakeMember();

    var failed = await manager.JoinAsync(DocId, member, CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, failed.Status);
    Assert.Null(failed.Membership);
    Assert.IsType<DocEndpointException>(failed.Error);
    Assert.Equal(0, store.Writes);
    Assert.False(store.Holds(DocId));
    Assert.Empty(member.Closes);
    Assert.Equal(0, manager.LiveRoomCount);

    endpoint.LoadFailure = null;
    endpoint.Holds(DocId, "back");
    var joined = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, joined.Status);
    Assert.Equal(2, endpoint.Loads);
  }

  [Fact]
  public async Task ANullDocumentSeedsAnEmptyRoomWithoutFailingAndWithoutAConverterCall()
  {
    endpoint.HoldsNothing(DocId, version: "v0");
    var manager = CreateManager();
    var member = new FakeMember();

    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);
    await result.Membership!.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame([0])),
        CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    Assert.Equal(0, converter.Seeds);
    Assert.Empty(store.FramesOf(DocId));
    Assert.Equal(new CollabWorkingSetTag(1, 0), store.Stored(DocId).Tag);
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, Assert.IsType<SyncStep2Frame>(member.Received[0]).Update);
    Assert.Equal("", YDocs.Text(replica));
  }

  [Fact]
  public async Task EveryDocAccessGoesThroughOneLane()
  {
    endpoint.Holds(DocId, "");
    store.BeforeWrite = async () => await Task.Delay(1);
    var manager = CreateManager(new CollabRoomOptions
    {
      ExportDebounce = TimeSpan.Zero,
      ExportMaxDelay = TimeSpan.Zero,
    });
    var writers = Enumerable.Range(0, 8).Select(_ => new FakeMember()).ToArray();
    var memberships = new List<CollabMembership>();

    foreach (var writer in writers)
    {
      memberships.Add((await manager.JoinAsync(DocId, writer, CancellationToken.None)).Membership!);
    }

    var storm = new List<Task>();

    for (var round = 0; round < 25; round++)
    {
      foreach (var membership in memberships)
      {
        using var client = YDocs.NewClient();
        var update = YDocs.UpdateAppending(client, "x");
        storm.Add(membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None).AsTask());
        storm.Add(membership.ReceiveAsync(SyncWire.Encode(new SyncStep1Frame([0])), CancellationToken.None).AsTask());
      }

      storm.Add(manager.JoinAsync(DocId, new FakeMember(canWrite: false), CancellationToken.None).AsTask());
      storm.Add(Task.Run(() => time.Advance(TimeSpan.FromMilliseconds(1))));
    }

    await Task.WhenAll(storm);
    await manager.SettleAsync();

    Assert.Equal(1, manager.MaxLaneDepth);
    Assert.Equal(1, store.MaxConcurrentEntries);
    Assert.Equal(new string('x', 200), YDocs.Text(await ReplicaAsync(manager)));
  }

  [Fact]
  public async Task TheLastLeaveStartsALingerAndAJoinDuringItKeepsTheRoom()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var first = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;

    await first.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(29));
    await manager.SettleAsync();
    Assert.Equal(1, manager.LiveRoomCount);

    var second = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);
    time.Advance(TimeSpan.FromSeconds(60));
    await manager.SettleAsync();

    Assert.Equal(CollabJoinStatus.Joined, second.Status);
    Assert.Equal(1, manager.LiveRoomCount);
    Assert.Equal(1, endpoint.Loads);
  }

  [Fact]
  public async Task TheLingerElapsingCompactsExportsAndDropsTheRoom()
  {
    endpoint.Holds(DocId, "a", version: "v1");
    var manager = CreateManager(new CollabRoomOptions { ExportDebounce = TimeSpan.FromMinutes(5), ExportMaxDelay = TimeSpan.FromMinutes(5) });
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    using var client = await SyncedAsync(membership, member);

    foreach (var piece in new[] { "b", "c", "d" })
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, piece))),
          CancellationToken.None);
    }

    Assert.Equal(4, store.FramesOf(DocId).Count);
    await membership.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");

    var compacted = Assert.Single(store.FramesOf(DocId));
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, compacted);
    Assert.Equal("abcd", YDocs.Text(replica));
    var save = Assert.Single(endpoint.Saves);
    Assert.Equal("abcd", save.Data["text"]?.GetValue<string>());
    Assert.Equal("v1", save.Version);

    var rejoined = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Joined, rejoined.Status);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal("abcd", YDocs.Text(await ReplicaAsync(manager)));
  }

  [Fact]
  public async Task EvictionWaitsForAnInFlightExportBeforeFlushing()
  {
    endpoint.Holds(DocId, "a");
    endpoint.SaveGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager();
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    using var client = await SyncedAsync(membership, member);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "b"))),
        CancellationToken.None);
    await membership.LeaveAsync();

    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the export to start");
    time.Advance(TimeSpan.FromSeconds(28));
    var settled = manager.SettleAsync();
    var finished = await Task.WhenAny(settled, Task.Delay(TimeSpan.FromMilliseconds(250)));

    Assert.NotSame(settled, finished);
    Assert.Equal(1, manager.LiveRoomCount);
    Assert.Equal(2, store.FramesOf(DocId).Count);

    endpoint.SaveGate.SetResult();
    endpoint.SaveGate = null;
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");

    Assert.Single(endpoint.Saves);
    var compacted = Assert.Single(store.FramesOf(DocId));
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, compacted);
    Assert.Equal("ab", YDocs.Text(replica));
  }

  [Fact]
  public async Task MembershipCallsStaySafeAfterLeavingAndAfterTheRoomClosed()
  {
    endpoint.Holds(DocId, "a");
    var manager = CreateManager();
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    using var client = await SyncedAsync(membership, member);
    var framesBefore = store.FramesOf(DocId).Count;

    await membership.LeaveAsync();
    await membership.LeaveAsync();
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "late"))),
        CancellationToken.None);

    Assert.Equal(framesBefore, store.FramesOf(DocId).Count);
    Assert.Equal(1, manager.LiveRoomCount);

    var second = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;
    await manager.DrainAsync(CancellationToken.None);
    await second.ReceiveAsync(SyncWire.Encode(new SyncStep1Frame([0])), CancellationToken.None);
    await second.LeaveAsync();
    await membership.LeaveAsync();

    Assert.Equal(0, manager.LiveRoomCount);
    Assert.Equal(framesBefore, store.FramesOf(DocId).Count);
  }

  [Fact]
  public async Task ResetRaisesTheEpochClosesEveryMemberAndReseedsOnTheNextJoin()
  {
    endpoint.Holds(DocId, "old");
    var manager = CreateManager();
    var first = new FakeMember();
    var second = new FakeMember(canWrite: false);
    var membership = (await manager.JoinAsync(DocId, first, CancellationToken.None)).Membership!;
    await manager.JoinAsync(DocId, second, CancellationToken.None);

    var tag = await manager.ResetAsync(DocId, CancellationToken.None);

    Assert.Equal(new CollabWorkingSetTag(1, 1), tag);
    Assert.Equal(1, store.Resets);
    Assert.Equal(new CollabWorkingSetTag(1, 1), store.Stored(DocId).Tag);
    Assert.Empty(store.FramesOf(DocId));
    Assert.Equal([CollabCloseReason.Reset], first.Closes);
    Assert.Equal([CollabCloseReason.Reset], second.Closes);
    Assert.Equal(0, manager.LiveRoomCount);

    using var client = YDocs.NewClient();
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "late"))),
        CancellationToken.None);
    Assert.Empty(store.FramesOf(DocId));

    endpoint.Holds(DocId, "new");
    var rejoined = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Joined, rejoined.Status);
    Assert.Equal(2, endpoint.Loads);
    Assert.Equal(new CollabWorkingSetTag(1, 1), rejoined.Membership!.Tag);
    Assert.Equal(new CollabWorkingSetTag(1, 1), store.Stored(DocId).Tag);
    Assert.Equal("new", YDocs.Text(await ReplicaAsync(manager)));
  }

  [Theory]
  [InlineData(true, 4, 5)]
  [InlineData(false, 0, 1)]
  public async Task ResetWithoutALiveRoomStillRaisesTheStoredEpoch(bool stored, long storedEpoch, long expected)
  {
    if (stored)
    {
      store.Seed(DocId, [YDocs.FullState(YDocs.DocWith("x"))], new CollabWorkingSetTag(1, storedEpoch));
    }

    var manager = CreateManager();

    var tag = await manager.ResetAsync(DocId, CancellationToken.None);

    Assert.Equal(new CollabWorkingSetTag(1, expected), tag);
    Assert.Equal(1, store.Resets);
    Assert.Equal(0, endpoint.Loads);
    Assert.Equal(0, manager.LiveRoomCount);
  }

  [Fact]
  public async Task ResetAbandonsAnInFlightExportInsteadOfLettingItLandAfterwards()
  {
    endpoint.Holds(DocId, "a");
    endpoint.SaveGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager();
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    using var client = await SyncedAsync(membership, member);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "b"))),
        CancellationToken.None);
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the export to start");

    var reset = manager.ResetAsync(DocId, CancellationToken.None).AsTask();
    var finished = await Task.WhenAny(reset, Task.Delay(TimeSpan.FromSeconds(10)));
    Assert.Same(reset, finished);
    endpoint.SaveGate.SetResult();
    endpoint.SaveGate = null;
    time.Advance(TimeSpan.FromMinutes(1));
    await manager.SettleAsync();

    Assert.Single(endpoint.Saves);
    Assert.Equal(0, manager.LiveRoomCount);
  }

  [Fact]
  public async Task DrainFlushesEveryRoomClosesMembersAsDrainingAndRefusesNewJoins()
  {
    endpoint.Holds("doc-a", "a");
    endpoint.Holds("doc-b", "b");
    var manager = CreateManager(new CollabRoomOptions { ExportDebounce = TimeSpan.FromMinutes(5), ExportMaxDelay = TimeSpan.FromMinutes(5) });
    var memberA = new FakeMember();
    var memberB = new FakeMember(canWrite: false);
    var membershipA = (await manager.JoinAsync("doc-a", memberA, CancellationToken.None)).Membership!;
    await manager.JoinAsync("doc-b", memberB, CancellationToken.None);
    using var client = await SyncedAsync(membershipA, memberA);
    await membershipA.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);
    await membershipA.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "?"))),
        CancellationToken.None);

    await manager.DrainAsync(CancellationToken.None);

    Assert.Equal([CollabCloseReason.Draining], memberA.Closes);
    Assert.Equal([CollabCloseReason.Draining], memberB.Closes);
    var save = Assert.Single(endpoint.Saves);
    Assert.Equal("doc-a", save.DocId);
    Assert.Equal("a!?", save.Data["text"]?.GetValue<string>());
    Assert.Single(store.FramesOf("doc-a"));
    Assert.Equal(0, manager.LiveRoomCount);

    var refused = await manager.JoinAsync("doc-c", new FakeMember(), CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Draining, refused.Status);
    Assert.Equal(2, endpoint.Loads);
  }

  private CollabRoomManager CreateManager(CollabRoomOptions? options = null)
  {
    return new CollabRoomManager(
        store,
        endpoint,
        converter,
        options ?? new CollabRoomOptions(),
        time);
  }

  /// <summary>A client doc synced to the room through the member's own connection.</summary>
  private static async Task<Doc> SyncedAsync(CollabMembership membership, FakeMember member)
  {
    var client = YDocs.NewClient();
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(client))),
        CancellationToken.None);
    YDocs.Apply(client, Assert.IsType<SyncStep2Frame>(member.Received.Last(frame => frame is SyncStep2Frame)).Update);

    return client;
  }

  private static async Task<Doc> ReplicaAsync(CollabRoomManager manager)
  {
    var probe = new FakeMember(canWrite: false);
    var result = await manager.JoinAsync(DocId, probe, CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    await result.Membership!.ReceiveAsync(SyncWire.Encode(new SyncStep1Frame([0])), CancellationToken.None);
    await result.Membership.LeaveAsync();
    var replica = YDocs.NewClient();
    YDocs.Apply(replica, Assert.IsType<SyncStep2Frame>(probe.Received.First(frame => frame is SyncStep2Frame)).Update);

    return replica;
  }
}
