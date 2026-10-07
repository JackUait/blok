using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Documents;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A format-1 room (rich text as HTML in a plain Y.Text) opened by this
/// server: migrated once, in place, under a new lineage, so format-1 clients
/// and their offline operations cannot write into it.
/// </summary>
public sealed class CollabRoomMigrationTests
{
  private const string DocId = "doc-1";
  private const string OpOne = "0123456789abcdef0123456789abcdef";
  private const string Fixture = "rich-marks";

  private readonly FakeWorkingSetStore store = new();
  private readonly FakeCollabOperationStore operations = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly ManualTimeProvider time = new();
  private readonly List<string> log = [];
  private readonly YDocConverterFixture fixture = YDocConverterFixtures.LoadFormat1(Fixture);

  public CollabRoomMigrationTests()
  {
    endpoint.HoldsNothing(DocId);
  }

  [Fact]
  public async Task AFormat1JournalIsMigratedOnOpen()
  {
    var tail = await SeedFormat1JournalAsync(withTail: true);
    var manager = JournalManager();
    var member = V2Member();

    var membership = await Join(manager, member);

    var head = operations.Head(DocId)!;
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, head.Format);
    Assert.Equal(5, head.Epoch);
    Assert.NotEqual(Tags.Lineage, head.Lineage);
    Assert.Matches("^[0-9a-f]{32}$", head.Lineage);
    Assert.Equal(0ul, head.DurableThrough);
    Assert.Empty(operations.Committed(DocId));
    Assert.Equal(new CollabWorkingSetTag(head.Format, head.Epoch, head.Lineage), membership.Tag);
    Assert.Equal(membership.Tag, Assert.IsType<BlokControlFrame>(member.Received[0]).Tag);

    // What the edit and state endpoints name: the new lineage, at its sequence 0.
    var state = await manager.StateAsync(DocId, CancellationToken.None);
    Assert.Equal(new CollabEditReceipt(membership.Tag, 0), state.Head);

