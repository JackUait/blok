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
    Assert.Equal("Hello", block.GetProperty("data").GetProperty("text").GetString());

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

  [Fact]
  public async Task RejectsMalformedInput()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    await Assert.ThrowsAnyAsync<Exception>(() => converter.ToMarkdownAsync("not json").AsTask());
  }
}
