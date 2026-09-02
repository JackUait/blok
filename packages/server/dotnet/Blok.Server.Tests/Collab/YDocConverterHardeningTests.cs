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

  [Fact]
  public void SeedAndExportHandleDataNestedToTheLimit()
  {
    var doc = new YDoc();

    RunOnAOneMegabyteStack(() =>
    {
      YDocConverter.Seed(doc, NestedData(YDocConverter.MaxValueDepth));

      var exported = YDocConverter.Export(doc);

      Assert.Single(exported);
    });
  }

  [Fact]
  public void SeedRejectsDataNestedPastTheLimit()
  {
    var doc = new YDoc();
    var error = Assert.Throws<InvalidDataException>(
        () => YDocConverter.Seed(doc, NestedData(YDocConverter.MaxValueDepth + 1)));

    Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public void ExportRejectsDocDataNestedPastTheLimit()
  {
    var doc = new YDoc();
    var blockMap = doc.GetMap("blocks");
    var rootOrder = doc.GetArray("root");

    static YMap Nested(int depth)
    {
      var current = new YMap([new KeyValuePair<string, object?>("v", 1d)]);

      for (var index = 0; index < depth; index++)
      {
        current = new YMap([new KeyValuePair<string, object?>("a", current)]);
      }

      return current;
    }

    doc.Transact(transaction =>
    {
      blockMap.Set(transaction, "deep", new YMap(
      [
        new KeyValuePair<string, object?>("id", "deep"),
        new KeyValuePair<string, object?>("type", "paragraph"),
        new KeyValuePair<string, object?>("data", Nested(YDocConverter.MaxValueDepth + 5)),
        new KeyValuePair<string, object?>("contentIds", new YArray([])),
      ]));
      rootOrder.Insert(transaction, 0, ["deep"]);
    });

    var error = Assert.Throws<InvalidDataException>(() => YDocConverter.Export(doc));

    Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
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
