using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A restore planned against a real doc, applied through the /edit path, and
/// exported again. The export must equal the normalized target; a wrong plan
/// either gets refused by the edit planner or silently loses blocks.
/// </summary>
public sealed class CollabRestorePlannerTests
{
  [Fact]
  public async Task SwapsRoots()
  {
    var doc = Doc(P("a"), P("b"));

    var after = await Restore(doc, Target(P("b"), P("a")));

    Assert.Equal(["b", "a"], Outline(after));
  }

  /// <summary>Review Focus 1: the first draft lost the children of a moved block.</summary>
  [Fact]
  public async Task MovesABlockWithChildrenToAnotherParentAndKeepsTheChildren()
  {
    var doc = Doc(
        Parent("a", "toggle", ["c"]),
        Parent("c", "toggle", ["g"], parent: "a"),
        P("g", parent: "c", text: "grandchild"),
        Parent("b", "toggle", []));

    var after = await Restore(doc, Target(
        Parent("a", "toggle", []),
        Parent("b", "toggle", ["c"]),
        Parent("c", "toggle", ["g"], parent: "b"),
        P("g", parent: "c", text: "grandchild")));

    Assert.Equal(["a", "b", "c<b", "g<c"], Outline(after));
    Assert.Equal(
        "grandchild",
        Block(after, "g")["data"]?["text"]?[0]?["text"]?.GetValue<string>());
  }

  [Fact]
  public async Task MovesAParentAfterItsSiblingWithItsChildren()
  {
    var doc = Doc(
        Parent("a", "toggle", ["k1", "k2"]),
        P("k1", parent: "a"),
        P("k2", parent: "a"),
        P("b"));

    var after = await Restore(doc, Target(
        P("b"),
        Parent("a", "toggle", ["k1", "k2"]),
        P("k1", parent: "a"),
        P("k2", parent: "a")));

    Assert.Equal(["b", "a", "k1<a", "k2<a"], Outline(after));
  }

  [Fact]
  public async Task MovesAParentWhoseChildrenStayWhereTheyWere()
  {
    var doc = Doc(
        Parent("a", "toggle", ["k1", "k2"]),
        P("k1", parent: "a"),
        P("k2", parent: "a"),
        Parent("b", "toggle", []));

    var after = await Restore(doc, Target(
        P("k1"),
        P("k2"),
        Parent("b", "toggle", ["a"]),
        Parent("a", "toggle", [], parent: "b")));

    Assert.Equal(["k1", "k2", "b", "a<b"], Outline(after));
  }

  [Fact]
  public async Task DeletesAParentWhoseChildMovesToRootAndKeepsTheGrandchild()
  {
    var doc = Doc(
        Parent("p", "toggle", ["c"]),
        Parent("c", "toggle", ["g"], parent: "p"),
        P("g", parent: "c", text: "deep"),
        P("x"));

    var after = await Restore(doc, Target(
        Parent("c", "toggle", ["g"]),
        P("g", parent: "c", text: "deep"),
        P("x")));

    Assert.Equal(["c", "g<c", "x"], Outline(after));
  }

  [Fact]
  public async Task ChangesTheTypeOfABlockWithChildren()
  {
    var doc = Doc(
        Parent("t", "toggle", ["k"]),
        P("k", parent: "t", text: "kid"));

    var after = await Restore(doc, Target(
        Parent("t", "callout", ["k"]),
        P("k", parent: "t", text: "kid")));

    Assert.Equal(["t", "k<t"], Outline(after));
    Assert.Equal("callout", Block(after, "t")["type"]?.GetValue<string>());
  }

  [Fact]
  public async Task ChangesTunes()
  {
    var doc = Doc(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": { "align": "left" } }""",
        P("b"));

    var after = await Restore(doc, Target(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": { "align": "center" } }""",
        P("b")));

    Assert.Equal("center", Block(after, "a")["tunes"]?["align"]?.GetValue<string>());
  }

  [Fact]
  public async Task ChangesTheDataOfAMovedBlock()
  {
    var doc = Doc(
        P("a"),
        Parent("b", "toggle", ["c"]),
        P("c", parent: "b", text: "old"));

    var after = await Restore(doc, Target(
        P("a"),
        P("c", text: "new"),
        Parent("b", "toggle", [])));

    Assert.Equal(["a", "c", "b"], Outline(after));
    Assert.Equal("new", Block(after, "c")["data"]?["text"]?[0]?["text"]?.GetValue<string>());
  }

