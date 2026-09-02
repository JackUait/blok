using System.Text.Json;
using Blok.Server.Documents;
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
