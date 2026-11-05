using System.Text.Json;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Documents;

public sealed class BlokDocumentConverterTests
{
  private const string Article = """
      {"blocks":[
        {"id":"h1","type":"header","data":{"text":"Release notes","level":2}},
        {"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b> — see <a href=\"https://x.com\">details</a>."}}
      ]}
      """;

  /// <summary>
  /// A consumer writing documents outside the browser has to stamp the same
  /// <c>version</c> the editor stamps, so it asks the bundle rather than
  /// inventing a number. <c>dev</c> is the fallback the bundle returns when the
  /// build-time define is missing — the whole failure mode this guards.
  /// The exact equality with <c>package.json</c> is pinned on the JavaScript
  /// side, in <c>test/unit/scripts/build-server-runtime.test.ts</c>.
  /// </summary>
  [Fact]
  public async Task ReportsTheEditorsOwnDocumentVersion()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var version = await converter.GetVersionAsync();

    Assert.False(string.IsNullOrWhiteSpace(version));
    Assert.NotEqual("dev", version);
  }

  /// <summary>
  /// `dev` is what the bundle answers when it was built without the VERSION
  /// define. Caching that would stamp it into every document the process writes
  /// for as long as it lives, and nothing downstream could tell it apart from a
  /// real version — so it fails loudly instead, every time it is asked.
  /// </summary>
  [Fact]
  public async Task RefusesToHandOutAVersionTheBundleDoesNotHave()
  {
    var runtime = new FixedRuntime("dev");
    var converter = new BlokDocumentConverter(runtime);

    await Assert.ThrowsAsync<InvalidOperationException>(async () => await converter.GetVersionAsync());
    await Assert.ThrowsAsync<InvalidOperationException>(async () => await converter.GetVersionAsync());
    Assert.Equal(2, runtime.Calls);
  }

  [Fact]
  public async Task AsksTheBundleForItsVersionOnlyOnce()
  {
    var runtime = new FixedRuntime("1.2.3");
    var converter = new BlokDocumentConverter(runtime);

    Assert.Equal("1.2.3", await converter.GetVersionAsync());
    Assert.Equal("1.2.3", await converter.GetVersionAsync());
    Assert.Equal(1, runtime.Calls);
  }

  private sealed class FixedRuntime(string answer) : IBlokRuntime
  {
    public int Calls { get; private set; }

    public ValueTask<string> InvokeAsync(
        string operation,
        string inputJson,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
      Calls++;

      return ValueTask.FromResult(answer);
    }
  }

  /// <summary>
  /// Handed to a model's structured-output setting, or to a validator, by a
  /// caller that has to constrain something to what Blok actually stores. The
  /// alternative is a hand-kept copy, which drifts.
  /// </summary>
  [Fact]
  public async Task DescribesTheSavedFormatAsJsonSchema()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    using var schema = JsonDocument.Parse(await converter.GetSchemaAsync());

    Assert.Equal(
        "https://json-schema.org/draft/2020-12/schema",
        schema.RootElement.GetProperty("$schema").GetString());
    Assert.True(schema.RootElement.GetProperty("$defs").TryGetProperty("paragraph", out _));
  }

  /// <summary>Segments are what the server now writes; HTML is still accepted on input.</summary>
  [Fact]
  public async Task TheSchemaTakesSegmentsOrHtmlInARichTextField()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    using var schema = JsonDocument.Parse(await converter.GetSchemaAsync());
    var text = schema.RootElement
        .GetProperty("$defs").GetProperty("paragraph")
        .GetProperty("properties").GetProperty("text");

    Assert.Equal(
        ["array", "string"],
        text.GetProperty("oneOf").EnumerateArray().Select(shape => shape.GetProperty("type").GetString()));
  }

  /// <summary>
  /// Handing a model a document's JSON makes it break the structure, so a
  /// translator takes the strings out, translates the list, and puts it back.
  /// A URL is not prose and never appears in the list.
  /// </summary>
  [Fact]
  public async Task ExtractsTheStringsWorthTranslating()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var texts = await converter.ExtractTextsAsync("""
        {"blocks":[
          {"id":"h1","type":"header","data":{"text":"Title","level":2}},
          {"id":"i1","type":"image","data":{"url":"https://cdn/x.png","caption":"A cat"}},
          {"id":"c1","type":"code","data":{"code":"var a = 1;"}}
        ]}
        """);

    Assert.Equal(["Title", "A cat"], texts);
  }

  [Fact]
  public async Task IncludesCodeOnlyWhenAsked()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string Document = """{"blocks":[{"id":"c1","type":"code","data":{"code":"var a = 1;"}}]}""";

    Assert.Empty(await converter.ExtractTextsAsync(Document));
    Assert.Equal(["var a = 1;"], await converter.ExtractTextsAsync(Document, includeCode: true));
  }

  /// <summary>
  /// The result of this one is STORED, so a block too malformed to read is
  /// carried through rather than dropped — dropping it would silently delete
  /// part of an article.
  /// </summary>
  [Fact]
  public async Task PutsTranslationsBackWithoutLosingAnythingElse()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var translated = await converter.InjectTextsAsync(
        """{"time":1700000000000,"version":"9.9.9","blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hello"}},7]}""",
        ["Привет"]);

    using var document = JsonDocument.Parse(translated);
    var root = document.RootElement;

    Assert.Equal("9.9.9", root.GetProperty("version").GetString());
    Assert.Equal(1700000000000, root.GetProperty("time").GetInt64());
    Assert.Equal("Привет", root.GetProperty("blocks")[0].GetProperty("data").GetProperty("text").GetString());
    Assert.Equal(7, root.GetProperty("blocks")[1].GetInt32());
  }

  [Fact]
  public async Task RefusesATranslationListThatDoesNotMatchTheDocument()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var failure = await Assert.ThrowsAsync<ArgumentException>(async () =>
        await converter.InjectTextsAsync(
            """{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hello"}}]}""",
            ["Привет", "Лишнее"]));

    Assert.Contains("1", failure.Message, StringComparison.Ordinal);
    Assert.Contains("2", failure.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ConvertsADocumentToMarkdown()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync(Article);

    Assert.Equal(
        "## Release notes\n\nShips **today** — see [details](https://x.com).",
        conversion.Markdown);
    Assert.Empty(conversion.Warnings);
  }

  /// <summary>
  /// The reason the conversion returns a report rather than a bare string: an
  /// MCP or agent client cannot ask a follow-up question about what it lost.
  /// </summary>
  [Fact]
  public async Task ReportsConstructsThatCouldNotSurviveMarkdown()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync("""
        {"blocks":[
          {"id":"c1","type":"callout","data":{"emoji":"💡"}},
          {"id":"p1","type":"paragraph","data":{"text":"Mind the gap"},"parent":"c1"},
          {"id":"s1","type":"spacer","data":{}}
        ]}
        """);

    Assert.Equal("> 💡 Mind the gap", conversion.Markdown);
    Assert.Collection(
        conversion.Warnings,
        warning =>
        {
          Assert.Equal("callout", warning.Construct);
          Assert.Equal("degraded", warning.Action);
          Assert.Contains("blockquote", warning.Detail);
        },
        warning =>
        {
          Assert.Equal("spacer", warning.Construct);
          Assert.Equal("dropped", warning.Action);
        });
  }

  [Fact]
  public async Task RoundTripsMarkdownThroughBlocks()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string markdown = "# Title\n\nA **bold** claim and a `token`.\n\n- one\n- two";

    var import = await converter.FromMarkdownAsync(markdown);
    var conversion = await converter.ToMarkdownAsync(import.DocumentJson);

    Assert.Equal(markdown, conversion.Markdown);
    Assert.Empty(import.Warnings);
  }

  [Fact]
  public async Task ImportsMarkdownAsADocumentEnvelope()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var import = await converter.FromMarkdownAsync("# Hello");

    using var document = JsonDocument.Parse(import.DocumentJson);
    var block = document.RootElement.GetProperty("blocks")[0];
    Assert.Equal("header", block.GetProperty("type").GetString());
    Assert.Equal("""[{"text":"Hello"}]""", block.GetProperty("data").GetProperty("text").GetRawText());

    // The report rides beside the document, never inside what a caller stores.
    Assert.False(document.RootElement.TryGetProperty("warnings", out _));
  }

  /// <summary>
  /// Blok has no raw-HTML block, so markup written into Markdown becomes
  /// literal text. Silent on its own — an MCP client would find its markup
  /// turned into visible characters only by reading the article back.
  /// </summary>
  [Fact]
  public async Task ReportsMarkupMarkdownCouldNotCarryIn()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var import = await converter.FromMarkdownAsync("<div class=\"note\">careful</div>");

    var warning = Assert.Single(import.Warnings);
    Assert.Equal("html", warning.Construct);
    Assert.Equal("degraded", warning.Action);
  }

  /// <summary>
  /// Refusing a script-capable scheme is the sanitizer working; doing it
  /// silently is not. The image leaves nothing behind at all, so a caller
  /// gating on the report would have overwritten an article with one less
  /// picture and been told nothing.
  /// </summary>
  [Fact]
  public async Task ReportsAUrlDroppedForItsScheme()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var import = await converter.FromMarkdownAsync("![evil](javascript:alert(1))");

    var warning = Assert.Single(import.Warnings);
    Assert.Equal("image", warning.Construct);
    Assert.Equal(BlokDegradationActions.Dropped, warning.Action);
    Assert.Contains("javascript:", warning.Detail, StringComparison.Ordinal);
  }

  /// <summary>
  /// A container naming a child the document does not carry loses it. The table
  /// path said so already; the canonical <c>content[]</c> form did not, which is
  /// exactly the shape a truncated document arrives in.
  /// </summary>
  [Fact]
  public async Task ReportsAContentReferenceItCouldNotResolve()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync("""
        {"blocks":[
          {"id":"l1","type":"list","data":{"text":"item","style":"unordered"},"content":["gone"]}
        ]}
        """);

    var warning = Assert.Single(conversion.Warnings);
    Assert.Equal("list", warning.Construct);
    Assert.Equal(BlokDegradationActions.Dropped, warning.Action);
    Assert.Contains("could not be resolved", warning.Detail, StringComparison.Ordinal);
  }

  [Fact]
  public async Task ImportsHtmlAsADocumentEnvelope()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var import = await converter.FromHtmlAsync("<h2>Hello</h2><p>A <b>bold</b> claim.</p>");

    using var document = JsonDocument.Parse(import.DocumentJson);
    var blocks = document.RootElement.GetProperty("blocks");
    Assert.Equal("header", blocks[0].GetProperty("type").GetString());
    Assert.Equal("""[{"text":"Hello"}]""", blocks[0].GetProperty("data").GetProperty("text").GetRawText());
    Assert.Equal(
        """[{"text":"A "},{"text":"bold","marks":{"bold":true}},{"text":" claim."}]""",
        blocks[1].GetProperty("data").GetProperty("text").GetRawText());

    // The report rides beside the document, never inside what a caller stores.
    Assert.False(document.RootElement.TryGetProperty("warnings", out _));
    Assert.Empty(import.Warnings);
  }

  /// <summary>
  /// The whole point of the report: a consumer that stores the result without
  /// reading it would never learn that the embed went missing.
  /// </summary>
  [Fact]
  public async Task ReportsWhatHtmlCouldNotCarryIn()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var import = await converter.FromHtmlAsync("<p>keep</p><iframe src=\"https://x.dev\"></iframe>");

    var warning = Assert.Single(import.Warnings);
    Assert.Equal("iframe", warning.Construct);
    Assert.Equal(BlokDegradationActions.Dropped, warning.Action);
    Assert.Contains("iframe", warning.Detail);
  }

  /// <summary>
  /// The document Blok renders from imported HTML has to be the document the
  /// HTML described — a structural round trip, not just a parse that succeeds.
  /// </summary>
  [Fact]
  public async Task RoundTripsHtmlThroughBlocks()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    // The canonical spelling: an import reads <b> as bold, which renders as <strong>.
    const string html = "<h2>Release notes</h2><p>Ships <strong>today</strong>.</p>";

    var import = await converter.FromHtmlAsync(html);

    Assert.Equal(html, await converter.ToHtmlAsync(import.DocumentJson));
  }

  [Fact]
  public async Task RendersHtmlAndPlainText()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    Assert.Equal("<h2>Release notes</h2><p>Ships <b>today</b> — see <a href=\"https://x.com\">details</a>.</p>",
        await converter.ToHtmlAsync(Article));
    Assert.Equal("Release notes\n\nShips today — see details.",
        await converter.ToPlainTextAsync(Article));
  }

  /// <summary>
  /// JSON.parse keeps the last value of a repeated key, and so does the Go
  /// server. Jint, once the bundle is loaded, kept the first.
  /// </summary>
  [Fact]
  public async Task ReadsTheLastValueOfARepeatedKey()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string repeated = """{"blocks":[{"id":"p","type":"paragraph","type":"header","data":{"text":"a","text":"b","level":2}}]}""";
    const string repeatedRoot = """{"blocks":1,"blocks":[{"id":"p","type":"paragraph","data":{"text":"x"}}]}""";

    Assert.Equal("<h2>b</h2>", await converter.ToHtmlAsync(repeated));
    Assert.Equal("## b", (await converter.ToMarkdownAsync(repeated)).Markdown);
    Assert.Equal("b", await converter.ToPlainTextAsync(repeated));
    Assert.Equal("<p>x</p>", await converter.ToHtmlAsync(repeatedRoot));
    Assert.Equal(
        "y",
        await converter.ToPlainTextAsync("""{"blocks":[],"blocks":[{"id":"p","type":"paragraph","data":{"text":"x","text":"y"}}]}"""));
  }

  /// <summary>
  /// Go's JSON.parse reads a lone-surrogate escape as U+FFFD, so the bare
  /// operations convert such a document. The envelope operations still refuse it.
  /// </summary>
  [Fact]
  public async Task ReadsALoneSurrogateInABareDocumentAsAReplacementCharacter()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string lone = """{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\ud800b"}}]}""";

    Assert.Equal("a�b", (await converter.ToMarkdownAsync(lone)).Markdown);
    Assert.Equal("<p>a�b</p>", await converter.ToHtmlAsync(lone));

    var validation = await converter.ValidateAsync("""{"blocks":[{"type":"\udc00","data":{}}]}""");

    Assert.Null(validation.Failure);
    Assert.Equal(["�"], validation.UnrecognizedBlockTypes);

    var envelope = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await converter.ToPlainTextAsync(lone));

    Assert.Equal(BlokConversionFailure.InvalidDocument, envelope.Reason);
  }

  /// <summary>
  /// The editor builds the outline live and saves only its colours, so the
  /// server has to rebuild it from the headings — and give each heading the id
  /// its link points at.
  /// </summary>
  [Fact]
  public async Task RendersATableOfContentsThatLinksToItsHeadings()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string document = """
        {"blocks":[
          {"id":"toc","type":"table_of_contents","data":{}},
          {"id":"h1","type":"header","data":{"text":"Intro","level":2}},
          {"id":"h2","type":"header","data":{"text":"Details","level":3}}
        ]}
        """;

    Assert.Equal(
        "<nav><ol>"
        + "<li data-depth=\"0\"><a href=\"#h1\">Intro</a></li>"
        + "<li data-depth=\"1\"><a href=\"#h2\">Details</a></li>"
        + "</ol></nav>"
        + "<h2 id=\"h1\">Intro</h2><h3 id=\"h2\">Details</h3>",
        await converter.ToHtmlAsync(document));
  }

  /// <summary>
  /// A consumer stores hand-edited and legacy documents, so one unreadable
  /// block must not cost it the whole article. The skip is reported, not
  /// silent.
  /// </summary>
  [Fact]
  public async Task SkipsAMalformedBlockAndReportsIt()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string document = """
      {"blocks":[
        {"id":"p1","type":"paragraph","data":{"text":"Kept"}},
        7,
        {"id":"p2","data":{"text":"No type"}}
      ]}
      """;

    var conversion = await converter.ToMarkdownAsync(document);

    Assert.Equal("Kept", conversion.Markdown);
    var warning = Assert.Single(conversion.Warnings);
    Assert.Equal("block", warning.Construct);
    Assert.Equal("dropped", warning.Action);
  }

  /// <summary>
  /// One unusable document, one answer, whichever reader was asked for it.
  /// </summary>
  [Theory]
  [InlineData("not json")]
  [InlineData("{\"nope\":1}")]
  public async Task ReportsEveryUnusableDocumentTheSameWay(string document)
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    foreach (var convert in new Func<Task>[]
    {
      () => converter.ToMarkdownAsync(document).AsTask(),
      () => converter.ToHtmlAsync(document).AsTask(),
      () => converter.ToPlainTextAsync(document).AsTask(),
    })
    {
      var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(convert);

      Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
    }
  }

  /// <summary>
  /// Jint's JSON.parse refuses a 65th nested array or object, and the bare
  /// readers hand the document to it as is. The plain-text reader wraps the
  /// document in a request, one level deeper. Go and Rust wrap JSON.parse to
  /// match (documents/runtime-scripts.json).
  /// </summary>
  [Fact]
  public async Task RefusesADocumentNestedPastTheParseDepth()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    static string Nested(int depth) =>
        "{\"blocks\":[],\"deep\":" + new string('[', depth - 1) + new string(']', depth - 1) + "}";

    await converter.ToHtmlAsync(Nested(64));
    await converter.ToMarkdownAsync(Nested(64));
    var wrapped = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await converter.ToPlainTextAsync(Nested(64)));
    Assert.Equal(BlokConversionFailure.InvalidDocument, wrapped.Reason);

    foreach (var convert in new Func<Task>[]
    {
      () => converter.ToHtmlAsync(Nested(65)).AsTask(),
      () => converter.ToMarkdownAsync(Nested(65)).AsTask(),
    })
    {
      var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(convert);
      Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
    }
  }

  /// <summary>
  /// The parity the readers and the translation path did not have: the same
  /// unreadable input arrived as two unrelated types — a JavaScript exception
  /// from the bundle's own parse for one, a <c>JsonException</c> from this
  /// package for the other — so a caller could not write one handler for "they
  /// sent us rubbish".
  ///
  /// <para>Only for input that is not JSON. Well-formed JSON that is not a
  /// document is deliberately NOT a failure here: the extraction tolerates
  /// anything and answers with an empty list, which is what lets a caller run
  /// it over stored documents of every vintage without losing one.</para>
  /// </summary>
  [Fact]
  public async Task ReportsUnreadableInputTheSameWayOnTheTranslationPath()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        () => converter.ExtractTextsAsync("not json").AsTask());

    Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
    Assert.Empty(await converter.ExtractTextsAsync("""{"nope":1}"""));
  }

  /// <summary>
  /// A caller's own cancellation is not a conversion failure, whatever else
  /// this package now wraps: a token it cancelled has to keep arriving as
  /// cancellation or every <c>catch</c> upstream stops working.
  /// </summary>
  [Fact]
  public async Task StillReportsTheCallersOwnCancellationAsCancellation()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    using var cancelled = new CancellationTokenSource();
    await cancelled.CancelAsync();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => converter.ToHtmlAsync(Article, cancelled.Token).AsTask());
  }

  /// <summary>
  /// The two outcomes a report can name, published so a consumer stops
  /// re-declaring them as its own constants and spelling one of them wrong.
  /// <c>Construct</c> stays an open string: a custom tool's name is genuinely
  /// open, and so is the set of Markdown constructs.
  /// </summary>
  [Fact]
  public async Task NamesTheTwoDegradationOutcomesItReports()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync("""
        {"blocks":[
          {"id":"c1","type":"callout","data":{"emoji":"💡"}},
          {"id":"p1","type":"paragraph","data":{"text":"Mind the gap"},"parent":"c1"},
          {"id":"s1","type":"spacer","data":{}}
        ]}
        """);

    Assert.Equal(BlokDegradationActions.Degraded, conversion.Warnings[0].Action);
    Assert.Equal(BlokDegradationActions.Dropped, conversion.Warnings[1].Action);
    Assert.Equal("degraded", BlokDegradationActions.Degraded);
    Assert.Equal("dropped", BlokDegradationActions.Dropped);
  }

  /// <summary>
  /// A search index wants the text a document holds, not the text the editor
  /// paints — an image's alt is an attribute on screen and nowhere in the
  /// reader's output. Off by default: a preview wants what the editor paints.
  /// </summary>
  [Fact]
  public async Task ReadsTheHiddenMediaTextOnlyWhenAsked()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string document = """
        {"blocks":[
          {"id":"i1","type":"image","data":{"url":"https://cdn/x.png","caption":"A cat","alt":"A tabby asleep"}},
          {"id":"b1","type":"bookmark","data":{"title":"Blok","url":"https://blokeditor.com","description":"Block editor"}}
        ]}
        """;

    var painted = await converter.ToPlainTextAsync(document);
    var indexed = await converter.ToPlainTextAsync(document, includeHiddenText: true);

    Assert.DoesNotContain("A tabby asleep", painted, StringComparison.Ordinal);
    Assert.DoesNotContain("Block editor", painted, StringComparison.Ordinal);
    Assert.Contains("A cat", painted, StringComparison.Ordinal);

    Assert.Contains("A cat", indexed, StringComparison.Ordinal);
    Assert.Contains("A tabby asleep", indexed, StringComparison.Ordinal);
    Assert.Contains("Block editor", indexed, StringComparison.Ordinal);
    Assert.Contains("https://blokeditor.com", indexed, StringComparison.Ordinal);
  }
}
