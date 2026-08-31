using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;

namespace Blok.Server.Tests.Collab;

/// <summary>Sync-protocol, echo, export and compaction behaviour of one room.</summary>
public sealed class CollabRoomTests
{
  private const string DocId = "doc-1";
  private readonly FakeWorkingSetStore store = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeDocConverter converter = new();
  private readonly ManualTimeProvider time = new();
  private readonly List<string> log = [];

  [Fact]
  public async Task AnswersSyncStep1WithTheDiffAndItsOwnSyncStep1()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var member = new FakeMember();
    var membership = await Join(manager, member);
    using var client = YDocs.NewClient();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(client))),
        CancellationToken.None);

    Assert.Collection(
        member.Received,
        frame => YDocs.Apply(client, Assert.IsType<SyncStep2Frame>(frame).Update),
        frame => Assert.Equal(
            YDocs.StateVector(client),
            Assert.IsType<SyncStep1Frame>(frame).StateVector));
    Assert.Equal("hello", YDocs.Text(client));
  }

  [Fact]
  public async Task AppliesAWriterUpdateAppendsItOnceAndBroadcastsToOthersOnly()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var framesBefore = store.FramesOf(DocId).Count;
    using var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, " world");
    writer.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(update)),
        CancellationToken.None);

    Assert.Empty(writer.Received);
    var relayed = Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received));
    Assert.Equal(update, relayed.Update);
    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count == framesBefore + 1,
        "the working set to catch up");
    Assert.Equal(update, store.FramesOf(DocId)[^1]);
    Assert.Equal("hello world", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task AppliesAWriterSyncStep2ForALateJoinerWithOfflineEdits()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var early = new FakeMember();
    var late = new FakeMember();
    await Join(manager, early);
    var membership = await Join(manager, late);
    using var offline = await SyncedClientAsync(manager, "hello");
    var edit = YDocs.UpdateAppending(offline, "!");
    early.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep2Frame(edit)),
        CancellationToken.None);

    Assert.Equal(edit, Assert.IsType<SyncUpdateFrame>(Assert.Single(early.Received)).Update);
    Assert.Equal("hello!", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task DropsSyncStep2AndUpdatesFromReadOnlyMembersButAnswersTheirSyncStep1()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var reader = new FakeMember(canWrite: false);
    var writer = new FakeMember();
    var membership = await Join(manager, reader);
    await Join(manager, writer);
    var framesBefore = store.FramesOf(DocId).Count;
    using var client = await SyncedClientAsync(manager, "hello");
    var edit = YDocs.UpdateAppending(client, " hacked");
    reader.Received.Clear();
    writer.Received.Clear();

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(edit)), CancellationToken.None);
    await membership.ReceiveAsync(SyncWire.Encode(new SyncStep2Frame(edit)), CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame([0])),
        CancellationToken.None);

    Assert.Empty(writer.Received);
    Assert.Equal(framesBefore, store.FramesOf(DocId).Count);
    Assert.Collection(
        reader.Received,
        frame => Assert.IsType<SyncStep2Frame>(frame),
        frame => Assert.IsType<SyncStep1Frame>(frame));
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task RelaysAwarenessAndQueryAwarenessToOthersEvenFromReadOnlyMembers()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var reader = new FakeMember(canWrite: false);
    var other = new FakeMember();
    var membership = await Join(manager, reader);
    await Join(manager, other);
    reader.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame([1, 2, 3])),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new QueryAwarenessFrame()),
        CancellationToken.None);

    Assert.Empty(reader.Received);
    Assert.Collection(
        other.Received,
        frame => Assert.Equal([1, 2, 3], Assert.IsType<AwarenessFrame>(frame).Update),
        frame => Assert.IsType<QueryAwarenessFrame>(frame));
  }

  [Fact]
  public async Task DropsAnAwarenessFrameThatClaimsMoreClientsThanTheRoomRelays()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var flooder = new FakeMember();
    var victim = new FakeMember();
    var membership = await Join(manager, flooder);
    await Join(manager, victim);
    victim.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(100_000))),
        CancellationToken.None);

    Assert.Empty(victim.Received);
    Assert.Contains(log, line => line.Contains("100000", StringComparison.Ordinal));
  }

  [Fact]
  public async Task RelaysAwarenessAtTheClientCapAndDropsTheFrameAboveIt()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager(new CollabRoomOptions { MaxAwarenessClients = 4 });
    var sender = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, sender);
    await Join(manager, other);
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(4))),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(5))),
        CancellationToken.None);

    Assert.Equal(
        AwarenessClaiming(4),
        Assert.IsType<AwarenessFrame>(Assert.Single(other.Received)).Update);
  }

  /// <summary>
  /// Presence for viewers is deliberate — they belong in the presence stack —
  /// so a read-only member's awareness relays; the cap that bounds it is the
  /// same one a writer gets, because neither can fabricate more peers.
  /// </summary>
  [Fact]
  public async Task HoldsAReadOnlyMembersPresenceToTheSameClientCap()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager(new CollabRoomOptions { MaxAwarenessClients = 4 });
    var reader = new FakeMember(canWrite: false);
    var other = new FakeMember();
    var membership = await Join(manager, reader);
    await Join(manager, other);
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(4))),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(5))),
        CancellationToken.None);

    Assert.Equal(
        AwarenessClaiming(4),
        Assert.IsType<AwarenessFrame>(Assert.Single(other.Received)).Update);
  }

  [Fact]
  public async Task DropsAnAwarenessFrameWhoseClientCountCannotBeRead()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var sender = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, sender);
    await Join(manager, other);
    other.Received.Clear();

    // An unterminated varuint: no count, so nothing to hold to the cap.
    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame([0x80])),
        CancellationToken.None);

    Assert.Empty(other.Received);
  }

  [Fact]
  public async Task BroadcastsQueryAwarenessToTheOthersWhenSomeoneJoins()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var first = new FakeMember();
    var second = new FakeMember();
    await Join(manager, first);

    await Join(manager, second);

    Assert.IsType<QueryAwarenessFrame>(Assert.Single(first.Received));
    Assert.Empty(second.Received);
  }

  [Fact]
  public async Task SendsTheEpochControlFrameFirstOnlyToMembersThatNegotiatedIt()
  {
    endpoint.Holds(DocId, "hello");
    store.Seed(DocId, [YDocs.FullState(YDocs.DocWith("hello"))], Tags.At(6));
    var manager = CreateManager();
    var negotiated = new FakeMember(acceptsControlFrames: true);
    var stock = new FakeMember();
    var membership = await Join(manager, negotiated);
    await Join(manager, stock);

    Assert.Equal(Tags.At(6), membership.Tag);
    Assert.Equal(
        Tags.At(6),
        Assert.IsType<BlokControlFrame>(negotiated.Received[0]).Tag);
    Assert.DoesNotContain(stock.Received, frame => frame is BlokControlFrame);
  }

  [Fact]
  public async Task IgnoresMalformedFramesAndUnusableUpdates()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var framesBefore = store.FramesOf(DocId).Count;
    other.Received.Clear();

    await membership.ReceiveAsync([0xff, 0xff, 0xff], CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame([0xde, 0xad, 0xbe, 0xef, 0x01])),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new PermissionDeniedFrame("nope")),
        CancellationToken.None);

    Assert.Empty(other.Received);
    Assert.Equal(framesBefore, store.FramesOf(DocId).Count);
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task ExportsAfterTheDebounceAndNotBefore()
  {
    endpoint.Holds(DocId, "hello", version: "v7");
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());
    await Edit(manager, membership, " world");

    time.Advance(TimeSpan.FromMilliseconds(1900));
    await manager.SettleAsync();
    Assert.Empty(endpoint.Saves);

    time.Advance(TimeSpan.FromMilliseconds(100));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the debounced export");

    var save = Assert.Single(endpoint.Saves);
    Assert.Equal(DocId, save.DocId);
    Assert.Equal("hello world", save.Data["text"]?.GetValue<string>());
    Assert.Equal("v7", save.Version);
  }

  [Fact]
  public async Task ExportsNoLaterThanTheMaxDelayUnderContinuousEdits()
  {
    endpoint.Holds(DocId, "");
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());

    for (var edit = 0; edit < 6; edit++)
    {
      await Edit(manager, membership, "x");
      time.Advance(TimeSpan.FromMilliseconds(1500));
      await manager.SettleAsync();
      Assert.Empty(endpoint.Saves);
    }

    await Edit(manager, membership, "x");
    time.Advance(TimeSpan.FromMilliseconds(1000));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the max-delay export");

    Assert.Equal("xxxxxxx", endpoint.Saves[0].Data["text"]?.GetValue<string>());
  }

  [Fact]
  public async Task RetriesAFailedExportOnTheNextTickAndKeepsTheBlob()
  {
    endpoint.Holds(DocId, "hello");
    endpoint.NextSaveFailure = new DocEndpointException("collab: the doc endpoint PUT returned 502.", 502);
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());
    await Edit(manager, membership, "!");

    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the failing export");
    await manager.SettleAsync();
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 2, "the retried export");

    Assert.Equal("hello!", endpoint.Saves[1].Data["text"]?.GetValue<string>());
    Assert.Equal(2, store.FramesOf(DocId).Count);
  }

  [Fact]
  public async Task CoalescesEditsMadeDuringAnInFlightExportIntoTheNextOne()
  {
    endpoint.Holds(DocId, "a");
    endpoint.SaveGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());
    await Edit(manager, membership, "b");
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the first export");

    await Edit(manager, membership, "c");
    time.Advance(TimeSpan.FromSeconds(2));
    await manager.SettleAsync();
    Assert.Single(endpoint.Saves);

    endpoint.SaveGate.SetResult();
    endpoint.SaveGate = null;
    await Waits.UntilAsync(() => time.ArmedTimerCount > 0, "the export to be re-armed");
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 2, "the coalesced export");

    Assert.Equal("ab", endpoint.Saves[0].Data["text"]?.GetValue<string>());
    Assert.Equal("abc", endpoint.Saves[1].Data["text"]?.GetValue<string>());
  }

  [Fact]
  public async Task CarriesTheVersionEachSaveAnswersWithIntoTheNextSave()
  {
    endpoint.Holds(DocId, "a", version: "v1");
    endpoint.NextSaveVersion = "v2";
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());

    await Edit(manager, membership, "b");
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the first export");
    await manager.SettleAsync();
    await Edit(manager, membership, "c");
    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 2, "the second export");

    Assert.Equal("v1", endpoint.Saves[0].Version);
    Assert.Equal("v2", endpoint.Saves[1].Version);
  }

  [Fact]
  public async Task SeedsEveryRoomUnderItsOwnRandomClientId()
  {
    var manager = CreateManager();

    for (var index = 0; index < 40; index++)
    {
      endpoint.Holds($"doc-{index}", "seed");
      var result = await manager.JoinAsync($"doc-{index}", new FakeMember(), CancellationToken.None);
      Assert.Equal(CollabJoinStatus.Joined, result.Status);
    }

    Assert.Equal(40, converter.SeededClientIds.Distinct().Count());
    Assert.All(converter.SeededClientIds, id => Assert.InRange(id, 0UL, uint.MaxValue));
  }

  [Fact]
  public async Task CompactsAnOversizedWorkingSetOnLoadByFrameCount()
  {
    using var source = YDocs.NewClient();
    var updates = new List<byte[]>();

    foreach (var piece in new[] { "a", "b", "c", "d", "e" })
    {
      updates.Add(YDocs.UpdateAppending(source, piece));
    }

    store.Seed(DocId, updates, Tags.At(2));
    var manager = CreateManager(new CollabRoomOptions { CompactionFrameThreshold = 4 });

    await Join(manager, new FakeMember());

    var frames = store.FramesOf(DocId);
    Assert.Single(frames);
    Assert.Equal(Tags.At(2), store.Stored(DocId).Tag);
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, frames[0]);
    Assert.Equal("abcde", YDocs.Text(replica));
    Assert.Equal(0, endpoint.Loads);
  }

  [Fact]
  public async Task CompactsAnOversizedWorkingSetOnLoadByByteSize()
  {
    using var source = YDocs.NewClient();
    var updates = new List<byte[]>
    {
      YDocs.UpdateAppending(source, new string('a', 200)),
      YDocs.UpdateAppending(source, new string('b', 200)),
    };
    store.Seed(DocId, updates, Tags.At(0));
    var manager = CreateManager(new CollabRoomOptions { CompactionByteThreshold = 256 });

    await Join(manager, new FakeMember());

    Assert.Single(store.FramesOf(DocId));
    Assert.Equal(new string('a', 200) + new string('b', 200), await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task LeavesASmallWorkingSetAloneOnLoad()
  {
    using var source = YDocs.NewClient();
    var updates = new List<byte[]>
    {
      YDocs.UpdateAppending(source, "a"),
      YDocs.UpdateAppending(source, "b"),
    };
    store.Seed(DocId, updates, Tags.At(0));
    var manager = CreateManager();

    await Join(manager, new FakeMember());

    Assert.Equal(0, store.Writes);
    Assert.Equal(2, store.FramesOf(DocId).Count);
  }

  [Fact]
  public async Task AJoinerCancellingMidSeedDoesNotPoisonTheSeedForTheOthers()
  {
    endpoint.Holds(DocId, "hello");
    endpoint.LoadGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var manager = CreateManager();
    using var cancellation = new CancellationTokenSource();

    var first = manager.JoinAsync(DocId, new FakeMember(), cancellation.Token).AsTask();
    var second = manager.JoinAsync(DocId, new FakeMember(), CancellationToken.None).AsTask();
    await Waits.UntilAsync(() => endpoint.Loads == 1, "the seed load to start");
    cancellation.Cancel();
    endpoint.LoadGate.SetResult();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
    Assert.Equal(CollabJoinStatus.Joined, (await second).Status);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal(1, converter.Seeds);
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The update is already applied and relayed, so a store failure must not
  /// reach the sender's socket: it is logged and retried, and the export the
  /// update earned still happens. An S3 timeout arrives as
  /// TaskCanceledException, which the room used to mistake for its own
  /// shutdown and swallow whole — losing the export as well.
  /// </summary>
  [Fact]
  public async Task AStoreTimeoutDuringAnApplyIsLoggedRetriedAndStillExports()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    using var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    other.Received.Clear();
    store.FailWrites = _ => new TaskCanceledException("s3 timed out");

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None);

    Assert.Equal(update, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);
    await Waits.UntilAsync(
        () => log.Any(line => line.Contains("could not persist", StringComparison.Ordinal)),
        "the failed write to be reported");

    time.Advance(TimeSpan.FromSeconds(2));
    await Waits.UntilAsync(() => endpoint.Saves.Count == 1, "the export the failed persist must not cancel");
    Assert.Equal("hello!", endpoint.Saves[0].Data["text"]?.GetValue<string>());

    store.FailWrites = null;
    await Waits.UntilAdvancingAsync(
        time,
        TimeSpan.FromMinutes(1),
        () => store.Holds(DocId) && store.FramesOf(DocId).Count == 2,
        "the retried persist");
  }

  /// <summary>The blob is written beside the lane: a stuck store must not stop sync.</summary>
  [Fact]
  public async Task ASlowStoreDoesNotStallTheLane()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    using var client = await SyncedClientAsync(manager, "hello");
    other.Received.Clear();
    var stuck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    store.BeforeWrite = () => stuck.Task;

    var receive = membership
        .ReceiveAsync(
            SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
            CancellationToken.None)
        .AsTask();
    var finished = await Task.WhenAny(receive, Task.Delay(TimeSpan.FromSeconds(5)));

    Assert.Same(receive, finished);
    await receive;
    Assert.Single(other.Received);
    Assert.Equal("hello!", await ExportedTextAsync(manager));

    stuck.SetResult();
    store.BeforeWrite = null;
    await Waits.UntilAsync(() => store.Holds(DocId) && store.FramesOf(DocId).Count == 2, "the released write");
  }

  /// <summary>
  /// Every write used to carry the whole log since the last compaction, and
  /// compaction only ran on load or eviction — so a long session wrote the
  /// entire history back on every keystroke. Compacting in place keeps a
  /// write bounded by the doc's own state plus the threshold.
  /// </summary>
  [Fact]
  public async Task NoWriteCarriesMoreFramesThanTheCompactionThreshold()
  {
    endpoint.Holds(DocId, "");
    var manager = CreateManager(new CollabRoomOptions { CompactionFrameThreshold = 4 });
    var membership = await Join(manager, new FakeMember());
    using var client = await SyncedClientAsync(manager, "");

    for (var edit = 0; edit < 60; edit++)
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "x"))),
          CancellationToken.None);
    }

    await manager.SettleAsync();
    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count > 0 && Replays(store.FramesOf(DocId)) == new string('x', 60),
        $"the last write; store holds {Replays(store.FramesOf(DocId))}");

    Assert.True(
        store.MostFramesWritten <= 4,
        $"a write carried {store.MostFramesWritten} frames");
    Assert.True(
        store.LargestWriteBytes < 400,
        $"the largest write was {store.LargestWriteBytes} bytes");
    Assert.True(
        store.WrittenBytes < 60 * 400,
        $"{store.WrittenBytes} bytes written for 60 updates");
  }

  /// <summary>
  /// DOCUMENTED LIMITATION, not a wish. An update that arrives before the one
  /// it depends on is held pending by yrs: ApplyV1 answers Ok, the state
  /// vector does not move (probe: still `00`) and StateDiffV1 against zero
  /// returns the 2-byte empty state — so compaction, which replaces the log
  /// with that diff, silently drops it (probe over 30 runs: the compacting
  /// side reads "ab", a replica hydrated from the compacted blob reads "a").
  /// YDotNet 0.6.0 exposes no pending-update API, so the room cannot detect
  /// this; over a socket, frames from one member arrive in order and each
  /// member's updates depend only on state the server already has, so a
  /// pending update means a buggy or hostile client.
  /// </summary>
  [Fact]
  public void CompactionDropsAnUpdateThatIsStillPending()
  {
    using var source = YDocs.NewClient();
    var first = YDocs.UpdateAppending(source, "a");
    var second = YDocs.UpdateAppending(source, "b");
    using var server = YDocs.NewClient();

    YDocs.Apply(server, second);
    var compacted = YDocs.FullState(server);
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, compacted);
    YDocs.Apply(replica, first);

    Assert.Equal(2, compacted.Length);
    Assert.Equal("", YDocs.Text(server));
    Assert.Equal("a", YDocs.Text(replica));
  }

  private static string Replays(IReadOnlyList<byte[]> frames)
  {
    using var replica = YDocs.NewClient();

    foreach (var frame in frames)
    {
      YDocs.Apply(replica, frame);
    }

    return YDocs.Text(replica);
  }

  /// <summary>
  /// An awareness payload that CLAIMS <paramref name="clients"/> entries.
  /// y-protocols writes [varuint clients]{[clientId][clock][varstring state]}*
  /// and never checks that a sender owns the ids it encodes, so the count is
  /// free to lie: 100_000 fabricated peers fit one frame under the message
  /// cap. The room reads the count and nothing else, so one entry of filler
  /// stands in for the bodies.
  /// </summary>
  private static byte[] AwarenessClaiming(ulong clients)
  {
    var payload = new List<byte>();
    var value = clients;

    do
    {
      var current = (byte)(value & 0x7f);
      value >>= 7;
      payload.Add(value == 0 ? current : (byte)(current | 0x80));
    }
    while (value != 0);

    payload.AddRange([0xe8, 0x07, 0x01, 0x02, (byte)'{', (byte)'}']);

    return [.. payload];
  }

  private CollabRoomManager CreateManager(CollabRoomOptions? options = null)
  {
    return new CollabRoomManager(
        store,
        endpoint,
        converter,
        options ?? new CollabRoomOptions(),
        time,
        log.Add);
  }

  private static async Task<CollabMembership> Join(CollabRoomManager manager, FakeMember member)
  {
    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);

    return result.Membership!;
  }

  /// <summary>A client doc holding the room's current state, obtained the way a stock client would.</summary>
  private static async Task<Doc> SyncedClientAsync(CollabRoomManager manager, string expectedText)
  {
    var probe = new FakeMember(canWrite: false);
    var membership = await Join(manager, probe);
    var client = YDocs.NewClient();
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(client))),
        CancellationToken.None);
    YDocs.Apply(client, Assert.IsType<SyncStep2Frame>(probe.Received.First(frame => frame is SyncStep2Frame)).Update);
    await membership.LeaveAsync();
    Assert.Equal(expectedText, YDocs.Text(client));

    return client;
  }

  private static async Task Edit(CollabRoomManager manager, CollabMembership membership, string value)
  {
    using var client = await SyncedClientAsync(manager, await ExportedTextAsync(manager));
    var update = YDocs.UpdateAppending(client, value);

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None);
  }

  private static async Task<string> ExportedTextAsync(CollabRoomManager manager)
  {
    var probe = new FakeMember(canWrite: false);
    var membership = await Join(manager, probe);
    await membership.ReceiveAsync(SyncWire.Encode(new SyncStep1Frame([0])), CancellationToken.None);
    await membership.LeaveAsync();
    using var replica = YDocs.NewClient();
    YDocs.Apply(replica, Assert.IsType<SyncStep2Frame>(probe.Received.First(frame => frame is SyncStep2Frame)).Update);

    return YDocs.Text(replica);
  }

  /// <summary>
  /// R5 moved the blob write beside the lane. A reset raises the epoch and
  /// mints a fresh lineage; if a pre-reset write were still in the air it
  /// would land AFTER the reset and quietly restore the old log under the old
  /// tag. ResetAsync settles the in-flight write first, so the reset's tag is
  /// always the last one the store keeps.
  /// </summary>
  [Fact]
  public async Task ResetSettlesAnInFlightWriteSoItCannotOvertakeTheReset()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());
    using var client = await SyncedClientAsync(manager, "hello");

    // Gate the off-lane write so the edit's persist is still in flight.
    var stuck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    store.BeforeWrite = () => stuck.Task;
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);

    // The reset must not complete while that write is unresolved.
    var reset = manager.ResetAsync(DocId, CancellationToken.None).AsTask();
    var early = await Task.WhenAny(reset, Task.Delay(TimeSpan.FromMilliseconds(200)));
    Assert.NotSame(reset, early);

    // Release the stale write; the reset now finishes and its tag wins.
    stuck.SetResult();
    store.BeforeWrite = null;
    var minted = Tags.AssertMinted(1, await reset);
    await Waits.UntilAsync(
        () => store.Stored(DocId).Tag == Tags.At(1, minted),
        $"the reset tag; store holds epoch {store.Stored(DocId).Tag.Epoch}");
  }
}
