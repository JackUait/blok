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
          Assert.Equal("callout", warning.Block);
          Assert.Equal("degraded", warning.Action);
          Assert.Contains("blockquote", warning.Detail);
        },
        warning =>
        {
          Assert.Equal("spacer", warning.Block);
          Assert.Equal("dropped", warning.Action);
        });
  }

  [Fact]
  public async Task RoundTripsMarkdownThroughBlocks()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string markdown = "# Title\n\nA **bold** claim and a `token`.\n\n- one\n- two";

    var blocksJson = await converter.FromMarkdownAsync(markdown);
    var conversion = await converter.ToMarkdownAsync(blocksJson);

    Assert.Equal(markdown, conversion.Markdown);
  }

  [Fact]
  public async Task ImportsMarkdownAsADocumentEnvelope()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var blocksJson = await converter.FromMarkdownAsync("# Hello");

    using var document = JsonDocument.Parse(blocksJson);
    var block = document.RootElement.GetProperty("blocks")[0];
    Assert.Equal("header", block.GetProperty("type").GetString());
    Assert.Equal("Hello", block.GetProperty("data").GetProperty("text").GetString());
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

  [Fact]
  public async Task RejectsMalformedInput()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    await Assert.ThrowsAnyAsync<Exception>(() => converter.ToMarkdownAsync("not json").AsTask());
  }
}
