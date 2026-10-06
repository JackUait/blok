using System.Text.Json;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Tabs run through the embedded runtime, not a C# port, so these pin what a
/// .NET host gets from each converter method for a tabs document.
/// </summary>
public sealed class BlokTabsDocumentTests
{
  private const string Tabs = """
      {"blocks":[
        {"id":"tabs","type":"tabs","data":{},"content":["t1","t2","t3"]},
        {"id":"t1","type":"tab","data":{"title":"Fruit & <Veg>","icon":"🍎"},"parent":"tabs","content":["p1","pg"]},
        {"id":"p1","type":"paragraph","data":{"text":"Body <b>one</b>"},"parent":"t1"},
        {"id":"pg","type":"page","data":{"pageId":"page-1"},"parent":"t1"},
        {"id":"t2","type":"tab","data":{"title":""},"parent":"tabs","content":["p2"]},
        {"id":"p2","type":"paragraph","data":{"text":"Body two"},"parent":"t2"},
        {"id":"t3","type":"tab","data":{"title":"Empty"},"parent":"tabs"}
      ]}
      """;

  private const string TextTabs = """
      {"blocks":[
        {"id":"tabs","type":"tabs","data":{},"content":["t1","t2"]},
        {"id":"t1","type":"tab","data":{"title":"Fruit & <Veg>","icon":"🍎"},"parent":"tabs","content":["p1"]},
        {"id":"p1","type":"paragraph","data":{"text":"Body <b>one</b>"},"parent":"t1"},
        {"id":"t2","type":"tab","data":{"title":"Empty"},"parent":"tabs"}
      ]}
      """;

