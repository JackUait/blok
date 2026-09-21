using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The server's /edit write path against a peer editing the SAME block at the
/// same instant. Each test stages real CRDT concurrency: a peer doc forked off
/// the server doc, both edit, then the peer's update merges back — which is
/// exactly what CollabRoom does (ApplyOps and ApplyUpdate land on one YDoc).
///
/// The client's counterpart of an /edit update is a full save() flush, and it
/// DEEP-ASSIGNS into the nested shared types it already holds
/// (DocumentStore.updateBlockData → deepAssignYGrid/deepAssignYMap/
/// deepAssignYArray). These tests ask whether the server's ReplaceData does
/// the same.
/// </summary>
public sealed class YDocConverterConcurrentLossTests
{
  private const string Table =
      """
      { "id": "tb", "type": "table", "data": { "content": [[
          { "text": "a1", "blocks": ["p1"] },
          { "text": "b1", "blocks": [] } ]] } }
      """;

  /// <summary>
  /// Two people in one table: one types in the left cell, the host pushes an
  /// /edit carrying the right cell's new text. The left cell's typing must
  /// survive — the client's deepAssignYGrid pairs rows by identity and writes
  /// only the changed leaf.
  /// </summary>
  [Fact]
  public void ConcurrentCellTypingSurvivesAServerTableUpdate()
  {
    var doc = SeededDoc(Table);
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction => Cell(peer, 0, 0).Set(transaction, "text", "a1 typed"));

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [[
            { "text": "a1", "blocks": ["p1"] },
            { "text": "b1 host", "blocks": [] } ]] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var content = Content(YDocConverter.Export(doc));