  /// <summary>
  /// c names p as its parent but p does not list it, so c cannot be an
  /// anchor: inserting after it would be refused.
  /// </summary>
  [Fact]
  public async Task ReplacesAnOrphanChildItsParentDoesNotList()
  {
    var doc = Doc(
        Parent("p", "toggle", ["k"]),
        P("k", parent: "p"),
        P("c", parent: "p"));

    // k then c is c's current order too, so only the anchor rule keeps c
    // from staying and n from being refused after it.
    var after = await Restore(doc, Target(
        Parent("p", "toggle", ["k", "c", "n"]),
        P("k", parent: "p"),
        P("c", parent: "p"),
        P("n", parent: "p")));

    Assert.Equal(["p", "k<p", "c<p", "n<p"], Outline(after));
  }

  [Fact]
  public async Task ReplacesARootBlockMissingFromTheRootOrder()
  {
    var doc = Doc(P("a"), P("r"));
    var order = doc.GetArray("root");

    doc.Transact(transaction => order.Delete(transaction, 1, 1));

    var after = await Restore(doc, Target(P("a"), P("r"), P("n")));

    Assert.Equal(["a", "r", "n"], Outline(after));
  }

  /// <summary>
  /// The export reads a self-parent as root, but the edit planner reads the
  /// stored value, so nothing can be inserted after that block.
  /// </summary>
  [Fact]
  public async Task ReplacesARootBlockWhoseStoredParentIsItself()
  {
    var doc = Doc(P("a"), P("x"));
    var block = Assert.IsType<YMap>(doc.GetMap("blocks").TryGet("x", out var value) ? value : null);

    doc.Transact(transaction => block.Set(transaction, "parentId", "x"));

    var after = await Restore(doc, Target(P("a"), P("x"), P("n")));

    Assert.Equal(["a", "x", "n"], Outline(after));
  }

  [Fact]
  public async Task PutsABlockWhoseTargetParentIsMissingAtRoot()
  {
    var doc = Doc(P("a"));

    var target = Target(P("a"), P("x", parent: "ghost"), P("y"));

    // The export puts the orphan at its tail; root keeps that order.
    Assert.Equal(["a", "y", "x<ghost"], Outline(target));

    var after = await Restore(doc, target);

    Assert.Equal(["a", "y", "x"], Outline(after));
  }

  [Fact]
  public async Task ReplacesANonBlockKeyWhoseIdTheTargetUses()
  {
    var doc = Doc(P("a"));
    var blocks = doc.GetMap("blocks");

    doc.Transact(transaction => blocks.Set(transaction, "x", "not a block"));

    var after = await Restore(doc, Target(P("a"), P("x")));

    Assert.Equal(["a", "x"], Outline(after));
  }

  [Fact]
  public async Task GivesAChildToAParentWithoutAChildrenList()
  {
    var doc = Doc(P("p"), P("q"));
    var block = Assert.IsType<YMap>(doc.GetMap("blocks").TryGet("p", out var value) ? value : null);

    doc.Transact(transaction => block.Remove(transaction, "contentIds"));

    var after = await Restore(doc, Target(
        """{ "id": "p", "type": "paragraph", "data": { "text": "p" }, "content": ["k"] }""",
        P("k", parent: "p"),
        P("q")));

    Assert.Equal(["p", "k<p", "q"], Outline(after));
  }

  [Fact]
  public async Task PlansNothingForAnIdenticalDocument()
  {
    var blocks = new[] { Parent("a", "toggle", ["c"]), P("c", parent: "a"), P("b") };
    var doc = Doc(blocks);
    var converter = Converter();

    var ops = CollabRestorePlanner.Plan(
        await Export(converter, doc), YDocConverter.DescribeStructure(doc), Target(blocks));

    Assert.Empty(ops);
  }

  [Fact]
  public async Task PlansOneUpdateForADataOnlyChange()
  {
    var doc = Doc(Parent("a", "toggle", ["c"]), P("c", parent: "a"), P("b", text: "before"));

    var (ops, _) = await RestorePlan(
        doc,
        Target(Parent("a", "toggle", ["c"]), P("c", parent: "a"), P("b", text: "after")));

    var update = Assert.IsType<CollabEditOp.Update>(Assert.Single(ops));
    Assert.Equal("b", update.Id);
  }

