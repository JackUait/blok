using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;
using YDotNet.Document.Cells;
using YDotNet.Document.Transactions;
using JsonArray = System.Text.Json.Nodes.JsonArray;
using JsonObject = System.Text.Json.Nodes.JsonObject;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// What the converter must survive when the JSON or the doc is hostile
/// rather than merely malformed: NUL characters (which abort the process on
/// read — see the YDocConverter header), depth that would overflow the
/// stack, and shared types no Blok client writes.
/// </summary>
public sealed class YDocConverterHardeningTests
{
  private const string NUL = "\0";

  /// <summary>
  /// A doc a JS peer can produce and this process CANNOT read: the blocks map
  /// carries a key with a NUL, and yffi's <c>YMapEntry::new</c> unwraps a
  /// <c>CString::new</c> over it. Skipped forever — running it aborts the
  /// whole test host, taking every other test with it. It exists so the
  /// hazard stays visible and reproducible.
  ///
  /// Reproduce by hand:
  ///   dotnet test --filter FullyQualifiedName~HostileNulUpdateAbortsTheProcess
  /// after deleting the Skip. Expect SIGABRT (exit 134) and
  ///   panicked at yffi/src/lib.rs:216:36:
  ///   called `Result::unwrap()` on an `Err` value: NulError(1, [97, 0, 98])
  /// </summary>
  [Fact(Skip = "Aborts the process: reading a NUL key panics inside yrs. See the doc comment.")]
  public void HostileNulUpdateAbortsTheProcess()
  {
    // A doc with one block whose blocks-map key and id are "a\0b", written by
    // yjs (the JS side round-trips NUL happily).
    const string Update =
        "AQfV8oK8AwAnAQZibG9ja3MDYQBiASgA1fKCvAMAAmlkAXcDYQBiKADV8oK8AwAE" +
        "dHlwZQF3CXBhcmFncmFwaCcA1fKCvAMABGRhdGEBJwDV8oK8AwAKY29udGVudElk" +
        "cwAoANXygrwDAwR0ZXh0AXcBeAgBBHJvb3QBdwNhAGIA";

    using var doc = new Doc();

    using (var transaction = doc.WriteTransaction())
    {
      // ApplyV1 itself succeeds — nothing decodes the strings yet.
      Assert.Equal(TransactionUpdateResult.Ok, transaction.ApplyV1(Convert.FromBase64String(Update)));
    }

    // This line never returns. It aborts.
    YDocConverter.Export(doc);
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
  /// Truncation is what makes this a data-loss bug rather than a nuisance:
  /// yffi cuts every string at the first NUL, so without the guard the
  /// server would PUT a silently shortened record back to the consumer.
  /// </summary>
  [Fact]
  public void SeedWouldOtherwiseTruncateAtTheFirstNul()
  {
    var error = Assert.Throws<InvalidDataException>(() => YDocConverter.Seed(
        new Doc(),
        Blocks("""
          { "id": "n1", "type": "paragraph", "data": { "text": "a\u0000b" } }
          """)));

    Assert.Contains("NUL", error.Message, StringComparison.Ordinal);
  }

  /// <summary>
  /// Only NUL is fatal — every other control character round-trips, so the
  /// guard must not widen into "reject control characters".
  /// </summary>
  [Fact]
  public void SeedAcceptsEveryOtherControlCharacter()
  {
    using var doc = new Doc();

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

    using var doc = new Doc();

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
    using var doc = new Doc();

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
    using var doc = new Doc();
    var error = Assert.Throws<InvalidDataException>(
        () => YDocConverter.Seed(doc, NestedData(YDocConverter.MaxValueDepth + 1)));

    Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
  }

  [Fact]
  public void ExportRejectsDocDataNestedPastTheLimit()
  {
    using var doc = new Doc();
    var blockMap = doc.Map("blocks");
    var rootOrder = doc.Array("root");
    var inputs = new List<Input>();

    Input Nested(int depth)
    {
      var current = Track(Input.Map(new Dictionary<string, Input>(StringComparer.Ordinal)
      {
        ["v"] = Track(Input.Double(1)),
      }));

      for (var index = 0; index < depth; index++)
      {
        current = Track(Input.Map(new Dictionary<string, Input>(StringComparer.Ordinal)
        {
          ["a"] = current,
        }));
      }

      return current;
    }

    Input Track(Input input)
    {
      inputs.Add(input);

      return input;
    }

    try
    {
      using (var transaction = doc.WriteTransaction())
      {
        blockMap.Insert(transaction, "deep", Track(Input.Map(
            new Dictionary<string, Input>(StringComparer.Ordinal)
            {
              ["id"] = Track(Input.String("deep")),
              ["type"] = Track(Input.String("paragraph")),
              ["data"] = Nested(YDocConverter.MaxValueDepth + 5),
              ["contentIds"] = Track(Input.Array([])),
            })));
        rootOrder.InsertRange(transaction, 0, [Track(Input.String("deep"))]);
      }
    }
    finally
    {
      foreach (var input in inputs)
      {
        input.Dispose();
      }
    }

    var error = Assert.Throws<InvalidDataException>(() => YDocConverter.Export(doc));

    Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
  }

  /// <summary>
  /// A non-Blok peer inserting a Y.Text must not brick the room forever. The
  /// JS client renders these as their string form (Y.Text and Y.XmlText: the
  /// text; Y.XmlElement: its XML), so the converter does too.
  /// </summary>
  [Theory]
  [InlineData("text")]
  [InlineData("xmltext")]
  [InlineData("xmlelement")]
  public void ExportReadsAForeignSharedTypeAsItsStringForm(string kind)
  {
    using var doc = new Doc();
    var blockMap = doc.Map("blocks");
    var rootOrder = doc.Array("root");
    var expected = kind switch
    {
      "text" => "hello world",
      "xmltext" => "xml text",
      _ => "<p></p>",
    };

    using (var id = Input.String("n1"))
    using (var type = Input.String("paragraph"))
    using (var rich = ForeignInput(kind))
    using (var data = Input.Map(new Dictionary<string, Input>(StringComparer.Ordinal)
    {
      ["rich"] = rich,
    }))
    using (var contentIds = Input.Array([]))
    using (var block = Input.Map(new Dictionary<string, Input>(StringComparer.Ordinal)
    {
      ["id"] = id,
      ["type"] = type,
      ["data"] = data,
      ["contentIds"] = contentIds,
    }))
    using (var orderEntry = Input.String("n1"))
    using (var transaction = doc.WriteTransaction())
    {
      blockMap.Insert(transaction, "n1", block);
      rootOrder.InsertRange(transaction, 0, [orderEntry]);
    }

    var exported = YDocConverter.Export(doc);

    Assert.Equal(expected, exported[0]!["data"]!["rich"]!.GetValue<string>());
  }

  private static Input ForeignInput(string kind)
  {
    return kind switch
    {
      "text" => Input.Text("hello world"),
      "xmltext" => Input.XmlText("xml text"),
      _ => Input.XmlElement("p"),
    };
  }

  private static void AssertSeedRejects(JsonArray blocks)
  {
    using var doc = new Doc();

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