  /// <summary>A static page cannot switch tabs, so every tab renders in order.</summary>
  [Fact]
  public async Task RendersEveryTabInOrderWithItsTitleAndIcon()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    Assert.Equal(
        "<div data-blok-tabs>"
        + "<section data-blok-tab><h4 data-blok-tab-title><span data-blok-tab-icon>🍎</span> Fruit &amp; &lt;Veg&gt;</h4><p>Body <b>one</b></p></section>"
        + "<section data-blok-tab><h4 data-blok-tab-title>Empty</h4></section>"
        + "</div>",
        await converter.ToHtmlAsync(TextTabs));
  }

  [Fact]
  public async Task WritesTabsToMarkdownAndReportsTheLostSwitching()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync(TextTabs);

    Assert.Equal("**🍎 Fruit & \\<Veg>**\n\nBody **one**\n\n**Empty**", conversion.Markdown);
    var warning = Assert.Single(conversion.Warnings);
    Assert.Equal("tabs", warning.Construct);
    Assert.Equal(BlokDegradationActions.Degraded, warning.Action);
  }

  [Fact]
  public async Task ReadsTabTitlesAsPlainTextAndRecognisesBothTypes()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var report = await converter.ToPlainTextWithReportAsync(TextTabs);
    var validation = await converter.ValidateAsync(TextTabs);

    Assert.Equal("Fruit & <Veg>\n\nBody one\n\nEmpty", report.Text);
    Assert.Empty(report.Warnings);
    Assert.Empty(validation.UnrecognizedBlockTypes);
  }

  /// <summary>
  /// A tab title is plain text: a translation carrying markup characters must
  /// come back escaped once, never read as HTML.
  /// </summary>
  [Fact]
  public async Task TranslatesTabTitlesAndEscapesThemOnce()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var texts = await converter.ExtractTextsAsync(TextTabs);
    var translated = await converter.InjectTextsAsync(TextTabs, ["Obst & <Gemüse>", "Körper <b>eins</b>", "A & <B>"]);

    Assert.Equal(["Fruit & <Veg>", "Body <b>one</b>", "Empty"], texts);
    Assert.Contains(
        "<h4 data-blok-tab-title>A &amp; &lt;B&gt;</h4>",
        await converter.ToHtmlAsync(translated),
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task IndexesTabTitlesAndThePagesATabHolds()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var index = await converter.GetPageIndexAsync(Tabs);

    var owner = Assert.Single(index.Owners);
    Assert.Equal("page-1", owner.PageId);
    Assert.Equal("pg", owner.SourceBlockId);
    Assert.Equal(
        ["", "Fruit & <Veg>", "Body one", "", "", "Body two", "Empty"],
        index.Text.Select(entry => entry.Text));
  }

  [Fact]
  public async Task RemapsEveryBlockInsideTheTabs()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    string[] ids = ["tabs", "t1", "p1", "pg", "t2", "p2", "t3"];

    var copy = await converter.RemapPageDocumentAsync(
        Tabs,
        ids.ToDictionary(id => id, id => "n-" + id),
        new Dictionary<string, string> { ["page-1"] = "page-2" });

    using var document = JsonDocument.Parse(copy);
    var blocks = document.RootElement.GetProperty("blocks");
    Assert.Equal(
        ["n-t1", "n-t2", "n-t3"],
        blocks[0].GetProperty("content").EnumerateArray().Select(id => id.GetString()));
    Assert.Equal("n-t1", blocks[3].GetProperty("parent").GetString());
    Assert.Equal("page-2", blocks[3].GetProperty("data").GetProperty("pageId").GetString());
  }

  /// <summary>
  /// <c>FromHtmlAsync</c> reads back the tabs <c>ToHtmlAsync</c> writes, so a
  /// stored HTML copy can become a document again without losing the tabs.
  /// </summary>
  [Fact]
  public async Task RebuildsTabsFromItsOwnHtml()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    var html = await converter.ToHtmlAsync(TextTabs);

    var import = await converter.FromHtmlAsync(html);

    using var document = JsonDocument.Parse(import.DocumentJson);
    var blocks = document.RootElement.GetProperty("blocks");
    Assert.Equal(
        ["tabs", "tab", "paragraph", "tab"],
        blocks.EnumerateArray().Select(block => block.GetProperty("type").GetString()));
    Assert.Equal("Fruit & <Veg>", blocks[1].GetProperty("data").GetProperty("title").GetString());
    Assert.Equal("🍎", blocks[1].GetProperty("data").GetProperty("icon").GetString());
    Assert.Empty(import.Warnings);
    Assert.Equal(html, await converter.ToHtmlAsync(import.DocumentJson));
  }

  /// <summary>
  /// The editor moves a non-tab child out of a loaded tabs block to just after
  /// it, in the same container. The export shows the same order.
  /// </summary>
  [Fact]
  public async Task RendersAStrayChildAfterTheTabsInItsContainer()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var html = await converter.ToHtmlAsync("""
        {"blocks":[
          {"id":"tg","type":"toggle","data":{"text":"Tog"},"content":["tabs","after"]},
          {"id":"tabs","type":"tabs","data":{},"parent":"tg","content":["s1","t1"]},
          {"id":"s1","type":"paragraph","data":{"text":"Stray"},"parent":"tabs"},
          {"id":"t1","type":"tab","data":{"title":"Do"},"parent":"tabs","content":["p1"]},
          {"id":"p1","type":"paragraph","data":{"text":"one"},"parent":"t1"},
          {"id":"after","type":"paragraph","data":{"text":"After"},"parent":"tg"}
        ]}
        """);

    Assert.Equal(
        "<details><summary>Tog</summary>"
        + "<div data-blok-tabs><section data-blok-tab><h4 data-blok-tab-title>Do</h4><p>one</p></section></div>"
        + "<p>Stray</p><p>After</p></details>",
        html);
  }

  /// <summary>
  /// A table shows only the blocks its cells list. The editor keeps a stray of
  /// a tabs block in a cell in that cell, right after the tabs block, and so
  /// does every export.
  /// </summary>
  [Fact]
  public async Task KeepsAStrayOfTabsInATableCellInThatCell()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string document = """
        {"blocks":[
          {"id":"tbl","type":"table","data":{"withHeadings":false,"content":[[{"blocks":["tabs"]},{"blocks":["c2"]}]]},"content":["tabs","c2"]},
          {"id":"tabs","type":"tabs","data":{},"parent":"tbl","content":["s1","t1"]},
          {"id":"s1","type":"paragraph","data":{"text":"STRAYTEXT"},"parent":"tabs"},
          {"id":"t1","type":"tab","data":{"title":"Do"},"parent":"tabs","content":["p1"]},
          {"id":"p1","type":"paragraph","data":{"text":"one"},"parent":"t1"},
          {"id":"c2","type":"paragraph","data":{"text":"Two"},"parent":"tbl"}
        ]}
        """;

    var markdown = (await converter.ToMarkdownAsync(document)).Markdown;
    var text = (await converter.ToPlainTextWithReportAsync(document)).Text;

    Assert.Equal(
        "<table><tbody><tr><td>"
        + "<div data-blok-tabs><section data-blok-tab><h4 data-blok-tab-title>Do</h4><p>one</p></section></div>"
        + "<p>STRAYTEXT</p></td><td><p>Two</p></td></tr></tbody></table>",
        await converter.ToHtmlAsync(document));
    Assert.Single(markdown.Split("STRAYTEXT").Skip(1));
    Assert.True(markdown.IndexOf("one", StringComparison.Ordinal) < markdown.IndexOf("STRAYTEXT", StringComparison.Ordinal));
    Assert.Single(text.Split("STRAYTEXT").Skip(1));
    Assert.True(text.IndexOf("one", StringComparison.Ordinal) < text.IndexOf("STRAYTEXT", StringComparison.Ordinal));
  }
}
