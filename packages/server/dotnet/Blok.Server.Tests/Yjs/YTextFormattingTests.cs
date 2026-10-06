using System.Numerics;
using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The formatted-text write API, its JSON writer and its delta reader. Byte
/// parity with yjs lives in the formatted-text-* scenarios
/// (<see cref="YDocWriteTests.TextWritesMatchYjs"/>); these pin the pieces
/// and the C# → yjs direction of ToDelta.
/// </summary>
public sealed class YTextFormattingTests
{
  private static readonly Dictionary<string, string> EveryRoot =
      new(StringComparer.Ordinal) { ["content"] = "text", ["blocks"] = "map" };

  /// <summary>Expected strings are node's JSON.stringify output.</summary>
  [Theory]
  [InlineData(1e21, "1e+21")]
  [InlineData(1e-7, "1e-7")]
  [InlineData(123e-20, "1.23e-18")]
  [InlineData(0.1, "0.1")]
  [InlineData(-0d, "0")]
  [InlineData(1.5, "1.5")]
  [InlineData(100d, "100")]
  [InlineData(1e20, "100000000000000000000")]
  [InlineData(123456789012345680000d, "123456789012345680000")]
  [InlineData(5e-324, "5e-324")]
  [InlineData(1.7976931348623157e308, "1.7976931348623157e+308")]
  [InlineData(0.000001, "0.000001")]
  [InlineData(-1e-7, "-1e-7")]
  [InlineData(9007199254740992d, "9007199254740992")]
  [InlineData(0.30000000000000004, "0.30000000000000004")]
  [InlineData(4.35, "4.35")]
  [InlineData(1e15, "1000000000000000")]
  [InlineData(12345600d, "12345600")]
  [InlineData(double.NaN, "null")]
  [InlineData(double.PositiveInfinity, "null")]
  public void StringifyWritesNumbersLikeJavaScript(double value, string expected)
  {
    Assert.Equal(expected, JsJson.Stringify(value));
  }

  /// <summary>
  /// JS objects list array-index keys first, ascending, then the rest in
  /// insertion order. "01", "-1" and 2^32-1 are not array indexes.
  /// </summary>
  [Fact]
  public void StringifyOrdersKeysLikeJavaScript()
  {
    var value = new AnyObject();

    value.Add("b", 1d);
    value.Add("10", 2d);
    value.Add("a", 3d);
    value.Add("2", 4d);
    value.Add("01", 5d);
    value.Add("4294967294", 6d);
    value.Add("4294967295", 7d);
    value.Add("-1", 8d);

    Assert.Equal(
        "{\"2\":4,\"10\":2,\"4294967294\":6,\"b\":1,\"a\":3,\"01\":5,\"4294967295\":7,\"-1\":8}",
        JsJson.Stringify(value));
  }

  [Fact]
  public void StringifyEscapesStringsLikeJavaScript()
  {
    var value = new AnyArray();

    value.Add("\ud800x");
    value.Add("\udc00");
    value.Add("😀");
    value.Add("\u0000\u001f\u007f\b\f\n\r\t\"\\/<>&\u2028");

    Assert.Equal(
        "[\"\\ud800x\",\"\\udc00\",\"😀\",\"\\u0000\\u001f\u007f\\b\\f\\n\\r\\t\\\"\\\\/<>&\u2028\"]",
        JsJson.Stringify(value));
  }

  /// <summary>JSON.stringify drops an undefined member and writes null for one in an array.</summary>
  [Fact]
  public void StringifyTreatsUndefinedAndNonFiniteLikeJavaScript()
  {
    var list = new AnyArray();
    var value = new AnyObject();

    list.Add(YUndefined.Instance);
    list.Add(double.NaN);
    value.Add("u", YUndefined.Instance);
    value.Add("n", double.NaN);
    value.Add("i", double.PositiveInfinity);
    value.Add("a", list);

    Assert.Equal("{\"n\":null,\"i\":null,\"a\":[null,null]}", JsJson.Stringify(value));
  }

  /// <summary>Values JSON.stringify cannot write the way yjs reads them back.</summary>
  [Fact]
  public void StringifyRefusesValuesWithNoJsonForm()
  {
    Assert.Throws<ArgumentException>(() => JsJson.Stringify(YUndefined.Instance));
    Assert.Throws<ArgumentException>(() => JsJson.Stringify(new BigInteger(1)));
    Assert.Throws<ArgumentException>(() => JsJson.Stringify(new byte[] { 1 }));
  }

