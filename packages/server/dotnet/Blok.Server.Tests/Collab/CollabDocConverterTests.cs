using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Documents;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>The adapter between the room and YDocConverter; the converter's own laws live in its conformance tests.</summary>
public sealed class CollabDocConverterTests
{
  private readonly ManualTimeProvider time = new();

  [Fact]
  public async Task SeedsTheBlocksOfAnOutputDataObjectAndExportsThemBackWithATimestamp()
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var document = JsonNode.Parse(
        """{"time":1,"blocks":[{"id":"a","type":"paragraph","data":{"text":"hi <b>you</b>"}}],"version":"1.12.0"}""")!;

    await converter.SeedAsync(doc, document);
    var exported = Assert.IsType<JsonObject>(await converter.ExportAsync(doc));

    Assert.Equal(time.GetUtcNow().ToUnixTimeMilliseconds(), exported["time"]?.GetValue<long>());
    var block = Assert.IsType<JsonObject>(Assert.Single(Assert.IsType<JsonArray>(exported["blocks"])));
    Assert.Equal("a", block["id"]?.GetValue<string>());
    Assert.Equal("paragraph", block["type"]?.GetValue<string>());
    Assert.Equal(
        """[{"text":"hi "},{"text":"you","marks":{"bold":true}}]""",
        block["data"]?["text"]?.ToJsonString());
  }

  /// <summary>
  /// The skip warning is the operator's only sign that a peer put a block
  /// the export cannot read into the room, so it must reach the room's log.
  /// </summary>
  [Fact]
  public async Task ForwardsExportWarningsToTheLog()
  {
    var doc = new YDoc();
    var warnings = new List<string>();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader, log: warnings.Add);
    var blocks = doc.GetMap("blocks");

    doc.Transact(transaction => blocks.Set(transaction, "bad", new YMap(
    [
      new KeyValuePair<string, object?>("id", 1d),
      new KeyValuePair<string, object?>("type", "paragraph"),
      new KeyValuePair<string, object?>("data", new YMap([])),
    ])));

    await converter.ExportAsync(doc);

    Assert.Contains(warnings, warning => warning.Contains("\"bad\"", StringComparison.Ordinal));
  }

  [Theory]
  [InlineData("[]")]
  [InlineData("\"text\"")]
  [InlineData("""{"time":1}""")]
  [InlineData("""{"blocks":{}}""")]
  public async Task RefusesADocumentWithoutABlocksArray(string body)
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);

    await Assert.ThrowsAsync<InvalidDataException>(
        async () => await converter.SeedAsync(doc, JsonNode.Parse(body)!));
  }

  /// <summary>
  /// Review Focus 1: a host that PUTs the same text spelled differently
  /// (<c>&lt;b&gt;</c> for <c>&lt;strong&gt;</c>, an entity, attribute order)
  /// must write nothing, or every respelling is an edit peers echo back.
  /// </summary>
  [Fact]
  public async Task AnEditThatOnlyRespellsTheHtmlWritesNothing()
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);

    await converter.SeedAsync(doc, JsonNode.Parse(
        """{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<strong>x</strong>&nbsp;<a href=\"h\" target=\"_blank\">y</a>"}}]}""")!);

    var updates = 0;

    doc.UpdateEmitted += _ => updates++;

    await converter.ApplyOpsAsync(doc, Ops(
        """{ "op": "update", "id": "a", "data": { "text": "<b>x</b> <a target=\"_blank\" href=\"h\">y</a><br>" } }"""));

    Assert.Equal(0, updates);
  }

  [Fact]
  public async Task AnEditReadsHtmlForTheBlocksTypeInTheDoc()
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);

    await converter.SeedAsync(doc, JsonNode.Parse(
        """{"blocks":[{"id":"a","type":"header","data":{"text":"x","level":2}}]}""")!);
    await converter.ApplyOpsAsync(doc, Ops(
        """{ "op": "update", "id": "a", "data": { "text": "x <i>y</i>", "level": 2 } }"""));

    var exported = await converter.ExportAsync(doc);

    Assert.Equal(
        """[{"text":"x "},{"text":"y","marks":{"italic":true}}]""",
        exported["blocks"]![0]!["data"]!["text"]!.ToJsonString());
  }

  /// <summary>Review Focus 3: HTML that ESCAPES markup characters reads as those characters.</summary>
  [Fact]
  public async Task EscapedMarkupCharactersReadAsText()
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);

    await converter.SeedAsync(doc, JsonNode.Parse(
        """{"blocks":[{"id":"a","type":"paragraph","data":{"text":"a &lt; b &amp;&amp; \"c\" &lt;b&gt;"}}]}""")!);

    var exported = await converter.ExportAsync(doc);

    Assert.Equal(
        "a < b && \"c\" <b>",
        Assert.Single(exported["blocks"]![0]!["data"]!["text"]!.AsArray())!["text"]!.GetValue<string>());
  }

  [Fact]
  public async Task ExportReadsLegacyHtmlTextAsSegments()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      var properties = new YMap(
      [
        new KeyValuePair<string, object?>("notes", new YMap(
        [
          new KeyValuePair<string, object?>("blocks", new YArray(
          [
            new YMap(
            [
              new KeyValuePair<string, object?>("type", "paragraph"),
              new KeyValuePair<string, object?>("data", new YMap(
                  [new KeyValuePair<string, object?>("text", "<i>n</i>")])),
            ]),
          ])),
        ])),
      ]);

      doc.GetMap("blocks").Set(transaction, "a", Block("a", "paragraph",
          new YMap([new KeyValuePair<string, object?>("text", new YText("<b>x</b>"))])));
      doc.GetMap("blocks").Set(transaction, "r", Block("r", "database-row",
          new YMap([new KeyValuePair<string, object?>("properties", properties)])));
      doc.GetArray("root").Insert(transaction, 0, ["a", "r"]);
    });

    var blocks = (JsonArray)(await new CollabDocConverter(time, RichTextRuntime.Reader).ExportAsync(doc))["blocks"]!;

    Assert.Equal("""[{"text":"x","marks":{"bold":true}}]""", blocks[0]!["data"]!["text"]!.ToJsonString());
    Assert.Equal(
        """[{"text":"n","marks":{"italic":true}}]""",
        blocks[1]!["data"]!["properties"]!["notes"]!["blocks"]![0]!["data"]!["text"]!.ToJsonString());
  }

  [Fact]
  public async Task CustomRichFieldsComeFromTheConstructor()
  {
    var doc = new YDoc();
    var fields = RichTextFields.With(new Dictionary<string, IList<string>> { ["callout"] = ["title"] });
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader, fields);

    await converter.SeedAsync(doc, JsonNode.Parse(
        """{"blocks":[{"id":"c","type":"callout","data":{"title":"<u>T</u>"}}]}""")!);

    doc.GetMap("blocks").TryGet("c", out var block);
    ((YMap)block!).TryGet("data", out var data);
    ((YMap)data!).TryGet("title", out var title);

    Assert.IsType<YXmlText>(title);
  }

  /// <summary>
  /// Only a failure a retry can heal is transient: the runtime's timeout or
  /// allocation budget, or a wait for a pooled engine cancelled by someone
  /// other than the caller.
  /// </summary>
  [Theory]
  [InlineData(BlokConversionFailure.TimedOut)]
  [InlineData(BlokConversionFailure.DocumentTooLarge)]
  public async Task AnExportRuntimeLimitIsTransient(BlokConversionFailure reason)
  {
    var failure = new BlokDocumentConversionException(reason, new TimeoutException());
    var converter = new CollabDocConverter(time, new FailingHtmlReader(failure));

    var error = await Assert.ThrowsAsync<CollabTransientException>(
        async () => await converter.ExportAsync(LegacyHtmlDoc()));

    Assert.Same(failure, error.InnerException);
  }

  [Fact]
  public async Task AnEnginePoolWaitCancelledElsewhereIsTransient()
  {
    var converter = new CollabDocConverter(time, new FailingHtmlReader(new OperationCanceledException()));

    await Assert.ThrowsAsync<CollabTransientException>(
        async () => await converter.ExportAsync(LegacyHtmlDoc()));
  }

  /// <summary>These repeat on every attempt, so they are NOT transient.</summary>
  [Theory]
  [InlineData("javascript")]
  [InlineData("unknown")]
  [InlineData("shape")]
  [InlineData("timeout-exception")]
  public async Task AnExportFailureThatRepeatsIsNotTransient(string kind)
  {
    Exception failure = kind switch
    {
      "javascript" => new BlokDocumentConversionException(
          BlokConversionFailure.InvalidDocument, new InvalidOperationException("TypeError")),
      "unknown" => new BlokDocumentConversionException(
          BlokConversionFailure.Unknown, new InvalidOperationException("RangeError")),
      "shape" => new InvalidDataException("collab: the runtime answered htmlFieldsToSegments with the wrong shape."),
      _ => new TimeoutException("not the runtime's own classification"),
    };
    var converter = new CollabDocConverter(time, new FailingHtmlReader(failure));

    var error = await Assert.ThrowsAnyAsync<Exception>(async () => await converter.ExportAsync(LegacyHtmlDoc()));

    Assert.Same(failure, error);
  }

  [Fact]
  public async Task AnExportCancelledByItsTokenStaysACancel()
  {
    var doc = LegacyHtmlDoc();
    using var cancel = new CancellationTokenSource();

    await cancel.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        await new CollabDocConverter(time, new CancellingHtmlReader()).ExportAsync(doc, cancel.Token));
  }

  private static YDoc LegacyHtmlDoc()
  {
    var doc = new YDoc();

    doc.Transact(transaction =>
    {
      doc.GetMap("blocks").Set(transaction, "a", Block("a", "paragraph",
          new YMap([new KeyValuePair<string, object?>("text", new YText("<b>x</b>"))])));
      doc.GetArray("root").Insert(transaction, 0, ["a"]);
    });

    return doc;
  }

  /// <summary>
  /// A seed and a migration each run once per lineage and may read a v1.15.2
  /// field far larger than anything an edit sends, so both get the one-time
  /// budget. On the default a large field would keep the document from ever
  /// opening. Export and edit reads stay on the runtime's default.
  /// </summary>
  [Fact]
  public async Task SeedAndMigrationReadWithTheOneTimeBudget()
  {
    var reader = new RecordingHtmlReader();
    var converter = new CollabDocConverter(time, reader);

    await converter.SeedAsync(new YDoc(), JsonNode.Parse(
        """{"blocks":[{"id":"a","type":"paragraph","data":{"text":"<b>x</b>"}}]}""")!);
    await converter.ExportAsync(LegacyHtmlDoc());
    await converter.ApplyOpsAsync(LegacyHtmlDoc(), CollabEditOps.Parse(
        """{"ops":[{"op":"update","id":"a","data":{"text":"<i>y</i>"}}]}"""u8.ToArray()));
    await converter.MigrateRichTextAsync(LegacyHtmlDoc());

    Assert.Equal(
        [CollabDocConverter.MigrationReadTimeout, null, null, CollabDocConverter.MigrationReadTimeout],
        reader.Timeouts);
    Assert.Equal(TimeSpan.FromSeconds(60), CollabDocConverter.MigrationReadTimeout);
  }

  private sealed class RecordingHtmlReader : IRichTextHtmlReader
  {
    internal List<TimeSpan?> Timeouts { get; } = [];

    public ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
        IReadOnlyList<RichTextHtml> fields,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
      Timeouts.Add(timeout);

      return ValueTask.FromResult<IReadOnlyList<JsonArray>>([.. fields.Select(_ => new JsonArray())]);
    }
  }

  private sealed class CancellingHtmlReader : IRichTextHtmlReader
  {
    public ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
        IReadOnlyList<RichTextHtml> fields,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
      cancellationToken.ThrowIfCancellationRequested();

      throw new InvalidOperationException("the token was not passed through");
    }
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

  private static IReadOnlyList<CollabEditOp> Ops(params string[] ops)
  {
    return CollabEditOps.Parse(
        System.Text.Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", ops)}}] }"""));
  }
}
