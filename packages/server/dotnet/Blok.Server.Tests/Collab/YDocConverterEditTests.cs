using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;
using JsonArray = System.Text.Json.Nodes.JsonArray;
using JsonObject = System.Text.Json.Nodes.JsonObject;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// YDocConverter.ApplyOps: the block-level edit path behind
/// POST /sync/{doc}/edit. Every op is validated against the doc BEFORE
/// anything is written, so a rejected request leaves the doc untouched.
/// </summary>
public sealed class YDocConverterEditTests
{
  private const string Root = """{ "id": "root", "type": "paragraph", "data": { "text": "r" } }""";
  private const string Second = """{ "id": "second", "type": "paragraph", "data": { "text": "s" } }""";

  [Fact]
  public void InsertsFirstWhenAfterIsNull()
  {
    using var doc = SeededDoc(Root, Second);

    Apply(doc, """{ "op": "insert", "id": "new", "block": { "type": "header", "data": {} } }""");

    Assert.Equal(["new", "root", "second"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void InsertsAfterTheNamedSibling()
  {
    using var doc = SeededDoc(Root, Second);

    Apply(
        doc,
        """
        { "op": "insert", "id": "new", "after": "root",
          "block": { "type": "header", "data": { "text": "n", "level": 2 } } }
        """);

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["root", "new", "second"], Ids(exported));
    Assert.Equal("header", BlockNamed(exported, "new")["type"]?.GetValue<string>());
    Assert.Equal("n", BlockNamed(exported, "new")["data"]?["text"]?.GetValue<string>());
  }

  /// <summary>
  /// parentId is the membership arbiter: an inserted child that carried only
  /// its parent's contentIds entry would be filtered out on export and come
  /// back as a root orphan.
  /// </summary>
  [Fact]
  public void InsertsUnderAParentAndLinksItBothWays()
  {
    using var doc = SeededDoc(
        """{ "id": "root", "type": "toggle", "data": {}, "content": ["kid"] }""",
        """{ "id": "kid", "type": "paragraph", "data": {}, "parent": "root" }""");

    Apply(
        doc,
        """
        { "op": "insert", "id": "new", "parent": "root", "after": "kid",
          "block": { "type": "paragraph", "data": { "text": "n" } } }
        """);

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["root", "kid", "new"], Ids(exported));
    Assert.Equal("root", BlockNamed(exported, "new")["parent"]?.GetValue<string>());
    Assert.Equal(["kid", "new"], Strings(BlockNamed(exported, "root")["content"]));
  }

  [Fact]
  public void LaterOpsSeeTheEffectsOfEarlierOnes()
  {
    using var doc = SeededDoc(Root);

    Apply(
        doc,
        """{ "op": "insert", "id": "a", "after": "root", "block": { "type": "p", "data": {} } }""",
        """{ "op": "insert", "id": "b", "parent": "a", "block": { "type": "p", "data": {} } }""",
        """{ "op": "update", "id": "b", "data": { "text": "late" } }""",
        """{ "op": "remove", "id": "root" }""");

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["a", "b"], Ids(exported));
    Assert.Equal("late", BlockNamed(exported, "b")["data"]?["text"]?.GetValue<string>());
  }

  [Fact]
  public void UpdateReplacesTheDataWholesale()
  {
    using var doc = SeededDoc(
        """{ "id": "root", "type": "paragraph", "data": { "text": "old", "level": 3 } }""");

    Apply(doc, """{ "op": "update", "id": "root", "data": { "text": "new" } }""");

    var data = BlockNamed(YDocConverter.Export(doc), "root")["data"]?.AsObject();
    Assert.Equal("new", data?["text"]?.GetValue<string>());
    Assert.Null(data?["level"]);
  }