  /// <summary>JSON.parse: numbers are doubles, a repeated key keeps its first place and last value.</summary>
  [Fact]
  public void ParseReadsJsonLikeJavaScript()
  {
    var parsed = Assert.IsType<AnyObject>(
        JsJson.Parse("{\"b\":1,\"a\":[true,null,\"\\ud800\",2.5e3],\"b\":{\"x\":\"y\"}}"));

    Assert.Equal("{\"b\":{\"x\":\"y\"},\"a\":[true,null,\"\\ud800\",2500]}", JsJson.Stringify(parsed));
    Assert.IsType<double>(JsJson.Parse("7"));
    Assert.Equal(double.PositiveInfinity, JsJson.Parse("1e400"));
  }

  /// <summary>
  /// The C# → yjs direction: every write, one transaction each, replayed by
  /// real yjs. The production ToDelta must read what yjs reads.
  /// </summary>
  [Fact]
  public void FormattedWritesReadBackInYjs()
  {
    var doc = new YDoc(4242);
    var content = doc.GetText("content");
    var blocks = doc.GetMap("blocks");
    var updates = new List<byte[]>();

    doc.UpdateEmitted += update => updates.Add(update.Update);
    doc.Transact(transaction => blocks.Set(transaction, "b1", new YXmlText()));

    blocks.TryGet("b1", out var nested);

    var rich = Assert.IsType<YXmlText>(nested);

    foreach (var text in new YTextBase[] { content, rich })
    {
      doc.Transact(transaction => text.Insert(transaction, 0, "Hello world", Attrs()));
      doc.Transact(transaction => text.Format(transaction, 0, 5, Attrs(("bold", true))));
      doc.Transact(transaction => text.Format(transaction, 6, 5, Attrs(("link", Link("h", "r")))));
      doc.Transact(transaction => text.Format(transaction, 1, 2, Attrs(("bold", null))));
      doc.Transact(transaction => text.InsertEmbed(
          transaction, 5, Attrs(("equation", Attrs(("expression", "x")))), Attrs(("italic", true))));
      doc.Transact(transaction => text.Insert(transaction, 12, "!"));
      doc.Transact(transaction => text.Delete(transaction, 3, 4));
    }

    var replay = NodeReplay.Run(EveryRoot, updates, null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(replay.Json),
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, EveryRoot)));
    Assert.Equal(
        YjsEngineFixtures.Canonicalize(replay.Json["content"]?["$text"]),
        YjsEngineFixtures.Canonicalize(DeltaJson(content.ToDelta())));
    Assert.Equal(
        YjsEngineFixtures.Canonicalize(replay.Json["blocks"]?["b1"]?["$text"]),
        YjsEngineFixtures.Canonicalize(DeltaJson(rich.ToDelta())));
    Assert.Equal(doc.EncodeStateVector(), replay.StateVector);
  }

  /// <summary>ToDelta over marks and an embed a PEER wrote, read off the wire.</summary>
  [Fact]
  public void ToDeltaReadsAPeersFormatsAndEmbeds()
  {
    var testCase = ScenarioSupport.Scenarios().Single(
        candidate => candidate.Name == "text-format-and-embed");
    var runner = new ScenarioRunner(testCase);

    runner.RunAll();

    var expected = testCase.Steps.Last(step => step.Expect?.Json is not null).Expect?.Json;

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(expected?["content"]?["$text"]),
        YjsEngineFixtures.Canonicalize(DeltaJson(runner.Doc.GetText("content").ToDelta())));
  }

  [Fact]
  public void AttachedTextNeedsATransaction()
  {
    var doc = new YDoc(4242);

    Assert.Throws<ArgumentNullException>(() => doc.GetText("content").Insert(null, 0, "a"));
  }

  [Fact]
  public void UndefinedAttributeIsRefused()
  {
    var doc = new YDoc(4242);
    var content = doc.GetText("content");

    Assert.Throws<ArgumentException>(() => doc.Transact(
        transaction => content.Insert(transaction, 0, "a", Attrs(("bold", YUndefined.Instance)))));
  }

  private static AnyObject Attrs(params (string Key, object? Value)[] entries)
  {
    var attributes = new AnyObject();

    foreach (var (key, value) in entries)
    {
      attributes.Add(key, value);
    }

    return attributes;
  }

  private static AnyObject Link(string href, string rel)
  {
    return Attrs(("href", href), ("rel", rel));
  }

  private static JsonArray DeltaJson(IReadOnlyList<YTextDelta> delta)
  {
    var rendered = new JsonArray();

    foreach (var operation in delta)
    {
      var entry = new JsonObject
      {
        ["insert"] = operation.Insert is string text
            ? JsonValue.Create(text)
            : JsonNode.Parse(JsJson.Stringify(operation.Insert)),
      };

      if (operation.Attributes is { } attributes)
      {
        entry["attributes"] = JsonNode.Parse(JsJson.Stringify(attributes));
      }

      rendered.Add(entry);
    }

    return rendered;
  }
}
