using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>History list, read, delete and restore through the room manager, on the real converter.</summary>
public sealed class CollabHistoryManagerTests
{
  private const string DocId = "doc-1";
  private readonly FakeWorkingSetStore store = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeCollabOperationStore operations = new();
  private readonly ManualTimeProvider time = new();
  private readonly List<string> log = [];

  public CollabHistoryManagerTests()
  {
    endpoint.HoldsDocument(DocId, Document(("a", "one")));
  }

  [Fact]
  public async Task WithoutAHistoryStoreEveryMethodAnswersNoHistory()
  {
    foreach (var manager in new[]
    {
      ManagerOver(null),
      ManagerOver(new JournalWithoutHistory(operations)),
    })
    {
      Assert.Equal(CollabHistoryStatus.NoHistory, (await manager.HistoryAsync(DocId)).Status);
      Assert.Equal(CollabHistoryStatus.NoHistory, (await manager.ReadVersionAsync(DocId, "l", 0)).Status);
      Assert.Equal((CollabHistoryStatus.NoHistory, null), await manager.DeleteLineageAsync(DocId, "l"));
      var restore = await manager.RestoreAsync(DocId, "l", 0, "op", null);
      Assert.Equal(CollabHistoryStatus.NoHistory, restore.History);
      Assert.Null(restore.Edit);
    }
  }

  [Fact]
  public async Task TheListGroupsEveryLineageNewestFirst()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    var first = Lineage();
    await EditAsync(manager, Update("a", "1"), actor: "u1");
    await ResetAsync(manager);
    var second = Lineage();
    await EditAsync(manager, Update("a", "2"), actor: "u2");
    await EditAsync(manager, Update("a", "3"), actor: "u1");
    await ResetAsync(manager);
    var third = Lineage();
    await EditAsync(manager, Update("a", "4"));

    var result = await manager.HistoryAsync(DocId);

