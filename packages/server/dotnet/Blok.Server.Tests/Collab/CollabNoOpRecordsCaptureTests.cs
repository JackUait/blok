using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// How a journal room answers v2 operations that change nothing, captured into
/// fixtures/collab-history/noop-records.json. Go and Rust replay the same
/// operations and must send the same frames and journal the same records. Set
/// BLOK_WRITE_COLLAB_HISTORY=1 to rewrite the file after an intended change.
/// </summary>
public sealed class CollabNoOpRecordsCaptureTests
{
  private const string DocId = "doc-1";
  private const string Seed = "hello";
  private const string Relative = "collab-history/noop-records.json";
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  private static readonly string[] Ids =
  [
    "00000000000000000000000000000001",
    "00000000000000000000000000000002",
    "00000000000000000000000000000003",
    "00000000000000000000000000000004",
  ];

  [Fact]
  public async Task TheNoOpRecordsMatchTheFixture()
  {
    var path = RichTextFixtures.PathOf(Relative);
    var text = (await Build()).ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), $"{Relative} is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static async Task<JsonObject> Build()
  {
    // A fixed client id keeps the bytes the same on every capture. Its edits
    // never name the seed's items, so every backend's seed can differ.
    var client = new YDoc(42);
    var insert = YDocs.UpdateAppending(client, "ab");
    var delete = YDocs.UpdateDeleting(client, 0, 1);
    var append = YDocs.UpdateAppending(client, "c");
    byte[] nothing = [0, 0];
    // One deleted item of a client the room has never seen: yjs parks it.
    byte[] unknownDelete = [0, 1, 7, 1, 0, 1];

    (string Name, (string Id, byte[] Update)[] Steps)[] cases =
    [
      ("a delete the room already holds is acked at the head",
          [(Ids[0], insert), (Ids[1], delete), (Ids[2], delete), (Ids[3], append)]),
      ("structs the room already holds under a new id are acked at the head",
          [(Ids[0], insert), (Ids[1], insert)]),
      ("a no-op resent under its own id is answered the same again",
          [(Ids[0], insert), (Ids[1], insert), (Ids[1], insert)]),
      ("a no-op before any commit is journalled",
          [(Ids[0], nothing), (Ids[1], nothing)]),
      ("a delete of an unknown item is parked and journalled",
          [(Ids[0], insert), (Ids[1], unknownDelete), (Ids[2], unknownDelete)]),
    ];

    var written = new JsonArray();

    foreach (var (name, steps) in cases)
    {
      written.Add(await Run(name, steps));
    }

    return new JsonObject
    {
      ["$comment"] = "v2 operations a journal room applies but that change nothing. Captured by CollabNoOpRecordsCaptureTests; do not edit by hand. Each case is a fresh room seeded with `seed`, a v2 writer and one other member. Updates are base64 Yjs v1 updates. `frames` is what the writer receives for the step, `relayed` whether the other member got anything, and `journal` the records at the end.",
      ["seed"] = Seed,
      ["cases"] = written,
    };
  }

  private static async Task<JsonObject> Run(string name, (string Id, byte[] Update)[] steps)
  {
    var operations = new FakeCollabOperationStore();
    var endpoint = new FakeDocEndpoint();
    endpoint.Holds(DocId, Seed);
    var manager = new CollabRoomManager(
        new FakeWorkingSetStore(),
        endpoint,
        new FakeDocConverter(),
        new CollabRoomOptions(),
        new ManualTimeProvider(),
        null,
        operations);
    var writer = new FakeMember(true, acceptsControlFrames: true, null, CollabOperationSource.ClientV2);
    var other = new FakeMember();
    var membership = (await manager.JoinAsync(DocId, writer, CancellationToken.None)).Membership!;
    await membership.ReceiveAsync(
        SyncWire.Encode(new SyncStep1Frame(new YDoc(41).EncodeStateVector())),
        CancellationToken.None);
    Assert.NotNull((await manager.JoinAsync(DocId, other, CancellationToken.None)).Membership);

    var written = new JsonArray();

    foreach (var (id, update) in steps)
    {
      writer.Received.Clear();
      other.Received.Clear();
      await membership.ReceiveAsync(
          SyncWire.Encode(new OperationFrame(membership.Tag.Lineage, id, update)),
          CancellationToken.None);

      written.Add(new JsonObject
      {
        ["operationId"] = id,
        ["update"] = Convert.ToBase64String(update),
        ["frames"] = new JsonArray([.. writer.Received.Select(Frame)]),
        ["relayed"] = other.Received.Count > 0,
      });
    }

    Assert.Empty(writer.Closes);

    return new JsonObject
    {
      ["name"] = name,
      ["steps"] = written,
      ["journal"] = new JsonArray([.. operations.Committed(DocId).Select(record => (JsonNode)new JsonObject
      {
        ["sequence"] = record.ServerSequence.ToString(CultureInfo.InvariantCulture),
        ["operationId"] = record.OperationId,
      })]),
    };
  }

  private static JsonNode Frame(SyncWireMessage frame) => frame switch
  {
    SyncUpdateFrame => new JsonObject { ["type"] = "update" },
    AcknowledgementFrame ack => new JsonObject
    {
      ["type"] = "acknowledgement",
      ["operationId"] = ack.OperationId,
      ["serverSequence"] = ack.ServerSequence.ToString(CultureInfo.InvariantCulture),
    },
    RejectionFrame rejection => new JsonObject
    {
      ["type"] = "rejection",
      ["operationId"] = rejection.OperationId,
      ["code"] = rejection.Code,
    },
    _ => new JsonObject { ["type"] = frame.GetType().Name },
  };
}