  [Fact]
  public void UpdateKeepsTheBlockTypeAndItsPlace()
  {
    using var doc = SeededDoc(Root, Second);

    Apply(doc, """{ "op": "update", "id": "second", "data": { "text": "new" } }""");

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["root", "second"], Ids(exported));
    Assert.Equal("paragraph", BlockNamed(exported, "second")["type"]?.GetValue<string>());
  }

  [Fact]
  public void RemoveTakesTheWholeSubtreeAndTheParentsEntry()
  {
    using var doc = SeededDoc(
        """{ "id": "root", "type": "toggle", "data": {}, "content": ["kid", "other"] }""",
        """{ "id": "kid", "type": "toggle", "data": {}, "parent": "root", "content": ["grandkid"] }""",
        """{ "id": "grandkid", "type": "paragraph", "data": {}, "parent": "kid" }""",
        """{ "id": "other", "type": "paragraph", "data": {}, "parent": "root" }""");

    Apply(doc, """{ "op": "remove", "id": "kid" }""");

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["root", "other"], Ids(exported));
    Assert.Equal(["other"], Strings(BlockNamed(exported, "root")["content"]));
  }

  /// <summary>
  /// A block whose parentId names the removed one but that its contentIds
  /// never listed would be left behind with a dangling parent — and the
  /// client's orphan pass would resurrect it at the top of the document.
  /// </summary>
  [Fact]
  public void RemoveTakesABlockParentedToItEvenWhenItIsNotListed()
  {
    using var doc = SeededDoc(
        Root,
        """{ "id": "gone", "type": "toggle", "data": {} }""",
        """{ "id": "stray", "type": "paragraph", "data": {}, "parent": "gone" }""");

    Apply(doc, """{ "op": "remove", "id": "gone" }""");

    Assert.Equal(["root"], Ids(YDocConverter.Export(doc)));
  }

  /// <summary>
  /// The membership arbiter again: "gone" lists x, but x names another
  /// parent, so x is displayed there and survives the removal.
  /// </summary>
  [Fact]
  public void RemoveKeepsAListedBlockThatNamesAnotherParent()
  {
    using var doc = SeededDoc(
        """{ "id": "root", "type": "toggle", "data": {}, "content": ["x"] }""",
        """{ "id": "x", "type": "paragraph", "data": {}, "parent": "root" }""",
        """{ "id": "gone", "type": "toggle", "data": {}, "content": ["x"] }""");

    Apply(doc, """{ "op": "remove", "id": "gone" }""");

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["root", "x"], Ids(exported));
    Assert.Equal(["x"], Strings(BlockNamed(exported, "root")["content"]));
  }

  /// <summary>
  /// A stale root-order entry would put a later re-insert of the same id back
  /// at the removed block's old position.
  /// </summary>
  [Fact]
  public void RemoveDropsTheRootOrderEntrySoTheIdCanBeUsedAgain()
  {
    using var doc = SeededDoc(Root, Second);

    Apply(
        doc,
        """{ "op": "remove", "id": "root" }""",
        """
        { "op": "insert", "id": "root", "after": "second",
          "block": { "type": "paragraph", "data": { "text": "again" } } }
        """);

    var exported = YDocConverter.Export(doc);
    Assert.Equal(["second", "root"], Ids(exported));
    Assert.Equal("again", BlockNamed(exported, "root")["data"]?["text"]?.GetValue<string>());
  }

  [Theory]
  [InlineData(
      """{ "op": "insert", "id": "root", "block": { "type": "p", "data": {} } }""",
      "already")]
  [InlineData(
      """{ "op": "insert", "id": "new", "parent": "ghost", "block": { "type": "p", "data": {} } }""",
      "ghost")]
  [InlineData(
      """{ "op": "insert", "id": "new", "after": "ghost", "block": { "type": "p", "data": {} } }""",
      "ghost")]
  [InlineData("""{ "op": "update", "id": "ghost", "data": {} }""", "ghost")]
  [InlineData("""{ "op": "remove", "id": "ghost" }""", "ghost")]
  public void RefusesAnOpThatDisagreesWithTheDocAndWritesNothing(string op, string mentions)
  {
    using var doc = SeededDoc(Root, Second);
    var before = Canonical(doc);

    var message = Refused(doc, op);

    Assert.StartsWith("collab: op 0:", message, StringComparison.Ordinal);
    Assert.Contains(mentions, message, StringComparison.Ordinal);
    Assert.Equal(before, Canonical(doc));
  }

  /// <summary>"after" names a sibling, so a block from another container is not one.</summary>
  [Fact]
  public void RefusesAnAfterThatIsNotAChildOfTheTargetParent()
  {
    using var doc = SeededDoc(
        """{ "id": "root", "type": "toggle", "data": {}, "content": ["kid"] }""",
        """{ "id": "kid", "type": "paragraph", "data": {}, "parent": "root" }""");

    var message = Refused(
        doc,
        """{ "op": "insert", "id": "new", "after": "kid", "block": { "type": "p", "data": {} } }""");

    Assert.Contains("kid", message, StringComparison.Ordinal);
    Assert.Equal(["root", "kid"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void WritesNothingWhenALaterOpIsInvalid()
  {
    using var doc = SeededDoc(Root);
    var before = Canonical(doc);

    var message = Refused(
        doc,
        """{ "op": "insert", "id": "new", "block": { "type": "p", "data": {} } }""",
        """{ "op": "remove", "id": "ghost" }""");

    Assert.StartsWith("collab: op 1:", message, StringComparison.Ordinal);
    Assert.Equal(before, Canonical(doc));
  }

  [Fact]
  public void RefusesDataNestedDeeperThanTheValueLimit()
  {
    using var doc = SeededDoc(Root);
    var deep = new StringBuilder();

    for (var level = 0; level < YDocConverter.MaxValueDepth + 2; level++)
    {
      deep.Append("{ \"k\": ");
    }

    deep.Append('1');
    deep.Append('}', YDocConverter.MaxValueDepth + 2);

    var message = Refused(doc, $$"""{ "op": "update", "id": "root", "data": {{deep}} }""");

    Assert.Contains("nested", message, StringComparison.Ordinal);
    Assert.Equal(["root"], Ids(YDocConverter.Export(doc)));
  }

  /// <summary>
  /// The request parser is the first NUL gate; this is the second one, for
  /// any caller that reaches the converter directly. A NUL read back through
  /// yffi aborts the process, so it must never reach a write.
  /// </summary>
  [Theory]
  [InlineData("insert id")]
  [InlineData("insert type")]
  [InlineData("insert data key")]
  [InlineData("insert data value")]
  [InlineData("insert parent")]
  [InlineData("update data")]
  [InlineData("remove id")]
  public void RefusesANulThatDidNotComeThroughTheRequestParser(string position)
  {
    using var doc = SeededDoc(Root);

    var message = Assert.Throws<CollabEditException>(
        () => YDocConverter.ApplyOps(doc, [NulOp(position)])).Message;

    Assert.StartsWith("collab: op 0:", message, StringComparison.Ordinal);
    Assert.Contains("NUL", message, StringComparison.Ordinal);
    Assert.Equal(["root"], Ids(YDocConverter.Export(doc)));
  }

  /// <summary>
  /// Built node by node, never by parsing: a raw NUL inside a JSON string
  /// literal is refused by the reader itself, which would test the reader
  /// rather than the converter's own guard.
  /// </summary>
  private static CollabEditOp NulOp(string position)
  {
    const string nul = "\0";

    return position switch
    {
      "insert id" => Insert($"new{nul}id", """{ "type": "p", "data": {} }"""),
      "insert type" => new CollabEditOp.Insert(
          "new",
          new JsonObject { ["type"] = $"p{nul}p", ["data"] = new JsonObject() },
          null,
          null),
      "insert data key" => new CollabEditOp.Insert(
          "new",
          new JsonObject
          {
            ["type"] = "p",
            ["data"] = new JsonObject { [$"k{nul}"] = 1 },
          },
          null,
          null),
      "insert data value" => new CollabEditOp.Insert(
          "new",
          new JsonObject
          {
            ["type"] = "p",
            ["data"] = new JsonObject { ["k"] = $"a{nul}b" },
          },
          null,
          null),
      "insert parent" => new CollabEditOp.Insert(
          "new",
          Block("""{ "type": "p", "data": {} }"""),
          null,
          $"root{nul}"),
      "update data" => new CollabEditOp.Update(
          "root",
          new JsonObject { ["text"] = $"a{nul}b" }),
      _ => new CollabEditOp.Remove($"root{nul}"),
    };
  }

  private static CollabEditOp.Insert Insert(string id, string blockJson)
  {
    return new CollabEditOp.Insert(id, Block(blockJson), null, null);
  }

  private static JsonObject Block(string json)
  {
    return JsonNode.Parse(json)?.AsObject() ??
        throw new InvalidOperationException("not a block");
  }

  private static Doc SeededDoc(params string[] blockJson)
  {
    var doc = new Doc();
    YDocConverter.Seed(
        doc,
        new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray()));

    return doc;
  }

  private static void Apply(Doc doc, params string[] opJson)
  {
    YDocConverter.ApplyOps(doc, Ops(opJson));
  }

  private static string Refused(Doc doc, params string[] opJson)
  {
    return Assert.Throws<CollabEditException>(
        () => YDocConverter.ApplyOps(doc, Ops(opJson))).Message;
  }

  /// <summary>Ops as the endpoint builds them, so the tests carry the real request shape.</summary>
  private static IReadOnlyList<CollabEditOp> Ops(params string[] opJson)
  {
    return CollabEditOps.Parse(
        Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }"""));
  }

  private static string Canonical(Doc doc)
  {
    return YDocConverterFixtures.Canonicalize(YDocConverter.Export(doc));
  }

  private static string[] Ids(JsonArray exported)
  {
    return exported
        .Select(block => block?["id"]?.GetValue<string>() ?? "")
        .ToArray();
  }

  private static JsonObject BlockNamed(JsonArray exported, string id)
  {
    return exported
        .Select(block => block?.AsObject())
        .Single(block => block?["id"]?.GetValue<string>() == id) ??
        throw new InvalidOperationException($"no block {id}");
  }

  private static string[] Strings(JsonNode? array)
  {
    return array?.AsArray()
        .Select(entry => entry?.GetValue<string>() ?? "")
        .ToArray() ?? [];
  }
}