    Assert.Equal(CollabHistoryStatus.Ready, result.Status);
    Assert.Equal([first, second, third], result.Lineages.Select(lineage => lineage.Lineage));
    Assert.Equal([false, false, true], result.Lineages.Select(lineage => lineage.Current));
    Assert.Equal(
        [(third, 1UL), (third, 0UL), (second, 2UL), (second, 0UL), (first, 1UL), (first, 0UL)],
        result.Versions.Select(version => (version.Lineage, version.Sequence)));
    Assert.Equal(["u2", "u1"], result.Versions[2].Actors);
    Assert.Equal(DateTimeOffset.UnixEpoch.AddSeconds(1), result.Versions[2].StartedAt);
    Assert.Equal(DateTimeOffset.UnixEpoch.AddSeconds(2), result.Versions[2].SavedAt);
  }

  [Fact]
  public async Task AReadAnswersTheExportAtThatPointWithItsTime()
  {
    var manager = CreateManager();
    var atZero = await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    var atOne = await BlocksAsync(manager);
    await EditAsync(manager, Insert("b", "three", after: "a"));
    var atTwo = await BlocksAsync(manager);
    var lineage = Lineage();

    var points = new[] { (0UL, atZero), (1UL, atOne), (2UL, atTwo) };

    foreach (var (sequence, expected) in points)
    {
      var read = await manager.ReadVersionAsync(DocId, lineage, sequence);

      Assert.Equal(CollabHistoryStatus.Ready, read.Status);
      var json = JsonNode.Parse(read.Json)!;
      Assert.True(JsonNode.DeepEquals(expected, json["blocks"]), $"point {sequence}: {json["blocks"]}");
      var at = DateTimeOffset.UnixEpoch.AddSeconds(sequence);
      Assert.Equal(at, read.Time);
      Assert.Equal(at.ToUnixTimeMilliseconds(), json["time"]!.GetValue<long>());
    }
  }

  [Fact]
  public async Task ABaselineWithAnUnknownCreatedAtHasNoTime()
  {
    operations.ResetsWithUnknownCreatedAt = true;
    var manager = CreateManager();
    await LoadAsync(manager);

    var read = await manager.ReadVersionAsync(DocId, Lineage(), 0);

    Assert.Equal(CollabHistoryStatus.Ready, read.Status);
    Assert.Null(read.Time);
    Assert.False(JsonNode.Parse(read.Json)!.AsObject().ContainsKey("time"));
  }

  [Fact]
  public async Task AnUnknownPointIsNotFound()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));

    Assert.Equal(CollabHistoryStatus.NotFound, (await manager.ReadVersionAsync(DocId, Lineage(), 2)).Status);
    Assert.Equal(CollabHistoryStatus.NotFound, (await manager.ReadVersionAsync(DocId, "ffffffffffffffffffffffffffffffff", 0)).Status);
    var restore = await manager.RestoreAsync(DocId, Lineage(), 2, "op", null);
    Assert.Equal(CollabHistoryStatus.NotFound, restore.History);
    Assert.Null(restore.Edit);
    Assert.Single(operations.Committed(DocId));
  }

  [Fact]
  public async Task APurgedDocumentAnswersPurgedFromEveryMethod()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    var lineage = Lineage();
    await manager.PurgeDocumentAsync(DocId, _ => ValueTask.FromResult(true));

    Assert.Equal(CollabHistoryStatus.Purged, (await manager.HistoryAsync(DocId)).Status);
    Assert.Equal(CollabHistoryStatus.Purged, (await manager.ReadVersionAsync(DocId, lineage, 0)).Status);
    Assert.Equal(CollabHistoryStatus.Purged, (await manager.DeleteLineageAsync(DocId, lineage)).Status);
    Assert.Equal(CollabHistoryStatus.Purged, (await manager.RestoreAsync(DocId, lineage, 0, "op", null)).History);
  }

  [Fact]
  public async Task AFreshManagerSeesAPurgeFromAnEarlierProcess()
  {
    var earlier = CreateManager();
    await LoadAsync(earlier);
    var lineage = Lineage();
    await earlier.PurgeDocumentAsync(DocId, _ => ValueTask.FromResult(true));
    var manager = CreateManager();

    Assert.Equal(CollabHistoryStatus.Purged, (await manager.HistoryAsync(DocId)).Status);
    Assert.Equal(CollabHistoryStatus.Purged, (await manager.ReadVersionAsync(DocId, lineage, 0)).Status);
    Assert.Equal(CollabHistoryStatus.Purged, (await manager.DeleteLineageAsync(DocId, lineage)).Status);
    Assert.Equal(CollabHistoryStatus.Purged, (await manager.RestoreAsync(DocId, lineage, 0, "op", null)).History);
  }

  [Fact]
  public async Task AnUnreadableLineageListIsCorrupt()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    operations.FailListings = _ => new InvalidDataException("collab: torn ledger");

    Assert.Equal(CollabHistoryStatus.Corrupt, (await manager.HistoryAsync(DocId)).Status);
  }

  [Fact]
  public async Task ACorruptRecordIsCorrupt()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "two"));
    operations.CorruptRecord(DocId, 1);

    Assert.Equal(CollabHistoryStatus.Corrupt, (await manager.ReadVersionAsync(DocId, Lineage(), 1)).Status);
    Assert.Equal(CollabHistoryStatus.Ready, (await manager.ReadVersionAsync(DocId, Lineage(), 0)).Status);
    Assert.Equal(CollabHistoryStatus.Corrupt, (await manager.RestoreAsync(DocId, Lineage(), 1, "op", null)).History);
  }

  [Fact]
  public async Task ARestoreMakesTheLiveDocumentEqualThePointAsOneJournalledEdit()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "A"));
    var pointA = await BlocksAsync(manager);
    await EditAsync(manager, Insert("b", "B", after: "a"));
    await EditAsync(manager, Remove("a"));
    var lineage = Lineage();

    var result = await manager.RestoreAsync(DocId, lineage, 1, "op-restore", "u9");

    Assert.Equal(CollabHistoryStatus.Ready, result.History);
    Assert.Equal(CollabEditStatus.Applied, result.Edit!.Status);
    Assert.Equal(4UL, result.Edit.Receipt!.ServerSequence);
    Assert.True(
        JsonNode.DeepEquals(WithoutStamps(pointA), WithoutStamps(await BlocksAsync(manager))),
        (await BlocksAsync(manager)).ToJsonString());
    var record = operations.Committed(DocId)[^1];
    Assert.Equal(4UL, record.ServerSequence);
    Assert.Equal("op-restore", record.OperationId);
    Assert.Equal("u9", record.ActorId);
    Assert.Equal(CollabOperationSource.HttpEdit, record.Source);
    Assert.Equal(
        SHA256.HashData(Encoding.UTF8.GetBytes($"restore\n{lineage}\n1")),
        record.Digest.ToArray());
  }

  [Fact]
  public async Task ARestoreReachesALineageAResetReplaced()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "old"));
    var old = await BlocksAsync(manager);
    var lineage = Lineage();
    await ResetAsync(manager);

    var result = await manager.RestoreAsync(DocId, lineage, 1, "op", null);

    Assert.Equal(CollabEditStatus.Applied, result.Edit!.Status);
    Assert.True(JsonNode.DeepEquals(WithoutStamps(old), WithoutStamps(await BlocksAsync(manager))));
  }

  [Fact]
  public async Task ARetriedRestoreGetsTheFirstReceipt()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "A"));
    await EditAsync(manager, Update("a", "B"));
    var lineage = Lineage();
    var first = await manager.RestoreAsync(DocId, lineage, 1, "op-restore", null);
    await EditAsync(manager, Update("a", "C"));

    var retry = await manager.RestoreAsync(DocId, lineage, 1, "op-restore", null);

    Assert.Equal(CollabEditStatus.Applied, retry.Edit!.Status);
    Assert.Equal(first.Edit!.Receipt!.ServerSequence, retry.Edit.Receipt!.ServerSequence);
    Assert.Equal(4, operations.Committed(DocId).Count);
  }

  [Fact]
  public async Task ARetryAfterItsLineageWasDeletedGetsTheFirstReceipt()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "old"));
    var old = Lineage();
    await ResetAsync(manager);
    var first = await manager.RestoreAsync(DocId, old, 1, "op-restore", null);
    Assert.Equal(CollabEditStatus.Applied, first.Edit!.Status);
    Assert.Equal(
        (CollabHistoryStatus.Ready, CollabLineageDeleteOutcome.Deleted),
        await manager.DeleteLineageAsync(DocId, old));

    var retry = await manager.RestoreAsync(DocId, old, 1, "op-restore", null);
    var fresh = await manager.RestoreAsync(DocId, old, 1, "op-other", null);

    Assert.Equal(CollabHistoryStatus.Ready, retry.History);
    Assert.Equal(CollabEditStatus.Applied, retry.Edit!.Status);
    Assert.Equal(first.Edit.Receipt!.ServerSequence, retry.Edit.Receipt!.ServerSequence);
    Assert.Equal(CollabHistoryStatus.NotFound, fresh.History);
    Assert.Null(fresh.Edit);
  }

  [Fact]
  public async Task TheGateMeasuresTheFrameTheLiveApplyBroadcasts()
  {
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var live = new YDoc();
    await converter.SeedAsync(live, Document(("a", "one")));

    // Rewrites push the live client's clock past 2^14, so its clock varints
    // are wider than a fresh client's.
    for (var round = 0; round < 20; round++)
    {
      await converter.ApplyOpsAsync(live, [Update("a", new string((char)('a' + round), 1000))]);
    }

    var ops = Enumerable.Range(0, 40)
        .Select(index => (CollabEditOp)Insert($"n{index}", $"text {index}", index == 0 ? "a" : $"n{index - 1}"))
        .ToList();

    var measured = await CollabRoom.PlannedFrameBytesAsync(live, converter, ops, CancellationToken.None);
    long broadcast = 0;
    live.UpdateEmitted += update => broadcast += SyncWire.Encode(new SyncUpdateFrame(update.Update)).Length;
    await converter.ApplyOpsAsync(live, ops);

    Assert.Equal(broadcast, measured);
  }

  [Fact]
  public async Task AStalePreconditionRefusesTheRestore()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "A"));
    var lineage = Lineage();

    var result = await manager.RestoreAsync(
        DocId, lineage, 0, "op", null, new CollabEditPrecondition(lineage, 0));

    Assert.Equal(CollabHistoryStatus.Ready, result.History);
    Assert.Equal(CollabEditStatus.PreconditionFailed, result.Edit!.Status);
    Assert.Equal(1UL, result.Edit.Receipt!.ServerSequence);
    Assert.Single(operations.Committed(DocId));
  }

  [Fact]
  public async Task ARestoreTooLargeForOneFrameChangesNothing()
  {
    var manager = CreateManager(new CollabRoomOptions { AnnouncedMaxMessageBytes = 2048 });
    await LoadAsync(manager);
    var member = new FakeMember(true, acceptsControlFrames: true, null, CollabOperationSource.ClientV2);
    await JoinAsync(manager, member);
    await EditAsync(manager, Insert("big", new string('x', 8192), after: "a"));
    await EditAsync(manager, Remove("big"));
    var before = await BlocksAsync(manager);
    var frames = member.Received.OfType<SyncUpdateFrame>().Count();

    var result = await manager.RestoreAsync(DocId, Lineage(), 1, "op", null);

    Assert.Equal(CollabEditStatus.TooLarge, result.Edit!.Status);
    Assert.Equal(2, operations.Committed(DocId).Count);
    Assert.Equal(frames, member.Received.OfType<SyncUpdateFrame>().Count());
    Assert.True(JsonNode.DeepEquals(before, await BlocksAsync(manager)));
    Assert.Empty(member.Closes);
  }

  [Fact]
  public async Task ARestoreJustUnderTheFrameLimitIsApplied()
  {
    const int Limit = 2048;
    var manager = CreateManager(new CollabRoomOptions { AnnouncedMaxMessageBytes = Limit });
    await LoadAsync(manager);
    await EditAsync(manager, Insert("big", new string('x', BorderlineText), after: "a"));
    await EditAsync(manager, Remove("big"));

    var result = await manager.RestoreAsync(DocId, Lineage(), 1, "op", null);

    Assert.Equal(CollabEditStatus.Applied, result.Edit!.Status);
    var frame = SyncWire.Encode(new SyncUpdateFrame(operations.Committed(DocId)[^1].Update.ToArray())).Length;
    Assert.InRange(frame, Limit - 64, Limit);
  }

  [Fact]
  public async Task ARestoreOfTheCurrentPointWritesNothing()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    await EditAsync(manager, Update("a", "A"));
    await EditAsync(manager, Insert("b", "B", after: "a"));

    var result = await manager.RestoreAsync(DocId, Lineage(), 2, "op", null);

    Assert.Equal(CollabEditStatus.Applied, result.Edit!.Status);
    Assert.Equal(2UL, result.Edit.Receipt!.ServerSequence);
    Assert.Equal(2, operations.Committed(DocId).Count);
  }

  [Fact]
  public async Task ADeleteRefusesTheCurrentLineageAndRemovesAnOldOne()
  {
    var manager = CreateManager();
    await LoadAsync(manager);
    var old = Lineage();
    await ResetAsync(manager);

    Assert.Equal((CollabHistoryStatus.Ready, CollabLineageDeleteOutcome.Current), await manager.DeleteLineageAsync(DocId, Lineage()));
    Assert.Equal((CollabHistoryStatus.Ready, CollabLineageDeleteOutcome.Deleted), await manager.DeleteLineageAsync(DocId, old));
    Assert.Equal((CollabHistoryStatus.Ready, CollabLineageDeleteOutcome.NotFound), await manager.DeleteLineageAsync(DocId, old));
    Assert.DoesNotContain(old, (await manager.HistoryAsync(DocId)).Lineages.Select(lineage => lineage.Lineage));
  }

  // Measured: with a 5-byte client id varint this restore's frame is the
  // text plus 164 bytes, exactly the 2048 limit. The room's id is random; a
  // shorter one makes the frame about 22 bytes smaller per varint byte.
  private const int BorderlineText = 1884;

  private CollabRoomManager CreateManager(CollabRoomOptions? options = null)
  {
    return ManagerOver(operations, options);
  }

  private CollabRoomManager ManagerOver(
      ICollabOperationStore? operationStore,
      CollabRoomOptions? options = null)
  {
    return new CollabRoomManager(
        store,
        endpoint,
        new CollabDocConverter(time, RichTextRuntime.Reader),
        options ?? new CollabRoomOptions(),
        time,
        log.Add,
        operationStore);
  }

  private string Lineage() => operations.Head(DocId)!.Lineage;

  private static async Task<JsonNode> LoadAsync(CollabRoomManager manager) => await BlocksAsync(manager);

  private static async Task<JsonNode> BlocksAsync(CollabRoomManager manager)
  {
    var state = await manager.StateAsync(DocId);

    Assert.Equal(CollabStateStatus.Ready, state.Status);

    return JsonNode.Parse(state.Json)!["blocks"]!;
  }

  private static async Task EditAsync(CollabRoomManager manager, CollabEditOp op, string? actor = null)
  {
    var result = await manager.EditAsync(
        DocId, [op], Guid.NewGuid().ToString("N"), CollabEditOps.CanonicalBodyDigest([op]), actor);

    Assert.Equal(CollabEditStatus.Applied, result.Status);
  }

  private static async Task ResetAsync(CollabRoomManager manager)
  {
    Assert.Equal(CollabResetStatus.Reset, (await manager.ResetForHttpAsync(DocId)).Status);
  }

  private static async Task JoinAsync(CollabRoomManager manager, FakeMember member)
  {
    var result = await manager.JoinAsync(DocId, member);

    Assert.Equal(CollabJoinStatus.Joined, result.Status);
    await result.Membership!.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient()))),
        CancellationToken.None);
  }

  private static JsonObject Document(params (string Id, string Text)[] blocks)
  {
    return new JsonObject
    {
      ["blocks"] = new JsonArray([.. blocks.Select(block => (JsonNode)Paragraph(block.Id, block.Text))]),
    };
  }

  private static JsonObject Paragraph(string id, string text)
  {
    return new JsonObject
    {
      ["id"] = id,
      ["type"] = "paragraph",
      ["data"] = new JsonObject { ["text"] = text },
    };
  }

  private static CollabEditOp.Update Update(string id, string text) =>
      new CollabEditOp.Update(id, new JsonObject { ["text"] = text });

  private static CollabEditOp.Insert Insert(string id, string text, string after) =>
      new CollabEditOp.Insert(
          id,
          new JsonObject { ["type"] = "paragraph", ["data"] = new JsonObject { ["text"] = text } },
          after,
          null);

  private static CollabEditOp.Remove Remove(string id) => new CollabEditOp.Remove(id);

  private static JsonNode WithoutStamps(JsonNode blocks)
  {
    var copy = blocks.DeepClone();

    foreach (var block in copy.AsArray().OfType<JsonObject>())
    {
      block.Remove("lastEditedAt");
      block.Remove("lastEditedBy");
    }

    return copy;
  }

  private sealed class JournalWithoutHistory(FakeCollabOperationStore inner) : ICollabOperationStore
  {
    public ValueTask<CollabDocumentOpen> OpenAsync(
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return inner.OpenAsync(documentId, cancellationToken);
    }
  }
}
