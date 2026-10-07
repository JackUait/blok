using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Format 2: a rich (type, key) is a formatted Y.XmlText holding segments, and
/// every reader decides by CLASS (contract §2, §9).
/// </summary>
public sealed class YDocConverterRichTextTests
{
  private static readonly JsonSerializerOptions Relaxed = new()
  {
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
  };

  [Fact]
  public void SeedsSegmentsAsFormattedTextAndExportsThemCanonical()
  {
    var doc = Seeded(
        """
        { "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "Hi " },
          { "text": "bold", "marks": { "italic": true, "bold": true } },
          { "embed": { "page": { "id": "p1" } } },
          { "text": "" },
          { "text": "x", "marks": { "link": { "rel": "r", "href": "h" } } }
        ] } }
        """);

    Assert.IsType<YXmlText>(DataValue(doc, "b1", "text"));
    Assert.Equal(
        """[{"text":"Hi "},{"text":"bold","marks":{"bold":true,"italic":true}},{"embed":{"page":{"id":"p1"}}},{"text":"x","marks":{"link":{"href":"h","rel":"r"}}}]""",
        Text(doc, "b1"));
  }

  [Fact]
  public void StoresEachMarkAsItsOwnAttributeWithSortedKeys()
  {
    var doc = Seeded(
        """
        { "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "x", "marks": { "link": { "target": "_blank", "href": "h" }, "bold": true } }
        ] } }
        """);
    var delta = ((YXmlText)DataValue(doc, "b1", "text")!).ToDelta();

    Assert.Single(delta);
    Assert.Equal("""{"bold":true,"link":{"href":"h","target":"_blank"}}""", JsJson.Stringify(delta[0].Attributes));
  }

  [Fact]
  public void MarkupCharactersTypedAsTextStayText()
  {
    var doc = Seeded(
        """{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a < b && \"c\" <b>x</b>" }] } }""");

    Assert.Equal("""[{"text":"a < b && \"c\" <b>x</b>"}]""", Text(doc, "b1"));
  }

  [Fact]
  public void EmptyParagraphDataBecomesAnEmptyFormattedText()
  {
    var doc = Seeded("""{ "id": "b1", "type": "paragraph", "data": {} }""");

    Assert.IsType<YXmlText>(DataValue(doc, "b1", "text"));
    Assert.Equal("[]", Text(doc, "b1"));
  }

  [Fact]
  public void DropsMarkKeysTheClientCannotRender()
  {
    var doc = Seeded(
        """
        { "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "x", "marks": { "bold": true, "glow": true, "tag:bad name": {}, "tag:abbr": { "title": "t" } } }
        ] } }
        """);

    Assert.Equal("""[{"text":"x","marks":{"bold":true,"tag:abbr":{"title":"t"}}}]""", Text(doc, "b1"));
  }

  [Fact]
  public void ReadsAnArrayThatIsNotSegmentsLeniently()
  {
    var doc = Seeded(
        """
        { "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "a", "checked": true }, 5, { "embed": "no" }, { "text": "b", "marks": { "bold": true } }
        ] } }
        """);

    Assert.Equal("""[{"text":"a"},{"text":"b","marks":{"bold":true}}]""", Text(doc, "b1"));
  }