    Assert.Equal("a1 typed", content[0]?[0]?["text"]?.GetValue<string>());
    Assert.Equal("b1 host", content[0]?[1]?["text"]?.GetValue<string>());
  }

  /// <summary>
  /// The mechanism behind the losses, with no concurrency at all: a server
  /// /edit that changes ONE cell must leave the grid's row containers where
  /// they were. The client's deepAssignYGrid pairs rows by identity and keeps
  /// their keys; a rebuilt grid mints fresh keys, and every peer edit anywhere
  /// in the table made during that round trip lands in an orphan.
  /// </summary>
  [Fact]
  public void AServerTableUpdateKeepsTheRowContainers()
  {
    var doc = SeededDoc(Table);
    var keysBefore = RowKeys(doc);

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [[
            { "text": "a1", "blocks": ["p1"] },
            { "text": "b1 host", "blocks": [] } ]] } }
        """);

    Assert.Equal(keysBefore, RowKeys(doc));
  }

  /// <summary>
  /// Two people each drop a block into ONE table cell: the peer inserts p2 into
  /// the cell's live `blocks` array, the host's /edit carries p3. Both ids must
  /// survive, or the loser's whole child block is orphaned. This is the exact
  /// loss the ordered-id-array rule exists to prevent on the client.
  /// </summary>
  [Fact]
  public void ConcurrentBlockInsertsIntoOneCellBothSurvive()
  {
    var doc = SeededDoc(Table);
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction =>
        Assert.IsType<YArray>(Get(Cell(peer, 0, 0), "blocks"))
            .Insert(transaction, 1, ["p2"]));

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [[
            { "text": "a1", "blocks": ["p1", "p3"] },
            { "text": "b1", "blocks": [] } ]] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var ids = Content(YDocConverter.Export(doc))[0]?[0]?["blocks"]?.AsArray()
        .Select(entry => entry?.GetValue<string>())
        .ToArray();

    Assert.Contains("p2", ids!);
    Assert.Contains("p3", ids!);
  }

  /// <summary>
  /// A nested plain object under block data — a tool's settings map. Two people
  /// change DIFFERENT keys of it; deepAssignYMap keeps both.
  /// </summary>
  [Fact]
  public void ConcurrentWritesToDifferentKeysOfANestedMapBothSurvive()
  {
    var doc = SeededDoc(
        """
        { "id": "cb", "type": "callout", "data": { "settings":
            { "icon": "star", "colour": "blue" } } }
        """);
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction =>
        Assert.IsType<YMap>(Get(Data(peer, "cb"), "settings"))
            .Set(transaction, "colour", "red"));

    Apply(
        doc,
        """
        { "op": "update", "id": "cb", "data": { "settings":
            { "icon": "bolt", "colour": "blue" } } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var settings = BlockNamed(YDocConverter.Export(doc), "cb")["data"]?["settings"];

    Assert.Equal("red", settings?["colour"]?.GetValue<string>());
    Assert.Equal("bolt", settings?["icon"]?.GetValue<string>());
  }

  /// <summary>
  /// A database block's property list: an array of id-bearing objects, which
  /// both sides store as an IDENTITY-keyed wrapper (keyed by each property's
  /// own id) so a rename of one property merges with a rename of another. Two
  /// people rename DIFFERENT properties.
  /// </summary>
  [Fact]
  public void ConcurrentRenamesOfDifferentDatabasePropertiesBothSurvive()
  {
    var doc = SeededDoc(
        """
        { "id": "db", "type": "database", "data": { "properties": [
            { "id": "p1", "name": "Name" },
            { "id": "p2", "name": "Status" } ] } }
        """);
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction =>
    {
      var properties = Assert.IsType<YMap>(Get(Data(peer, "db"), "properties"));
      var rows = Assert.IsType<YMap>(Get(properties, "__rows"));

      Assert.IsType<YMap>(Get(rows, "p2")).Set(transaction, "name", "State");
    });

    Apply(
        doc,
        """
        { "op": "update", "id": "db", "data": { "properties": [
            { "id": "p1", "name": "Title" },
            { "id": "p2", "name": "Status" } ] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var properties = BlockNamed(YDocConverter.Export(doc), "db")["data"]?["properties"]?.AsArray();

    Assert.Equal("State", properties?[1]?["name"]?.GetValue<string>());
    Assert.Equal("Title", properties?[0]?["name"]?.GetValue<string>());
  }

  /// <summary>
  /// CONTROL — the top-level diffable text merge, already shipped. It proves
  /// the staging above is not vacuous: the same fork/merge shape DOES preserve
  /// a peer's concurrent edit where the write path edits in place.
  /// </summary>
  [Fact]
  public void ConcurrentTypingInTopLevelTextMerges()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "hello" } }""");
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction =>
        Assert.IsType<YText>(Get(Data(peer, "p"), "text")).Insert(transaction, 0, "X"));

    Apply(doc, """{ "op": "update", "id": "p", "data": { "text": "hello!" } }""");

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    Assert.Equal(
        "Xhello!",
        BlockNamed(YDocConverter.Export(doc), "p")["data"]?["text"]?.GetValue<string>());
  }

  /// <summary>
  /// A top-level key the peer adds while an /edit that does not name it is in
  /// flight. ReplaceData removes keys the new data does not carry — but only
  /// the ones the doc held when it ran, so the peer's later-arriving key is
  /// expected to survive.
  /// </summary>
  [Fact]
  public void ATopLevelKeyAddedConcurrentlySurvivesAServerUpdate()
  {
    var doc = SeededDoc("""{ "id": "p", "type": "paragraph", "data": { "text": "hi" } }""");
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction => Data(peer, "p").Set(transaction, "align", "center"));

    Apply(doc, """{ "op": "update", "id": "p", "data": { "text": "hi there" } }""");

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    Assert.Equal(
        "center",
        BlockNamed(YDocConverter.Export(doc), "p")["data"]?["align"]?.GetValue<string>());
  }

  /// <summary>
  /// The other half of the contract the in-place write must not lose: an
  /// update states the whole value of the key it names, so a NESTED key the
  /// new data omits is removed, exactly as the client's deepAssignYMap
  /// removes it. Deep-assigning must not turn "replace the data" into "merge
  /// into the data".
  /// </summary>
  [Fact]
  public void AnUpdateDropsANestedKeyTheNewDataOmits()
  {
    var doc = SeededDoc(
        """
        { "id": "cb", "type": "callout", "data": { "settings":
            { "icon": "star", "colour": "blue" } } }
        """);

    Apply(doc, """{ "op": "update", "id": "cb", "data": { "settings": { "icon": "bolt" } } }""");

    var settings = BlockNamed(YDocConverter.Export(doc), "cb")["data"]?["settings"];

    Assert.Equal("bolt", settings?["icon"]?.GetValue<string>());
    Assert.Null(settings?["colour"]);
  }

  /// <summary>
  /// Row identity survives a row INSERT, not just an in-place cell edit: the
  /// rows that were there keep their keys and their containers, so a peer
  /// editing any of them during the round trip still lands in a live row.
  /// </summary>
  [Fact]
  public void AddingATableRowKeepsTheExistingRowsKeys()
  {
    var doc = SeededDoc(Table);
    var keysBefore = RowKeys(doc);

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [
            [ { "text": "a1", "blocks": ["p1"] }, { "text": "b1", "blocks": [] } ],
            [ { "text": "a2", "blocks": [] }, { "text": "b2", "blocks": [] } ] ] } }
        """);

    var keysAfter = RowKeys(doc);

    Assert.Equal(keysBefore, keysAfter.Take(1).ToArray());
    Assert.Equal(2, keysAfter.Length);
    Assert.Equal("a2", Content(YDocConverter.Export(doc))[1]?[0]?["text"]?.GetValue<string>());
  }

  /// <summary>
  /// Rows are paired by CONTENT, so the pairing has to read a number the doc
  /// holds (a double, written back as an integer) as equal to the same number
  /// in the incoming JSON. If it did not, every numeric row would look brand
  /// new and be re-minted — the loss this whole path exists to stop.
  /// </summary>
  [Fact]
  public void NumericRowsPairWithTheRowsAlreadyInTheDocument()
  {
    var doc = SeededDoc(
        """
        { "id": "tb", "type": "table", "data": { "content": [
            [ { "count": 1 }, { "count": 2 } ],
            [ { "count": 3 }, { "count": 4.5 } ] ] } }
        """);
    var keysBefore = RowKeys(doc);

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [
            [ { "count": 1 }, { "count": 2 } ],
            [ { "count": 3 }, { "count": 9.5 } ] ] } }
        """);

    Assert.Equal(keysBefore, RowKeys(doc));
    Assert.Equal(9.5, Content(YDocConverter.Export(doc))[1]?[1]?["count"]?.GetValue<double>());
  }

  /// <summary>
  /// A database's property list REORDERED while a peer renames one of the
  /// properties. Keyed by each property's own id, a reorder is a new order
  /// array and every property's container survives it; diffed by POSITION, the
  /// rename landed on whichever property took that index and both peers
  /// converged on the same wrong label.
  ///
  /// The expected result is the client's own, measured by running the same
  /// scenario through DocumentStore.updateBlockData.
  /// </summary>
  [Fact]
  public void ReorderingDatabasePropertiesKeepsAConcurrentRename()
  {
    var doc = SeededDoc(
        """
        { "id": "db", "type": "database", "data": { "properties": [
            { "id": "p1", "name": "Name" },
            { "id": "p2", "name": "Status" },
            { "id": "p3", "name": "Owner" } ] } }
        """);
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction =>
    {
      var rows = Assert.IsType<YMap>(
          Get(Assert.IsType<YMap>(Get(Data(peer, "db"), "properties")), "__rows"));

      Assert.IsType<YMap>(Get(rows, "p3")).Set(transaction, "name", "Assignee");
    });

    Apply(
        doc,
        """
        { "op": "update", "id": "db", "data": { "properties": [
            { "id": "p3", "name": "Owner" },
            { "id": "p1", "name": "Name" },
            { "id": "p2", "name": "Status" } ] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var properties = BlockNamed(YDocConverter.Export(doc), "db")["data"]?["properties"]?.AsArray();

    Assert.Equal(
        ["p3", "p1", "p2"],
        properties?.Select(entry => entry?["id"]?.GetValue<string>() ?? "").ToArray() ?? []);
    Assert.Equal("Assignee", properties?[0]?["name"]?.GetValue<string>());
  }

  /// <summary>
  /// An element added to a plain array while a peer writes a field of an
  /// element that STAYS. The changed middle is paired by content and assigned
  /// in place; a blanket delete+insert of the middle recreates every container
  /// in it and the peer's field goes with the old one.
  ///
  /// The expected result is the client's own, measured by running the same
  /// scenario through DocumentStore.updateBlockData.
  /// </summary>
  [Fact]
  public void AnUnequalArrayMiddleKeepsTheContainerThatSurvives()
  {
    var doc = SeededDoc(
        """
        { "id": "x", "type": "tool", "data": { "items": [
            { "a": "1" }, { "a": "2" }, { "a": "3" } ] } }
        """);
    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    peer.Transact(transaction =>
    {
      var items = Assert.IsType<YArray>(Get(Data(peer, "x"), "items"));

      Assert.IsType<YMap>(items.Get(2)).Set(transaction, "b", "peer");
    });

    Apply(
        doc,
        """
        { "op": "update", "id": "x", "data": { "items": [
            { "a": "1" }, { "a": "2" }, { "a": "3x" }, { "a": "4" } ] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var items = BlockNamed(YDocConverter.Export(doc), "x")["data"]?["items"]?.AsArray();

    Assert.Equal("peer", items?[2]?["b"]?.GetValue<string>());
    Assert.Equal("3x", items?[2]?["a"]?.GetValue<string>());
    Assert.Equal(4, items?.Count);
  }

  private static YDoc SeededDoc(params string[] blockJson)
  {
    var doc = new YDoc(1);

    YDocConverter.Seed(doc, new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray()));

    return doc;
  }

  /// <summary>A second peer holding the same document, as a joining client does.</summary>
  private static YDoc Fork(YDoc doc)
  {
    var peer = new YDoc(2);

    Assert.Equal(ApplyOutcome.Applied, peer.ApplyUpdate(doc.EncodeStateAsUpdate()).Outcome);

    return peer;
  }

  private static void Apply(YDoc doc, params string[] opJson)
  {
    YDocConverter.ApplyOps(
        doc,
        CollabEditOps.Parse(
            Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }""")));
  }

  private static YMap Data(YDoc doc, string id)
  {
    return Assert.IsType<YMap>(Get(Assert.IsType<YMap>(Get(doc.GetMap("blocks"), id)), "data"));
  }

  private static string[] RowKeys(YDoc doc)
  {
    var grid = Assert.IsType<YMap>(Get(Data(doc, "tb"), "content"));

    return Assert.IsType<YArray>(Get(grid, "__rowKeys"))
        .Enumerate()
        .Select(entry => (string?)entry ?? "")
        .ToArray();
  }

  private static YMap Cell(YDoc doc, int row, int column)
  {
    var grid = Assert.IsType<YMap>(Get(Data(doc, "tb"), "content"));
    var rows = Assert.IsType<YMap>(Get(grid, "__rows"));
    var order = Assert.IsType<YArray>(Get(grid, "__rowKeys"));
    var cells = Assert.IsType<YArray>(Get(rows, Assert.IsType<string>(order.Get(row))));

    return Assert.IsType<YMap>(cells.Get(column));
  }

  private static object? Get(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }

  private static JsonArray Content(JsonArray exported)
  {
    return BlockNamed(exported, "tb")["data"]?["content"]?.AsArray() ??
        throw new InvalidOperationException("no content");
  }

  private static JsonObject BlockNamed(JsonArray exported, string id)
  {
    return exported
        .Select(block => block?.AsObject())
        .Single(block => block?["id"]?.GetValue<string>() == id) ??
        throw new InvalidOperationException($"no block {id}");
  }
}
