using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>What one journal record changed: blocks by id, and page fields by key.</summary>
public sealed class CollabVersionChangesTests
{
  [Fact]
  public void TheSameBlocksAreNoChange()
  {
    var blocks = Blocks(Block("a"), Block("b"));

    Assert.Empty(CollabVersionChanges.Blocks(blocks, blocks.DeepClone().AsArray()));
  }

  [Fact]
  public void ANewBlockIsAddedAndAMissingOneIsRemoved()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("a"), Block("gone", type: "header")),
        Blocks(Block("a"), Block("new")));

    Assert.Equal(
        [("new", "paragraph", CollabBlockChangeKind.Added), ("gone", "header", CollabBlockChangeKind.Removed)],
        changes.Select(change => (change.Id, change.Type, change.Kind)));
    Assert.Null(changes[0].Before);
    Assert.Equal("new", changes[0].After!["id"]!.GetValue<string>());
    Assert.Equal("gone", changes[1].Before!["id"]!.GetValue<string>());
    Assert.Null(changes[1].After);
  }

  [Fact]
  public void ADifferentTypeDataOrTunesIsAChange()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("a", text: "x"), Block("b"), Block("c")),
        Blocks(
            Block("a", text: "y"),
            Block("b", type: "header"),
            Block("c", tunes: new JsonObject { ["align"] = "center" })));

    Assert.Equal(["a", "b", "c"], changes.Select(change => change.Id));
    Assert.All(changes, change => Assert.Equal(CollabBlockChangeKind.Changed, change.Kind));
    Assert.Equal("x", changes[0].Before!["data"]!["text"]!.GetValue<string>());
    Assert.Equal("y", changes[0].After!["data"]!["text"]!.GetValue<string>());
    Assert.Equal("header", changes[1].Type);
  }

  [Fact]
  public void KeyOrderMissingTunesAndEditStampsAreNoChange()
  {
    var before = Block("a");
    before["data"] = new JsonObject { ["text"] = "x", ["level"] = 2 };
    var after = Block("a");
    after["data"] = new JsonObject { ["level"] = 2, ["text"] = "x" };
    after["tunes"] = new JsonObject();
    after["lastEditedAt"] = 5;
    after["lastEditedBy"] = "u2";

    Assert.Empty(CollabVersionChanges.Blocks(Blocks(before), Blocks(after)));
  }

  /// <summary>Never "a different previous sibling": that would flag every block after an insert.</summary>
  [Fact]
  public void AnInsertMovesNothingAroundIt()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("a"), Block("b"), Block("c")),
        Blocks(Block("new"), Block("a"), Block("b"), Block("c")));

    var change = Assert.Single(changes);
    Assert.Equal(("new", CollabBlockChangeKind.Added), (change.Id, change.Kind));
  }

  [Fact]
  public void ABlockOutOfTheKeptOrderOfItsParentIsMoved()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("a"), Block("b"), Block("c")),
        Blocks(Block("c"), Block("a"), Block("b")));

    var change = Assert.Single(changes);
    Assert.Equal(("c", CollabBlockChangeKind.Moved), (change.Id, change.Kind));
    Assert.NotNull(change.Before);
    Assert.NotNull(change.After);
  }

  [Fact]
  public void ABlockUnderADifferentParentIsMoved()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("p"), Block("a")),
        Blocks(Block("p"), Block("a", parent: "p")));

    var change = Assert.Single(changes);
    Assert.Equal(("a", CollabBlockChangeKind.Moved), (change.Id, change.Kind));
  }

  /// <summary>As the client diff: a block that is changed still takes its place in the kept order.</summary>
  [Fact]
  public void AChangedBlockThatAlsoMovedIsChanged()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("a"), Block("b", text: "x")),
        Blocks(Block("b", text: "y"), Block("a"), Block("c", parent: "a")));

    Assert.Equal(
        [("b", CollabBlockChangeKind.Changed), ("c", CollabBlockChangeKind.Added)],
        changes.Select(change => (change.Id, change.Kind)));
  }

  [Fact]
  public void SiblingOrderIsComparedWithinEachParent()
  {
    var changes = CollabVersionChanges.Blocks(
        Blocks(Block("p"), Block("x", parent: "p"), Block("y", parent: "p"), Block("q")),
        Blocks(Block("q"), Block("p"), Block("y", parent: "p"), Block("x", parent: "p")));

    Assert.Equal(
        [("q", CollabBlockChangeKind.Moved), ("y", CollabBlockChangeKind.Moved)],
        changes.Select(change => (change.Id, change.Kind)));
  }

  [Fact]
  public void PageAndValueKeysThatChangedAreListedPageFirst()
  {
    var doc = new YDoc(1);
    var page = doc.GetMap("page");
    var values = doc.GetMap("values");
    doc.Transact(transaction =>
    {
      page.Set(transaction, "title", "Plan");
      page.Set(transaction, "icon", "x");
      values.Set(transaction, "count", 1.0);
      values.Set(transaction, "kept", "same");
    });
    var before = CollabVersionChanges.PageFields(doc);

    doc.Transact(transaction =>
    {
      page.Set(transaction, "title", "Plan B");
      page.Remove(transaction, "icon");
      page.Set(transaction, "cover", "c");
      values.Set(transaction, "count", 2.0);
      values.Set(transaction, "kept", "same");
    });
    var after = CollabVersionChanges.PageFields(doc);

    Assert.Equal(["cover", "icon", "title", "values.count"], CollabVersionChanges.Page(before, after));
    Assert.Empty(CollabVersionChanges.Page(after, CollabVersionChanges.PageFields(doc)));
  }

  [Fact]
  public void AnObjectValueIsComparedByContent()
  {
    var doc = new YDoc(1);
    var values = doc.GetMap("values");
    var first = new AnyObject();
    first.Add("a", 1.0);
    doc.Transact(transaction => values.Set(transaction, "o", first));
    var before = CollabVersionChanges.PageFields(doc);
    var second = new AnyObject();
    second.Add("a", 2.0);
    doc.Transact(transaction => values.Set(transaction, "o", second));

    Assert.Equal(["values.o"], CollabVersionChanges.Page(before, CollabVersionChanges.PageFields(doc)));
  }

  [Fact]
  public async Task AReplayDiffsEachRecordAfterTheFirstBeforeAgainstTheOneBeforeIt()
  {
    var live = new YDoc();
    RichTextRuntime.Seed(live, new JsonArray(
        JsonNode.Parse("""{ "id": "a", "type": "paragraph", "data": { "text": "one" } }""")));
    var baseline = new ReadOnlyMemory<byte>[] { live.EncodeStateAsUpdate() };
    var emitted = Capture(live);

    RichTextRuntime.ApplyOps(live, Ops("""{ "op": "update", "id": "a", "data": { "text": "two" } }"""));
    RichTextRuntime.ApplyOps(live, Ops("""{ "op": "insert", "id": "b", "after": "a", "block": { "type": "paragraph", "data": { "text": "b" } } }"""));
    RichTextRuntime.ApplyOps(live, Ops("""{ "op": "remove", "id": "a" }"""));

    var all = await CollabVersionChanges.ReplayAsync(baseline, Records(emitted), 0, Converter(), CancellationToken.None);
    var fromOne = await CollabVersionChanges.ReplayAsync(baseline, Records(emitted), 1, Converter(), CancellationToken.None);

    Assert.Equal([1UL, 2UL, 3UL], all.Select(record => record.Sequence));
    Assert.Equal(DateTimeOffset.UnixEpoch.AddMinutes(2), all[1].CommittedAt);
    Assert.Equal("actor-3", all[2].ActorId);
    Assert.Equal(
        [
          [("a", CollabBlockChangeKind.Changed)],
          [("b", CollabBlockChangeKind.Added)],
          [("a", CollabBlockChangeKind.Removed)],
        ],
        all.Select(record => record.Blocks.Select(change => (change.Id, change.Kind)).ToList()));
    Assert.Equal("""[{"text":"one"}]""", all[0].Blocks[0].Before!["data"]!["text"]!.ToJsonString());
    Assert.Equal("""[{"text":"two"}]""", all[0].Blocks[0].After!["data"]!["text"]!.ToJsonString());
    Assert.Equal("""[{"text":"two"}]""", all[2].Blocks[0].Before!["data"]!["text"]!.ToJsonString());
    Assert.All(all, record => Assert.Empty(record.Page));

    Assert.Equal([2UL, 3UL], fromOne.Select(record => record.Sequence));
    Assert.Equal(CollabBlockChangeKind.Added, Assert.Single(fromOne[0].Blocks).Kind);
  }

  /// <summary>The first "before" must be that record's state: with it missing, nothing is diffed against the baseline.</summary>
  [Fact]
  public async Task AMissingFirstBeforeRecordYieldsNoRows()
  {
    var client = new YDoc(1);
    var text = client.GetText("t");
    var u1 = client.Transact(transaction => text.Insert(transaction, 0, "a"))!;
    var u2 = client.Transact(transaction => text.Insert(transaction, 1, "b"))!;
    var u3 = client.Transact(transaction => text.Insert(transaction, 2, "c"))!;
    var withoutTwo = Records([u1, u2, u3]).Where(record => record.ServerSequence != 2);

    var changes = await CollabVersionChanges.ReplayAsync([], withoutTwo, 2, Converter(), CancellationToken.None);

    Assert.Empty(changes);
  }

  /// <summary>A record that is parked, or touches nothing shown, is still a row: the client says "not visualizable".</summary>
  [Fact]
  public async Task ARecordWithNothingVisibleIsARowWithNoBlocks()
  {
    var client = new YDoc(1);
    var text = client.GetText("t");
    var u1 = client.Transact(transaction => text.Insert(transaction, 0, "a"))!;
    var u2 = client.Transact(transaction => text.Insert(transaction, 1, "b"))!;

    var changes = await CollabVersionChanges.ReplayAsync([], Records([u2, u1]), 0, Converter(), CancellationToken.None);

    Assert.Equal([1UL, 2UL], changes.Select(record => record.Sequence));
    Assert.All(changes, record =>
    {
      Assert.Empty(record.Blocks);
      Assert.Empty(record.Page);
    });
  }

  [Fact]
  public async Task AReplayListsPageKeysEachRecordChanged()
  {
    var client = new YDoc(1);
    var page = client.GetMap("page");
    var baseline = client.Transact(transaction => page.Set(transaction, "title", "A"))!;
    var u1 = client.Transact(transaction => page.Set(transaction, "title", "B"))!;
    var u2 = client.Transact(transaction => client.GetMap("values").Set(transaction, "k", true))!;

    var changes = await CollabVersionChanges.ReplayAsync(
        [baseline], Records([u1, u2]), 0, Converter(), CancellationToken.None);

    Assert.Equal([["title"], ["values.k"]], changes.Select(record => record.Page.ToList()));
  }

  /// <summary>Format 1 keeps HTML in rich fields. Only blocks a record changed go through the runtime.</summary>
  [Fact]
  public async Task OnlyChangedBlocksHaveTheirHtmlRead()
  {
    var source = new YDoc(1);
    var blocks = source.GetMap("blocks");
    var baseline = source.Transact(transaction =>
    {
      blocks.Set(transaction, "a", HtmlBlock("a", "<b>x</b>"));
      blocks.Set(transaction, "b", HtmlBlock("b", "<i>kept</i>"));
      source.GetArray("root").Insert(transaction, 0, ["a", "b"]);
    })!;
    var aText = (YText)Value((YMap)Value((YMap)Value(blocks, "a")!, "data")!, "text")!;
    var edit = source.Transact(transaction =>
    {
      aText.Delete(transaction, 3, 1);
      aText.Insert(transaction, 3, "z");
    })!;
    var reader = new CountingReader(RichTextRuntime.Reader);

    var changes = await CollabVersionChanges.ReplayAsync(
        [baseline],
        Records([edit]),
        0,
        new CollabDocConverter(TimeProvider.System, reader),
        CancellationToken.None);

    var change = Assert.Single(Assert.Single(changes).Blocks);
    Assert.Equal(("a", CollabBlockChangeKind.Changed), (change.Id, change.Kind));
    Assert.Equal("""[{"text":"x","marks":{"bold":true}}]""", change.Before!["data"]!["text"]!.ToJsonString());
    Assert.Equal("""[{"text":"z","marks":{"bold":true}}]""", change.After!["data"]!["text"]!.ToJsonString());
    Assert.Equal(["<b>x</b>", "<b>z</b>"], reader.Read.Order(StringComparer.Ordinal));
  }

  private static YMap HtmlBlock(string id, string html)
  {
    return new YMap(
    [
      new KeyValuePair<string, object?>("id", id),
      new KeyValuePair<string, object?>("type", "paragraph"),
      new KeyValuePair<string, object?>("data", new YMap(
          [new KeyValuePair<string, object?>("text", new YText(html))])),
      new KeyValuePair<string, object?>("tunes", new YMap([])),
      new KeyValuePair<string, object?>("contentIds", new YArray([])),
    ]);
  }

  private static object? Value(YMap map, string key)
  {
    map.TryGet(key, out var value);

    return value;
  }

  private static CollabDocConverter Converter() => new(TimeProvider.System, RichTextRuntime.Reader);

  private static List<byte[]> Capture(YDoc live)
  {
    var emitted = new List<byte[]>();
    live.UpdateEmitted += update =>
    {
      if (update.Local)
      {
        emitted.Add(update.Update);
      }
    };

    return emitted;
  }

  private static IReadOnlyList<CollabEditOp> Ops(params string[] opJson)
  {
    return CollabEditOps.Parse(
        Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }"""));
  }

  private static async IAsyncEnumerable<CollabOperationRecord> Records(IEnumerable<byte[]> updates)
  {
    ulong sequence = 0;

    foreach (var update in updates)
    {
      sequence++;
      await Task.Yield();

      yield return new CollabOperationRecord(
          sequence.ToString("x32", CultureInfo.InvariantCulture),
          sequence,
          DateTimeOffset.UnixEpoch.AddMinutes(sequence),
          $"actor-{sequence}",
          CollabOperationSource.HttpEdit,
          update,
          new byte[32]);
    }
  }

  private sealed class CountingReader(IRichTextHtmlReader inner) : IRichTextHtmlReader
  {
    internal List<string> Read { get; } = [];

    public ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
        IReadOnlyList<RichTextHtml> fields,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
      Read.AddRange(fields.Select(field => field.Html));

      return inner.ReadAsync(fields, timeout, cancellationToken);
    }
  }

  private static JsonArray Blocks(params JsonObject[] blocks)
  {
    return new JsonArray([.. blocks.Select(block => (JsonNode)block)]);
  }

  private static JsonObject Block(
      string id,
      string type = "paragraph",
      string text = "t",
      string? parent = null,
      JsonObject? tunes = null)
  {
    var block = new JsonObject
    {
      ["id"] = id,
      ["type"] = type,
      ["data"] = new JsonObject { ["text"] = text },
    };

    if (tunes is not null)
    {
      block["tunes"] = tunes;
    }

    if (parent is not null)
    {
      block["parent"] = parent;
    }

    return block;
  }
}
