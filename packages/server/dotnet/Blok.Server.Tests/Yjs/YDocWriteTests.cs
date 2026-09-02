using System.Numerics;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The write API: what the engine authors itself. The oracle is real yjs —
/// every scenario the engine writes into is replayed through node, and every
/// engineWrites step's bytes are compared with the mirror document's inside
/// <see cref="ScenarioRunner"/>.
/// </summary>
public sealed class YDocWriteTests
{
  private const string Astral = "😀";

  private static readonly Dictionary<string, string> MapRoot =
      new(StringComparer.Ordinal) { ["blocks"] = "map" };

  private static readonly Dictionary<string, string> TextRoot =
      new(StringComparer.Ordinal) { ["content"] = "text" };

  private static readonly Dictionary<string, string> EveryRoot =
      new(StringComparer.Ordinal)
      {
        ["blocks"] = "map",
        ["list"] = "array",
        ["content"] = "text",
      };

  /// <summary>
  /// yjs's typeMapSet: every Any value is a length-one ContentAny, and a
  /// Uint8Array is the one map value that is not Any at all.
  /// </summary>
  [Fact]
  public void SetPacksEveryPrimitiveAsAnyOfLengthOne()
  {
    var doc = new YDoc(4242);
    var blocks = doc.GetMap("blocks");
    var nested = new AnyObject();
    var items = new AnyArray();

    nested.Add("a", 1d);
    items.Add("x");

    doc.Transact(transaction =>
    {
      blocks.Set(transaction, "nothing", null);
      blocks.Set(transaction, "flag", true);
      blocks.Set(transaction, "number", 42d);
      blocks.Set(transaction, "text", "v");
      blocks.Set(transaction, "object", nested);
      blocks.Set(transaction, "array", items);
      blocks.Set(transaction, "binary", new byte[] { 1, 2, 3 });
    });

    var structs = doc.Store.Clients[doc.ClientId];

    Assert.Equal(7, structs.Count);

    foreach (var current in structs.Take(6))
    {
      var content = Assert.IsType<ContentAny>(Assert.IsType<YItem>(current).Content);

      Assert.Equal(1, content.Length);
    }

    Assert.IsType<ContentBinary>(Assert.IsType<YItem>(structs[6]).Content);
  }

  /// <summary>yjs's packJsonContent: one item per run of Any values.</summary>
  [Fact]
  public void InsertPacksConsecutiveAnysIntoOneItem()
  {
    var doc = new YDoc(4242);
    var list = doc.GetArray("list");

    doc.Transact(transaction => list.Insert(transaction, 0, ["a", 1d, true, null]));

    var only = Assert.Single(doc.Store.Clients[doc.ClientId]);
    var content = Assert.IsType<ContentAny>(Assert.IsType<YItem>(only).Content);

    Assert.Equal(4, content.Length);
    Assert.Equal(["a", 1d, true, null], list.Enumerate());
  }

  /// <summary>
  /// A shared type cannot ride inside an Any run, so the run before it is
  /// flushed and the run after it starts fresh: three items, not one.
  /// </summary>
  [Fact]
  public void InsertOfATypeFlushesBothSides()
  {
    var doc = new YDoc(4242);
    var list = doc.GetArray("list");

    doc.Transact(transaction => list.Insert(transaction, 0, ["a", new YMap(), "b"]));

    var structs = doc.Store.Clients[doc.ClientId];

    Assert.Equal(3, structs.Count);
    Assert.IsType<ContentAny>(Assert.IsType<YItem>(structs[0]).Content);
    Assert.IsType<ContentType>(Assert.IsType<YItem>(structs[1]).Content);
    Assert.IsType<ContentAny>(Assert.IsType<YItem>(structs[2]).Content);
  }

