using System.Numerics;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// One test per law of DocumentStore.toJSON/fromJSON and YBlockSerializer,
/// driven against docs built directly with the engine — the only way to reach
/// shapes (cycles, duplicated grid keys) that fromJSON never produces.
/// </summary>
public sealed class YDocConverterLawTests
{
  /// <summary>
  /// The writer of shapes the engine's own API cannot produce. A different id
  /// from anything BuildDoc used, so its clocks start at 0 with no overlap.
  /// </summary>
  private const ulong ForeignClient = 999;

  [Fact]
  public void ParentIdIsTheMembershipArbiter()
  {
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc(
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
    var doc = BuildDoc([], ("a", Block("a", parentId: "not-yet-arrived")));

    Assert.Equal(
        "not-yet-arrived",
        BlockNamed(YDocConverter.Export(doc), "a")["parent"]?.GetValue<string>());
  }

  [Fact]
  public void ADanglingContentIdStaysInContentButNotInTheOrder()
  {
    var doc = BuildDoc(["a"], ("a", Block("a", contentIds: ["missing"])));

    var exported = YDocConverter.Export(doc);

    Assert.Equal(["a"], Ids(exported));
    Assert.Equal(["missing"], Strings(BlockNamed(exported, "a")["content"]));
  }

  [Fact]
  public void NonStringContentEntriesPassThroughVerbatim()
  {
    var doc = new YDoc();

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
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" } }"""));

    var contentIds = Assert.IsType<YArray>(Entry(BlockOf(doc, "a"), "contentIds"));