  [Fact]
  public void RefusesHtmlThatNoConverterRead()
  {
    var error = Assert.Throws<InvalidDataException>(() =>
        Seeded("""{ "id": "b1", "type": "paragraph", "data": { "text": "<b>x</b>" } }"""));

    Assert.Contains("HTML", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void ReadsHtmlThroughTheConvertedTable()
  {
    var blocks = Blocks("""{ "id": "b1", "type": "paragraph", "data": { "text": "<b>x</b>" } }""");
    var found = YDocConverter.CollectSeedHtml(blocks, RichTextFields.BuiltIn);

    Assert.Equal([new RichTextHtml("paragraph", "text", "<b>x</b>")], found);

    var doc = new YDoc();

    YDocConverter.Seed(
        doc,
        blocks,
        RichTextInput.Converting(
            RichTextFields.BuiltIn,
            new Dictionary<string, JsonArray>(StringComparer.Ordinal)
            {
              ["<b>x</b>"] = (JsonArray)JsonNode.Parse("""[{"text":"x","marks":{"bold":true}}]""")!,
            }));

    Assert.Equal("""[{"text":"x","marks":{"bold":true}}]""", Text(doc, "b1"));
  }

  [Fact]
  public void AnEmptyHtmlStringNeedsNoConverter()
  {
    var doc = Seeded("""{ "id": "b1", "type": "paragraph", "data": { "text": "" } }""");

    Assert.Equal("[]", Text(doc, "b1"));
  }

  [Fact]
  public void NonRichDiffableKeysKeepPlainText()
  {
    var doc = Seeded(
        """{ "id": "c1", "type": "code", "data": { "code": "a < b", "text": "<b>t</b>" } }""");

    Assert.IsType<YText>(DataValue(doc, "c1", "code"));
    Assert.IsType<YText>(DataValue(doc, "c1", "text"));
    Assert.Equal("<b>t</b>", YDocConverter.Export(doc)[0]!["data"]!["text"]!.GetValue<string>());
  }

  [Fact]
  public void ARichFieldHoldingNeitherStringNorArrayStaysAPlainLeaf()
  {
    var doc = Seeded("""{ "id": "b1", "type": "paragraph", "data": { "text": 5 } }""");

    Assert.Equal(5d, DataValue(doc, "b1", "text"));
    Assert.Equal(5, YDocConverter.Export(doc)[0]!["data"]!["text"]!.GetValue<long>());
  }

  [Fact]
  public void CustomFieldsFromTheOptionsAreRich()
  {
    var fields = RichTextFields.With(new Dictionary<string, IList<string>> { ["callout"] = ["title"] });
    var doc = new YDoc();

    YDocConverter.Seed(
        doc,
        Blocks("""{ "id": "c1", "type": "callout", "data": { "title": [{ "text": "T", "marks": { "bold": true } }] } }"""),
        RichTextInput.Refusing(fields));

    Assert.IsType<YXmlText>(DataValue(doc, "c1", "title"));
    Assert.Equal(
        """[{"text":"T","marks":{"bold":true}}]""",
        YDocConverter.Export(doc, fields, null, out _)[0]!["data"]!["title"]!.ToJsonString());
  }

  /// <summary>
  /// Contract §9: export decides by class, so a server whose field list
  /// lacks a field a client formatted still exports segments, not the bare
  /// characters with the marks thrown away.
  /// </summary>
  [Fact]
  public void FormattedTextUnderAnyKeyExportsAsSegments()
  {
    var fields = RichTextFields.With(new Dictionary<string, IList<string>> { ["callout"] = ["title"] });
    var doc = new YDoc();

    YDocConverter.Seed(
        doc,
        Blocks("""{ "id": "c1", "type": "callout", "data": { "title": [{ "text": "T", "marks": { "bold": true } }] } }"""),
        RichTextInput.Refusing(fields));

    Assert.Equal(
        """[{"text":"T","marks":{"bold":true}}]""",
        YDocConverter.Export(doc)[0]!["data"]!["title"]!.ToJsonString());
  }

  [Fact]
  public void LegacyHtmlTextUnderARichFieldIsHandedOutForConversion()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      var data = new YMap([new KeyValuePair<string, object?>("text", new YText("<b>x</b>"))]);

      doc.GetMap("blocks").Set(transaction, "b1", Block("b1", "paragraph", data));
      doc.GetArray("root").Insert(transaction, 0, ["b1"]);
    });

    var exported = YDocConverter.Export(doc, RichTextFields.BuiltIn, null, out var slots);
    var slot = Assert.Single(slots);

