using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Reading a point of history: a fresh document, the lineage baseline, then
/// records 1..N, each screened and applied as the live room does.
/// </summary>
public sealed class CollabHistoryReplayTests
{
  [Fact]
  public async Task EveryPrefixExportsWhatTheLiveDocumentHeldAtThatPoint()
  {
    var live = new YDoc();
    RichTextRuntime.Seed(live, new JsonArray(
        JsonNode.Parse("""{ "id": "root", "type": "paragraph", "data": { "text": "r" } }"""),
        JsonNode.Parse("""{ "id": "second", "type": "header", "data": { "text": "s", "level": 2 } }""")));

    var baseline = new ReadOnlyMemory<byte>[] { live.EncodeStateAsUpdate() };
    var emitted = new List<byte[]>();
    live.UpdateEmitted += update =>
    {
      if (update.Local)
      {
        emitted.Add(update.Update);
      }
    };

    var snapshots = new List<string> { Blocks(RichTextRuntime.Export(live)) };
    string[] edits =
    [
      """{ "op": "insert", "id": "a", "after": "root", "block": { "type": "paragraph", "data": { "text": "x <b>y</b>" } } }""",
      """{ "op": "update", "id": "root", "data": { "text": "changed" } }""",
      """{ "op": "remove", "id": "second" }""",
      """{ "op": "insert", "id": "b", "parent": "a", "block": { "type": "paragraph", "data": { "text": "kid" } } }""",
    ];

    foreach (var edit in edits)
    {
      RichTextRuntime.ApplyOps(live, Ops(edit));
      snapshots.Add(Blocks(RichTextRuntime.Export(live)));
    }

    Assert.Equal(4, emitted.Count);
    Assert.Equal(5, snapshots.Distinct().Count());

    for (var n = 0; n <= 4; n++)
    {
      var replayed = await CollabHistoryReplay.BuildAsync(
          baseline, Records(emitted.Take(n)), CancellationToken.None);

      Assert.Equal(snapshots[n], Blocks(RichTextRuntime.Export(replayed)));
    }
  }

  /// <summary>
  /// Journal order is commit order, not causal order: a record whose
  /// dependency comes later is parked, then lands when the dependency does.
  /// </summary>
  [Fact]
  public async Task ARecordAheadOfItsDependencyIsParkedNotRefused()
  {
    var client = new YDoc(1);
    var text = client.GetText("t");
    var u1 = client.Transact(transaction => text.Insert(transaction, 0, "a"))!;
    var u2 = client.Transact(transaction => text.Insert(transaction, 1, "b"))!;

    var toOne = await CollabHistoryReplay.BuildAsync([], Records([u2]), CancellationToken.None);

    Assert.DoesNotContain("b", toOne.GetText("t").ToString());

    var toTwo = await CollabHistoryReplay.BuildAsync([], Records([u2, u1]), CancellationToken.None);

    Assert.Equal("ab", toTwo.GetText("t").ToString());
  }

  [Fact]
  public async Task AFormatOneBaselineExportsAsSegments()
  {
    var source = new YDoc();

    source.Transact(transaction =>
    {
      source.GetMap("blocks").Set(transaction, "a", new YMap(
      [
        new KeyValuePair<string, object?>("id", "a"),
        new KeyValuePair<string, object?>("type", "paragraph"),
        new KeyValuePair<string, object?>("data", new YMap(
            [new KeyValuePair<string, object?>("text", new YText("<b>x</b>"))])),
        new KeyValuePair<string, object?>("tunes", new YMap([])),
        new KeyValuePair<string, object?>("contentIds", new YArray([])),
      ]));
      source.GetArray("root").Insert(transaction, 0, ["a"]);
    });

    var replayed = await CollabHistoryReplay.BuildAsync(
        [source.EncodeStateAsUpdate()], Records([]), CancellationToken.None);

    var blocks = RichTextRuntime.Export(replayed);

    Assert.Equal("""[{"text":"x","marks":{"bold":true}}]""", blocks[0]!["data"]!["text"]!.ToJsonString());
  }

  [Fact]
  public async Task ARecordTheInspectorRefusesThrowsNamingItsSequence()
  {
    var client = new YDoc(1);
    var fine = client.Transact(transaction => client.GetText("t").Insert(transaction, 0, "a"))!;

    var refused = await Assert.ThrowsAsync<CollabHistoryReplayException>(
        async () => await CollabHistoryReplay.BuildAsync(
            [], Records([fine, NestedArrayUpdate(257)]), CancellationToken.None));

    Assert.Contains("2", refused.Message);
    Assert.Equal(2UL, refused.Sequence);
  }

  private static async IAsyncEnumerable<CollabOperationRecord> Records(IEnumerable<byte[]> updates)
  {
    ulong sequence = 0;

    foreach (var update in updates)
    {
      sequence++;
      await Task.Yield();

      yield return new CollabOperationRecord(
          sequence.ToString("x32", System.Globalization.CultureInfo.InvariantCulture),
          sequence,
          DateTimeOffset.UnixEpoch.AddMinutes(sequence),
          null,
          CollabOperationSource.HttpEdit,
          update,
          new byte[32]);
    }
  }

  private static string Blocks(JsonArray blocks)
  {
    return blocks.ToJsonString();
  }

  private static IReadOnlyList<CollabEditOp> Ops(params string[] opJson)
  {
    return CollabEditOps.Parse(
        Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }"""));
  }

  /// <summary>One map key holding <paramref name="depth"/> nested Any arrays (as UpdateInspectorTests builds it).</summary>
  private static byte[] NestedArrayUpdate(int depth)
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint(1);
    writer.WriteVarUint(1);
    writer.WriteVarUint(1000);
    writer.WriteVarUint(0);
    // ContentAny with the parentSub bit; the parent is a root name.
    writer.WriteUint8(0x28);
    writer.WriteVarUint(1);
    writer.WriteVarString("m");
    writer.WriteVarString("k");
    writer.WriteVarUint(1);

    for (var level = 0; level < depth; level++)
    {
      writer.WriteUint8(117);
      writer.WriteVarUint(1);
    }

    writer.WriteUint8(126);
    writer.WriteVarUint(0);

    return writer.ToArray();
  }
}