    Assert.Equal(0, contentIds.Count);
    Assert.Null(BlockNamed(YDocConverter.Export(doc), "a")["content"]);
  }

  [Fact]
  public void SeedWritesTunesWheneverTheKeyIsPresentAndExportOmitsEmptyOnes()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "text": "a" }, "tunes": {} }""",
        """{ "id": "b", "type": "paragraph", "data": { "text": "b" } }"""));

    Assert.IsType<YMap>(Entry(BlockOf(doc, "a"), "tunes"));
    Assert.False(BlockOf(doc, "b").TryGet("tunes", out _));

    var exported = YDocConverter.Export(doc);

    Assert.Null(BlockNamed(exported, "a")["tunes"]);
    Assert.Null(BlockNamed(exported, "b")["tunes"]);
  }

  [Fact]
  public void SeedNormalizesEmptyParagraphDataOnly()
  {
    var doc = new YDoc();

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
    var doc = new YDoc();

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
    // A BigInteger becomes a lib0 BigInt (tag 122), which the JS client reads
    // as a BigInt: `typeof x === 'number'` fails and JSON.stringify throws.
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "paragraph", "data": { "n": 5, "big": 1735689600000, "f": 2.5 }, "lastEditedAt": 1735689600000 }"""));

    var block = BlockOf(doc, "a");
    var data = Assert.IsType<YMap>(Entry(block, "data"));

    Assert.IsType<double>(Entry(data, "n"));
    Assert.IsType<double>(Entry(data, "big"));
    Assert.IsType<double>(Entry(data, "f"));
    Assert.IsType<double>(Entry(block, "lastEditedAt"));
  }

  [Fact]
  public void ExportWritesIntegralNumbersAsIntegersAndReadsBigIntegersToo()
  {
    var doc = BuildDoc(
        ["a"],
        ("a", Table("a", ("whole", 3.0), ("fraction", 2.5))));

    // Only a peer can put one there: the engine's map API refuses a bigint
    // on the write side (Locked Decision 2), so it arrives as an update.
    ApplyForeign(
        doc,
        Keyed(0, DataOf(doc, "a"), "long", new ContentAny([new BigInteger(7)])));

    AssertJson(
        """{"whole":3,"fraction":2.5,"long":7}""",
        BlockNamed(YDocConverter.Export(doc), "a")["data"]);
  }

  [Fact]
  public void TheArrayRuleDecidesBetweenYArraysAndAtomicLeaves()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "a", "type": "widget", "data": { "objects": [{ "k": 1 }], "primitives": [1, 2], "empty": [], "mixed": [1, {}], "grid": [[{ "k": 1 }]] } }"""));

    var data = Assert.IsType<YMap>(Entry(BlockOf(doc, "a"), "data"));

    Assert.IsType<YArray>(Entry(data, "objects"));
    Assert.IsType<AnyArray>(Entry(data, "primitives"));
    Assert.IsType<AnyArray>(Entry(data, "empty"));
    Assert.IsType<AnyArray>(Entry(data, "mixed"));

    var grid = Assert.IsType<YMap>(Entry(data, "grid"));

    Assert.IsType<YMap>(Entry(grid, "__rows"));
    Assert.Equal(1, Assert.IsType<YArray>(Entry(grid, "__rowKeys")).Count);
  }

  [Fact]
  public void GridRowKeysNormalizeFirstWinsDropStraysAppendOrphansSorted()
  {
    var doc = BuildDoc(
        ["t"],
        ("t", Table(
            "t",
            ("content", MapOf(
                ("__rows", MapOf(
                    ("k1", Row("r1")),
                    ("k2", Row("r2")),
                    ("zz", Row("orphan z")),
                    ("aa", Row("orphan a")))),
                ("__rowKeys", ArrayOf("k1", "stray", "k2", "k1")))))));

    AssertJson(
        """[[{"text":"r1"}],[{"text":"r2"}],[{"text":"orphan a"}],[{"text":"orphan z"}]]""",
        BlockNamed(YDocConverter.Export(doc), "t")["data"]?["content"]);
  }

  [Fact]
  public void AMapReadsAsAGridOnlyWithBothContainerKeysInShape()
  {
    var plainKeys = MapOf(
        ("__rows", MapOf(("k1", "row"))),
        ("__rowKeys", PlainArray("k1")));
    var rowsOnly = MapOf(("__rows", MapOf(("k1", "row"))));
    var doc = BuildDoc(
        ["t"],
        ("t", Table("t", ("plainKeys", plainKeys), ("rowsOnly", rowsOnly))));

    var data = BlockNamed(YDocConverter.Export(doc), "t")["data"];

    AssertJson("""{"__rows":{"k1":"row"},"__rowKeys":["k1"]}""", data?["plainKeys"]);
    AssertJson("""{"__rows":{"k1":"row"}}""", data?["rowsOnly"]);
  }

  /// <summary>
  /// LOCKSTEP RULE with the client's toJSON: a block whose id or type is not
  /// a string, or whose data is not a map, is skipped with a warning naming
  /// its map key. The order is derived before any block is read, so the rest
  /// of the document survives — a child of the skipped block included, still
  /// naming it as parent.
  /// </summary>
  [Fact]
  public void ExportSkipsABlockWithoutAStringIdAStringTypeOrAMapDataAndWarns()
  {
    var doc = BuildDoc(
        ["bad-id", "bad-type", "bad-data", "good"],
        ("bad-id", MapOf(
            ("id", 1.0),
            ("type", "paragraph"),
            ("data", MapOf()),
            ("contentIds", ArrayOf("kid")))),
        ("kid", Block("kid", parentId: "bad-id")),
        ("bad-type", MapOf(("id", "bad-type"), ("type", null), ("data", MapOf()))),
        ("bad-data", MapOf(("id", "bad-data"), ("type", "paragraph"), ("data", new AnyObject()))),
        ("good", Block("good")));
    var warnings = new List<string>();

    var exported = YDocConverter.Export(doc, warnings.Add);

    Assert.Equal(["kid", "good"], Ids(exported));
    Assert.Equal("bad-id", BlockNamed(exported, "kid")["parent"]?.GetValue<string>());
    Assert.Collection(
        warnings,
        warning => Assert.Contains("\"bad-id\"", warning, StringComparison.Ordinal),
        warning => Assert.Contains("\"bad-type\"", warning, StringComparison.Ordinal),
        warning => Assert.Contains("\"bad-data\"", warning, StringComparison.Ordinal));
  }

  /// <summary>
  /// A blocks-map entry that is not a map at all — a peer's Y.XmlFragment,
  /// say — is not a block: it is dropped from the order without a warning,
  /// and never reaches the block reader that warns.
  /// </summary>
  [Fact]
  public void ExportDropsANonMapBlocksEntryWithoutWarning()
  {
    var doc = BuildDoc(["frag", "good"], ("good", Block("good")));
    var blockMap = doc.GetMap("blocks");

    doc.Transact(transaction => blockMap.Set(transaction, "frag", new YXmlFragment()));

    var warnings = new List<string>();

    Assert.Equal(["good"], Ids(YDocConverter.Export(doc, warnings.Add)));
    Assert.Empty(warnings);
  }

  [Fact]
  public void SeedSkipsBlocksWithoutAStringId()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": 42, "type": "paragraph", "data": { "text": "skipped" } }""",
        """{ "type": "paragraph", "data": { "text": "skipped too" } }""",
        """{ "id": "kept", "type": "paragraph", "data": { "text": "kept" } }"""));

    Assert.Equal(["kept"], Ids(YDocConverter.Export(doc)));
  }

  [Fact]
  public void SeedReplacesWhateverTheDocHeldBefore()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "old", "type": "paragraph", "data": { "text": "old" } }"""));
    YDocConverter.Seed(doc, Blocks(
        """{ "id": "new", "type": "paragraph", "data": { "text": "new" } }"""));

    Assert.Equal(["new"], Ids(YDocConverter.Export(doc)));
  }

  private static YDoc BuildDoc(
      string[] rootOrder,
      params (string Id, YMap Block)[] blocks)
  {
    var doc = new YDoc();
    var blockMap = doc.GetMap("blocks");
    var root = doc.GetArray("root");

    doc.Transact(transaction =>
    {
      foreach (var (id, block) in blocks)
      {
        blockMap.Set(transaction, id, block);
      }

      if (rootOrder.Length > 0)
      {
        root.Insert(transaction, 0, rootOrder);
      }
    });

    return doc;
  }

  /// <summary>One client's structs, applied as a peer's update would be.</summary>
  private static void ApplyForeign(YDoc doc, params DecodedStruct[] structs)
  {
    var update = new DecodedUpdate(
        new Dictionary<ulong, IReadOnlyList<DecodedStruct>> { [ForeignClient] = structs },
        new DeleteSet());

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
  }

  /// <summary>
  /// A struct writing one key of an already-integrated map. Info carries the
  /// parentSub bit because that is what the wire would set.
  /// </summary>
  private static DecodedStruct Keyed(ulong clock, YAbstractType target, string key, YContent content)
  {
    return new DecodedStruct(
        new YId(ForeignClient, clock),
        content.Length,
        DecodedStructKind.Item,
        null,
        null,
        null,
        target.Item?.Id ??
            throw new InvalidOperationException("the target map is not integrated"),
        key,
        content,
        0x20);
  }

  private static YMap DataOf(YDoc doc, string id)
  {
    return Assert.IsType<YMap>(Entry(BlockOf(doc, id), "data"));
  }

  private static YMap BlockOf(YDoc doc, string id)
  {
    return Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id));
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }

  private static YMap Block(
      string id,
      string? parentId = null,
      string[]? contentIds = null)
  {
    var entries = new List<(string, object?)>
    {
      ("id", id),
      ("type", "paragraph"),
      ("data", MapOf(("text", id))),
      ("contentIds", ArrayOf(contentIds ?? [])),
    };

    if (parentId is not null)
    {
      entries.Add(("parentId", parentId));
    }

    return MapOf([.. entries]);
  }

  /// <summary>A table block whose data holds the given entries.</summary>
  private static YMap Table(string id, params (string Key, object? Value)[] data)
  {
    return MapOf(
        ("id", id),
        ("type", "table"),
        ("data", MapOf(data)),
        ("contentIds", ArrayOf()));
  }

  /// <summary>One grid row holding a single text cell.</summary>
  private static YArray Row(string text)
  {
    return new YArray([MapOf(("text", text))]);
  }

  private static YMap MapOf(params (string Key, object? Value)[] entries)
  {
    return new YMap(entries.Select(
        entry => new KeyValuePair<string, object?>(entry.Key, entry.Value)));
  }

  private static YArray ArrayOf(params string[] items)
  {
    return new YArray(items);
  }

  /// <summary>A plain (non-shared) array, what a bare ymap.set stores.</summary>
  private static AnyArray PlainArray(params string[] items)
  {
    var array = new AnyArray();

    foreach (var item in items)
    {
      array.Add(item);
    }

    return array;
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
