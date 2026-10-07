using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Table data through the server's collab converter: seed, client update,
/// /edit update, export. Each test states what a table must still hold after
/// the path runs. A failing test here is a confirmed loss.
/// </summary>
public sealed class TableDataLossAuditTests
{
  /// <summary>
  /// Every field the table tool saves: column ids (so rows are identity
  /// rows), row ids, a 2x1 merge, colours, placement, text sizes, widths.
  /// </summary>
  private const string FullTable =
      """
      { "id": "tb", "type": "table", "content": ["p00", "p01", "p10", "p11", "p12"],
        "data": {
          "withHeadings": true, "withHeadingColumn": true, "stretched": true,
          "colWidths": [120.5, 200, 333.25], "initialColWidth": 217.75, "textSize": "comfortable",
          "content": [
            [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 2, "color": "blue", "textColor": "red", "placement": "middle-center" },
              { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] },
              { "id": "c2", "rowId": "r0", "blocks": ["p01"], "rowspan": 2 } ],
            [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] },
              { "id": "c1", "rowId": "r1", "blocks": ["p12"], "placement": "bottom-right" },
              { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 2] } ]
          ] } }
      """;

  private static readonly string[] CellChildren =
  [
    """{ "id": "p00", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "origin" }] } }""",
    """{ "id": "p01", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "tall" }] } }""",
    """{ "id": "p10", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "first" }] } }""",
    """{ "id": "p11", "type": "list", "parent": "tb", "data": { "text": [{ "text": "second" }], "style": "unordered" } }""",
    """{ "id": "p12", "type": "paragraph", "parent": "tb", "data": { "text": [{ "text": "x" }] } }""",
  ];

  [Fact]
  public void SeedThenExportKeepsEveryTableField()
  {
    var input = Blocks([FullTable, .. CellChildren]);
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, input);