  [Fact]
  public async Task ReinsertedBlocksCarryTheTargetsEditStamps()
  {
    var doc = Doc(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "lastEditedAt": 1, "lastEditedBy": "u1" }""",
        """{ "id": "b", "type": "paragraph", "data": { "text": "b" }, "lastEditedAt": 2, "lastEditedBy": "u2" }""");
    var target = Target(
        """{ "id": "b", "type": "paragraph", "data": { "text": "b" }, "lastEditedAt": 20, "lastEditedBy": "v2" }""",
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "lastEditedAt": 10, "lastEditedBy": "v1" }""");

    var (ops, after) = await RestorePlan(doc, target);
    var inserted = ops.OfType<CollabEditOp.Insert>().ToArray();

    Assert.NotEmpty(inserted);

    foreach (var insert in inserted)
    {
      Assert.Equal(
          Block(target, insert.Id)["lastEditedAt"]?.GetValue<long>(),
          Block(after, insert.Id)["lastEditedAt"]?.GetValue<long>());
      Assert.Equal(
          Block(target, insert.Id)["lastEditedBy"]?.GetValue<string>(),
          Block(after, insert.Id)["lastEditedBy"]?.GetValue<string>());
    }
  }

  /// <summary>
  /// Plans against <paramref name="doc"/>, applies the plan, and checks the
  /// export equals the normalized target, edit stamps aside. The return
  /// value is the export after the restore.
  /// </summary>
  private static async Task<JsonArray> Restore(YDoc doc, JsonArray target)
  {
    return (await RestorePlan(doc, target)).After;
  }

  private static async Task<(IReadOnlyList<CollabEditOp> Ops, JsonArray After)> RestorePlan(
      YDoc doc, JsonArray target)
  {
    var converter = Converter();
    var current = await Export(converter, doc);
    var expected = Unstamped(CollabRestorePlanner.NormalizeTarget(target));

    // Otherwise an empty plan would pass.
    Assert.NotEqual(expected, Unstamped(current));

    var ops = CollabRestorePlanner.Plan(current, YDocConverter.DescribeStructure(doc), target);

    await converter.ApplyOpsAsync(doc, ops);

    var after = await Export(converter, doc);

    Assert.Equal(expected, Unstamped(after));

    return (ops, after);
  }

  private static CollabDocConverter Converter()
  {
    return new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader);
  }

  private static async Task<JsonArray> Export(CollabDocConverter converter, YDoc doc)
  {
    return (JsonArray)(await converter.ExportAsync(doc))["blocks"]!;
  }

  private static YDoc Doc(params string[] blockJson)
  {
    var doc = new YDoc();

    RichTextRuntime.Seed(doc, Blocks(blockJson));

    return doc;
  }

  /// <summary>A target as a replay hands it over: the export of a seeded doc.</summary>
  private static JsonArray Target(params string[] blockJson)
  {
    return RichTextRuntime.Export(Doc(blockJson));
  }

  private static JsonArray Blocks(string[] blockJson)
  {
    return new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray());
  }

  private static string P(string id, string? parent = null, string? text = null)
  {
    var block = new JsonObject
    {
      ["id"] = id,
      ["type"] = "paragraph",
      ["data"] = new JsonObject { ["text"] = text ?? id },
    };

    if (parent is not null)
    {
      block["parent"] = parent;
    }

    return block.ToJsonString();
  }

  private static string Parent(string id, string type, string[] content, string? parent = null)
  {
    var block = new JsonObject
    {
      ["id"] = id,
      ["type"] = type,
      ["data"] = new JsonObject(),
      ["content"] = new JsonArray(content.Select(child => (JsonNode?)child).ToArray()),
    };

    if (parent is not null)
    {
      block["parent"] = parent;
    }

    return block.ToJsonString();
  }

  /// <summary>Canonical JSON without lastEditedAt/lastEditedBy.</summary>
  private static string Unstamped(JsonArray blocks)
  {
    var copy = blocks.DeepClone().AsArray();

    foreach (var block in copy.OfType<JsonObject>())
    {
      block.Remove("lastEditedAt");
      block.Remove("lastEditedBy");
    }

    return YDocConverterFixtures.Canonicalize(copy);
  }

  /// <summary>Export order as "id" or "id&lt;parent", an independent check on NormalizeTarget.</summary>
  private static string[] Outline(JsonArray blocks)
  {
    return blocks
        .Select(block => block?["parent"] is { } parent
          ? $"{block["id"]}<{parent}"
          : $"{block?["id"]}")
        .ToArray();
  }

  private static JsonObject Block(JsonArray blocks, string id)
  {
    return blocks
        .OfType<JsonObject>()
        .Single(block => block["id"]?.GetValue<string>() == id);
  }
}
