using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;
using YDotNet.Document.Cells;
using JsonArray = System.Text.Json.Nodes.JsonArray;
using JsonObject = System.Text.Json.Nodes.JsonObject;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// One test per law of DocumentStore.toJSON/fromJSON and YBlockSerializer,
/// driven against docs built directly with YDotNet — the only way to reach
/// shapes (cycles, duplicated grid keys) that fromJSON never produces.
/// </summary>
public sealed class YDocConverterLawTests
{
  [Fact]
  public void ParentIdIsTheMembershipArbiter()
  {
    using var doc = BuildDoc(
        ["a", "b"],
        ("a", Block("a", contentIds: ["x"])),
        ("b", Block("b", contentIds: ["x"])),
        ("x", Block("x", parentId: "b")));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["a", "b", "x"], Ids(exported));
    Assert.Null(BlockNamed(exported, "a")["content"]);
    Assert.Equal(["x"], Strings(BlockNamed(exported, "b")["content"]));
    Assert.Equal("b", BlockNamed(exported, "x")["parent"]?.GetValue<string>());
  }

  [Fact]
  public void ADisagreeingOrderEntryDoesNotConsumeTheId()
  {
    // x sits first under a (disagreeing) and then under b (agreeing): the
    // skip must not mark it seen, or the later agreeing slot loses it.
    using var doc = BuildDoc(
        ["a", "b"],
        ("a", Block("a", contentIds: ["x", "y"])),
        ("y", Block("y", parentId: "a")),
        ("b", Block("b", contentIds: ["x"])),
        ("x", Block("x", parentId: "b")));

    Assert.Equal(["a", "y", "b", "x"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void CycleBreakLetsTheSmallestIdKeepItsParent()
  {
    using var doc = BuildDoc(
        [],
        ("q", Block("q", parentId: "p", contentIds: ["p"])),
        ("p", Block("p", parentId: "q", contentIds: ["q"])));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["q", "p"], Ids(exported));
    Assert.Null(BlockNamed(exported, "q")["parent"]);
    Assert.Equal(["p"], Strings(BlockNamed(exported, "q")["content"]));
    Assert.Equal("q", BlockNamed(exported, "p")["parent"]?.GetValue<string>());
    Assert.Null(BlockNamed(exported, "p")["content"]);
  }

  [Fact]
  public void CycleBreakUsesUtf16CodeUnitOrderForTheKeeper()
  {
    // 'Ａ' (U+FF21) is a smaller code point than '😀' (U+1F600) but a LARGER
    // UTF-16 code unit than its high surrogate, so the emoji is the keeper.
    using var doc = BuildDoc(
        [],
        ("Ａ", Block("Ａ", parentId: "😀")),
        ("😀", Block("😀", parentId: "Ａ")));

    var exported = YDocConverter.Export(doc);

    Assert.Null(BlockNamed(exported, "Ａ")["parent"]);
    Assert.Equal("Ａ", BlockNamed(exported, "😀")["parent"]?.GetValue<string>());
  }

  [Fact]
  public void ASelfParentIsAlwaysBroken()
  {
    using var doc = BuildDoc(
        [],
        ("a", Block("a", parentId: "a", contentIds: ["a"])));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["a"], Ids(exported));
    Assert.Null(BlockNamed(exported, "a")["parent"]);
    Assert.Null(BlockNamed(exported, "a")["content"]);
  }

  [Fact]
  public void ADuplicateIdEmitsOnceAtItsFirstAgreeingOccurrence()
  {
    using var doc = BuildDoc(
        ["a", "a"],
        ("a", Block("a", contentIds: ["k", "k"])),
        ("k", Block("k", parentId: "a")));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["a", "k"], Ids(exported));
    // The projection filters by ownership only; it never dedupes.
    Assert.Equal(["k", "k"], Strings(BlockNamed(exported, "a")["content"]));
  }

  [Fact]
  public void UnreachedBlocksAppendInTwoSortedPasses()
  {
    // Pass one: tops (no parent, or a parent with no entry), sorted, each
    // descending into its listed children. Pass two: whatever is left,
    // sorted — which can emit a child ahead of its own orphaned parent.
    using var doc = BuildDoc(
        [],
        ("y", Block("y", parentId: "ghost", contentIds: ["y-kid"])),
        ("y-kid", Block("y-kid", parentId: "y")),
        ("x", Block("x")),
        ("w", Block("w", parentId: "y", contentIds: ["v"])),
        ("v", Block("v", parentId: "w")));

    Assert.Equal(["x", "y", "y-kid", "v", "w"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void TheOrphanTailSortsByUtf16CodeUnit()
  {
    using var doc = BuildDoc(
        [],
        ("Ａ", Block("Ａ", parentId: "ghost")),
        ("😀", Block("😀", parentId: "ghost")),
        ("é", Block("é", parentId: "ghost")),
        ("z", Block("z", parentId: "ghost")));

    Assert.Equal(["z", "é", "😀", "Ａ"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void ADanglingParentIdIsKept()
  {
    using var doc = BuildDoc([], ("a", Block("a", parentId: "not-yet-arrived")));

    Assert.Equal(
        "not-yet-arrived",
        BlockNamed(YDocConverter.Export(doc), "a")["parent"]?.GetValue<string>());
  }

  [Fact]
  public void ADanglingContentIdStaysInContentButNotInTheOrder()
  {
    using var doc = BuildDoc(["a"], ("a", Block("a", contentIds: ["missing"])));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["a"], Ids(exported));
    Assert.Equal(["missing"], Strings(BlockNamed(exported, "a")["content"]));
  }

  [Fact]
  public void NonStringContentEntriesPassThroughVerbatim()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "content": [7, "b"] }""",
        """{ "id": "b", "type": "paragraph", "data": { "text": "b" }, "parent": "a" }"""));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["a", "b"], Ids(exported));
    AssertJson("""[7,"b"]""", BlockNamed(exported, "a")["content"]);
  }

  [Fact]
  public void SeedCreatesContentIdsEagerlyEvenWhenEmpty()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" } }"""));

    var blocks = doc.Map("blocks");

    using (var transaction = doc.ReadTransaction())
    {
      var contentIds = blocks.Get(transaction, "a")?.Map.Get(transaction, "contentIds");

      Assert.NotNull(contentIds);
      Assert.Equal(OutputTag.Array, contentIds.Tag);
      Assert.Equal(0u, contentIds.Array.Length(transaction));
    }

    Assert.Null(BlockNamed(YDocConverter.Export(doc), "a")["content"]);
  }

  [Fact]
  public void SeedWritesTunesWheneverTheKeyIsPresentAndExportOmitsEmptyOnes()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": {} }""",
        """{ "id": "b", "type": "paragraph", "data": { "text": "b" } }"""));

    var blocks = doc.Map("blocks");

    using (var transaction = doc.ReadTransaction())
    {
      var tunes = blocks.Get(transaction, "a")?.Map.Get(transaction, "tunes");

      Assert.NotNull(tunes);
      Assert.Equal(OutputTag.Map, tunes.Tag);
      Assert.Null(blocks.Get(transaction, "b")?.Map.Get(transaction, "tunes"));
    }

    var exported = YDocConverter.Export(doc);

    Assert.Null(BlockNamed(exported, "a")["tunes"]);
    Assert.Null(BlockNamed(exported, "b")["tunes"]);
  }

  [Fact]
  public void SeedNormalizesEmptyParagraphDataOnly()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "p", "type": "paragraph", "data": {} }""",
        """{ "id": "h", "type": "header", "data": {} }"""));

    var exported = YDocConverter.Export(doc);

    AssertJson("""{"text":""}""", BlockNamed(exported, "p")["data"]);
    AssertJson("{}", BlockNamed(exported, "h")["data"]);
  }

  [Fact]
  public void SeedKeepsANullParentOutOfTheRootOrder()
  {
    // fromJSON tests `parent === undefined`, so a present null is not a top-
    // level block; it lands in the orphan tail and reads back parentless.
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "first", "type": "paragraph", "data": { "text": "1" } }""",
        """{ "id": "nullish", "type": "paragraph", "data": { "text": "2" }, "parent": null }""",
        """{ "id": "last", "type": "paragraph", "data": { "text": "3" } }"""));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["first", "last", "nullish"], Ids(exported));
    Assert.Null(BlockNamed(exported, "nullish")["parent"]);
  }

  [Fact]
  public void SeedWritesNumbersAsDoublesNeverLongs()
  {
    // A Long becomes a lib0 BigInt (tag 122), which the JS client reads as a
    // BigInt: `typeof x === 'number'` fails and JSON.stringify throws.
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "n": 5, "big": 1735689600000, "f": 2.5 }, "lastEditedAt": 1735689600000 }"""));

    var blocks = doc.Map("blocks");
    using var transaction = doc.ReadTransaction();
    var block = blocks.Get(transaction, "a")?.Map;

    Assert.NotNull(block);

    var data = block.Get(transaction, "data")?.Map;

    Assert.NotNull(data);
    Assert.Equal(OutputTag.Double, data.Get(transaction, "n")?.Tag);
    Assert.Equal(OutputTag.Double, data.Get(transaction, "big")?.Tag);
    Assert.Equal(OutputTag.Double, data.Get(transaction, "f")?.Tag);
    Assert.Equal(OutputTag.Double, block.Get(transaction, "lastEditedAt")?.Tag);
  }

  [Fact]
  public void ExportWritesIntegralNumbersAsIntegersAndReadsLongsToo()
  {
    using var doc = BuildDoc(
        ["a"],
        ("a", Table(
            "a",
            ("whole", Input.Double(3.0)),
            ("fraction", Input.Double(2.5)),
            ("long", Input.Long(7)))));

    AssertJson(
        """{"whole":3,"fraction":2.5,"long":7}""",
        BlockNamed(YDocConverter.Export(doc), "a")["data"]);
  }

  [Fact]
  public void TheArrayRuleDecidesBetweenYArraysAndAtomicLeaves()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "widget", "data": { "objects": [{ "k": 1 }], "primitives": [1, 2], "empty": [], "mixed": [1, {}], "grid": [[{ "k": 1 }]] } }"""));

    var blocks = doc.Map("blocks");
    using var transaction = doc.ReadTransaction();
    var data = blocks.Get(transaction, "a")?.Map.Get(transaction, "data")?.Map;

    Assert.NotNull(data);
    Assert.Equal(OutputTag.Array, data.Get(transaction, "objects")?.Tag);
    Assert.Equal(OutputTag.JsonArray, data.Get(transaction, "primitives")?.Tag);
    Assert.Equal(OutputTag.JsonArray, data.Get(transaction, "empty")?.Tag);
    Assert.Equal(OutputTag.JsonArray, data.Get(transaction, "mixed")?.Tag);

    var grid = data.Get(transaction, "grid");

    Assert.NotNull(grid);
    Assert.Equal(OutputTag.Map, grid.Tag);
    Assert.Equal(OutputTag.Map, grid.Map.Get(transaction, "__rows")?.Tag);
    Assert.Equal(OutputTag.Array, grid.Map.Get(transaction, "__rowKeys")?.Tag);
    Assert.Equal(1u, grid.Map.Get(transaction, "__rowKeys")?.Array.Length(transaction));
  }

  [Fact]
  public void GridRowKeysNormalizeFirstWinsDropStraysAppendOrphansSorted()
  {
    var rows = MapOf(
        ("k1", Row("r1")),
        ("k2", Row("r2")),
        ("zz", Row("orphan z")),
        ("aa", Row("orphan a")));
    var order = ArrayOf(Str("k1"), Str("stray"), Str("k2"), Str("k1"));
    using var doc = BuildDoc(
        ["t"],
        ("t", Table("t", ("content", MapOf(("__rows", rows), ("__rowKeys", order))))));

    AssertJson(
        """[[{"text":"r1"}],[{"text":"r2"}],[{"text":"orphan a"}],[{"text":"orphan z"}]]""",
        BlockNamed(YDocConverter.Export(doc), "t")["data"]?["content"]);
  }

  [Fact]
  public void AMapReadsAsAGridOnlyWithBothContainerKeysInShape()
  {
    var plainKeys = MapOf(
        ("__rows", MapOf(("k1", Str("row")))),
        ("__rowKeys", Input.Collection([Str("k1")])));
    var rowsOnly = MapOf(("__rows", MapOf(("k1", Str("row")))));
    using var doc = BuildDoc(
        ["t"],
        ("t", Table("t", ("plainKeys", plainKeys), ("rowsOnly", rowsOnly))));

    var data = BlockNamed(YDocConverter.Export(doc), "t")["data"];

    AssertJson("""{"__rows":{"k1":"row"},"__rowKeys":["k1"]}""", data?["plainKeys"]);
    AssertJson("""{"__rows":{"k1":"row"}}""", data?["rowsOnly"]);
  }

  [Fact]
  public void ExportRejectsABlockWithoutAStringIdAStringTypeOrAMapData()
  {
    using var badId = BuildDoc(
        ["a"],
        ("a", MapOf(("id", Input.Double(1)), ("type", Str("paragraph")), ("data", MapOf()))));
    using var badType = BuildDoc(
        ["a"],
        ("a", MapOf(("id", Str("a")), ("type", Input.Null()), ("data", MapOf()))));
    using var badData = BuildDoc(
        ["a"],
        ("a", MapOf(("id", Str("a")), ("type", Str("paragraph")), ("data", Input.Object(new Dictionary<string, Input>())))));

    Assert.Throws<InvalidDataException>(() => YDocConverter.Export(badId));
    Assert.Throws<InvalidDataException>(() => YDocConverter.Export(badType));
    Assert.Throws<InvalidDataException>(() => YDocConverter.Export(badData));
  }

  [Fact]
  public void SeedSkipsBlocksWithoutAStringId()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": 42, "type": "paragraph", "data": { "text": "skipped" } }""",
        """{ "type": "paragraph", "data": { "text": "skipped too" } }""",
        """{ "id": "kept", "type": "paragraph", "data": { "text": "kept" } }"""));

    Assert.Equal(["kept"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void SeedReplacesWhateverTheDocHeldBefore()
  {
    using var doc = new Doc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "old", "type": "paragraph", "data": { "text": "old" } }"""));
    YDocConverter.Seed(doc, Blocks(
        """{ "id": "new", "type": "paragraph", "data": { "text": "new" } }"""));

    Assert.Equal(["new"], Ids(YDocConverter.Export(doc)));
  }

  private static Doc BuildDoc(
      string[] rootOrder,
      params (string Id, Input Block)[] blocks)
  {
    var doc = new Doc();
    var blockMap = doc.Map("blocks");
    var root = doc.Array("root");

    using (var transaction = doc.WriteTransaction())
    {
      foreach (var (id, block) in blocks)
      {
        blockMap.Insert(transaction, id, block);
      }

      if (rootOrder.Length > 0)
      {
        root.InsertRange(transaction, 0, rootOrder.Select(Str).ToArray());
      }
    }

    return doc;
  }

  private static Input Block(
      string id,
      string? parentId = null,
      string[]? contentIds = null)
  {
    var entries = new List<(string, Input)>
    {
      ("id", Str(id)),
      ("type", Str("paragraph")),
      ("data", MapOf(("text", Str(id)))),
      ("contentIds", ArrayOf((contentIds ?? []).Select(Str).ToArray())),
    };

    if (parentId is not null)
    {
      entries.Add(("parentId", Str(parentId)));
    }

    return MapOf(entries.ToArray());
  }

  /// <summary>A table block whose data holds the given entries.</summary>
  private static Input Table(string id, params (string Key, Input Value)[] data)
  {
    return MapOf(
        ("id", Str(id)),
        ("type", Str("table")),
        ("data", MapOf(data)),
        ("contentIds", ArrayOf()));
  }

  /// <summary>One grid row holding a single text cell.</summary>
  private static Input Row(string text)
  {
    return ArrayOf(MapOf(("text", Str(text))));
  }

  private static Input MapOf(params (string Key, Input Value)[] entries)
  {
    return Input.Map(entries.ToDictionary(
        entry => entry.Key,
        entry => entry.Value,
        StringComparer.Ordinal));
  }

  private static Input ArrayOf(params Input[] items)
  {
    return Input.Array(items);
  }

  private static Input Str(string value)
  {
    return Input.String(value);
  }

  private static JsonArray Blocks(params string[] blockJson)
  {
    return new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray());
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

  /// <summary>Key order is Y.Map iteration order, so compare semantically.</summary>
  private static void AssertJson(string expected, JsonNode? actual)
  {
    Assert.Equal(
        YDocConverterFixtures.Canonicalize(JsonNode.Parse(expected)),
        YDocConverterFixtures.Canonicalize(actual));
  }

  private static string[] Strings(JsonNode? array)
  {
    return array?.AsArray()
        .Select(entry => entry?.GetValue<string>() ?? "")
        .ToArray() ?? [];
  }
}
