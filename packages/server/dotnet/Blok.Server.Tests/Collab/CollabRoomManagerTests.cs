using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

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
    Tags.AssertMinted(0, store.Stored(DocId).Tag);
    var replica = YDocs.NewClient();
    YDocs.Apply(replica, frames[0]);
    Assert.Equal("seeded", YDocs.Text(replica));
  }

  [Fact]
  public async Task AStoredWorkingSetHydratesTheRoomWithoutTouchingTheEndpoint()
  {
    var source = YDocs.NewClient();
    var updates = new List<byte[]>
    {
      YDocs.UpdateAppending(source, "from "),
      YDocs.UpdateAppending(source, "disk"),
    };
    store.Seed(DocId, updates, Tags.At(3));
    var manager = CreateManager();
    var member = new FakeMember();

    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);
    await result.Membership!.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame([0])),
        CancellationToken.None);

    Assert.Equal(0, endpoint.Loads);
    Assert.Equal(0, converter.Seeds);
    Assert.Equal(Tags.At(3), result.Membership.Tag);
    var replica = YDocs.NewClient();
    YDocs.Apply(replica, Assert.IsType<SyncStep2Frame>(member.Received[0]).Update);
    Assert.Equal("from disk", YDocs.Text(replica));
  }

  [Fact]
  public async Task AnEmptyStoredLogAfterAResetReseedsUnderTheStoredEpoch()
  {
    store.Seed(DocId, [], Tags.At(5));
    endpoint.Holds(DocId, "fresh");
    var manager = CreateManager();

    var result = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    Assert.Equal(1, endpoint.Loads);
    var lineage = Tags.AssertMinted(5, result.Membership!.Tag);
    Assert.Equal(Tags.At(5, lineage), store.Stored(DocId).Tag);
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
    Tags.AssertMinted(0, store.Stored(DocId).Tag);
    var replica = YDocs.NewClient();
    YDocs.Apply(replica, Assert.IsType<SyncStep2Frame>(member.Received[0]).Update);
    Assert.Equal("", YDocs.Text(replica));
  }

  /// <summary>
  /// A null seed persists a zero-frame log, so the next open re-seeds. That
  /// re-seed creates no new history — the client that synced under the first
  /// lineage and then edited offline must still be able to ship those edits,
  /// which a fresh lineage would make it throw away.
  /// </summary>
  [Fact]
  public async Task AReSeedOfANullDocumentKeepsTheLineageItPersisted()
  {
    endpoint.HoldsNothing(DocId);
    var manager = CreateManager();
    var first = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;
    var lineage = Tags.AssertMinted(0, first.Tag);
    await first.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");

    var second = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;

    Assert.Equal(2, endpoint.Loads);
    Assert.Equal(Tags.At(0, lineage), second.Tag);
    Assert.Equal(Tags.At(0, lineage), store.Stored(DocId).Tag);
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
        var client = YDocs.NewClient();
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

  /// <summary>
  /// A refresh during a slow seed: the joiner is gone by the time the room is
  /// Ready. Only a LEAVE used to arm the linger, so the room sat there loaded
  /// forever with no members and no timer.
  /// </summary>
  [Fact]
  public async Task ACancelledFirstJoinLeavesARoomThatStillEvicts()
  {
    endpoint.Holds(DocId, "hello");
    endpoint.LoadGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager();
    using var cancellation = new CancellationTokenSource();

    var join = manager.JoinAsync(DocId, new FakeMember(), cancellation.Token).AsTask();
    await Waits.UntilAsync(() => endpoint.Loads == 1, "the seed load to start");
    await cancellation.CancelAsync();
    endpoint.LoadGate.SetResult();
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => join);
    await manager.SettleAsync();

    Assert.Equal(1, converter.Seeds);
    Assert.Equal(1, manager.LiveRoomCount);
    Assert.Equal(1, time.ArmedTimerCount);

    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");
  }

  [Fact]
  public async Task ACancelledJoinDoesNotArmTheLingerWhileOthersAreStillInTheRoom()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);
    using var cancellation = new CancellationTokenSource();
    await cancellation.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => manager.JoinAsync(DocId, new FakeMember(), cancellation.Token).AsTask());
    time.Advance(TimeSpan.FromMinutes(5));
    await manager.SettleAsync();

    Assert.Equal(1, manager.LiveRoomCount);
  }

  [Fact]
  public async Task TheLingerElapsingCompactsExportsAndDropsTheRoom()
  {
    endpoint.Holds(DocId, "a", version: "v1");
    var manager = CreateManager(new CollabRoomOptions { ExportDebounce = TimeSpan.FromMinutes(5), ExportMaxDelay = TimeSpan.FromMinutes(5) });
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    var client = await SyncedAsync(membership, member);

    foreach (var piece in new[] { "b", "c", "d" })
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, piece))),
          CancellationToken.None);
    }

    // The blob is written beside the lane, so the log catches up rather than
    // being current the instant ReceiveAsync returns.
    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count == 4,
        "the working set to catch up");
    await membership.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");

    var compacted = Assert.Single(store.FramesOf(DocId));
    var replica = YDocs.NewClient();
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
    var client = await SyncedAsync(membership, member);
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
    var replica = YDocs.NewClient();
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
    var client = await SyncedAsync(membership, member);
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

  /// <summary>
  /// With no members the applied edit lived only in the doc until the
  /// off-lane write landed, so a 204 preceded any durable copy and a process
  /// death in that window lost an acknowledged write. The write is gated so
  /// the order is observable: the answer must wait for the blob.
  /// </summary>
  [Fact]
  public async Task AHeadlessEditIsInTheBlobBeforeItIsAnswered()
  {
    endpoint.Holds(DocId, "a");
    var manager = CreateManager();
    var probe = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;
    await probe.LeaveAsync();
    var stuck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    store.BeforeWrite = () => stuck.Task;

    var edit = manager.EditAsync(DocId, [Insert("b")], CancellationToken.None).AsTask();
    await Waits.UntilAsync(() => store.Writes == 2, "the edit's blob write to start");

    Assert.False(edit.IsCompleted, "the edit was answered before its blob write landed");
    stuck.SetResult();
    store.BeforeWrite = null;
    Assert.Equal(CollabEditStatus.Applied, (await edit).Status);
    Assert.Equal("ab", YDocs.Replay(store.FramesOf(DocId)));
  }

  [Fact]
  public async Task AHeadlessEditPersistsExportsAfterTheDebounceAndEvictsAfterTheLinger()
  {
    endpoint.Holds(DocId, "a", version: "v1");
    var manager = CreateManager();

    var result = await manager.EditAsync(DocId, [Insert("b")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Applied, result.Status);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal("ab", YDocs.Replay(store.FramesOf(DocId)));
    Assert.Equal(1, manager.LiveRoomCount);
    // The export debounce and the eviction linger.
    Assert.Equal(2, time.ArmedTimerCount);

    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the debounced export");
    await manager.SettleAsync();

    var save = Assert.Single(endpoint.Saves);
    Assert.Equal("ab", save.Data["text"]?.GetValue<string>());
    Assert.Equal("v1", save.Version);
    Assert.Equal(1, time.ArmedTimerCount);

    time.Advance(TimeSpan.FromSeconds(28));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");
    Assert.Single(endpoint.Saves);
    Assert.Equal("ab", YDocs.Replay(store.FramesOf(DocId)));
  }

  [Fact]
  public async Task ARefusedEditWritesNothingAndTheRoomStillEvicts()
  {
    endpoint.Holds(DocId, "a");
    converter.EditFailure = new CollabEditException("collab: op 0: refused.");
    var manager = CreateManager();

    var result = await manager.EditAsync(DocId, [Insert("b")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Invalid, result.Status);
    Assert.IsType<CollabEditException>(result.Error);
    Assert.Equal(1, store.Writes);
    Assert.Equal("a", YDocs.Replay(store.FramesOf(DocId)));
    Assert.Equal(1, manager.LiveRoomCount);
    Assert.Equal(1, time.ArmedTimerCount);

    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");
    Assert.Empty(endpoint.Saves);
  }

  /// <summary>
  /// An edit can queue behind an eviction that is mid-flush. When the room
  /// closes underneath it the edit answers null and the manager retries on
  /// a fresh room, hydrated from the blob the eviction just wrote.
  /// </summary>
  [Fact]
  public async Task AnEditQueuedBehindAClosingRoomIsRetriedOnAFreshOne()
  {
    endpoint.Holds(DocId, "a");
    endpoint.SaveGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager(new CollabRoomOptions
    {
      ExportDebounce = TimeSpan.FromMinutes(5),
      ExportMaxDelay = TimeSpan.FromMinutes(5),
    });
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    var client = await SyncedAsync(membership, member);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "b"))),
        CancellationToken.None);
    await Waits.UntilAsync(() => store.FramesOf(DocId).Count == 2, "the working set to catch up");
    await membership.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the eviction's export to start");

    var edit = manager.EditAsync(DocId, [Insert("c")], CancellationToken.None).AsTask();
    endpoint.SaveGate.SetResult();
    endpoint.SaveGate = null;
    var result = await edit;

    Assert.Equal(CollabEditStatus.Applied, result.Status);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal(2, store.Reads);
    Assert.Equal("abc", YDocs.Replay(store.FramesOf(DocId)));
    Assert.Equal(1, manager.LiveRoomCount);
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
    var seeded = Tags.AssertMinted(0, store.Stored(DocId).Tag);

    var tag = await manager.ResetAsync(DocId, CancellationToken.None);

    var reset = Tags.AssertMinted(1, tag);
    Assert.NotEqual(seeded, reset);
    Assert.Equal(1, store.Resets);
    Assert.Equal(Tags.At(1, reset), store.Stored(DocId).Tag);
    Assert.Empty(store.FramesOf(DocId));
    Assert.Equal([CollabCloseReason.Reset], first.Closes);
    Assert.Equal([CollabCloseReason.Reset], second.Closes);
    Assert.Equal(0, manager.LiveRoomCount);

    var client = YDocs.NewClient();
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "late"))),
        CancellationToken.None);
    Assert.Empty(store.FramesOf(DocId));

    endpoint.Holds(DocId, "new");
    var rejoined = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Joined, rejoined.Status);
    Assert.Equal(2, endpoint.Loads);
    var reseeded = Tags.AssertMinted(1, rejoined.Membership!.Tag);
    Assert.NotEqual(reset, reseeded);
    Assert.Equal(Tags.At(1, reseeded), store.Stored(DocId).Tag);
    Assert.Equal("new", YDocs.Text(await ReplicaAsync(manager)));
  }

  [Theory]
  [InlineData(true, 4, 5)]
  [InlineData(false, 0, 1)]
  public async Task ResetWithoutALiveRoomStillRaisesTheStoredEpoch(bool stored, long storedEpoch, long expected)
  {
    if (stored)
    {
      store.Seed(DocId, [YDocs.FullState(YDocs.DocWith("x"))], Tags.At(storedEpoch));
    }

    var manager = CreateManager();

    var tag = await manager.ResetAsync(DocId, CancellationToken.None);

    Tags.AssertMinted(expected, tag);
    Assert.Equal(1, store.Resets);
    Assert.Equal(0, endpoint.Loads);
    Assert.Equal(0, manager.LiveRoomCount);
  }

  /// <summary>
  /// Blob writes run beside the lane, so one can still be in the air when the
  /// operator resets. It carries the pre-reset log under the pre-reset tag,
  /// and the S3 driver has no guard read to refuse it, so the reset waits for
  /// it instead of racing it.
  /// </summary>
  [Fact]
  public async Task ResetWaitsForAnInFlightBlobWriteInsteadOfRacingIt()
  {
    endpoint.Holds(DocId, "a");
    var manager = CreateManager();
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    var client = await SyncedAsync(membership, member);
    var stuck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    store.BeforeWrite = () => stuck.Task;
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "b"))),
        CancellationToken.None);
    await Waits.UntilAsync(() => store.Writes == 2, "the blob write to start");

    var reset = manager.ResetAsync(DocId, CancellationToken.None).AsTask();
    var raced = await Task.WhenAny(reset, Task.Delay(TimeSpan.FromMilliseconds(250)));
    Assert.NotSame(reset, raced);

    stuck.SetResult();
    store.BeforeWrite = null;
    var tag = await reset;

    Tags.AssertMinted(1, tag);
    Assert.Equal(tag, store.Stored(DocId).Tag);
    Assert.Empty(store.FramesOf(DocId));
  }

  /// <summary>
  /// The reset endpoint hands the room the request's RequestAborted token.
  /// A store PUT can land and the awaiting task still throw for that token;
  /// if the throw leaves the lane before CloseLocked, the store holds the
  /// reset while a Ready room at the old tag keeps its members and writes
  /// the old log back on its next persist.
  /// </summary>
  [Fact]
  public async Task ARequestAbortAfterTheStoreResetLandedStillClosesTheRoom()
  {
    endpoint.Holds(DocId, "old");
    var manager = CreateManager();
    var member = new FakeMember();
    await manager.JoinAsync(DocId, member, CancellationToken.None);
    using var request = new CancellationTokenSource();
    store.AfterReset = () => request.Cancel();

    try
    {
      await manager.ResetAsync(DocId, request.Token);
    }
    catch (OperationCanceledException)
    {
      // Either outcome is acceptable for the caller; the room must not stay open.
    }

    Assert.Equal(1, store.Resets);
    Assert.Equal(1, store.Stored(DocId).Tag.Epoch);
    Assert.Equal([CollabCloseReason.Reset], member.Closes);
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
    var client = await SyncedAsync(membership, member);
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
    var client = await SyncedAsync(membershipA, memberA);
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

  /// <summary>
  /// An unreadable blob loses its epoch, so the doc re-seeds at epoch 0 — a
  /// client that cached the old epoch-0 history must not merge into the fresh
  /// one, and only the lineage can tell them apart.
  /// </summary>
  [Fact]
  public async Task AReSeedAfterAnUnreadableBlobMintsANewLineage()
  {
    using var directory = new TemporaryDirectory();
    var disk = new LocalCollabStore(directory.Path);
    var before = CollabWorkingSetTag.NewLineage();
    await disk.WriteAsync(
        DocId,
        CollabWorkingSetCodec.EncodeFrames([YDocs.FullState(YDocs.DocWith("old"))]),
        new CollabWorkingSetTag(CollabWorkingSetTag.SchemaV2, 5, before),
        CancellationToken.None);
    var path = Path.Combine(directory.Path, CollabDocKey.For(DocId));
    var bytes = await File.ReadAllBytesAsync(path);
    bytes[0] ^= 0xff;
    await File.WriteAllBytesAsync(path, bytes);
    endpoint.Holds(DocId, "fresh");
    var manager = CreateManager(store: disk);
    var member = new FakeMember(acceptsControlFrames: true);

    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    var lineage = Tags.AssertMinted(0, result.Membership!.Tag);
    Assert.NotEqual(before, lineage);
    Assert.Equal(
        result.Membership.Tag,
        Assert.IsType<BlokControlFrame>(member.Received[0]).Tag);
    var stored = await disk.ReadAsync(DocId, CancellationToken.None);
    Assert.Equal(result.Membership.Tag, stored!.Tag);
  }

  [Fact]
  public async Task AReSeedAfterABlobWithCorruptFramesUnderAnIntactHeaderStillJoins()
  {
    using var directory = new TemporaryDirectory();
    var disk = new LocalCollabStore(directory.Path);
    await disk.WriteAsync(
        DocId,
        CollabWorkingSetCodec.EncodeFrames([YDocs.FullState(YDocs.DocWith("old"))]),
        Tags.At(3),
        CancellationToken.None);
    var path = Path.Combine(directory.Path, CollabDocKey.For(DocId));
    var written = await File.ReadAllBytesAsync(path);
    await File.WriteAllBytesAsync(path, [.. written[..CollabWorkingSetCodec.HeaderLength], 0xff, 0xff]);
    endpoint.Holds(DocId, "fresh");
    var manager = CreateManager(store: disk);

    var result = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    Tags.AssertMinted(0, result.Membership!.Tag);
    var stored = await disk.ReadAsync(DocId, CancellationToken.None);
    Assert.Equal(result.Membership.Tag, stored!.Tag);
    Assert.Equal("fresh", YDocs.Replay(CollabWorkingSetCodec.TryDecodeFrames(stored.Updates, out var frames) ? frames : []));
  }

  [Fact]
  public async Task AReSeedAfterALostBlobMintsANewLineageUnderTheSameEpoch()
  {
    using var directory = new TemporaryDirectory();
    var disk = new LocalCollabStore(directory.Path);
    endpoint.Holds(DocId, "v1");
    var manager = CreateManager(store: disk);
    var first = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;
    var before = Tags.AssertMinted(0, first.Tag);
    await first.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");
    File.Delete(Path.Combine(directory.Path, CollabDocKey.For(DocId)));

    var second = (await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None)).Membership!;

    Assert.Equal(2, converter.Seeds);
    Assert.Equal(first.Tag.Epoch, second.Tag.Epoch);
    Assert.NotEqual(before, Tags.AssertMinted(0, second.Tag));
  }

  /// <summary>
  /// The store is down while the doc is edited and the room then empties.
  /// Dropping the room here would hand the next open a blob that is missing
  /// the last edits — with at least one frame in it, the blob is
  /// authoritative and the doc endpoint is never consulted again — so the
  /// room stays loaded, keeps the doc as the authority and retries.
  /// </summary>
  [Fact]
  public async Task AStoreOutageKeepsTheRoomLoadedUntilTheWorkingSetCatchesUp()
  {
    var log = new List<string>();
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager(log: log);
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    var client = await SyncedAsync(membership, member);
    store.FailWrites = _ => new IOException("disk full");

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the export");
    Assert.Equal("hello!", endpoint.Saves[0].Data["text"]?.GetValue<string>());

    await membership.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();

    Assert.Equal(1, manager.LiveRoomCount);
    Assert.Contains(log, line => line.Contains("could not", StringComparison.Ordinal));
    Assert.True(time.ArmedTimerCount > 0, "the eviction has to be retried");

    store.FailWrites = null;
    await Waits.UntilAdvancingAsync(
        time,
        TimeSpan.FromMinutes(5),
        () => manager.LiveRoomCount == 0,
        "the retried eviction");

    var stored = YDocs.NewClient();
    YDocs.Apply(stored, Assert.Single(store.FramesOf(DocId)));
    Assert.Equal("hello!", YDocs.Text(stored));
    Assert.Single(endpoint.Saves);

    var rejoined = await manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Joined, rejoined.Status);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal("hello!", YDocs.Text(await ReplicaAsync(manager)));
  }

  /// <summary>
  /// The endpoint is down while the room empties. Dropping the room once
  /// the blob was written would leave the consumer's record trailing the
  /// working set for a whole session: the next open hydrates from the blob,
  /// is not dirty, and never exports — one log line as the only trace.
  /// </summary>
  [Fact]
  public async Task AnEndpointOutageAtEvictionKeepsTheRoomLoadedUntilTheExportLands()
  {
    var log = new List<string>();
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager(
        new CollabRoomOptions
        {
          ExportDebounce = TimeSpan.FromMinutes(5),
          ExportMaxDelay = TimeSpan.FromMinutes(5),
        },
        log: log);
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    var client = await SyncedAsync(membership, member);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);
    await manager.SettleAsync();
    endpoint.NextSaveFailure = new DocEndpointException("collab: the doc endpoint PUT returned 502.", 502);

    await membership.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();

    Assert.Single(endpoint.Saves);
    Assert.Equal(1, manager.LiveRoomCount);
    Assert.True(time.ArmedTimerCount > 0, "the eviction has to be retried");
    Assert.Contains(log, line => line.Contains("export", StringComparison.Ordinal));

    await Waits.UntilAdvancingAsync(
        time,
        TimeSpan.FromMinutes(1),
        () => manager.LiveRoomCount == 0,
        "the retried eviction");

    Assert.Equal(2, endpoint.Saves.Count);
    Assert.Equal("hello!", endpoint.Saves[^1].Data["text"]?.GetValue<string>());
  }

  /// <summary>
  /// An S3 timeout surfaces as TaskCanceledException. The room's failure
  /// filters used to exempt every OperationCanceledException — they exist for
  /// the room's own lifetime token — so a timeout escaped the eviction flush,
  /// CloseLocked never ran and the room became an unreachable zombie.
  /// </summary>
  [Fact]
  public async Task AStoreTimeoutDuringTheEvictionFlushIsAFailureNotAShutdown()
  {
    var log = new List<string>();
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager(
        new CollabRoomOptions
        {
          ExportDebounce = TimeSpan.FromMinutes(5),
          ExportMaxDelay = TimeSpan.FromMinutes(5),
        },
        log: log);
    var member = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, member, CancellationToken.None)).Membership!;
    var client = await SyncedAsync(membership, member);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);
    await manager.SettleAsync();
    store.FailWrites = _ => new TaskCanceledException("s3 timed out");

    await membership.LeaveAsync();
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();

    Assert.Equal(1, manager.LiveRoomCount);
    Assert.True(time.ArmedTimerCount > 0, "a room that could not flush must keep a timer");
    Assert.DoesNotContain(log, line => line.Contains("background work failed", StringComparison.Ordinal));
    Assert.Contains(log, line => line.Contains("could not flush the working set", StringComparison.Ordinal));

    store.FailWrites = null;
    await Waits.UntilAdvancingAsync(
        time,
        TimeSpan.FromMinutes(5),
        () => manager.LiveRoomCount == 0,
        "the retried eviction");
    Assert.Single(store.FramesOf(DocId));
  }

  /// <summary>
  /// Draining is the opposite of eviction on purpose: the server is going
  /// down, so a room that cannot write its blob still closes (and its export
  /// is still attempted), and one failing room never aborts the others.
  /// </summary>
  [Fact]
  public async Task DrainClosesARoomWhoseStoreFailsAndStillDrainsTheOthers()
  {
    var log = new List<string>();
    endpoint.Holds("doc-a", "a");
    endpoint.Holds("doc-b", "b");
    var manager = CreateManager(
        new CollabRoomOptions
        {
          ExportDebounce = TimeSpan.FromMinutes(5),
          ExportMaxDelay = TimeSpan.FromMinutes(5),
        },
        log: log);
    var memberA = new FakeMember();
    var memberB = new FakeMember();
    var membershipA = (await manager.JoinAsync("doc-a", memberA, CancellationToken.None)).Membership!;
    var membershipB = (await manager.JoinAsync("doc-b", memberB, CancellationToken.None)).Membership!;
    var clientA = await SyncedAsync(membershipA, memberA);
    var clientB = await SyncedAsync(membershipB, memberB);
    await membershipA.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(clientA, "!"))),
        CancellationToken.None);
    await membershipB.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(clientB, "?"))),
        CancellationToken.None);
    await manager.SettleAsync();
    store.FailWrites = docId => docId == "doc-a"
      ? new TaskCanceledException("s3 timed out")
      : null;

    await manager.DrainAsync(CancellationToken.None);

    Assert.Equal(0, manager.LiveRoomCount);
    Assert.Equal([CollabCloseReason.Draining], memberA.Closes);
    Assert.Equal([CollabCloseReason.Draining], memberB.Closes);
    Assert.Single(store.FramesOf("doc-b"));
    Assert.Equal(
        ["a!", "b?"],
        endpoint.Saves
            .OrderBy(save => save.DocId, StringComparer.Ordinal)
            .Select(save => save.Data["text"]?.GetValue<string>()));
  }

  private CollabRoomManager CreateManager(
      CollabRoomOptions? options = null,
      ICollabWorkingSetStore? store = null,
      List<string>? log = null)
  {
    return new CollabRoomManager(
        store ?? this.store,
        endpoint,
        converter,
        options ?? new CollabRoomOptions(),
        time,
        log is null ? null : log.Add);
  }

  /// <summary>An insert op the fake converter applies by appending <paramref name="text"/>.</summary>
  private static CollabEditOp.Insert Insert(string text)
  {
    return new CollabEditOp.Insert(
        $"block-{text}",
        new JsonObject
        {
          ["type"] = "paragraph",
          ["data"] = new JsonObject { ["text"] = text },
        },
        After: null,
        Parent: null);
  }

  /// <summary>A client doc synced to the room through the member's own connection.</summary>
  private static async Task<YDoc> SyncedAsync(CollabMembership membership, FakeMember member)
  {
    var client = YDocs.NewClient();
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(client))),
        CancellationToken.None);
    YDocs.Apply(client, Assert.IsType<SyncStep2Frame>(member.Received.Last(frame => frame is SyncStep2Frame)).Update);

    return client;
  }

  private static async Task<YDoc> ReplicaAsync(CollabRoomManager manager)
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
