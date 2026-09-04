using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>Sync-protocol, echo, export and compaction behaviour of one room.</summary>
public sealed class CollabRoomTests
{
  private const string DocId = "doc-1";

  // 32 lowercase hex, the operation-id shape the v2 codec enforces.
  private const string OpOne = "0123456789abcdef0123456789abcdef";
  private const string OpTwo = "fedcba9876543210fedcba9876543210";

  private readonly FakeWorkingSetStore store = new();
  private readonly FakeCollabOperationStore operations = new();
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
    var client = YDocs.NewClient();

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
    var client = await SyncedClientAsync(manager, "hello");
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
    var offline = await SyncedClientAsync(manager, "hello");
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
    var client = await SyncedClientAsync(manager, "hello");
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
    var stock = SyncFrames.Payload("awareness");

    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(stock)),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new QueryAwarenessFrame()),
        CancellationToken.None);

    Assert.Empty(reader.Received);
    Assert.Collection(
        other.Received,
        frame => Assert.Equal(stock, Assert.IsType<AwarenessFrame>(frame).Update),
        frame => Assert.IsType<QueryAwarenessFrame>(frame));
  }

  /// <summary>
  /// A stock client JSON.parses every state in a relayed awareness frame and
  /// its provider ends the session when that throws, so one member's bad
  /// frame must never reach the others. A third one closes the sender: a
  /// stock client never produces these.
  /// </summary>
  [Theory]
  [InlineData(new byte[] { 0x01, 0x02, 0x03 })]
  [InlineData(new byte[] { 0x01, 0x02, 0x03, 0x01, (byte)'{' })]
  public async Task DropsAMalformedAwarenessFrameAndClosesTheSenderOnTheThird(byte[] payload)
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var sender = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, sender);
    await Join(manager, other);
    other.Received.Clear();
    var frame = SyncWire.Encode(new AwarenessFrame(payload));

    await membership.ReceiveAsync(frame, CancellationToken.None);
    await membership.ReceiveAsync(frame, CancellationToken.None);
    Assert.Empty(sender.Closes);
    await membership.ReceiveAsync(frame, CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(SyncFrames.Payload("awareness"))),
        CancellationToken.None);

    Assert.Equal([CollabCloseReason.BadAwareness], sender.Closes);
    Assert.Empty(other.Received);
    Assert.Contains(log, line => line.Contains("malformed awareness", StringComparison.Ordinal));
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

    // Over the cap is a best-effort drop, never a strike: a genuinely huge
    // room answers every queryAwareness with every state it knows.
    for (var attempt = 0; attempt < 3; attempt++)
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(5))),
          CancellationToken.None);
    }

    Assert.Equal(
        AwarenessClaiming(4),
        Assert.IsType<AwarenessFrame>(Assert.Single(other.Received)).Update);
    Assert.Empty(sender.Closes);
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
    // Default options announce no cap, so no limits frame follows.
    Assert.DoesNotContain(negotiated.Received, frame => frame is BlokLimitsFrame);
  }

  [Fact]
  public async Task AnnouncesTheMessageCapRightAfterTheControlFrame()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager(
        new CollabRoomOptions { AnnouncedMaxMessageBytes = 1L << 20 });
    var negotiated = new FakeMember(acceptsControlFrames: true);
    var stock = new FakeMember();
    await Join(manager, negotiated);
    await Join(manager, stock);

    Assert.IsType<BlokControlFrame>(negotiated.Received[0]);
    Assert.Equal(
        1L << 20,
        Assert.IsType<BlokLimitsFrame>(negotiated.Received[1]).MaxMessageBytes);
    Assert.DoesNotContain(stock.Received, frame => frame is BlokLimitsFrame);
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

  /// <summary>
  /// The pre-apply screen refuses only Malformed and TooDeep, and refusing is
  /// a DROP: the member keeps its connection, because one bad frame is not
  /// evidence the rest of the session is bad.
  /// </summary>
  [Fact]
  public async Task AMalformedUpdateIsDroppedWithoutClosingTheMember()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var framesBefore = store.FramesOf(DocId).Count;
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame([0xde, 0xad, 0xbe, 0xef, 0x01])),
        CancellationToken.None);

    Assert.Empty(writer.Closes);
    Assert.Empty(other.Closes);
    Assert.Empty(other.Received);
    Assert.Equal(framesBefore, store.FramesOf(DocId).Count);
  }

  /// <summary>
  /// Locked Decision 9: NUL is ordinary data. Refusing an update that carries
  /// one would not remove it — the sender's state vector already covers it,
  /// so every following SyncStep2 would resend it forever.
  /// </summary>
  [Fact]
  public async Task ARoomAppliesANulBearingUpdateAndExportsItIntact()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var framesBefore = store.FramesOf(DocId).Count;
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "a\0b"))),
        CancellationToken.None);

    Assert.Empty(writer.Closes);
    Assert.Contains(other.Received, frame => frame is SyncUpdateFrame);
    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count == framesBefore + 1,
        "the working set to catch up");
    Assert.Equal("helloa\0b", await ExportedTextAsync(manager));
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

  /// <summary>
  /// A peer can write a shape the converter refuses. The export must not
  /// stall until somebody edits again: it is retried with the backoff a
  /// failed PUT gets, and the log names the block the converter refused.
  /// </summary>
  [Fact]
  public async Task RetriesAnExportTheConverterRefusedWithBackoff()
  {
    endpoint.Holds(DocId, "hello");
    converter.NextExportFailure = new InvalidDataException(
        "collab: block \"b-1\" has data that is not a map.");
    var manager = CreateManager();
    var membership = await Join(manager, new FakeMember());
    await Edit(manager, membership, "!");

    time.Advance(TimeSpan.FromSeconds(2));
    await manager.SettleAsync();

    Assert.Equal(1, converter.Exports);
    Assert.Empty(endpoint.Saves);
    Assert.Contains(log, line => line.Contains("b-1", StringComparison.Ordinal));
    Assert.DoesNotContain(log, line => line.Contains("background work failed", StringComparison.Ordinal));
    Assert.True(time.ArmedTimerCount > 0, "the export has to be retried");

    await Waits.UntilAdvancingAsync(
        time,
        TimeSpan.FromSeconds(2),
        () => endpoint.Saves.Count == 1,
        "the retried export");
    Assert.Equal("hello!", endpoint.Saves[0].Data["text"]?.GetValue<string>());
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
    var source = YDocs.NewClient();
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
    var replica = YDocs.NewClient();
    YDocs.Apply(replica, frames[0]);
    Assert.Equal("abcde", YDocs.Text(replica));
    Assert.Equal(0, endpoint.Loads);
  }

  [Fact]
  public async Task CompactsAnOversizedWorkingSetOnLoadByByteSize()
  {
    var source = YDocs.NewClient();
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
    var source = YDocs.NewClient();
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
  ///
  /// A working-set-only room, deliberately: the blob is the only durable copy
  /// there, so its write failing is a retry. A journal-backed room's commit
  /// failure is not (see AppendFailureClosesEveryMemberWithCommitUnavailable).
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
    var client = await SyncedClientAsync(manager, "hello");
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

  /// <summary>
  /// The blob is written beside the lane: a stuck store must not stop sync.
  /// This is the working-set-only path; a journal-backed room awaits its
  /// commit INSIDE the lane, so a stuck journal does hold that document up.
  /// </summary>
  [Fact]
  public async Task ASlowStoreDoesNotStallTheLane()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
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
    var client = await SyncedClientAsync(manager, "");

    for (var edit = 0; edit < 60; edit++)
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "x"))),
          CancellationToken.None);
    }

    await manager.SettleAsync();
    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count > 0 && YDocs.Replay(store.FramesOf(DocId)) == new string('x', 60),
        $"the last write; store holds {YDocs.Replay(store.FramesOf(DocId))}");

    Assert.True(
        store.MostFramesWritten <= 4,
        $"a write carried {store.MostFramesWritten} frames");
    // The engine does not merge items (Global Constraints), so the compacted
    // state is one struct per inserted character — fatter than the yrs state
    // this budget was first written against. What it guards is that a write
    // is bounded by the DOC, never by the history.
    Assert.True(
        store.LargestWriteBytes < 600,
        $"the largest write was {store.LargestWriteBytes} bytes");
    Assert.True(
        store.WrittenBytes < 60 * 400,
        $"{store.WrittenBytes} bytes written for 60 updates");
  }

  /// <summary>
  /// Once the compacted state itself is over the byte threshold, measuring
  /// the whole log made every following update compact again — a full
  /// StateDiffV1 and a full-blob write per keystroke. Only what accumulated
  /// on top of the compacted frame counts. The first update after a load
  /// still pays one compaction, which is what teaches the room its base.
  /// </summary>
  [Fact]
  public async Task MeasuresTheLogWithoutItsCompactedBaseWhenDecidingToCompact()
  {
    var seed = new string('a', 300);
    store.Seed(DocId, [YDocs.FullState(YDocs.DocWith(seed))], Tags.At(0));
    var manager = CreateManager(new CollabRoomOptions { CompactionByteThreshold = 256 });
    var membership = await Join(manager, new FakeMember());
    var client = await SyncedClientAsync(manager, seed);

    foreach (var piece in new[] { "b", "c", "d" })
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, piece))),
          CancellationToken.None);
    }

    await manager.SettleAsync();
    await Waits.UntilAsync(
        () => YDocs.Replay(store.FramesOf(DocId)) == seed + "bcd",
        "the working set to catch up");
    Assert.Equal(3, store.FramesOf(DocId).Count);

    var tail = new string('e', 300);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, tail))),
        CancellationToken.None);

    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count == 1,
        "the compaction the tail earned");
    Assert.Equal(seed + "bcd" + tail, YDocs.Replay(store.FramesOf(DocId)));
  }

  /// <summary>
  /// An update that arrives before the one it depends on is PARKED, and the
  /// engine writes what is parked into every diff it encodes (Locked
  /// Decisions 4 and 5). So compaction, which replaces the log with the
  /// doc's whole state, no longer loses it: a late joiner hydrated from the
  /// compacted blob converges the moment the dependency arrives.
  /// </summary>
  [Fact]
  public void CompactionKeepsAnUpdateThatIsStillPending()
  {
    var source = YDocs.NewClient();
    var first = YDocs.UpdateAppending(source, "a");
    var second = YDocs.UpdateAppending(source, "b");
    var server = YDocs.NewClient();

    YDocs.Apply(server, second);
    var compacted = YDocs.FullState(server);
    var replica = YDocs.NewClient();
    YDocs.Apply(replica, compacted);
    YDocs.Apply(replica, first);

    Assert.True(server.HasPending);
    Assert.Equal("", YDocs.Text(server));
    Assert.Equal("ab", YDocs.Text(replica));
  }

  /// <summary>
  /// The journal is the record of what happened, so nothing an operation did
  /// may be visible before the append says it is durable — not to another
  /// member, and not as a receipt to the writer.
  /// </summary>
  [Fact]
  public async Task DoesNotAckOrBroadcastBeforeAppendCompletes()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeAppend = () =>
    {
      entered.TrySetResult();

      return release.Task;
    };

    var receive = membership
        .ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None)
        .AsTask();
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Empty(other.Received);
    Assert.Empty(writer.Received);
    Assert.Empty(operations.Committed(DocId));
    // The blob write is scheduled after the append too, so the update cannot
    // reach the working set ahead of the journal either.
    Assert.Equal(0, store.Writes);

    release.SetResult();
    await receive.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Contains(other.Received, frame => frame is SyncUpdateFrame);
    Assert.Contains(writer.Received, frame => frame is AcknowledgementFrame);
    Assert.Single(operations.Committed(DocId));
    await Waits.UntilAsync(() => store.Writes > 0, "the working set write the commit earned");
  }

  [Fact]
  public async Task AcknowledgesAndBroadcastsToEveryV2MemberIncludingTheSubmitterAfterCommit()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member("user-7");
    var other = V2Member("user-9");
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    Assert.Equal(update, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);
    Assert.Collection(
        writer.Received,
        frame => Assert.Equal(update, Assert.IsType<SyncUpdateFrame>(frame).Update),
        frame =>
        {
          var ack = Assert.IsType<AcknowledgementFrame>(frame);

          Assert.Equal(membership.Tag.Lineage, ack.Lineage);
          Assert.Equal(OpOne, ack.OperationId);
          Assert.Equal(1UL, ack.ServerSequence);
        });
    var record = Assert.Single(operations.Committed(DocId));
    Assert.Equal(OpOne, record.OperationId);
    Assert.Equal(1UL, record.ServerSequence);
    Assert.Equal("user-7", record.ActorId);
    Assert.Equal(CollabOperationSource.ClientV2, record.Source);
    Assert.Equal(update, record.Update.ToArray());
  }

  [Fact]
  public async Task AppendFailureClosesEveryMemberWithCommitUnavailable()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    operations.FailAppends = _ => new IOException("the journal is down");

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Equal([CollabCloseReason.CommitUnavailable], other.Closes);
  }

  [Fact]
  public async Task AppendFailureClosesAndDiscardsTheRoomWithoutObservation()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();
    operations.FailAppends = _ => new IOException("the journal is down");

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    Assert.Empty(other.Received);
    Assert.Empty(writer.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal(0, manager.LiveRoomCount);

    // The fence goes with the room, or the document stays locked to a process
    // that is no longer serving it.
    var reopened = await operations.OpenAsync(DocId, CancellationToken.None);
    Assert.Equal(CollabDocumentOpenOutcome.Opened, reopened.Outcome);
    await reopened.Session!.DisposeAsync();
  }

  /// <summary>
  /// An append that commits and then fails to say so is the case the whole
  /// idempotency key exists for: the room discards itself having observed
  /// nothing, and the client's retry of the same id reads back as a duplicate.
  /// </summary>
  [Fact]
  public async Task UnknownCommitOutcomeClosesAndRetryResolvesById()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();
    operations.CommitBeforeFailing = true;
    operations.FailAppends = _ => new IOException("the journal could not answer");

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Empty(other.Received);
    Assert.Empty(writer.Received);
    Assert.Single(operations.Committed(DocId));

    operations.FailAppends = null;
    operations.CommitBeforeFailing = false;
    time.Advance(TimeSpan.FromSeconds(2));
    var retryMember = V2Member();
    var retry = await Join(manager, retryMember);
    retryMember.Received.Clear();

    await retry.ReceiveAsync(Operation(retry, OpOne, update), CancellationToken.None);

    var ack = Assert.IsType<AcknowledgementFrame>(Assert.Single(retryMember.Received));
    Assert.Equal(OpOne, ack.OperationId);
    Assert.Equal(1UL, ack.ServerSequence);
    Assert.Single(operations.Committed(DocId));
    Assert.Equal("hello!", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// A store that keeps failing would otherwise reload baseline and tail on
  /// every reconnect of every member, so the document pays for the outage.
  /// </summary>
  [Fact]
  public async Task RepeatedAppendFailureDoesNotReloadTheDocumentPerRetry()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    operations.FailAppends = _ => new IOException("the journal is down");

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);
    var opensAfterFailure = operations.Opens;

    for (var attempt = 0; attempt < 4; attempt++)
    {
      var refused = await manager.JoinAsync(DocId, V2Member(), CancellationToken.None);

      Assert.Equal(CollabJoinStatus.Unavailable, refused.Status);
    }

    Assert.Equal(opensAfterFailure, operations.Opens);
    Assert.Equal(1, endpoint.Loads);

    // One join gets through when the cooldown expires, and failing again
    // doubles the wait rather than restarting it.
    time.Advance(TimeSpan.FromSeconds(2));
    var second = await manager.JoinAsync(DocId, V2Member(), CancellationToken.None);
    Assert.Equal(CollabJoinStatus.Joined, second.Status);

    // The sync exchange first, or the operation is refused as not-synced and
    // the append that has to fail again never runs.
    await second.Membership!.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient()))),
        CancellationToken.None);
    await second.Membership.ReceiveAsync(
        Operation(second.Membership, OpTwo, update),
        CancellationToken.None);

    time.Advance(TimeSpan.FromSeconds(2));
    Assert.Equal(
        CollabJoinStatus.Unavailable,
        (await manager.JoinAsync(DocId, V2Member(), CancellationToken.None)).Status);

    time.Advance(TimeSpan.FromSeconds(2));
    Assert.Equal(
        CollabJoinStatus.Joined,
        (await manager.JoinAsync(DocId, V2Member(), CancellationToken.None)).Status);
    Assert.Equal(1, endpoint.Loads);
  }

  /// <summary>
  /// A store that never answers leaves the outcome unknown, which is the
  /// commit-unavailable case — not a refusal of the operation.
  /// </summary>
  [Fact]
  public async Task AnAppendPastTheStoreTimeoutIsCommitUnavailable()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager(
        new CollabRoomOptions { CommitTimeout = TimeSpan.FromSeconds(5) });
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var never = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeAppend = () =>
    {
      entered.TrySetResult();

      return never.Task;
    };

    var receive = membership
        .ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None)
        .AsTask();
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    time.Advance(TimeSpan.FromSeconds(5));

    // Bounded so a commit that never gives up fails this test instead of
    // hanging the run.
    await receive.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Equal([CollabCloseReason.CommitUnavailable], other.Closes);
    Assert.Empty(other.Received);
    Assert.Empty(writer.Received);
    Assert.Equal(0, manager.LiveRoomCount);
  }

  /// <summary>
  /// One process per document: a second one refuses the join instead of
  /// waiting for the fence or forcing it.
  /// </summary>
  [Fact]
  public async Task OpenElsewhereRefusesTheJoinAsUnavailable()
  {
    endpoint.Holds(DocId, "hello");
    var held = await operations.OpenAsync(DocId, CancellationToken.None);
    Assert.Equal(CollabDocumentOpenOutcome.Opened, held.Outcome);
    var manager = CreateJournalManager();

    var refused = await manager.JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Unavailable, refused.Status);
    Assert.Null(refused.Membership);
    // Nothing was seeded behind the holder's back.
    Assert.Equal(0, endpoint.Loads);
    Assert.Equal(0, manager.LiveRoomCount);

    await held.Session!.DisposeAsync();

    Assert.Equal(
        CollabJoinStatus.Joined,
        (await manager.JoinAsync(DocId, V2Member(), CancellationToken.None)).Status);
  }

  /// <summary>
  /// The client re-sends an operation whose acknowledgement it never saw. The
  /// commit already happened, so it is answered from the journal — and the
  /// other members must not see the update a second time.
  /// </summary>
  [Fact]
  public async Task LostAckRetryReturnsTheSameCommitWithoutRebroadcast()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);
    writer.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    var ack = Assert.IsType<AcknowledgementFrame>(Assert.Single(writer.Received));
    Assert.Equal(OpOne, ack.OperationId);
    Assert.Equal(1UL, ack.ServerSequence);
    Assert.Empty(other.Received);
    Assert.Single(operations.Committed(DocId));
  }

  /// <summary>
  /// The lookup runs BEFORE the provisional apply for exactly this input.
  /// Discovering the conflict from the append instead would leave the document
  /// holding bytes that will never be journalled, whose only cure is closing
  /// the room — so any writer could kill the room for everyone by re-sending
  /// one id with different bytes.
  /// </summary>
  [Fact]
  public async Task SameIdDifferentBytesRejectsWithoutApply()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    await membership.ReceiveAsync(
        Operation(membership, OpOne, YDocs.UpdateAppending(client, "!")),
        CancellationToken.None);
    var different = YDocs.UpdateAppending(client, "?");
    writer.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, different), CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(writer.Received));
    Assert.Equal(OpOne, rejection.OperationId);
    Assert.Equal("operation-id-conflict", rejection.Code);
    Assert.Empty(other.Received);
    Assert.Empty(writer.Closes);
    Assert.Empty(other.Closes);
    Assert.Equal(1, manager.LiveRoomCount);
    Assert.Single(operations.Committed(DocId));
    Assert.Equal("hello!", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The append is awaited inside the room lane, so a slow commit holds the
  /// next one up rather than letting it overtake: what every member sees is
  /// the order the journal recorded.
  /// </summary>
  [Fact]
  public async Task CommittedOperationsBroadcastInServerSequenceOrder()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var first = V2Member();
    var second = V2Member();
    var observer = new FakeMember(canWrite: false);
    var firstMembership = await Join(manager, first);
    var secondMembership = await Join(manager, second);
    await Join(manager, observer);
    var client = await SyncedClientAsync(manager, "hello");
    var firstUpdate = YDocs.UpdateAppending(client, "a");
    var secondUpdate = YDocs.UpdateAppending(client, "b");
    observer.Received.Clear();
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeAppend = () =>
    {
      entered.TrySetResult();

      return release.Task;
    };

    var slow = firstMembership
        .ReceiveAsync(Operation(firstMembership, OpOne, firstUpdate), CancellationToken.None)
        .AsTask();
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    operations.BeforeAppend = null;
    var overtaking = secondMembership
        .ReceiveAsync(Operation(secondMembership, OpTwo, secondUpdate), CancellationToken.None)
        .AsTask();
    release.SetResult();
    await slow.WaitAsync(TimeSpan.FromSeconds(10));
    await overtaking.WaitAsync(TimeSpan.FromSeconds(10));

    string[] submitted = [Convert.ToHexString(firstUpdate), Convert.ToHexString(secondUpdate)];
    Assert.Equal(
        submitted,
        operations.Committed(DocId)
            .Select(record => Convert.ToHexString(record.Update.Span))
            .ToArray());
    Assert.Equal(
        submitted,
        observer.Received
            .OfType<SyncUpdateFrame>()
            .Select(frame => Convert.ToHexString(frame.Update))
            .ToArray());
  }

  /// <summary>
  /// A room that reloads must rebuild from committed data alone: the
  /// checkpoint covers everything through its sequence, the tail carries what
  /// came after it, and no operation falls between the two.
  /// </summary>
  [Fact]
  public async Task ReloadReplaysEveryAcknowledgedOperationAfterTheCheckpoint()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    await membership.ReceiveAsync(
        Operation(membership, OpOne, YDocs.UpdateAppending(client, "!")),
        CancellationToken.None);
    await membership.ReceiveAsync(
        Operation(membership, OpTwo, YDocs.UpdateAppending(client, "?")),
        CancellationToken.None);
    await membership.LeaveAsync();

    time.Advance(TimeSpan.FromSeconds(30));
    await Waits.UntilAsync(() => manager.LiveRoomCount == 0, "the room to be evicted");

    // Through sequence 1, so operation one is only reachable via the
    // checkpoint: the open no longer returns it in the tail.
    await using (var session = (await operations.OpenAsync(DocId, CancellationToken.None)).Session!)
    {
      var replica = YDocs.NewClient();

      foreach (var frame in session.OpenResult.Baseline)
      {
        YDocs.Apply(replica, frame.ToArray());
      }

      YDocs.Apply(replica, session.OpenResult.Tail[0].Update.ToArray());
      await session.WriteCheckpointAsync(
          new CollabOperationCheckpoint(1, YDocs.FullState(replica)),
          CancellationToken.None);
    }

    Assert.Equal("hello!?", await ExportedTextAsync(manager));
    Assert.Equal(1, endpoint.Loads);
  }

  [Fact]
  public async Task UnjournalledProvisionalStateNeverExportsOrCheckpoints()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    operations.FailAppends = _ => new IOException("the journal is down");

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();

    Assert.Empty(endpoint.Saves);
    Assert.Empty(operations.Committed(DocId));
    Assert.Null(operations.Checkpoint(DocId));

    operations.FailAppends = null;
    time.Advance(TimeSpan.FromSeconds(2));
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// S3 exposes a working set and no journal, so that room keeps relaying and
  /// scheduling the blob write exactly as it did — and has no commit primitive
  /// to run: an operation frame is dropped rather than applied.
  /// </summary>
  [Fact]
  public async Task WorkingSetOnlyRoomKeepsTheLegacyRelayPath()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateManager();
    var writer = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var framesBefore = store.FramesOf(DocId).Count;
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None);

    Assert.Empty(writer.Received);
    Assert.Equal(update, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);
    await Waits.UntilAsync(
        () => store.FramesOf(DocId).Count == framesBefore + 1,
        "the working set to catch up");

    // From a member that DID negotiate v2, so the protocol gate lets the frame
    // through and the room's "no journal" guard is what stops it. A v1 sender
    // would be refused a frame earlier and prove nothing about this room.
    var negotiated = V2Member();
    var negotiatedMembership = await Join(manager, negotiated);

    // The join itself broadcasts a queryAwareness to the others.
    negotiated.Received.Clear();
    writer.Received.Clear();
    other.Received.Clear();

    await negotiatedMembership.ReceiveAsync(
        Operation(negotiatedMembership, OpOne, YDocs.UpdateAppending(client, "?")),
        CancellationToken.None);

    Assert.Empty(negotiated.Received);
    Assert.Empty(writer.Received);
    Assert.Empty(other.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal("hello!", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The lookup runs in the lane the append is bounded in, so it is bounded
  /// the same way: a store that hangs there would wedge the document with no
  /// timeout, no close and no cooldown, and take the drain down with it.
  /// </summary>
  [Fact]
  public async Task ALookupPastTheStoreTimeoutIsCommitUnavailable()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager(
        new CollabRoomOptions { CommitTimeout = TimeSpan.FromSeconds(5) });
    var writer = V2Member();
    var other = new FakeMember();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var never = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeLookup = () =>
    {
      entered.TrySetResult();

      return never.Task;
    };

    var receive = membership
        .ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None)
        .AsTask();
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    time.Advance(TimeSpan.FromSeconds(5));
    await receive.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Empty(other.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal(0, manager.LiveRoomCount);
  }

  [Fact]
  public async Task ResettingAnOperationStoreRoomResetsTheJournalAndClosesMembers()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);

    var reset = await manager.ResetAsync(DocId, CancellationToken.None);

    Assert.Equal(membership.Tag.Format, reset.Format);
    Assert.Equal(membership.Tag.Epoch + 1, reset.Epoch);
    Assert.NotEqual(membership.Tag.Lineage, reset.Lineage);
    Assert.Equal([CollabCloseReason.Reset], writer.Closes);
    Assert.Equal(0, store.Resets);
    var head = Assert.IsType<CollabDocumentHead>(operations.Head(DocId));
    Assert.Equal(reset.Format, head.Format);
    Assert.Equal(reset.Epoch, head.Epoch);
    Assert.Equal(reset.Lineage, head.Lineage);
  }

  [Fact]
  public async Task AQueuedOldLineageReceiveCannotAppendAfterJournalReset()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();

    // v1, deliberately: a v2 member's raw SyncUpdate is a policy violation the
    // room drops on its own, so this test would pass without the reset having
    // fenced anything.
    var writer = new FakeMember();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var oldUpdate = YDocs.UpdateAppending(client, "late");
    var releaseLoad = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    endpoint.LoadGate = releaseLoad;
    writer.Received.Clear();
    var reset = manager.ResetAsync(DocId, CancellationToken.None).AsTask();
    await Waits.UntilAsync(() => endpoint.Loads == 2, "the reset endpoint load");
    var append = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeAppend = () =>
    {
      append.TrySetResult();

      return Task.CompletedTask;
    };

    // Deterministic, not a race: the reset holds the room's lane at the gated
    // endpoint load, and ReceiveAsync registers on that lane synchronously —
    // so this write is queued BEHIND the reset before it is released.
    var queued = membership
        .ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(oldUpdate)), CancellationToken.None)
        .AsTask();
    Assert.False(queued.IsCompleted);

    releaseLoad.SetResult();
    var resetTag = await reset;
    endpoint.LoadGate = null;
    await queued.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Equal(membership.Tag.Epoch + 1, resetTag.Epoch);
    Assert.NotEqual(membership.Tag.Lineage, resetTag.Lineage);
    Assert.Equal([CollabCloseReason.Reset], writer.Closes);
    Assert.Empty(writer.Received);
    Assert.False(append.Task.IsCompleted);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal(0, manager.LiveRoomCount);
  }

  [Fact]
  public async Task ResettingANewOperationStoreRoomOpensTheJournalBeforeTheWorkingSet()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();

    var reset = await manager.ResetAsync(DocId, CancellationToken.None);

    Assert.Equal(1, operations.Opens);
    Assert.Equal(1, endpoint.Loads);
    Assert.Equal(0, store.Reads);
    Assert.Equal(1, reset.Epoch);
    Assert.Equal(0, manager.LiveRoomCount);
  }

  [Fact]
  public async Task AJournalRoomResetDoesNotWriteTheWorkingSet()
  {
    endpoint.Holds(DocId, "hello");
    using var room = new CollabRoom(
        DocId,
        store,
        endpoint,
        converter,
        new CollabRoomOptions(),
        time,
        log.Add,
        operations);

    var result = await room.ResetAsync(CancellationToken.None);

    var reset = Assert.IsType<CollabResetResult>(result);
    Assert.Equal(CollabResetStatus.Reset, reset.Status);
    Assert.Equal(0, store.Resets);
    Assert.Equal(0, store.Reads);
    Assert.Equal(reset.Tag?.Lineage, operations.Head(DocId)?.Lineage);
  }

  /// <summary>
  /// DisposeAsync carries no token, so nothing ends the wait if a store hangs
  /// there — and it runs on the failure path with the lane held, which the
  /// drain waits on with no token of its own. The bound abandons the session
  /// instead: the fence stays held until its liveness signal lapses, so the
  /// document is briefly unavailable rather than permanently wedged.
  /// </summary>
  [Fact]
  public async Task ASessionThatHangsInDisposeDoesNotWedgeTheRoom()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager(
        new CollabRoomOptions { CommitTimeout = TimeSpan.FromSeconds(5) });
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var never = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeDispose = () =>
    {
      entered.TrySetResult();

      return never.Task;
    };
    operations.FailAppends = _ => new IOException("the journal is down");

    var receive = membership
        .ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None)
        .AsTask();
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    time.Advance(TimeSpan.FromSeconds(5));
    await receive.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Equal(0, manager.LiveRoomCount);

    // The trade the bound makes, stated as an assertion: the abandoned session
    // still holds the fence.
    var reopened = await operations.OpenAsync(DocId, CancellationToken.None);
    Assert.Equal(CollabDocumentOpenOutcome.DocumentOpenElsewhere, reopened.Outcome);
  }

  /// <summary>
  /// Frame 102 is a v2 frame. A member that negotiated v1 gets no answer to
  /// one — an acknowledgement or a rejection is a frame its client cannot
  /// parse, and a stock provider ends the session on those.
  /// </summary>
  [Fact]
  public async Task AnOperationFrameFromAV1MemberIsDroppedWithoutJournalling()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = V2Member();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    stock.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    Assert.Empty(stock.Received);
    Assert.Empty(other.Received);
    Assert.Empty(stock.Closes);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// Protocol §7: a raw SyncStep2/Update from a v2 member carries no operation
  /// id, so it can be answered with neither an acknowledgement nor a
  /// rejection. It is dropped and the member is closed.
  /// </summary>
  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task ARawWriteFromAV2MemberIsDroppedAndTheMemberIsClosed(bool asSyncStep2)
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = V2Member();
    var membership = await Join(manager, writer);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(asSyncStep2
          ? new SyncStep2Frame(update)
          : new SyncUpdateFrame(update)),
        CancellationToken.None);

    // The relay is what a leak looks like from outside: the submitter is
    // excluded from a v1 broadcast, so only a peer can see the bytes escape.
    Assert.Empty(other.Received);
    Assert.Empty(writer.Received);
    Assert.Equal([CollabCloseReason.RawWriteOnV2], writer.Closes);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The gate is the negotiated protocol, not the frame shape: v1 and stock
  /// y-websocket members keep writing through SyncStep2 and SyncUpdate.
  /// </summary>
  [Fact]
  public async Task ARawWriteFromAV1MemberIsStillAppliedOnTheSameRoom()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var membership = await Join(manager, stock);
    var client = await SyncedClientAsync(manager, "hello");

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);

    Assert.Empty(stock.Closes);
    Assert.Single(operations.Committed(DocId));
    Assert.Equal("hello!", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// Sync readiness is per membership: until the room has queued ITS SyncStep2
  /// the member may hold a state the server never sent it, so the operation is
  /// refused transiently and the connection stays open for the retry.
  /// </summary>
  [Fact]
  public async Task AnOperationBeforeTheRoomAnsweredSyncStep1IsRejectedAsNotSynced()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer, synced: false);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(writer.Received));
    Assert.Equal("not-synced", rejection.Code);
    Assert.Equal(OpOne, rejection.OperationId);
    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(writer.Closes);

    // Transient: the same id is accepted once the handshake completes.
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient()))),
        CancellationToken.None);
    writer.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    Assert.Contains(writer.Received, frame => frame is AcknowledgementFrame);
    Assert.Single(operations.Committed(DocId));
  }

  /// <summary>
  /// A SyncStep1 the room could not answer left the member holding a state
  /// this room never sent, so it is not synced — the flag belongs after the
  /// SyncStep2 send, not at the top of the answer.
  /// </summary>
  [Fact]
  public async Task ASyncStep1TheRoomCouldNotAnswerDoesNotMakeTheMemberSynced()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer, synced: false);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");

    // Not a state vector yjs can read: the answer throws and is dropped.
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame([0xff, 0xff, 0xff])),
        CancellationToken.None);
    writer.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(writer.Received));
    Assert.Equal("not-synced", rejection.Code);
    Assert.Empty(operations.Committed(DocId));
  }

  /// <summary>Presence is not a write, so it crosses the room before the sync exchange too.</summary>
  [Fact]
  public async Task AwarenessBeforeTheSyncExchangeIsStillRelayed()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var other = V2Member();
    var membership = await Join(manager, writer, synced: false);
    await Join(manager, other, synced: false);
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new AwarenessFrame(AwarenessClaiming(1))),
        CancellationToken.None);

    Assert.Equal(
        AwarenessClaiming(1),
        Assert.IsType<AwarenessFrame>(Assert.Single(other.Received)).Update);
    Assert.Empty(writer.Closes);
  }

  /// <summary>
  /// A v1 write is journalled like every other, so nothing it did may be
  /// visible before the append returns. What it does NOT earn is a receipt:
  /// 103 is a v2 frame, and the submitter is not in the broadcast either.
  /// </summary>
  [Fact]
  public async Task V1UpdateIsJournalledBeforeBroadcastWithAServerGeneratedId()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember(actorId: "user-3");
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    stock.Received.Clear();
    other.Received.Clear();
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeAppend = () =>
    {
      entered.TrySetResult();

      return release.Task;
    };

    var receive = membership
        .ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None)
        .AsTask();
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Empty(other.Received);
    Assert.Empty(stock.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal(0, store.Writes);

    release.SetResult();
    await receive.WaitAsync(TimeSpan.FromSeconds(10));

    Assert.Equal(update, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);
    Assert.Empty(stock.Received);
    var record = Assert.Single(operations.Committed(DocId));

    // ClientV2 is the enum's zero value, so a source nobody set reads as v2.
    Assert.Equal(CollabOperationSource.ClientV1, record.Source);
    Assert.Equal("user-3", record.ActorId);
    Assert.Equal(update, record.Update.ToArray());
    Assert.Equal(1UL, record.ServerSequence);
    Assert.Matches("^[0-9a-f]{32}$", record.OperationId);
    await Waits.UntilAsync(() => store.Writes > 0, "the working set write the commit earned");
  }

  /// <summary>
  /// The same bytes twice, as a SyncUpdate and then a SyncStep2. The document
  /// converges, the sender is answered on NEITHER send — that is what
  /// "journalled, no receipt" means on the wire — and the journal takes one
  /// row, because the engine integrates nothing the second time and says so.
  /// </summary>
  [Fact]
  public async Task V1DuplicateStateConvergesButHasNoClientReceipt()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    stock.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None);
    await membership.ReceiveAsync(SyncWire.Encode(new SyncStep2Frame(update)), CancellationToken.None);

    Assert.Empty(stock.Received);

    var record = Assert.Single(operations.Committed(DocId));

    Assert.Equal(update, record.Update.ToArray());
    Assert.Equal(update, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);
    Assert.Equal("hello!", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// What an already-synced client actually answers SyncStep1 with, on a
  /// document that has been edited the way documents are.
  ///
  /// On a pristine document that answer is two bytes of nothing, which is the
  /// shape the requirement was written around. It stops being two bytes the
  /// moment anything is deleted: yjs writes the delete set WHOLE, never
  /// diffed against the target (<c>writeDeleteSet(createDeleteSetFromStructStore)</c>,
  /// mirrored by this engine's <c>EncodeStateAsUpdate</c>), so the answer
  /// carries the document's entire deletion history and grows with it. A skip
  /// keyed on the bytes therefore journals one no-op per idle reconnect on
  /// every document that has ever seen a backspace — which is every real one.
  /// </summary>
  [Fact]
  public async Task AnIdleV1ResyncIsNotJournalledEvenWithDeletionHistory()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var pristine = await SyncedClientAsync(manager, "hello");
    var twoBytes = pristine.EncodeStateAsUpdate(await ServerStateVectorAsync(manager, pristine));
    Assert.Equal(new byte[] { 0, 0 }, twoBytes);
    stock.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep2Frame(twoBytes)),
        CancellationToken.None);

    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(other.Received);

    // Now give the document deletion history and re-sync from scratch.
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateDeleting(pristine, 4, 1))),
        CancellationToken.None);
    var synced = await SyncedClientAsync(manager, "hell");
    var answer = synced.EncodeStateAsUpdate(await ServerStateVectorAsync(manager, synced));

    // The whole point: an in-sync answer is NOT the two-byte shape here.
    Assert.True(answer.Length > 2, $"expected a carried delete set, got {answer.Length} bytes");

    // Let the export the DELETION legitimately earned land first, or the
    // absence measured below is just that PUT arriving late.
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();
    await Waits.UntilAsync(() => endpoint.Saves.Count > 0, "the export the deletion earned");

    var committed = operations.Committed(DocId).Count;
    var frames = store.FramesOf(DocId).Count;
    var saves = endpoint.Saves.Count;
    stock.Received.Clear();
    other.Received.Clear();

    // Three idle reconnects, the way a flaky connection produces them.
    for (var reconnect = 0; reconnect < 3; reconnect++)
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncStep2Frame(answer)),
          CancellationToken.None);
    }

    Assert.Equal(committed, operations.Committed(DocId).Count);
    Assert.Empty(stock.Received);
    Assert.Empty(other.Received);
    Assert.Equal("hell", await ExportedTextAsync(manager));

    // No working-set frame and no PUT of unchanged content back to the
    // consumer's own document endpoint.
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();
    Assert.Equal(frames, store.FramesOf(DocId).Count);
    Assert.Equal(saves, endpoint.Saves.Count);
  }

  /// <summary>
  /// Ten bytes prove the union in <c>ParkedCoverage</c> is load-bearing, and
  /// load-bearing in the UNSAFE direction.
  ///
  /// <see cref="DeleteSet.Read"/> appends when a client is listed twice — its
  /// own comment says so — and a parked delete set is stored exactly as it
  /// arrived (<c>PendingDs = unappliedNow</c>), with no merge. So one update
  /// can park [1,5) and [2,6) for the same client: raw lengths 8, covering 5
  /// clocks. A later [1,9) covers 8 clocks for the same raw 8. Summing
  /// lengths instead of unioning them therefore reads the second update as
  /// "nothing new" — and it is applied to the live document, journalled
  /// nowhere and relayed to nobody.
  /// </summary>
  [Fact]
  public async Task ADeletionThatOnlyWidensParkedRangesIsStillJournalled()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);

    // No struct groups; a delete set naming client 7 twice, which appends.
    byte[] overlapping = [0x00, 0x02, 0x07, 0x01, 0x01, 0x04, 0x07, 0x01, 0x02, 0x04];

    // One range over the union of those two: the same raw total, more clocks.
    byte[] widening = [0x00, 0x01, 0x07, 0x01, 0x01, 0x08];
    stock.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(overlapping)),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(widening)),
        CancellationToken.None);

    Assert.Equal(2, operations.Committed(DocId).Count);
    Assert.Equal(
        widening,
        Assert.IsType<SyncUpdateFrame>(Assert.Single(
            other.Received,
            frame => frame is SyncUpdateFrame update && update.Update.Length == widening.Length))
            .Update);
    Assert.Empty(stock.Received);
    Assert.Empty(stock.Closes);
  }

  /// <summary>
  /// A parked delete set is not a corner case, and while one exists EVERY
  /// apply rebuilds it: <c>DeleteSet.Apply</c> opens with
  /// <c>new DeleteSet()</c> and always allocates, and
  /// <c>MergeDeleteSets(null, X)</c> hands that fresh object straight back.
  /// So an update that decodes to zero structs and zero delete-set clients —
  /// the literal two-byte idle resync — still replaces
  /// <c>Store.PendingDs</c> with a different object.
  ///
  /// Any parked-state signal that reads identity, or counts objects, calls
  /// that a change and journals one no-op per reconnect. The signal has to
  /// measure how much is parked, not whether the parked set was touched.
  /// </summary>
  [Fact]
  public async Task AnIdleV1ResyncIsNotJournalledWhileADeleteIsParked()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var twoBytes = client.EncodeStateAsUpdate(await ServerStateVectorAsync(manager, client));
    Assert.Equal(new byte[] { 0, 0 }, twoBytes);

    // A deletion of text the server never received, so it cannot be applied
    // and parks. Store.PendingDs is non-null from here on.
    var stray = YDocs.NewClient();
    YDocs.UpdateAppending(stray, "zz");
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateDeleting(stray, 0, 2))),
        CancellationToken.None);

    // Let the export the parked delete legitimately earned land first, or the
    // absence measured below is just that PUT arriving late.
    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();
    await Waits.UntilAsync(() => endpoint.Saves.Count > 0, "the export the parked delete earned");

    var committed = operations.Committed(DocId).Count;
    var frames = store.FramesOf(DocId).Count;
    var saves = endpoint.Saves.Count;
    stock.Received.Clear();
    other.Received.Clear();

    for (var reconnect = 0; reconnect < 3; reconnect++)
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncStep2Frame(twoBytes)),
          CancellationToken.None);
    }

    Assert.Equal(committed, operations.Committed(DocId).Count);
    Assert.Empty(stock.Received);
    Assert.Empty(other.Received);
    Assert.Equal("hello", await ExportedTextAsync(manager));

    time.Advance(TimeSpan.FromSeconds(30));
    await manager.SettleAsync();
    Assert.Equal(frames, store.FramesOf(DocId).Count);
    Assert.Equal(saves, endpoint.Saves.Count);
  }

  /// <summary>
  /// The other fundamental edit shape, and the one no test in this file could
  /// produce until now. A Yjs deletion creates NO structs: it marks existing
  /// items deleted and names them in the delete set, so the room's state
  /// vector is byte-identical across it. A skip keyed on the state vector
  /// therefore swallows every backspace a v1 client sends — unrelayed, so the
  /// other tabs keep showing the deleted text, and unjournalled, so the next
  /// load resurrects it and the export PUTs the resurrection back to the
  /// consumer's own endpoint.
  /// </summary>
  [Fact]
  public async Task AV1DeletionIsJournalledAndRelayed()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var deletion = YDocs.UpdateDeleting(client, 4, 1);
    var stateVectorBefore = await ServerStateVectorAsync(manager, client);
    stock.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(deletion)),
        CancellationToken.None);

    var record = Assert.Single(operations.Committed(DocId));
    Assert.Equal(deletion, record.Update.ToArray());
    Assert.Equal(CollabOperationSource.ClientV1, record.Source);
    Assert.Equal(deletion, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);
    Assert.Empty(stock.Received);

    // Documentation, NOT a guard: this holds whether the room journals the
    // deletion or drops it, and the journal assertion above fails first
    // either way. It is here so the next person who reaches for a
    // state-vector test reads the reason it cannot work.
    Assert.Equal(stateVectorBefore, await ServerStateVectorAsync(manager, client));
    Assert.Equal("hell", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// An update that arrives before the one it depends on parks in the engine
  /// without moving the state vector (see
  /// <see cref="CompactionKeepsAnUpdateThatIsStillPending"/>). It is real new
  /// data all the same: skipping it on the state vector alone would leave the
  /// document holding bytes the journal never gets, which is the one thing an
  /// operation-store room may not do.
  /// </summary>
  [Fact]
  public async Task AV1UpdateThatOnlyParksPendingIsStillJournalled()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    YDocs.UpdateAppending(client, "a");
    var second = YDocs.UpdateAppending(client, "b");
    stock.Received.Clear();
    other.Received.Clear();

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(second)), CancellationToken.None);

    var record = Assert.Single(operations.Committed(DocId));
    Assert.Equal(second, record.Update.ToArray());
    Assert.Equal(second, Assert.IsType<SyncUpdateFrame>(Assert.Single(other.Received)).Update);

    // With the room left parked, a refused apply must still be refused.
    // Journalled bytes the engine cannot read are a poison pill: the next
    // load hydrates them and throws.
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame([0xde, 0xad, 0xbe, 0xef, 0x01])),
        CancellationToken.None);

    Assert.Single(operations.Committed(DocId));
    Assert.Single(other.Received);
    Assert.Empty(stock.Closes);

    // Still parked: the update was journalled for what it carries, not for
    // what it changed.
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The write gate comes before the journal on the v1 path too, and a reader
  /// is answered with nothing at all — a rejection is a v2 frame.
  /// </summary>
  [Fact]
  public async Task AReadOnlyV1UpdateIsDroppedWithoutJournalling()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var reader = new FakeMember(canWrite: false);
    var writer = new FakeMember();
    var membership = await Join(manager, reader);
    await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var edit = YDocs.UpdateAppending(client, " hacked");
    reader.Received.Clear();
    writer.Received.Clear();

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(edit)), CancellationToken.None);
    await membership.ReceiveAsync(SyncWire.Encode(new SyncStep2Frame(edit)), CancellationToken.None);

    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(reader.Received);
    Assert.Empty(writer.Received);
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The v1 half of
  /// <see cref="AppendFailureClosesAndDiscardsTheRoomWithoutObservation"/>:
  /// bytes the journal refused are bytes the room may not relay, keep or
  /// write back to the doc endpoint, whichever protocol sent them.
  /// </summary>
  [Fact]
  public async Task AFailedV1AppendDiscardsTheRoomWithoutRelayingOrExporting()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var other = new FakeMember();
    var membership = await Join(manager, stock);
    await Join(manager, other);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    stock.Received.Clear();
    other.Received.Clear();
    operations.FailAppends = _ => new IOException("the journal is down");

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None);

    Assert.Equal([CollabCloseReason.CommitUnavailable], stock.Closes);
    Assert.Equal([CollabCloseReason.CommitUnavailable], other.Closes);
    Assert.Empty(stock.Received);
    Assert.Empty(other.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal(0, manager.LiveRoomCount);

    operations.FailAppends = null;
    time.Advance(TimeSpan.FromSeconds(30));

    Assert.Empty(endpoint.Saves);
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The minted ids have to differ per update. The store refuses a second
  /// append under an id it already holds with other bytes, and that refusal
  /// is not a per-write error: it discards the room for everyone in it.
  /// </summary>
  [Fact]
  public async Task ConsecutiveV1UpdatesAreJournalledUnderDistinctIds()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var stock = new FakeMember();
    var membership = await Join(manager, stock);
    var client = await SyncedClientAsync(manager, "hello");
    stock.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "?"))),
        CancellationToken.None);

    var committed = operations.Committed(DocId);

    Assert.Equal(2, committed.Count);
    Assert.NotEqual(committed[0].OperationId, committed[1].OperationId);
    Assert.Equal(
        new ulong[] { 1, 2 },
        committed.Select(record => record.ServerSequence).ToArray());
    Assert.Empty(stock.Received);
    Assert.Empty(stock.Closes);
    Assert.Equal("hello!?", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The HTTP edit path goes through the same cooldown. It is the likelier
  /// retry storm of the two: a caller that retries a 503 would otherwise
  /// reload the document's baseline and tail on every request.
  /// </summary>
  [Fact]
  public async Task AnEditIsRefusedWhileTheDocumentIsInItsCommitCooldown()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    operations.FailAppends = _ => new IOException("the journal is down");
    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);
    var opens = operations.Opens;

    var refused = await manager.EditAsync(DocId, [Appending("b-1", "x")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Unavailable, refused.Status);
    Assert.Equal(opens, operations.Opens);
    Assert.Equal(1, endpoint.Loads);
  }

  [Fact]
  public async Task APostApplyFailureClosesWithoutObservation()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var observer = new FakeMember();
    await Join(manager, writer);
    await Join(manager, observer);
    writer.Received.Clear();
    observer.Received.Clear();
    converter.EditFailureAfterApply = new InvalidOperationException("the converter failed after writing");

    var result = await manager.EditAsync(DocId, [Appending("b-1", "x")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Unavailable, result.Status);
    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Equal([CollabCloseReason.CommitUnavailable], observer.Closes);
    Assert.Empty(writer.Received);
    Assert.Empty(observer.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(endpoint.Saves);
    time.Advance(TimeSpan.FromSeconds(2));
    converter.EditFailureAfterApply = null;
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task AnEditWithNoLocalUpdateClosesWithoutObservation()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var observer = new FakeMember();
    await Join(manager, writer);
    await Join(manager, observer);
    writer.Received.Clear();
    observer.Received.Clear();
    converter.SuppressEditUpdates = true;

    var result = await manager.EditAsync(DocId, [Appending("b-1", "x")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Unavailable, result.Status);
    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Equal([CollabCloseReason.CommitUnavailable], observer.Closes);
    Assert.Empty(writer.Received);
    Assert.Empty(observer.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(endpoint.Saves);
    time.Advance(TimeSpan.FromSeconds(2));
    converter.SuppressEditUpdates = false;
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task AnEditWithMultipleLocalUpdatesClosesWithoutObservation()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var observer = new FakeMember();
    await Join(manager, writer);
    await Join(manager, observer);
    writer.Received.Clear();
    observer.Received.Clear();
    converter.EmitSecondEditUpdate = true;

    var result = await manager.EditAsync(DocId, [Appending("b-1", "x")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Unavailable, result.Status);
    Assert.Equal([CollabCloseReason.CommitUnavailable], writer.Closes);
    Assert.Equal([CollabCloseReason.CommitUnavailable], observer.Closes);
    Assert.Empty(writer.Received);
    Assert.Empty(observer.Received);
    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(endpoint.Saves);
    time.Advance(TimeSpan.FromSeconds(2));
    converter.EmitSecondEditUpdate = false;
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task AnEditIsRefusedWhileAnotherProcessHoldsTheDocument()
  {
    endpoint.Holds(DocId, "hello");
    var held = await operations.OpenAsync(DocId, CancellationToken.None);
    Assert.Equal(CollabDocumentOpenOutcome.Opened, held.Outcome);
    var manager = CreateJournalManager();

    var refused = await manager.EditAsync(DocId, [Appending("b-1", "x")], CancellationToken.None);

    Assert.Equal(CollabEditStatus.Unavailable, refused.Status);
    Assert.Equal(0, endpoint.Loads);
    Assert.Equal(0, manager.LiveRoomCount);

    await held.Session!.DisposeAsync();
    Assert.Equal(
        CollabEditStatus.Applied,
        (await manager.EditAsync(DocId, [Appending("b-1", "x")], CancellationToken.None)).Status);
  }

  [Fact]
  public async Task AReadOnlyMembersOperationIsRejectedWithoutJournalling()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var reader = V2Member(canWrite: false);
    var membership = await Join(manager, reader);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, " hacked");
    reader.Received.Clear();

    await membership.ReceiveAsync(Operation(membership, OpOne, update), CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(reader.Received));
    Assert.Equal("read-only", rejection.Code);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  /// <summary>
  /// The lookup covers the current lineage only, so an operation naming an
  /// older one has to be refused before it: its id would read as uncommitted
  /// and its bytes would be journalled into a history they never belonged to.
  /// </summary>
  [Fact]
  public async Task AnOperationFromAnotherLineageIsRejectedWithoutJournalling()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = await SyncedClientAsync(manager, "hello");
    var update = YDocs.UpdateAppending(client, "!");
    writer.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new OperationFrame(Tags.Lineage, OpOne, update)),
        CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(writer.Received));
    Assert.Equal("lineage-mismatch", rejection.Code);
    Assert.Equal(Tags.Lineage, rejection.Lineage);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal("hello", await ExportedTextAsync(manager));
  }

  [Fact]
  public async Task AnUnusableOperationUpdateIsRejectedWithoutJournalling()
  {
    endpoint.Holds(DocId, "hello");
    var manager = CreateJournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    writer.Received.Clear();

    await membership.ReceiveAsync(
        Operation(membership, OpOne, [0xde, 0xad, 0xbe, 0xef, 0x01]),
        CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(writer.Received));
    Assert.Equal("invalid-update", rejection.Code);
    Assert.Empty(operations.Committed(DocId));
    Assert.Empty(writer.Closes);
  }

  /// <summary>
  /// A well-formed awareness payload carrying <paramref name="clients"/>
  /// entries: y-protocols writes [varuint clients]{[clientId][clock][varstring
  /// state]}* and never checks that a sender owns the ids it encodes, so
  /// 100_000 fabricated peers fit one frame under the message cap.
  /// </summary>
  private static byte[] AwarenessClaiming(ulong clients)
  {
    var payload = new List<byte>();
    WriteVarUint(payload, clients);

    for (var client = 0UL; client < clients; client++)
    {
      WriteVarUint(payload, 1000 + client);
      payload.AddRange([0x01, 0x02, (byte)'{', (byte)'}']);
    }

    return [.. payload];
  }

  private static void WriteVarUint(List<byte> payload, ulong value)
  {
    do
    {
      var current = (byte)(value & 0x7f);
      value >>= 7;
      payload.Add(value == 0 ? current : (byte)(current | 0x80));
    }
    while (value != 0);
  }

  private static byte[] Operation(
      CollabMembership membership,
      string operationId,
      byte[] update)
  {
    return SyncWire.Encode(
        new OperationFrame(membership.Tag.Lineage, operationId, update));
  }

  private static CollabEditOp.Insert Appending(string id, string text)
  {
    return new CollabEditOp.Insert(
        id,
        new JsonObject
        {
          ["id"] = id,
          ["type"] = "paragraph",
          ["data"] = new JsonObject { ["text"] = text },
        },
        After: null,
        Parent: null);
  }

  private static FakeMember V2Member(string? actorId = null, bool canWrite = true)
  {
    return new FakeMember(
        canWrite,
        acceptsControlFrames: true,
        actorId,
        CollabOperationSource.ClientV2);
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

  /// <summary>A room backed by an operation store, which is what turns on the commit path.</summary>
  private CollabRoomManager CreateJournalManager(CollabRoomOptions? options = null)
  {
    return new CollabRoomManager(
        store,
        endpoint,
        converter,
        options ?? new CollabRoomOptions(),
        time,
        log.Add,
        operations);
  }

  /// <summary>
  /// Joins, and for a v2 member also completes the sync exchange the room
  /// requires before it accepts an operation frame — without it every commit
  /// test below would be exercising the not-synced gate instead.
  /// <paramref name="synced"/> false is for the tests of that gate.
  /// </summary>
  private static async Task<CollabMembership> Join(
      CollabRoomManager manager,
      FakeMember member,
      bool synced = true)
  {
    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    var membership = result.Membership!;

    if (synced && member.ProtocolSource == CollabOperationSource.ClientV2)
    {
      await membership.ReceiveAsync(
          SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient()))),
          CancellationToken.None);
    }

    return membership;
  }

  /// <summary>A client doc holding the room's current state, obtained the way a stock client would.</summary>
  private static async Task<YDoc> SyncedClientAsync(CollabRoomManager manager, string expectedText)
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

  /// <summary>
  /// The room's own state vector, as it answers a SyncStep1 with. A stock
  /// provider's SyncStep2 is the diff its doc computes against exactly this.
  /// </summary>
  private static async Task<byte[]> ServerStateVectorAsync(CollabRoomManager manager, YDoc client)
  {
    var probe = new FakeMember(canWrite: false);
    var membership = await Join(manager, probe);
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(client))),
        CancellationToken.None);
    await membership.LeaveAsync();

    return Assert.IsType<SyncStep1Frame>(
        probe.Received.First(frame => frame is SyncStep1Frame)).StateVector;
  }

  private static async Task Edit(CollabRoomManager manager, CollabMembership membership, string value)
  {
    var client = await SyncedClientAsync(manager, await ExportedTextAsync(manager));
    var update = YDocs.UpdateAppending(client, value);

    await membership.ReceiveAsync(SyncWire.Encode(new SyncUpdateFrame(update)), CancellationToken.None);
  }

  private static async Task<string> ExportedTextAsync(CollabRoomManager manager)
  {
    var probe = new FakeMember(canWrite: false);
    var membership = await Join(manager, probe);
    await membership.ReceiveAsync(SyncWire.Encode(new SyncStep1Frame([0])), CancellationToken.None);
    await membership.LeaveAsync();
    var replica = YDocs.NewClient();
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
    var client = await SyncedClientAsync(manager, "hello");

    // Gate the off-lane write so the edit's persist is still in flight.
    var stuck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    store.BeforeWrite = () => stuck.Task;
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncUpdateFrame(YDocs.UpdateAppending(client, "!"))),
        CancellationToken.None);

    var reset = manager.ResetAsync(DocId, CancellationToken.None).AsTask();

    // Release the stale write; the reset finishes only after it landed.
    stuck.SetResult();
    store.BeforeWrite = null;
    var minted = Tags.AssertMinted(1, await reset);

    Assert.Equal(["write:0", "reset:1"], store.Journal[^2..]);
    Assert.Equal(Tags.At(1, minted), store.Stored(DocId).Tag);
  }

  [Fact]
  public void DisposeIsIdempotent()
  {
    var room = new CollabRoom(
        DocId,
        store,
        endpoint,
        converter,
        new CollabRoomOptions(),
        time,
        log.Add);

    room.Dispose();
    room.Dispose();

    Assert.Equal(0, time.ArmedTimerCount);
  }
}