    Assert.Equal(new RichTextHtml("paragraph", "text", "<b>x</b>"), slot.Html);
    Assert.Same(exported[0]!["data"], slot.Target);
    Assert.Equal("text", slot.Key);
    Assert.Throws<InvalidOperationException>(() => YDocConverter.Export(doc));
  }

  [Fact]
  public void LegacyHtmlStringsInsideDatabaseRowDocumentsAreHandedOutToo()
  {
    var doc = Seeded(
        """
        { "id": "r1", "type": "database-row", "data": { "properties": {
          "notes": { "blocks": [
            { "id": "n1", "type": "paragraph", "data": { "text": "<i>n</i>" } },
            { "id": "n2", "type": "code", "data": { "code": "<i>c</i>" } }
          ] },
          "status": "done"
        } } }
        """);

    YDocConverter.Export(doc, RichTextFields.BuiltIn, null, out var slots);

    var slot = Assert.Single(slots);

    Assert.Equal(new RichTextHtml("paragraph", "text", "<i>n</i>"), slot.Html);
    Assert.IsNotType<YXmlText>(DataValue(doc, "r1", "properties"));
  }

  [Fact]
  public void AnUpdateWithUnchangedSegmentsWritesNothing()
  {
    var doc = Seeded(
        """{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a", "marks": { "link": { "href": "h", "rel": "r" } } }] } }""");
    var updates = 0;

    doc.UpdateEmitted += _ => updates++;

    YDocConverter.ApplyOps(doc, Ops(
        """{ "op": "update", "id": "b1", "data": { "text": [{ "marks": { "link": { "rel": "r", "href": "h", "title": "x" } }, "text": "a" }] } }"""));

    Assert.Equal(0, updates);
  }

  [Fact]
  public void AnUpdateEditsTheFormattedTextInPlace()
  {
    var doc = Seeded(
        """{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "hello world" }] } }""");
    var live = DataValue(doc, "b1", "text");

    YDocConverter.ApplyOps(doc, Ops(
        """{ "op": "update", "id": "b1", "data": { "text": [{ "text": "hello " }, { "text": "big", "marks": { "bold": true } }, { "text": " world" }] } }"""));

    Assert.Same(live, DataValue(doc, "b1", "text"));
    Assert.Equal(
        """[{"text":"hello "},{"text":"big","marks":{"bold":true}},{"text":" world"}]""",
        Text(doc, "b1"));
  }

  /// <summary>
  /// Replacing a legacy plain text is a whole-key set, which is
  /// last-writer-wins against a peer typing into the old text at that moment.
  /// It happens once per field, on the first rich write.
  /// </summary>
  [Fact]
  public void AnUpdateReplacesLegacyPlainTextWithFormattedText()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      var data = new YMap([new KeyValuePair<string, object?>("text", new YText("<b>x</b>"))]);

      doc.GetMap("blocks").Set(transaction, "b1", Block("b1", "paragraph", data));
      doc.GetArray("root").Insert(transaction, 0, ["b1"]);
    });

    YDocConverter.ApplyOps(doc, Ops(
        """{ "op": "update", "id": "b1", "data": { "text": [{ "text": "x", "marks": { "bold": true } }] } }"""));

    Assert.IsType<YXmlText>(DataValue(doc, "b1", "text"));
    Assert.Equal("""[{"text":"x","marks":{"bold":true}}]""", Text(doc, "b1"));
  }

  [Fact]
  public void AnUpdateFindsHtmlForTheConverterUsingTheBlocksTypeInTheDoc()
  {
    var doc = Seeded(
        """{ "id": "b1", "type": "paragraph", "data": { "text": [] } }""",
        """{ "id": "c1", "type": "code", "data": { "code": "" } }""");
    var ops = Ops(
        """{ "op": "update", "id": "b1", "data": { "text": "<b>x</b>" } }""",
        """{ "op": "update", "id": "c1", "data": { "code": "<b>y</b>" } }""",
        """{ "op": "insert", "id": "n1", "block": { "type": "header", "data": { "text": "<i>z</i>" } } }""",
        """{ "op": "update", "id": "n1", "data": { "text": "<u>w</u>" } }""");

    Assert.Equal(
        [
          new RichTextHtml("paragraph", "text", "<b>x</b>"),
          new RichTextHtml("header", "text", "<i>z</i>"),
          new RichTextHtml("header", "text", "<u>w</u>"),
        ],
        YDocConverter.CollectOpsHtml(doc, ops, RichTextFields.BuiltIn));
    Assert.Throws<CollabEditException>(() => YDocConverter.ApplyOps(doc, ops));
  }

  [Fact]
  public void SameAsLiveReadsFormattedTextAsSegments()
  {
    var doc = Seeded(
        """{ "id": "x1", "type": "custom", "data": { "nested": { "k": 1 } } }""");

    doc.Transact(transaction =>
    {
      doc.GetMap("blocks").TryGet("x1", out var block);
      ((YMap)block!).TryGet("data", out var value);
      var data = (YMap)value!;
      var rich = new YXmlText();

      rich.Insert(null, 0, "a", new AnyObject());
      data.Set(transaction, "rich", rich);
    });

    var updates = 0;

    doc.UpdateEmitted += _ => updates++;

    YDocConverter.ApplyOps(doc, Ops(
        """{ "op": "update", "id": "x1", "data": { "nested": { "k": 1 }, "rich": [{ "text": "a" }] } }"""));

    Assert.Equal(0, updates);
  }

  /// <summary>
  /// Host data is never trusted: a malformed mark or embed is normalised on
  /// the way in, so no client reading the room later chokes on it.
  /// </summary>
  [Fact]
  public void SeedNormalisesMalformedMarksAndEmbeds()
  {
    var doc = Seeded(
        """
        { "id": "b1", "type": "paragraph", "data": { "text": [
          { "text": "a", "marks": { "tag:b": { "x": 1, "y": "1" }, "color": {}, "background": 5 } },
          { "embed": { "equation": { "expression": 5 } } },
          { "embed": { "equation": null } },
          { "embed": { "page": { "id": {} } } },
          { "embed": { "html": 5 } },
          { "text": "b", "marks": { "tag:i": "str" } }
        ] } }
        """,
        """{ "id": "b2", "type": "paragraph", "data": { "text": [{ "text": "other" }] } }""");

    Assert.Equal("""[{"text":"a","marks":{"tag:b":{"y":"1"}}},{"text":"b"}]""", Text(doc, "b1"));
    Assert.Equal("""[{"text":"other"}]""", Text(doc, "b2"));
  }

  [Fact]
  public void ARestEditNormalisesMalformedMarksAndEmbeds()
  {
    var doc = Seeded("""{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "a" }] } }""");

    YDocConverter.ApplyOps(doc, Ops(
        """
        { "op": "update", "id": "b1", "data": { "text": [
          { "text": "a", "marks": { "tag:b": { "x": null }, "color": [1] } },
          { "embed": { "page": { "id": "p", "extra": "1" } } },
          { "embed": { "equation": { "expression": "e" } } }
        ] } }
        """));

    Assert.Equal(
        """[{"text":"a","marks":{"tag:b":{}}},{"embed":{"equation":{"expression":"e"}}}]""",
        Text(doc, "b1"));
  }

  /// <summary>
  /// A peer writes what it likes into a formatted text. Export reads the
  /// valid segments, and a REST edit of that text plans and applies.
  /// </summary>
  [Fact]
  public void APeersMalformedWriteNeitherBreaksExportNorTheNextEdit()
  {
    var doc = Seeded(
        """{ "id": "b1", "type": "paragraph", "data": { "text": [{ "text": "ab" }] } }""",
        """{ "id": "b2", "type": "paragraph", "data": { "text": [{ "text": "other" }] } }""");

    PoisonFormattedText(doc, "b1");

    Assert.Equal(
        """[{"text":"a"},{"text":"x","marks":{"tag:b":{}}},{"text":"b"}]""",
        Text(doc, "b1"));
    Assert.Equal("""[{"text":"other"}]""", Text(doc, "b2"));

    YDocConverter.ApplyOps(doc, Ops(
        """{ "op": "update", "id": "b1", "data": { "text": [{ "text": "abc" }] } }"""));

    Assert.Equal("""[{"text":"abc"}]""", Text(doc, "b1"));
    Assert.Equal(
        "abc",
        string.Concat(((YXmlText)DataValue(doc, "b1", "text")!).ToDelta().Select(op => op.Insert as string)));
  }

  /// <summary>
  /// Writes, between "a" and "b": a malformed equation embed, an "x" whose
  /// marks are a non-string tag attribute and a non-string color, and a
  /// page embed whose id is not a string.
  /// </summary>
  internal static void PoisonFormattedText(YDoc doc, string blockId)
  {
    var text = (YXmlText)DataValue(doc, blockId, "text")!;
    var marks = new AnyObject();
    var tag = new AnyObject();
    var equation = new AnyObject();
    var badEquation = new AnyObject();
    var page = new AnyObject();
    var badPage = new AnyObject();

    tag.Add("x", 1d);
    marks.Add("color", new AnyObject());
    marks.Add("tag:b", tag);
    equation.Add("expression", 5d);
    badEquation.Add("equation", equation);
    page.Add("id", new AnyObject());
    badPage.Add("page", page);

    doc.Transact(transaction =>
    {
      text.InsertEmbed(transaction, 1, badEquation, new AnyObject());
      text.Insert(transaction, 2, "x", marks);
      text.InsertEmbed(transaction, 3, badPage, new AnyObject());
    });
  }

  private static YMap Block(string id, string type, YMap data)
  {
    return new YMap(
    [
      new KeyValuePair<string, object?>("id", id),
      new KeyValuePair<string, object?>("type", type),
      new KeyValuePair<string, object?>("data", data),
      new KeyValuePair<string, object?>("tunes", new YMap([])),
      new KeyValuePair<string, object?>("contentIds", new YArray([])),
    ]);
  }

  private static JsonArray Blocks(params string[] blocks)
  {
    return new JsonArray(blocks.Select(block => JsonNode.Parse(block)).ToArray());
  }

  private static YDoc Seeded(params string[] blocks)
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, Blocks(blocks));

    return doc;
  }

  private static object? DataValue(YDoc doc, string id, string key)
  {
    doc.GetMap("blocks").TryGet(id, out var block);
    ((YMap)block!).TryGet("data", out var data);
    ((YMap)data!).TryGet(key, out var value);

    return value;
  }

  private static string Text(YDoc doc, string id)
  {
    return YDocConverter.Export(doc)
        .Single(block => block!["id"]!.GetValue<string>() == id)!["data"]!["text"]!
        .ToJsonString(Relaxed);
  }

  private static IReadOnlyList<CollabEditOp> Ops(params string[] ops)
  {
    return CollabEditOps.Parse(
        System.Text.Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", ops)}}] }"""));
  }
}