    // The baseline alone rebuilds the migrated room, the tail's edit included.
    var rebuilt = Replay(operations.Baseline(DocId));
    AssertMigrated(rebuilt);
    AssertJsonEqual(Expected(withTail: tail), RichTextRuntime.Export(rebuilt));
  }

  [Fact]
  public async Task AMigratedJournalIsNotMigratedAgain()
  {
    await SeedFormat1JournalAsync();
    var manager = JournalManager();
    await Join(manager, V2Member());
    var migrated = operations.Head(DocId)!;
    var baseline = operations.Baseline(DocId);
    await manager.DrainAsync(CancellationToken.None);

    var again = JournalManager();
    var membership = await Join(again, V2Member());

    Assert.Equal(migrated, operations.Head(DocId));
    Assert.Equal(migrated.Lineage, membership.Tag.Lineage);
    Assert.Equal(
        baseline.Select(update => update.ToArray()),
        operations.Baseline(DocId).Select(update => update.ToArray()));
  }

  /// <summary>The reset is the commit point: until it lands the journal is format 1 and the next open migrates again.</summary>
  [Fact]
  public async Task AFailedCommitLeavesTheFormat1JournalIntact()
  {
    await SeedFormat1JournalAsync();
    var before = operations.Head(DocId);
    var baseline = operations.Baseline(DocId).Select(update => update.ToArray()).ToArray();
    operations.FailResets = _ => new IOException("the disk is full");

    var result = await JournalManager().JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, result.Status);
    Assert.Equal(before, operations.Head(DocId));
    Assert.Equal(baseline, operations.Baseline(DocId).Select(update => update.ToArray()).ToArray());

    operations.FailResets = null;
    var membership = await Join(JournalManager(), V2Member());

    Assert.Equal(CollabWorkingSetTag.CurrentFormat, membership.Tag.Format);
    AssertMigrated(Replay(operations.Baseline(DocId)));
  }

  [Fact]
  public async Task AFailedReadLeavesTheFormat1JournalIntact()
  {
    await SeedFormat1JournalAsync();
    var before = operations.Head(DocId);

    var result = await new CollabRoomManager(
            store,
            endpoint,
            new CollabDocConverter(time, new FailingReader()),
            new CollabRoomOptions(),
            time,
            log.Add,
            operations)
        .JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, result.Status);
    Assert.Equal(before, operations.Head(DocId));
    Assert.Contains(log, line =>
        line.Contains("could not migrate its format-1 rich text", StringComparison.Ordinal) &&
        line.Contains("ran past its timeout", StringComparison.Ordinal));
  }

  /// <summary>
  /// A field too large for the runtime's timeout fails the same way on every
  /// open. Each attempt holds a pooled engine for the whole timeout, so the
  /// document is held off for a doubling wait instead of being reloaded by
  /// every reconnect.
  /// </summary>
  [Fact]
  public async Task AMigrationThatRunsPastTheRuntimesLimitsIsHeldOff()
  {
    await SeedFormat1JournalAsync();
    var reader = new LimitReader();
    var manager = new CollabRoomManager(
        store,
        endpoint,
        new CollabDocConverter(time, reader),
        new CollabRoomOptions(),
        time,
        log.Add,
        operations);

    var first = await manager.JoinAsync(DocId, V2Member(), CancellationToken.None);
    var during = await manager.JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, first.Status);
    Assert.Equal(CollabJoinStatus.Unavailable, during.Status);
    Assert.Equal(1, reader.Calls);
    Assert.Contains(log, line => line.Contains("held off", StringComparison.Ordinal));

    time.Advance(new CollabRoomOptions().Backoff(1));
    var after = await manager.JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, after.Status);
    Assert.Equal(2, reader.Calls);
    Assert.Equal(CollabWorkingSetTag.HtmlRichTextFormat, operations.Head(DocId)!.Format);
  }

  /// <summary>
  /// The pre-reset load does not migrate. A reset that is then refused must
  /// not leave that format-1 room serving: every joiner would be told format 1
  /// and the old lineage.
  /// </summary>
  [Fact]
  public async Task ARefusedResetDoesNotLeaveAFormat1RoomServing()
  {
    await SeedFormat1JournalAsync();
    store.FailRetires = _ => new IOException("the disk is busy");
    var manager = JournalManager();

    var reset = await manager.ResetForHttpAsync(DocId, CancellationToken.None);

    Assert.Equal(CollabResetStatus.Unavailable, reset.Status);

    store.FailRetires = null;
    var membership = await Join(manager, V2Member());

    Assert.Equal(CollabWorkingSetTag.CurrentFormat, membership.Tag.Format);
    Assert.NotEqual(Tags.Lineage, membership.Tag.Lineage);
  }

  /// <summary>The migration's reset leaves the head at sequence 0, so the room's own counters must follow it.</summary>
  [Fact]
  public async Task AnEditAfterMigrationCommitsAtSequenceOneAndCheckpoints()
  {
    await SeedFormat1JournalAsync(withTail: true);
    var manager = JournalManager();
    await Join(manager, V2Member());

    var result = await manager.EditAsync(
        DocId,
        [new CollabEditOp.Insert(
            "added",
            new JsonObject
            {
              ["id"] = "added",
              ["type"] = "paragraph",
              ["data"] = new JsonObject { ["text"] = "<b>after</b>" },
            },
            After: null,
            Parent: null)],
        CancellationToken.None);

    Assert.Equal(CollabEditStatus.Applied, result.Status);
    Assert.Equal(1ul, Assert.Single(operations.Committed(DocId)).ServerSequence);
    Assert.True(await manager.CheckpointAsync(DocId, CancellationToken.None));
    Assert.Equal(1ul, operations.Checkpoint(DocId)!.Through);
  }

  /// <summary>
  /// The server's half of refusing a format-1 client: the control frame says
  /// format 2 (the client ends unsupported-format), and an operation from the
  /// old lineage — an offline outbox — is rejected, never journalled.
  /// </summary>
  [Fact]
  public async Task AFormat1ClientsOperationIsRefusedAfterMigration()
  {
    await SeedFormat1JournalAsync();
    var manager = JournalManager();
    var writer = V2Member();
    var membership = await Join(manager, writer);
    var client = Replay(operations.Baseline(DocId));
    var update = client.Transact(transaction =>
        ((YMap)((YMap)client.GetMap("blocks").Get("m-simple")!).Get("data")!)
            .Set(transaction, "text", new YText("<b>offline</b>")))!;
    writer.Received.Clear();

    await membership.ReceiveAsync(
        SyncWire.Encode(new OperationFrame(Tags.Lineage, OpOne, update)),
        CancellationToken.None);

    var rejection = Assert.IsType<RejectionFrame>(Assert.Single(writer.Received));
    Assert.Equal("lineage-mismatch", rejection.Code);
    Assert.Empty(operations.Committed(DocId));
  }

  [Fact]
  public async Task AJournalInANewerFormatIsRefusedAndKept()
  {
    await SeedJournalAsync(CollabWorkingSetTag.CurrentFormat + 1);
    var before = operations.Head(DocId);

    var result = await JournalManager().JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, result.Status);
    Assert.Equal(before, operations.Head(DocId));
    Assert.Contains(log, line => line.Contains("format 3", StringComparison.Ordinal));
  }

  [Fact]
  public async Task AFormat1WorkingSetIsMigratedInPlace()
  {
    store.Seed(DocId, [fixture.Update], Format1(4));
    var manager = WorkingSetManager();

    var membership = await Join(manager, V2Member());

    var stored = store.Stored(DocId);
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, stored.Tag.Format);
    Assert.Equal(5, stored.Tag.Epoch);
    Assert.NotEqual(Tags.Lineage, stored.Tag.Lineage);
    Assert.Equal(stored.Tag, membership.Tag);

    // WriteAsync, never ResetAsync: a reset stores an empty log.
    Assert.Equal(0, store.Resets);
    Assert.Equal(0, endpoint.Loads);
    var rebuilt = Replay(store.FramesOf(DocId).Select(frame => (ReadOnlyMemory<byte>)frame).ToList());
    AssertMigrated(rebuilt);
    AssertJsonEqual(Expected(withTail: false), RichTextRuntime.Export(rebuilt));
  }

  /// <summary>The host record still holds HTML; a migrated room writes it back as segments, as the journal path does.</summary>
  [Fact]
  public async Task AMigratedWorkingSetWritesTheRecordBack()
  {
    store.Seed(DocId, [fixture.Update], Format1(4));
    var manager = WorkingSetManager();
    await Join(manager, V2Member());

    await Waits.UntilAdvancingAsync(
        time,
        TimeSpan.FromSeconds(5),
        () => endpoint.Saves.Count > 0,
        "the migrated record to be written back");

    AssertJsonEqual(Expected(withTail: false), endpoint.Saves[0].Data["blocks"]!);
  }

  [Fact]
  public async Task AFailedWriteLeavesTheFormat1WorkingSetIntact()
  {
    store.Seed(DocId, [fixture.Update], Format1(4));
    store.FailWrites = _ => new IOException("the disk is full");

    var result = await WorkingSetManager().JoinAsync(DocId, V2Member(), CancellationToken.None);

    Assert.Equal(CollabJoinStatus.SeedFailed, result.Status);
    Assert.Equal(Format1(4), store.Stored(DocId).Tag);
    Assert.Equal(fixture.Update, Assert.Single(store.FramesOf(DocId)));
  }

  [Fact]
  public async Task AnEmptyFormat1WorkingSetSeedsInTheCurrentFormat()
  {
    store.Seed(DocId, [], Format1(4));
    endpoint.HoldsDocument(DocId, new JsonObject { ["blocks"] = fixture.Canonical.DeepClone() });

    var membership = await Join(WorkingSetManager(), V2Member());

    Assert.Equal(CollabWorkingSetTag.CurrentFormat, membership.Tag.Format);
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, store.Stored(DocId).Tag.Format);
    AssertMigrated(Replay(store.FramesOf(DocId).Select(frame => (ReadOnlyMemory<byte>)frame).ToList()));
  }

  [Fact]
  public async Task AFormat1WorkingSetIsMigratedWhenTheJournalAdoptsIt()
  {
    store.Seed(DocId, [fixture.Update], Format1(4));

    var membership = await Join(JournalManager(), V2Member());

    var head = operations.Head(DocId)!;
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, head.Format);
    Assert.Equal(5, head.Epoch);
    Assert.NotEqual(Tags.Lineage, head.Lineage);
    Assert.Equal(head.Lineage, membership.Tag.Lineage);
    AssertMigrated(Replay(operations.Baseline(DocId)));
  }

  [Fact]
  public async Task AJournalResetStampsTheCurrentFormat()
  {
    await SeedFormat1JournalAsync();

    var tag = await JournalManager().ResetAsync(DocId, CancellationToken.None);

    Assert.Equal(CollabWorkingSetTag.CurrentFormat, tag.Format);
    Assert.Equal(5, tag.Epoch);
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, operations.Head(DocId)!.Format);
  }

  [Fact]
  public async Task AWorkingSetResetStampsTheCurrentFormat()
  {
    store.Seed(DocId, [fixture.Update], Format1(4));

    var tag = await WorkingSetManager().ResetAsync(DocId, CancellationToken.None);

    Assert.Equal(CollabWorkingSetTag.CurrentFormat, tag.Format);
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, store.Stored(DocId).Tag.Format);
  }

  private static CollabWorkingSetTag Format1(long epoch)
  {
    return new CollabWorkingSetTag(CollabWorkingSetTag.HtmlRichTextFormat, epoch, Tags.Lineage);
  }

  /// <summary>The fixture's room as format-1 journal history: its state as the baseline, and optionally one format-1 edit after it.</summary>
  private async Task<bool> SeedFormat1JournalAsync(bool withTail = false)
  {
    await SeedJournalAsync(CollabWorkingSetTag.HtmlRichTextFormat, withTail);

    return withTail;
  }

  private async Task SeedJournalAsync(int format, bool withTail = false)
  {
    var open = await operations.OpenAsync(DocId);
    await using var session = open.Session!;
    await session.ResetAsync(new CollabOperationReset(format, 4, Tags.Lineage, [fixture.Update]));

    if (withTail)
    {
      var client = new YDoc();
      client.ApplyUpdate(fixture.Update);
      var text = (YText)((YMap)((YMap)client.GetMap("blocks").Get("m-highlight")!).Get("data")!).Get("text")!;
      var update = client.Transact(transaction => text.Insert(transaction, 0, "<i>tail</i> "))!;

      await session.AppendAsync(new CollabOperationCandidate(
          OpOne, null, CollabOperationSource.ClientV2, update, new byte[32]));
    }
  }

  private JsonNode Expected(bool withTail)
  {
    var canonical = fixture.Canonical.DeepClone();

    if (withTail)
    {
      var block = canonical.AsArray().Single(entry => entry!["id"]!.GetValue<string>() == "m-highlight")!;
      block["data"]!["text"] = "<i>tail</i> " + block["data"]!["text"]!.GetValue<string>();
    }

    return RichTextRuntime.WithSegments(canonical);
  }

  private static void AssertMigrated(YDoc doc)
  {
    Assert.Empty(YDocConverter.CollectLegacyRichText(doc, RichTextFields.BuiltIn));

    foreach (var id in doc.GetMap("blocks").Keys)
    {
      var data = (YMap)((YMap)doc.GetMap("blocks").Get(id)!).Get("data")!;
      Assert.IsType<YXmlText>(data.Get("text"));
    }
  }

  private static YDoc Replay(IReadOnlyList<ReadOnlyMemory<byte>> updates)
  {
    var doc = new YDoc();

    foreach (var update in updates)
    {
      Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update.ToArray()).Outcome);
    }

    return doc;
  }

  private static void AssertJsonEqual(JsonNode expected, JsonNode actual)
  {
    Assert.Equal(
        YDocConverterFixtures.Canonicalize(expected),
        YDocConverterFixtures.Canonicalize(actual));
  }

  private CollabRoomManager JournalManager()
  {
    return new CollabRoomManager(
        store,
        endpoint,
        new CollabDocConverter(time, RichTextRuntime.Reader),
        new CollabRoomOptions(),
        time,
        log.Add,
        operations);
  }

  private CollabRoomManager WorkingSetManager()
  {
    return new CollabRoomManager(
        store,
        endpoint,
        new CollabDocConverter(time, RichTextRuntime.Reader),
        new CollabRoomOptions(),
        time,
        log.Add);
  }

  private static FakeMember V2Member()
  {
    return new FakeMember(
        canWrite: true,
        acceptsControlFrames: true,
        actorId: null,
        CollabOperationSource.ClientV2);
  }

  private static async Task<CollabMembership> Join(CollabRoomManager manager, FakeMember member)
  {
    var result = await manager.JoinAsync(DocId, member, CancellationToken.None);

    Assert.True(result.Status == CollabJoinStatus.Joined, $"{result.Status}: {result.Error}");
    var membership = result.Membership!;

    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient()))),
        CancellationToken.None);

    return membership;
  }

  private sealed class LimitReader : IRichTextHtmlReader
  {
    internal int Calls { get; private set; }

    public ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
        IReadOnlyList<RichTextHtml> fields, CancellationToken cancellationToken = default)
    {
      Calls++;

      throw new BlokDocumentConversionException(
          BlokConversionFailure.TimedOut, new TimeoutException("ran past the runtime's timeout"));
    }
  }

  private sealed class FailingReader : IRichTextHtmlReader
  {
    public ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
        IReadOnlyList<RichTextHtml> fields, CancellationToken cancellationToken = default)
    {
      throw new TimeoutException("the runtime ran past its timeout");
    }
  }
}

internal static class MigrationTestMaps
{
  internal static object? Get(this YMap map, string key)
  {
    return map.TryGet(key, out var value) ? value : null;
  }
}