  /// <summary>
  /// Many writes, one transaction, one update — and a real yjs document fed
  /// only that update renders what the engine renders.
  /// </summary>
  [Fact]
  public void OneTransactionEmitsOneUpdateReadableByYjs()
  {
    var doc = new YDoc(4242);
    var blocks = doc.GetMap("blocks");
    var list = doc.GetArray("list");
    var content = doc.GetText("content");
    var emitted = new List<YUpdateEvent>();

    doc.UpdateEmitted += emitted.Add;

    var written = doc.Transact(transaction =>
    {
      blocks.Set(transaction, "title", "hello");
      list.Insert(transaction, 0, ["a", "b"]);
      content.Insert(transaction, 0, "text");
    });

    var only = Assert.Single(emitted);

    Assert.True(only.Local);
    Assert.Equal(only.Update, written);

    var replay = NodeReplay.Run(EveryRoot, [only.Update], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, EveryRoot)),
        YjsEngineFixtures.Canonicalize(replay.Json));
    Assert.Equal(doc.EncodeStateVector(), replay.StateVector);
  }

  /// <summary>
  /// A write that changes nothing advances no clock and records no deletion,
  /// so there is no update to send.
  /// </summary>
  [Fact]
  public void NoChangeEmitsNothing()
  {
    var doc = new YDoc(4242);
    var blocks = doc.GetMap("blocks");
    var list = doc.GetArray("list");
    var content = doc.GetText("content");
    var emitted = new List<YUpdateEvent>();

    doc.UpdateEmitted += emitted.Add;

    Assert.Null(doc.Transact(_ => { }));
    Assert.Null(doc.Transact(transaction => blocks.Remove(transaction, "absent")));
    Assert.Null(doc.Transact(transaction => blocks.Clear(transaction)));
    Assert.Null(doc.Transact(transaction => list.Insert(transaction, 0, [])));
    Assert.Null(doc.Transact(transaction => list.Delete(transaction, 0, 0)));
    Assert.Null(doc.Transact(transaction => content.Insert(transaction, 0, string.Empty)));
    Assert.Null(doc.Transact(transaction => content.Delete(transaction, 0, 0)));
    Assert.Empty(emitted);
  }

  /// <summary>
  /// A prelim type carries its content until the item that holds it is
  /// integrated, and then writes it top-down inside the same transaction.
  /// </summary>
  [Fact]
  public void PrelimMapIntegratesWithItsParent()
  {
    var doc = new YDoc(4242);
    var blocks = doc.GetMap("blocks");
    var row = new YMap(
    [
      new("title", "first"),
      new("tags", new YArray(["a", "b"])),
    ]);

    Assert.Null(row.Doc);

    var written = doc.Transact(transaction => blocks.Set(transaction, "b1", row));

    Assert.Same(doc, row.Doc);
    Assert.True(blocks.TryGet("b1", out var value));
    Assert.Same(row, value);
    Assert.True(row.TryGet("title", out var title));
    Assert.Equal("first", title);

    var replay = NodeReplay.Run(MapRoot, [written ?? []], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, MapRoot)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  /// <summary>
  /// Deleting the middle of a run splits it at a clean start and a clean end,
  /// so one item becomes three and only the middle one is a tombstone.
  /// </summary>
  [Fact]
  public void DeleteFromArraySplitsARun()
  {
    var doc = new YDoc(4242);
    var list = doc.GetArray("list");

    doc.Transact(transaction => list.Insert(transaction, 0, ["a", "b", "c", "d"]));

    Assert.Single(doc.Store.Clients[doc.ClientId]);

    doc.Transact(transaction => list.Delete(transaction, 1, 2));

    var structs = doc.Store.Clients[doc.ClientId];

    Assert.Equal(3, structs.Count);
    Assert.False(structs[0].IsDeleted);
    Assert.True(structs[1].IsDeleted);
    Assert.False(structs[2].IsDeleted);
    Assert.Equal(["a", "d"], list.Enumerate());
  }

  /// <summary>
  /// yjs's typeListInsertGenericsAfter has no branch for either: undefined is
  /// not a constructor it can switch on, and a bigint falls through to the
  /// "Unexpected content type" throw.
  /// </summary>
  [Fact]
  public void InsertRejectsUndefinedAndBigIntLikeYjs()
  {
    var doc = new YDoc(4242);
    var list = doc.GetArray("list");

    Assert.Throws<ArgumentException>(
        () => doc.Transact(transaction => list.Insert(transaction, 0, [YUndefined.Instance])));
    Assert.Throws<ArgumentException>(
        () => doc.Transact(transaction => list.Insert(transaction, 0, [new BigInteger(1)])));
    Assert.Throws<ArgumentException>(
        () => doc.Transact(transaction =>
            doc.GetMap("blocks").Set(transaction, "big", new BigInteger(1))));
    Assert.Empty(doc.Store.Clients);
  }

  /// <summary>
  /// A map key may hold undefined — yjs's typeMapSet tests <c>value == null</c>
  /// with the loose operator, so undefined lands in a ContentAny beside null.
  /// </summary>
  [Fact]
  public void SetAdmitsUndefined()
  {
    var doc = new YDoc(4242);
    var blocks = doc.GetMap("blocks");
    var written = doc.Transact(
        transaction => blocks.Set(transaction, "undef", YUndefined.Instance));

    Assert.True(blocks.TryGet("undef", out var value));
    Assert.Same(YUndefined.Instance, value);

    var replay = NodeReplay.Run(MapRoot, [written ?? []], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, MapRoot)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  /// <summary>
  /// Locked Decision 2: every JSON number becomes a double, so the Any tag is
  /// chosen by lib0's own rule rather than by the CLR type the JSON parsed to.
  /// </summary>
  [Fact]
  public void JsonNumbersAlwaysLowerToDouble()
  {
    var built = ScenarioSupport.BuildValue(
        JsonNode.Parse("""{"i": 1, "f": 0.5, "wide": 2147483648, "deep": [7]}"""));
    var members = Assert.IsType<AnyObject>(built);

    foreach (var (key, value) in members)
    {
      if (key == "deep")
      {
        Assert.IsType<double>(Assert.Single(Assert.IsType<AnyArray>(value)));

        continue;
      }

      Assert.IsType<double>(value);
    }

    Assert.IsType<double>(ScenarioSupport.BuildValue(JsonNode.Parse("1")));

    var doc = new YDoc(4242);
    var written = doc.Transact(
        transaction => doc.GetMap("blocks").Set(transaction, "numbers", built));
    var replay = NodeReplay.Run(MapRoot, [written ?? []], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, MapRoot)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  /// <summary>
  /// The two scenarios whose engine steps write text. The runner compares the
  /// engine's own bytes with the mirror document's on every engineWrites step,
  /// so a divergence in the insert position fails here first.
  /// </summary>
  [Theory]
  [InlineData("nul-and-astral-strings")]
  [InlineData("text-format-and-embed")]
  public void TextInsertAndDeleteMatchYjs(string name)
  {
    var testCase = ScenarioSupport.Scenarios().Single(candidate => candidate.Name == name);
    var runner = new ScenarioRunner(testCase);

    runner.RunAll();

    Assert.True(runner.Checks > 0, $"\"{name}\" asserted nothing");

    var replay = NodeReplay.Run(testCase.Roots, [runner.Doc.EncodeStateAsUpdate()], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(runner.Doc, testCase.Roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  /// <summary>
  /// Cutting a surrogate pair would make both halves unencodable, so each
  /// half becomes U+FFFD and keeps its code-unit count.
  /// </summary>
  [Fact]
  public void TextSplitsOnSurrogatePairsLikeYjs()
  {
    var doc = new YDoc(4242);
    var content = doc.GetText("content");
    var updates = new List<byte[]>();

    doc.UpdateEmitted += update => updates.Add(update.Update);
    doc.Transact(transaction => content.Insert(transaction, 0, $"a{Astral}b"));
    doc.Transact(transaction => content.Delete(transaction, 1, 1));

    Assert.Equal("a�b", content.ToString());

    var replay = NodeReplay.Run(TextRoot, updates, null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, TextRoot)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  /// <summary>
  /// Insert, insert into the middle, delete the head: three transactions,
  /// three updates, and a yjs document that ends up with the same string.
  /// </summary>
  [Fact]
  public void TextRoundTripsThroughNode()
  {
    var doc = new YDoc(4242);
    var content = doc.GetText("content");
    var updates = new List<byte[]>();

    doc.UpdateEmitted += update => updates.Add(update.Update);
    doc.Transact(transaction => content.Insert(transaction, 0, "hello world"));
    doc.Transact(transaction => content.Insert(transaction, 5, ","));
    doc.Transact(transaction => content.Delete(transaction, 0, 1));

    Assert.Equal("ello, world", content.ToString());
    Assert.Equal(3, updates.Count);

    var replay = NodeReplay.Run(TextRoot, updates, null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, TextRoot)),
        YjsEngineFixtures.Canonicalize(replay.Json));
    Assert.Equal(doc.EncodeStateVector(), replay.StateVector);
  }
}
