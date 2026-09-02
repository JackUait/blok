using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// What the converter must survive when the JSON or the doc is hostile
/// rather than merely malformed: NUL characters, depth that would overflow
/// the stack, and shared types no Blok client writes.
/// </summary>
public sealed class YDocConverterHardeningTests
{
  private const string NUL = "\0";

  /// <summary>The peer that writes shapes the engine's own API cannot.</summary>
  private const ulong ForeignClient = 999;

  /// <summary>
  /// A doc a JS peer can produce: the blocks map carries a key with a NUL.
  /// NUL is ordinary data to the engine, so the update applies and the NUL
  /// reaches the export intact (Locked Decision 9).
  /// </summary>
  [Fact]
  public void HostileNulUpdateExportsTheNulIntact()
  {
    // A doc with one block whose blocks-map key and id are "a\0b", written by
    // yjs (the JS side round-trips NUL happily).
    const string Update =
        "AQfV8oK8AwAnAQZibG9ja3MDYQBiASgA1fKCvAMAAmlkAXcDYQBiKADV8oK8AwAE" +
        "dHlwZQF3CXBhcmFncmFwaCcA1fKCvAMABGRhdGEBJwDV8oK8AwAKY29udGVudElk" +
        "cwAoANXygrwDAwR0ZXh0AXcBeAgBBHJvb3QBdwNhAGIA";

    var doc = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        doc.ApplyUpdate(Convert.FromBase64String(Update)).Outcome);

    var exported = YDocConverter.Export(doc);
    var block = Assert.Single(exported);

