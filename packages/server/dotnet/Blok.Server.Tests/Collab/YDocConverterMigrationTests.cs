using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Room format 1 → 2 at the doc level: every top-level rich field still
/// holding HTML (a plain Y.Text, or a string) becomes a formatted Y.XmlText,
/// read by the client's own HTML reader. Inputs are the frozen format-1 rooms
/// the real client wrote (fixtures/collab-format1).
/// </summary>
public sealed class YDocConverterMigrationTests
{
  public static TheoryData<string> Cases()
  {
    return new TheoryData<string>(YDocConverterFixtures.Format1CaseNames());
  }

  /// <summary>Cases copied from fixtures/collab, whose format-2 client wrote canonical.segments.json.</summary>
  public static TheoryData<string> CopiedCases()
  {
    return new TheoryData<string>(YDocConverterFixtures.Format1CaseNames()
        .Where(name => YDocConverterFixtures.CaseNames().Contains(name))
        .Where(name => YDocConverterFixtures.Load(name).CanonicalSegments is not null));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void MigrationKeepsEveryCharacterAndMark(string name)
  {
    var fixture = YDocConverterFixtures.LoadFormat1(name);
    var doc = Format1Room(fixture);

    Migrate(doc, RichTextFields.BuiltIn);

    AssertJsonEqual(RichTextRuntime.WithSegments(fixture.Canonical), RichTextRuntime.Export(doc));
    Assert.Empty(YDocConverter.CollectLegacyRichText(doc, RichTextFields.BuiltIn));
  }

  /// <summary>
  /// The released client (v1.15.2) stored a rich field as a plain string
  /// leaf, not a Y.Text; the fixtures were written by later builds. The
  /// same rooms with every rich text turned into a string must migrate to
  /// the same characters and marks.
  /// </summary>
  [Theory]
  [MemberData(nameof(Cases))]
  public void StringLeafRoomsMigrateToTheSameSegments(string name)
  {
    var fixture = YDocConverterFixtures.LoadFormat1(name);
    var doc = Format1Room(fixture);
    StringLeaves(doc);

    Migrate(doc, RichTextFields.BuiltIn);

    AssertJsonEqual(RichTextRuntime.WithSegments(fixture.Canonical), RichTextRuntime.Export(doc));
    Assert.Empty(YDocConverter.CollectLegacyRichText(doc, RichTextFields.BuiltIn));
  }

  /// <summary>
  /// The released client stripped NUL before storing, but a stored NUL would
  /// otherwise fail the same way on every open. It is dropped, as the client
  /// drops it.
  /// </summary>
  [Fact]
  public void ANulInLegacyHtmlIsDropped()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      doc.GetMap("blocks").Set(transaction, "p", Block("p", "paragraph", "a\0<b>b\0c</b>", null, asString: true));
      doc.GetArray("root").Insert(transaction, 0, ["p"]);
    });

    Assert.Equal("a<b>bc</b>", Assert.Single(YDocConverter.CollectLegacyRichText(doc, RichTextFields.BuiltIn)).Html);
    Assert.Equal(1, Migrate(doc, RichTextFields.BuiltIn));
    Assert.Equal(
        """[{"text":"a"},{"text":"bc","marks":{"bold":true}}]""",
        RichText.ToJson(RichText.FromDelta(((YXmlText)DataValue(doc, "p", "text")!).ToDelta())).ToJsonString());
  }

  /// <summary>
  /// An oracle that is not the server's: the format-2 client seeded the same
  /// input.json and wrote what it reads back.
  /// </summary>
  [Theory]
  [MemberData(nameof(CopiedCases))]
  public void MigrationMatchesWhatTheFormat2ClientWrites(string name)
  {
    var doc = Format1Room(YDocConverterFixtures.LoadFormat1(name));

    Migrate(doc, RichTextFields.BuiltIn);

    AssertJsonEqual(YDocConverterFixtures.Load(name).CanonicalSegments!, RichTextRuntime.Export(doc));
  }

  [Theory]
  [InlineData("rich-block-types")]
  [InlineData("rich-marks")]
  [InlineData("rich-links")]
  [InlineData("rich-embeds")]
  public void EveryMigratedRichFieldIsFormattedText(string name)
  {
    var fixture = YDocConverterFixtures.LoadFormat1(name);
    var doc = Format1Room(fixture);
    var found = YDocConverter.CollectLegacyRichText(doc, RichTextFields.BuiltIn);

    Assert.NotEmpty(found);

    Migrate(doc, RichTextFields.BuiltIn);

    foreach (var block in fixture.Canonical)
    {
      var id = block!["id"]!.GetValue<string>();
      var type = block["type"]!.GetValue<string>();

      if (RichTextFields.BuiltIn.IsRich(type, "text") && block["data"]!["text"] is not null)
      {
        Assert.IsType<YXmlText>(DataValue(doc, id, "text"));
      }
    }
  }

  [Fact]
  public void MigrationIsIdempotent()
  {
    var doc = Format1Room(YDocConverterFixtures.LoadFormat1("rich-marks"));

    Migrate(doc, RichTextFields.BuiltIn);

    var before = doc.EncodeStateVector();
    var updates = 0;
    doc.UpdateEmitted += _ => updates++;

    Assert.Equal(0, Migrate(doc, RichTextFields.BuiltIn));
    Assert.Equal(0, updates);
    Assert.Equal(before, doc.EncodeStateVector());
  }

  [Fact]
  public void MigrationIsOneTransaction()
  {
    var doc = Format1Room(YDocConverterFixtures.LoadFormat1("rich-block-types"));
    var updates = 0;
    doc.UpdateEmitted += _ => updates++;

    Assert.True(Migrate(doc, RichTextFields.BuiltIn) > 1);
    Assert.Equal(1, updates);
  }

  /// <summary>
  /// Not rich: diffable fields, a callout title, an unregistered tool's text,
  /// and a database-row's nested documents (plain JSON, contract §8).
  /// </summary>
  [Fact]
  public void LeavesEveryNonRichFieldAsItWas()
  {
    var fixture = YDocConverterFixtures.LoadFormat1("rich-negatives");
    var doc = Format1Room(fixture);

    Assert.Equal(0, Migrate(doc, RichTextFields.BuiltIn));

    Assert.Equal("<b>not markup</b> &amp; a < b", Assert.IsType<YText>(DataValue(doc, "n-code", "code")).ToString());
    Assert.Equal("a <b>bold</b> caption", Assert.IsType<YText>(DataValue(doc, "n-image", "caption")).ToString());
    Assert.Equal("<b>legacy</b> title", Assert.IsType<YText>(DataValue(doc, "n-callout", "title")).ToString());
    Assert.Equal("<b>custom</b> tool text", Assert.IsType<YText>(DataValue(doc, "n-widget", "text")).ToString());
    AssertJsonEqual(fixture.Canonical, YDocConverter.Export(doc, RichTextFields.BuiltIn, null, out _));
  }

  [Fact]
  public void AHostRichFieldIsMigratedToo()
  {
    var doc = Format1Room(YDocConverterFixtures.LoadFormat1("rich-negatives"));
    var fields = RichTextFields.With([new("widget", ["text"])]);

    Assert.Equal(1, Migrate(doc, fields));

    Assert.IsType<YXmlText>(DataValue(doc, "n-widget", "text"));
    Assert.Equal(
        """[{"text":"custom","marks":{"bold":true}},{"text":" tool text"}]""",
        RichText.ToJson(RichText.FromDelta(((YXmlText)DataValue(doc, "n-widget", "text")!).ToDelta())).ToJsonString());
  }

  /// <summary>
  /// The export skips blocks it cannot reach or read, but they are still in
  /// the doc and a client may still reach them later. A string leaf in a rich
  /// field is legacy HTML as well (the export reads it as such).
  /// </summary>
  [Fact]
  public void MigratesUnreachableBlocksAndStringLeaves()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      var blocks = doc.GetMap("blocks");

      blocks.Set(transaction, "orphan", Block("orphan", "paragraph", "<b>lost</b> child", "nowhere"));
      blocks.Set(transaction, "leaf", Block("leaf", "header", "<i>leaf</i>", null, asString: true));
      doc.GetArray("root").Insert(transaction, 0, ["leaf"]);
    });

    Assert.Equal(2, Migrate(doc, RichTextFields.BuiltIn));

    Assert.IsType<YXmlText>(DataValue(doc, "orphan", "text"));
    Assert.IsType<YXmlText>(DataValue(doc, "leaf", "text"));
  }

  [Fact]
  public void AnUnansweredFieldWritesNothing()
  {
    var doc = Format1Room(YDocConverterFixtures.LoadFormat1("rich-marks"));
    var before = doc.EncodeStateVector();

    Assert.Throws<InvalidDataException>(
        () => YDocConverter.MigrateRichText(doc, RichTextInput.Refusing(RichTextFields.BuiltIn)));

    Assert.Equal(before, doc.EncodeStateVector());
  }

  [Fact]
  public void MarkupTypedAsTextStaysText()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      doc.GetMap("blocks").Set(transaction, "p", Block("p", "paragraph", "a &lt; b &amp;&amp; \"c\"", null));
      doc.GetArray("root").Insert(transaction, 0, ["p"]);
    });

    Migrate(doc, RichTextFields.BuiltIn);

    Assert.Equal(
        """[{"text":"a < b && \"c\""}]""",
        RichText.ToJson(RichText.FromDelta(((YXmlText)DataValue(doc, "p", "text")!).ToDelta())).ToJsonString(
            new System.Text.Json.JsonSerializerOptions
            {
              Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            }));
  }

  private static YDoc Format1Room(YDocConverterFixture fixture)
  {
    var doc = new YDoc();

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(fixture.Update).Outcome);

    return doc;
  }

  /// <summary>Every built-in rich Y.Text becomes the string it holds, as the released client stored it.</summary>
  internal static void StringLeaves(YDoc doc)
  {
    var blocks = doc.GetMap("blocks");

    doc.Transact(transaction =>
    {
      foreach (var id in blocks.Keys.ToArray())
      {
        if (!blocks.TryGet(id, out var block) ||
            block is not YMap entry ||
            !entry.TryGet("type", out var type) ||
            !entry.TryGet("data", out var data) ||
            data is not YMap fields)
        {
          continue;
        }

        foreach (var key in fields.Keys.ToArray())
        {
          if (RichTextFields.BuiltIn.IsRich(type as string, key) &&
              fields.TryGet(key, out var value) &&
              value is YText text)
          {
            fields.Set(transaction, key, text.ToString());
          }
        }
      }
    });
  }

  private static int Migrate(YDoc doc, RichTextFields fields)
  {
    var found = YDocConverter.CollectLegacyRichText(doc, fields);
    var read = found.Count == 0
      ? []
      : RichTextRuntime.Reader.ReadAsync(found).AsTask().GetAwaiter().GetResult();
    var table = new Dictionary<string, JsonArray>(StringComparer.Ordinal);

    for (var index = 0; index < found.Count; index++)
    {
      table[found[index].Html] = read[index];
    }

    return YDocConverter.MigrateRichText(doc, RichTextInput.Converting(fields, table));
  }

  private static YMap Block(string id, string type, string html, string? parentId, bool asString = false)
  {
    var entries = new List<KeyValuePair<string, object?>>
    {
      new("id", id),
      new("type", type),
      new("data", new YMap([new KeyValuePair<string, object?>("text", asString ? html : new YText(html))])),
    };

    if (parentId is not null)
    {
      entries.Add(new("parentId", parentId));
    }

    return new YMap(entries);
  }

  private static object? DataValue(YDoc doc, string id, string key)
  {
    doc.GetMap("blocks").TryGet(id, out var block);
    ((YMap)block!).TryGet("data", out var data);
    ((YMap)data!).TryGet(key, out var value);

    return value;
  }

  private static void AssertJsonEqual(JsonNode expected, JsonNode actual)
  {
    Assert.Equal(
        YDocConverterFixtures.Canonicalize(expected),
        YDocConverterFixtures.Canonicalize(actual));
  }
}