    AssertSameDocument(input, RichTextRuntime.Export(doc));
  }

  [Fact]
  public void APeerReadingTheSeededDocExportsTheSameTable()
  {
    var input = Blocks([FullTable, .. CellChildren]);
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, input);

    AssertSameDocument(input, RichTextRuntime.Export(Fork(doc)));
  }

  /// <summary>Legacy string cells, an empty row, and a mixed string/object row.</summary>
  [Fact]
  public void SeedThenExportKeepsLegacyAndRaggedGrids()
  {
    var input = Blocks(
        """
        { "id": "tb", "type": "table", "data": { "withHeadings": false, "withHeadingColumn": false,
          "content": [ ["a", "<b>b</b>"], [], ["c", { "blocks": [] }], [{ "blocks": [], "text": "d" }] ] } }
        """);
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, input);

    AssertSameDocument(input, RichTextRuntime.Export(doc));
  }

  public static TheoryData<string, string> TableEdits() => new()
  {
    {
      "move column c2 to the front",
      """
      [ [ { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] } ],
        [ { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] } ] ]
      """
    },
    {
      "insert column c3 in the middle",
      """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c3", "rowId": "r0", "blocks": [] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c3", "rowId": "r1", "blocks": [] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]
      """
    },
    {
      "delete column c1",
      """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]
      """
    },
    {
      "move row r1 above r0",
      """
      [ [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ],
        [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ] ]
      """
    },
    {
      "merge then a colour on the covered column",
      """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 3, "rowspan": 2, "color": "green" }, { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] }, { "id": "c2", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] }, { "id": "c1", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] }, { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 0] } ] ]
      """
    },
    {
      "cells lose their column ids (legacy save)",
      """
      [ [ { "blocks": ["p00"] }, { "blocks": [] }, { "blocks": ["p01"] } ],
        [ { "blocks": ["p10", "p11"] }, { "blocks": ["p12"] }, { "blocks": [] } ] ]
      """
    },
    {
      "two columns share an id (paste dup)",
      """
      [ [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c0", "rowId": "r0", "blocks": ["p01"] }, { "id": "c2", "rowId": "r0", "blocks": [] } ],
        [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c0", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ]
      """
    },
    {
      "legacy strings replace the cells",
      """
      [ ["a", "b", "c"], ["d", "e", "f"] ]
      """
    },
    {
      "table emptied",
      """
      [ ]
      """
    },
  };

  /// <summary>An /edit carrying a new grid must export exactly that grid.</summary>
  [Theory]
  [MemberData(nameof(TableEdits))]
  public void AnEditOfTheTableExportsTheEditedGrid(string scenario, string content)
  {
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, Blocks([FullTable, .. CellChildren]));

    var data = JsonNode.Parse(
        $$"""{ "withHeadings": true, "withHeadingColumn": false, "colWidths": [100, 200], "content": {{content}} }""")!;

    Apply(doc, $$"""{ "op": "update", "id": "tb", "data": {{data.ToJsonString()}} }""");

    var exported = BlockNamed(RichTextRuntime.Export(doc), "tb")["data"];

    Assert.True(
        JsonNode.DeepEquals(Normalize(data), Normalize(exported)),
        $"{scenario}: expected {Normalize(data)?.ToJsonString()} got {Normalize(exported)?.ToJsonString()}");
  }

  /// <summary>
  /// The same edits applied twice in a row (the second over a doc already
  /// reshaped by the first) must still export what the second edit says.
  /// </summary>
  [Theory]
  [MemberData(nameof(TableEdits))]
  public void AnEditOverAnEditedTableExportsTheSecondGrid(string scenario, string content)
  {
    foreach (var (_, first) in TableEditPairs())
    {
      var doc = new YDoc(1);

      RichTextRuntime.Seed(doc, Blocks([FullTable, .. CellChildren]));
      Apply(doc, $$"""{ "op": "update", "id": "tb", "data": { "content": {{first}} } }""");

      var data = JsonNode.Parse($$"""{ "content": {{content}} }""")!;

      Apply(doc, $$"""{ "op": "update", "id": "tb", "data": {{data.ToJsonString()}} }""");

      var exported = BlockNamed(RichTextRuntime.Export(doc), "tb")["data"];

      Assert.True(
          JsonNode.DeepEquals(Normalize(data), Normalize(exported)),
          $"{scenario} after [{first}]: expected {Normalize(data)?.ToJsonString()} got {Normalize(exported)?.ToJsonString()}");
    }
  }

  /// <summary>
  /// A peer adds column c3 to every row while the host's /edit (made before
  /// it saw that column) changes one cell's colour. Both must survive: the
  /// host never said to drop c3, it simply did not know about it.
  /// </summary>
  [Fact]
  public void APeersNewColumnSurvivesAConcurrentHostCellEdit()
  {
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, Blocks([FullTable, .. CellChildren]));

    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    // The peer's own save: the same rows plus c3 at the end of each.
    Apply(
        peer,
        """
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c3", "rowId": "r0", "blocks": [] } ],
          [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c3", "rowId": "r1", "blocks": [] } ] ] } }
        """);

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "color": "red" }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01"] } ],
          [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var content = BlockNamed(RichTextRuntime.Export(doc), "tb")["data"]!["content"]!.AsArray();

    Assert.Equal("red", content[0]![0]!["color"]?.GetValue<string>());
    Assert.Equal(["c0", "c1", "c2", "c3"], content[0]!.AsArray().Select(cell => cell!["id"]!.GetValue<string>()));
    Assert.Equal(["c0", "c1", "c2", "c3"], content[1]!.AsArray().Select(cell => cell!["id"]!.GetValue<string>()));
  }

  /// <summary>
  /// A peer moves column c2 to the front while the host edits a cell in it.
  /// The host's text must land in the moved column, not at its old index.
  /// </summary>
  [Fact]
  public void AHostCellEditFollowsAConcurrentColumnMove()
  {
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, Blocks([FullTable, .. CellChildren]));

    var peer = Fork(doc);
    var before = doc.EncodeStateVector();

    Apply(
        peer,
        """
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c2", "rowId": "r0", "blocks": ["p01"] }, { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] } ],
          [ { "id": "c2", "rowId": "r1", "blocks": [] }, { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] } ] ] } }
        """);

    Apply(
        doc,
        """
        { "op": "update", "id": "tb", "data": { "content": [
          [ { "id": "c0", "rowId": "r0", "blocks": ["p00"] }, { "id": "c1", "rowId": "r0", "blocks": [] }, { "id": "c2", "rowId": "r0", "blocks": ["p01", "pNew"] } ],
          [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] }, { "id": "c1", "rowId": "r1", "blocks": ["p12"] }, { "id": "c2", "rowId": "r1", "blocks": [] } ] ] } }
        """);

    doc.ApplyUpdate(peer.EncodeStateAsUpdate(before));

    var row = BlockNamed(RichTextRuntime.Export(doc), "tb")["data"]!["content"]![0]!.AsArray();
    var c2 = row.Single(cell => cell!["id"]!.GetValue<string>() == "c2");

    Assert.Equal(["p01", "pNew"], c2!["blocks"]!.AsArray().Select(id => id!.GetValue<string>()));
  }

  /// <summary>
  /// Moving a cell child block out of the table with ops (unlink + link at
  /// root) while the table data still names it must not lose the block.
  /// </summary>
  [Fact]
  public void ACellChildStillNamedByItsCellIsExported()
  {
    var doc = new YDoc(1);

    RichTextRuntime.Seed(doc, Blocks([FullTable, .. CellChildren]));

    var exported = RichTextRuntime.Export(doc);

    foreach (var id in new[] { "p00", "p01", "p10", "p11", "p12" })
    {
      Assert.Equal("tb", BlockNamed(exported, id)["parent"]?.GetValue<string>());
    }

    Assert.Equal(
        ["p00", "p01", "p10", "p11", "p12"],
        BlockNamed(exported, "tb")["content"]!.AsArray().Select(id => id!.GetValue<string>()));
  }

  private static IEnumerable<(string Scenario, string Content)> TableEditPairs()
  {
    foreach (var row in TableEdits())
    {
      yield return ((string)row[0], (string)row[1]);
    }
  }

  private static JsonArray Blocks(params string[] json)
  {
    return new JsonArray(json.Select(entry => JsonNode.Parse(entry)).ToArray());
  }

  private static YDoc Fork(YDoc doc)
  {
    var peer = new YDoc(2);

    Assert.Equal(ApplyOutcome.Applied, peer.ApplyUpdate(doc.EncodeStateAsUpdate()).Outcome);

    return peer;
  }

  private static void Apply(YDoc doc, params string[] opJson)
  {
    RichTextRuntime.ApplyOps(
        doc,
        CollabEditOps.Parse(
            Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }""")));
  }

  private static JsonObject BlockNamed(JsonArray exported, string id)
  {
    return exported
        .Select(block => block?.AsObject())
        .Single(block => block?["id"]?.GetValue<string>() == id) ??
        throw new InvalidOperationException($"no block {id}");
  }

  private static void AssertSameDocument(JsonArray expected, JsonArray actual)
  {
    var want = Normalize(expected)!.ToJsonString();
    var got = Normalize(actual)!.ToJsonString();

    Assert.Equal(want, got);
  }

  /// <summary>Objects with sorted keys, so key order is not a difference.</summary>
  private static JsonNode? Normalize(JsonNode? node)
  {
    return node switch
    {
      JsonObject map => new JsonObject(
          map.OrderBy(entry => entry.Key, StringComparer.Ordinal)
              .Select(entry => KeyValuePair.Create(entry.Key, Normalize(entry.Value)))),
      JsonArray items => new JsonArray(items.Select(Normalize).ToArray()),
      null => null,
      _ => node.DeepClone(),
    };
  }
}