    Assert.Equal($"a{NUL}b", block!["id"]!.GetValue<string>());
    Assert.Equal("x", block["data"]!["text"]!.GetValue<string>());
  }

  [Theory]
  [InlineData("id")]
  [InlineData("type")]
  [InlineData("parent")]
  [InlineData("lastEditedBy")]
  public void SeedRejectsANulInABlockStringField(string field)
  {
    var block = new JsonObject
    {
      ["id"] = "n1",
      ["type"] = "paragraph",
      ["data"] = new JsonObject { ["text"] = "x" },
      [field] = $"a{NUL}b",
    };

    AssertSeedRejects(new JsonArray(block));
  }

  [Fact]
  public void SeedRejectsANulInADataKey()
  {
    AssertSeedRejects(Blocks("""
      { "id": "n1", "type": "paragraph", "data": { "k\u0000e": "v" } }
      """));
  }

  [Fact]
  public void SeedRejectsANulInADataValue()
  {
    AssertSeedRejects(Blocks("""
      { "id": "n1", "type": "paragraph", "data": { "text": "a\u0000b" } }
      """));
  }

  [Fact]
  public void SeedRejectsANulNestedDeepInsideData()
  {
    AssertSeedRejects(Blocks("""
      {
        "id": "n1",
        "type": "paragraph",
        "data": { "rows": [[{ "text": "a\u0000b" }]] }
      }
      """));
  }

  [Fact]
  public void SeedRejectsANulInATuneKeyOrValue()
  {
    AssertSeedRejects(Blocks("""
      { "id": "n1", "type": "paragraph", "data": {}, "tunes": { "anchor": "a\u0000b" } }
      """));
    AssertSeedRejects(Blocks("""
      { "id": "n1", "type": "paragraph", "data": {}, "tunes": { "a\u0000b": "x" } }
      """));
  }

  [Fact]
  public void SeedRejectsANulInAContentId()
  {
    AssertSeedRejects(Blocks("""
      { "id": "n1", "type": "paragraph", "data": {}, "content": ["c\u00001"] }
      """));
  }

  /// <summary>
  /// The endpoint contract, unchanged by the engine: a seeded document is one
  /// a consumer PUT, and NUL is refused there rather than silently stored.
  /// </summary>
  [Fact]
  public void SeedNamesTheNulInItsRefusal()
  {
    var error = Assert.Throws<InvalidDataException>(() => YDocConverter.Seed(
        new YDoc(),
        Blocks("""
          { "id": "n1", "type": "paragraph", "data": { "text": "a\u0000b" } }
          """)));

    Assert.Contains("NUL", error.Message, StringComparison.Ordinal);
  }

  /// <summary>
  /// The engine's transaction has no rollback — a throwing body skips the
  /// cleanup that emits, and the writes it already made stay in the store —
  /// so a refused seed must never have opened one.
  /// </summary>
  [Fact]
  public void ARefusedSeedLeavesTheDocAsItWas()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "old", "type": "paragraph", "data": { "text": "old" } }"""));

    Assert.Throws<InvalidDataException>(() => YDocConverter.Seed(doc, Blocks(
        """{ "id": "good", "type": "paragraph", "data": { "text": "good" } }""",
        """{ "id": "bad", "type": "paragraph", "data": { "text": "a\u0000b" } }""")));

    var exported = YDocConverter.Export(doc);

    Assert.Equal("old", Assert.Single(exported)!["id"]!.GetValue<string>());
  }

  /// <summary>
  /// Only NUL is screened — every other control character round-trips, so the
  /// guard must not widen into "reject control characters".
  /// </summary>
  [Fact]
  public void SeedAcceptsEveryOtherControlCharacter()
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(
        """{ "id": "n1", "type": "paragraph", "data": { "text": "a\u0001b\u001Fc\td" } }"""));

    Assert.Equal(
        "a\u0001b\u001Fc\td",
        YDocConverter.Export(doc)[0]!["data"]!["text"]!.GetValue<string>());
  }

  /// <summary>
  /// A parentId chain far past any recursion limit: iterative walks make the
  /// length a memory question, never a stack question.
  /// </summary>
  [Fact]
  public void ExportWalksALongParentChainWithoutRecursing()
  {
    const int Length = 20000;

    var doc = new YDoc();

    YDocConverter.Seed(doc, ParentChain(Length));

    RunOnAOneMegabyteStack(() =>
    {
      var exported = YDocConverter.Export(doc);

      Assert.Equal(Length, exported.Count);
      Assert.Equal("b0", exported[0]!["id"]!.GetValue<string>());
    });
  }

  /// <summary>
  /// The depth accounting both sides share: a value INSIDE data is level 1
  /// and only CONTAINERS are counted, so the scalar inside the deepest
  /// allowed map is read back whole.
  /// </summary>
  [Fact]
  public void SeedAndExportHandleDataNestedToTheLimit()
  {
    var doc = new YDoc();

    RunOnAOneMegabyteStack(() =>
    {
      // data plus MaxValueDepth levels inside it: the deepest record a seed takes.
      YDocConverter.Seed(doc, NestedData(YDocConverter.MaxValueDepth + 1));

      var exported = YDocConverter.Export(doc);

      Assert.Single(exported);

      var deepest = Descend(exported[0]!["data"]!.AsObject(), YDocConverter.MaxValueDepth);

      Assert.Equal(1L, deepest["v"]?.GetValue<long>());
    });
  }

  [Fact]
  public void SeedRejectsDataNestedPastTheLimit()
  {
    var doc = new YDoc();
    var error = Assert.Throws<InvalidDataException>(
        () => YDocConverter.Seed(doc, NestedData(YDocConverter.MaxValueDepth + 2)));

    Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
  }

  /// <summary>
  /// LOCKSTEP RULE with the client: a container nested past the cap exports
  /// as null, and the block — and the document — still export. The map at
  /// level 256 is the last one read; its child container is the null.
  /// </summary>
  [Fact]
  public void ExportWritesNullForADocValueNestedPastTheLimit()
  {
    var doc = new YDoc();

    WriteBlock(doc, "deep", ("data", NestedMaps(YDocConverter.MaxValueDepth + 5)));

    var exported = YDocConverter.Export(doc);

    var last = Descend(exported[0]!["data"]!.AsObject(), YDocConverter.MaxValueDepth);

    Assert.True(last.ContainsKey("a"));
    Assert.Null(last["a"]);
  }

  /// <summary>
  /// The two value kinds no Blok client writes but a peer can. A Uint8Array
  /// is the index-keyed object JSON.stringify writes for one. A subdoc is an
  /// empty object: JSON.stringify of a Y.Doc writes {}, and the guid is not
  /// a value the record ever carried.
  /// </summary>
  [Fact]
  public void ExportRendersPeerMintedBytesAsAnIndexKeyedObjectAndASubdocAsAnEmptyObject()
  {
    var doc = new YDoc();

    WriteBlock(doc, "n1");

    var data = Assert.IsType<YMap>(
        Entry(Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), "n1")), "data"));

    doc.Transact(transaction => data.Set(transaction, "blob", new byte[] { 1, 2, 3 }));
    ApplyForeign(doc, Keyed(0, data, "sub", new ContentDoc("sub-guid", null)));

    var exported = YDocConverter.Export(doc)[0]!["data"]!;

    AssertJson("""{"0":1,"1":2,"2":3}""", exported["blob"]);
    AssertJson("{}", exported["sub"]);
  }

  /// <summary>
  /// A peer's malformed blocks are skipped and named; the rest of the
  /// document exports. Received the way a peer's update is, so the shapes
  /// are the ones that really survive the wire.
  /// </summary>
  [Fact]
  public void ExportSkipsPeerMintedMalformedBlocksAndKeepsTheRest()
  {
    var source = new YDoc();

    WriteBlock(source, "str-data", ("data", "nope"));
    WriteBlock(source, "num-id", ("id", 7d));
    WriteBlock(source, "deep", ("data", NestedMaps(300)));
    WriteBlock(source, "fine");

    var replica = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        replica.ApplyUpdate(source.EncodeStateAsUpdate()).Outcome);

    var warnings = new List<string>();

    var exported = YDocConverter.Export(replica, warnings.Add);

    Assert.Equal(["deep", "fine"], exported.Select(block => block!["id"]!.GetValue<string>()));
    Assert.Collection(
        warnings,
        warning => Assert.Contains("\"str-data\"", warning, StringComparison.Ordinal),
        warning => Assert.Contains("\"num-id\"", warning, StringComparison.Ordinal));
  }

  /// <summary>
  /// yjs's LEGACY JSON content (ref 2) and a Y.Text embed (ref 5) read back as
  /// System.Text.Json nodes, which the value switch had no case for — so one
  /// of them threw out of the export. No Blok client writes either, but a
  /// legacy or non-JS peer does, and the JS client reads them as ordinary
  /// values. The room treats a failed export as retryable, so a single such
  /// value stopped the document from ever being persisted again while edits
  /// went on being accepted and relayed.
  /// </summary>
  [Fact]
  public void ExportReadsWireJsonContentAsAnOrdinaryValue()
  {
    var doc = new YDoc();

    WriteBlock(doc, "n1");

    ApplyForeign(
        doc,
        Keyed(0, DataOf(doc, "n1"), "legacy", new ContentJson(["""{"a":1}"""])),
        Keyed(1, DataOf(doc, "n1"), "embed", new ContentEmbed("""{"kind":"image"}""")));

    var block = Assert.Single(YDocConverter.Export(doc));

    Assert.Equal("""{"a":1}""", block!["data"]!["legacy"]!.ToJsonString());
    Assert.Equal("""{"kind":"image"}""", block["data"]!["embed"]!.ToJsonString());
  }

  /// <summary>
  /// JSON.stringify escapes an unpaired surrogate rather than dropping it, so
  /// a browser can put one on the wire; System.Text.Json parses lazily and
  /// then refuses to materialise it. Left lazy that failure lands in the save
  /// call, outside every guard in the converter, and costs the whole record —
  /// so the value is dropped here instead, as the client drops what it cannot
  /// read.
  /// </summary>
  [Fact]
  public void ExportSkipsAWireJsonValueItCannotMaterialise()
  {
    var doc = new YDoc();

    WriteBlock(doc, "n1");

    ApplyForeign(doc, Keyed(0, DataOf(doc, "n1"), "lone", new ContentEmbed("\"\\ud800\"")));

    var block = Assert.Single(YDocConverter.Export(doc));

    Assert.Equal("n1", block!["data"]!["text"]!.GetValue<string>());
    Assert.False(block["data"]!.AsObject().ContainsKey("lone"));
  }

  /// <summary>
  /// The same agreement at the seam: a payload the decoder accepted has to
  /// survive the export walk, or the record is never written again.
  /// </summary>
  [Fact]
  public void ExportReadsWireJsonNestedDeeperThanTheJsonDefault()
  {
    var doc = new YDoc();
    var deep = new string('[', 100) + "1" + new string(']', 100);

    WriteBlock(doc, "n1");
    ApplyForeign(doc, Keyed(0, DataOf(doc, "n1"), "deep", new ContentEmbed(deep)));

    var block = Assert.Single(YDocConverter.Export(doc));

    Assert.Equal(deep, block!["data"]!["deep"]!.ToJsonString());
  }

  private static YMap DataOf(YDoc doc, string id)
  {
    return Assert.IsType<YMap>(
        Entry(Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id)), "data"));
  }

  /// <summary>
  /// A non-Blok peer inserting a Y.Text must not brick the room forever. The
  /// JS client renders these as their string form, so Y.Text and Y.XmlText
  /// render their text here too. The XML CONTAINERS render "" instead of
  /// their markup (Locked Decision 8): they are placeholders in this engine,
  /// and no Blok client writes one.
  /// </summary>
  [Theory]
  [InlineData("text", "hello world")]
  [InlineData("xmltext", "xml text")]
  [InlineData("xmlelement", "")]
  [InlineData("xmlfragment", "")]
  [InlineData("xmlhook", "")]
  public void ExportReadsAForeignSharedTypeAsItsStringForm(string kind, string expected)
  {
    var doc = new YDoc();
    var blockMap = doc.GetMap("blocks");
    var rootOrder = doc.GetArray("root");

    doc.Transact(transaction =>
    {
      blockMap.Set(transaction, "n1", new YMap(
      [
        new KeyValuePair<string, object?>("id", "n1"),
        new KeyValuePair<string, object?>("type", "paragraph"),
        new KeyValuePair<string, object?>("data", new YMap([])),
        new KeyValuePair<string, object?>("contentIds", new YArray([])),
      ]));
      rootOrder.Insert(transaction, 0, ["n1"]);
    });

    var data = Assert.IsType<YMap>(Entry(Assert.IsType<YMap>(Entry(blockMap, "n1")), "data"));

    if (kind == "xmltext")
    {
      // A Y.XmlText with content: the engine has no write API for one, so it
      // arrives the way it really does, as a peer's update.
      ApplyForeign(
          doc,
          Keyed(0, data, "rich", new ContentType(6, null)),
          Listed(1, new YId(ForeignClient, 0), new ContentString("xml text")));
    }
    else
    {
      doc.Transact(transaction => data.Set(transaction, "rich", ForeignType(kind)));
    }

    var exported = YDocConverter.Export(doc);

    Assert.Equal(expected, exported[0]!["data"]!["rich"]!.GetValue<string>());
  }

  private static YAbstractType ForeignType(string kind)
  {
    return kind switch
    {
      "text" => new YText("hello world"),
      "xmlelement" => new YXmlElement("p"),
      "xmlfragment" => new YXmlFragment(),
      _ => new YXmlHook("h"),
    };
  }

  /// <summary>One client's structs, applied as a peer's update would be.</summary>
  private static void ApplyForeign(YDoc doc, params DecodedStruct[] structs)
  {
    var update = new DecodedUpdate(
        new Dictionary<ulong, IReadOnlyList<DecodedStruct>> { [ForeignClient] = structs },
        new DeleteSet());

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
  }

  /// <summary>A struct writing one key of an already-integrated map.</summary>
  private static DecodedStruct Keyed(
      ulong clock, YAbstractType target, string key, YContent content)
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

  /// <summary>A struct appended to the list of the type at <paramref name="parent"/>.</summary>
  private static DecodedStruct Listed(ulong clock, YId parent, YContent content)
  {
    return new DecodedStruct(
        new YId(ForeignClient, clock),
        content.Length,
        DecodedStructKind.Item,
        null,
        null,
        null,
        parent,
        null,
        content,
        0);
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }

  /// <summary>
  /// A paragraph block in the doc and in the root order; each override
  /// replaces one of its fields, as a peer's write would.
  /// </summary>
  private static void WriteBlock(YDoc doc, string id, params (string Key, object? Value)[] overrides)
  {
    var fields = new List<KeyValuePair<string, object?>>
    {
      new("id", id),
      new("type", "paragraph"),
      new("data", new YMap([new KeyValuePair<string, object?>("text", id)])),
      new("contentIds", new YArray([])),
    };

    // The map constructor overwrites a repeated key in place, so an override
    // keeps the field's original position.
    fields.AddRange(overrides.Select(
        entry => new KeyValuePair<string, object?>(entry.Key, entry.Value)));

    var blockMap = doc.GetMap("blocks");
    var rootOrder = doc.GetArray("root");

    doc.Transact(transaction =>
    {
      blockMap.Set(transaction, id, new YMap(fields));
      rootOrder.Insert(transaction, rootOrder.Count, [id]);
    });
  }

  /// <summary><paramref name="depth"/> nested maps, the innermost holding v: 1.</summary>
  private static YMap NestedMaps(int depth)
  {
    var current = new YMap([new KeyValuePair<string, object?>("v", 1d)]);

    for (var index = 1; index < depth; index++)
    {
      current = new YMap([new KeyValuePair<string, object?>("a", current)]);
    }

    return current;
  }

  /// <summary>Follows key "a" <paramref name="steps"/> times.</summary>
  private static JsonObject Descend(JsonObject node, int steps)
  {
    for (var index = 0; index < steps; index++)
    {
      node = node["a"]!.AsObject();
    }

    return node;
  }

  private static void AssertJson(string expected, JsonNode? actual)
  {
    Assert.Equal(
        YDocConverterFixtures.Canonicalize(JsonNode.Parse(expected)),
        YDocConverterFixtures.Canonicalize(actual));
  }

  private static void AssertSeedRejects(JsonArray blocks)
  {
    var doc = new YDoc();

    Assert.Throws<InvalidDataException>(() => YDocConverter.Seed(doc, blocks));
  }

  private static JsonArray Blocks(params string[] blockJson)
  {
    return new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray());
  }

  private static JsonArray ParentChain(int length)
  {
    var blocks = new JsonArray();

    for (var index = 0; index < length; index++)
    {
      var block = new JsonObject
      {
        ["id"] = $"b{index}",
        ["type"] = "paragraph",
        ["data"] = new JsonObject { ["text"] = "x" },
      };

      if (index > 0)
      {
        block["parent"] = $"b{index - 1}";
      }

      if (index < length - 1)
      {
        block["content"] = new JsonArray($"b{index + 1}");
      }

      blocks.Add(block);
    }

    return blocks;
  }

  /// <summary>Data nested to exactly <paramref name="depth"/> containers.</summary>
  private static JsonArray NestedData(int depth)
  {
    JsonNode current = new JsonObject { ["v"] = 1 };

    for (var index = 1; index < depth; index++)
    {
      current = new JsonObject { ["a"] = current };
    }

    return new JsonArray(new JsonObject
    {
      ["id"] = "deep",
      ["type"] = "paragraph",
      ["data"] = current,
    });
  }

  /// <summary>
  /// The stack a Linux thread-pool thread gets — the one the server actually
  /// runs these walks on, and a quarter of the test host's main stack.
  /// </summary>
  private static void RunOnAOneMegabyteStack(Action work)
  {
    Exception? failure = null;
    var thread = new Thread(
        () =>
        {
          try
          {
            work();
          }
          catch (Exception error)
          {
            failure = error;
          }
        },
        1024 * 1024);

    thread.Start();
    thread.Join();

    if (failure is not null)
    {
      throw new InvalidOperationException("the walk failed on a 1 MiB stack", failure);
    }
  }
}
