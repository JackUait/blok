using System.Text.Json.Nodes;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Table data through the embedded runtime (Jint): translation round trip,
/// import from HTML/Markdown, export to text/Markdown, validation. A failing
/// test here is a confirmed loss.
/// </summary>
public sealed class TableDocumentDataLossAuditTests
{
  private static readonly Lazy<IBlokDocumentConverter> Shared = new(() => BlokDocuments.Create(poolSize: 1));

  private const string FullTable =
      """
      {"blocks":[
        { "id": "tb", "type": "table", "content": ["p00", "p01", "p10", "p11", "p12"],
          "data": {
            "withHeadings": true, "withHeadingColumn": true, "stretched": true,
            "colWidths": [120.5, 200, 333.25], "initialColWidth": 217.75, "textSize": "comfortable",
            "content": [
              [ { "id": "c0", "rowId": "r0", "blocks": ["p00"], "colspan": 2, "color": "blue", "textColor": "red", "placement": "middle-center" },
                { "id": "c1", "rowId": "r0", "blocks": [], "mergedInto": [0, 0] },
                { "id": "c2", "rowId": "r0", "blocks": ["p01"], "rowspan": 2 } ],
              [ { "id": "c0", "rowId": "r1", "blocks": ["p10", "p11"] },
                { "id": "c1", "rowId": "r1", "blocks": ["p12"], "placement": "bottom-right" },
                { "id": "c2", "rowId": "r1", "blocks": [], "mergedInto": [0, 2] } ]
            ] } },
        { "id": "p00", "type": "paragraph", "parent": "tb", "data": { "text": "origin" } },
        { "id": "p01", "type": "paragraph", "parent": "tb", "data": { "text": "tall" } },
        { "id": "p10", "type": "paragraph", "parent": "tb", "data": { "text": "first" } },
        { "id": "p11", "type": "paragraph", "parent": "tb", "data": { "text": "second" } },
        { "id": "p12", "type": "paragraph", "parent": "tb", "data": { "text": "xcell" } }
      ]}
      """;

  /// <summary>Legacy text cells, with a merge, so translation walks the grid itself.</summary>
  private const string TextCellTable =
      """
      {"blocks":[
        { "id": "tb", "type": "table",
          "data": { "withHeadings": false, "withHeadingColumn": false, "colWidths": [10, 20, 30],
            "content": [
              ["plain a", { "blocks": [], "text": "rich <b>b</b>", "color": "red" }, "c"],
              [{ "blocks": [], "text": "wide", "colspan": 2 }, { "blocks": [], "mergedInto": [1, 0] }, "f"]
            ] } }
      ]}
      """;

  [Theory]
  [InlineData(FullTable)]
  [InlineData(TextCellTable)]
  public async Task ExtractThenInjectTheSameTextsChangesNothing(string document)
  {
    var converter = Shared.Value;
    var texts = await converter.ExtractTextsAsync(document);
    var injected = await converter.InjectTextsAsync(document, texts);

    Assert.True(
        JsonNode.DeepEquals(JsonNode.Parse(document), JsonNode.Parse(injected)),
        injected);
  }

  [Fact]
  public async Task TranslatingTextCellsReachesEveryVisibleCellAndKeepsTheGrid()
  {
    var converter = Shared.Value;
    var texts = await converter.ExtractTextsAsync(TextCellTable);
    var injected = JsonNode.Parse(
        await converter.InjectTextsAsync(TextCellTable, [.. texts.Select(text => "T:" + text)]))!;
    var content = injected["blocks"]![0]!["data"]!["content"]!;

    Assert.Equal(["plain a", "rich <b>b</b>", "c", "wide", "f"], texts);
    Assert.Equal("T:plain a", content[0]![0]!.GetValue<string>());
    Assert.Equal("T:rich <b>b</b>", content[0]![1]!["text"]!.GetValue<string>());
    Assert.Equal("red", content[0]![1]!["color"]!.GetValue<string>());
    Assert.Equal(2, content[1]![0]!["colspan"]!.GetValue<int>());
    Assert.Equal("T:f", content[1]![2]!.GetValue<string>());
  }

  [Fact]
  public async Task ExtractingABlockCellTableYieldsEachCellChildOnce()
  {
    var texts = await Shared.Value.ExtractTextsAsync(FullTable);

    Assert.Equal(["origin", "tall", "first", "second", "xcell"], texts);
  }

  [Fact]
  public async Task PlainTextOfATableCarriesEveryCellBlock()
  {
    var text = await Shared.Value.ToPlainTextAsync(FullTable);

    foreach (var word in new[] { "origin", "tall", "first", "second", "xcell" })
    {
      Assert.Contains(word, text);
    }
  }

  [Fact]
  public async Task MarkdownOfATableCarriesEveryCellBlockAndReportsTheMerge()
  {
    var result = await Shared.Value.ToMarkdownAsync(FullTable);

    foreach (var word in new[] { "origin", "tall", "first", "second", "xcell" })
    {
      Assert.Contains(word, result.Markdown);
    }

    Assert.NotEmpty(result.Warnings);
  }

  [Fact]
  public async Task ValidationAcceptsEverySavedTableField()
  {
    var validation = await Shared.Value.ValidateAsync(FullTable);

    Assert.True(validation.IsDocument);
    Assert.Equal(0, validation.MalformedBlockCount);
    Assert.Empty(validation.UnrecognizedBlockTypes);
    Assert.False(validation.IsEmpty);
  }

  /// <summary>An HTML merge must arrive as a Blok merge: origin spans, covers point back.</summary>
  [Fact]
  public async Task HtmlImportKeepsMergedCells()
  {
    var import = await Shared.Value.FromHtmlAsync(
        "<table><tr><td colspan=\"2\">wide</td><td rowspan=\"2\">tall</td></tr><tr><td>a</td><td>b</td></tr></table>");
    var blocks = JsonNode.Parse(import.DocumentJson)!["blocks"]!.AsArray();
    var table = blocks.Single(block => block!["type"]!.GetValue<string>() == "table")!;
    var content = table["data"]!["content"]!;

    Assert.Equal(2, content[0]![0]!["colspan"]!.GetValue<int>());
    Assert.Equal("[0,0]", content[0]![1]!["mergedInto"]!.ToJsonString());
    Assert.Equal(2, content[0]![2]!["rowspan"]!.GetValue<int>());
    Assert.Equal("[0,2]", content[1]![2]!["mergedInto"]!.ToJsonString());
    Assert.Single(content[1]![0]!["blocks"]!.AsArray());
    Assert.Single(content[1]![1]!["blocks"]!.AsArray());
  }

  /// <summary>
  /// Every non-whitespace word of a cell must reach some block, and every
  /// block a cell names must exist.
  /// </summary>
  [Theory]
  [InlineData("<table><tr><td><ul><li>outer<ul><li>inner</li></ul></li></ul></td></tr></table>", new[] { "outer", "inner" })]
  [InlineData("<table><tr><td><p>one</p><p>two</p></td><td><pre><code>x = 1</code></pre></td></tr></table>", new[] { "one", "two", "x = 1" })]
  [InlineData("<table><tr><td><div><table><tr><td>deep</td></tr></table></div></td></tr></table>", new[] { "deep" })]
  [InlineData("<table><tr><td><h2>title</h2></td></tr></table>", new[] { "title" })]
  [InlineData("<table><tr><td><blockquote>quoted</blockquote><img src=\"https://x.test/a.png\" alt=\"pic\"></td></tr></table>", new[] { "quoted" })]
  public async Task HtmlImportKeepsEveryCellsContent(string html, string[] words)
  {
    var import = await Shared.Value.FromHtmlAsync(html);
    var document = import.DocumentJson;
    var blocks = JsonNode.Parse(document)!["blocks"]!.AsArray();
    var ids = blocks.Select(block => block!["id"]?.GetValue<string>()).ToHashSet();

    foreach (var table in blocks.Where(block => block!["type"]!.GetValue<string>() == "table"))
    {
      foreach (var cell in table!["data"]!["content"]!.AsArray().SelectMany(row => row!.AsArray()))
      {
        foreach (var id in cell!["blocks"]!.AsArray())
        {
          Assert.Contains(id!.GetValue<string>(), ids);
        }
      }
    }

    var text = await Shared.Value.ToPlainTextAsync(document);

    foreach (var word in words)
    {
      Assert.True(document.Contains(word, StringComparison.Ordinal), $"{word} missing from {document}");
      Assert.True(text.Contains(word, StringComparison.Ordinal), $"{word} missing from plain text {text} of {document}");
    }
  }

  /// <summary>
  /// html-to-blocks flattens a table nested in a cell, with a warning, because
  /// a Blok cell cannot hold a grid (`table` is a restricted cell tool). The
  /// guard only looks at the cell's DIRECT children, so one wrapper element
  /// (Google Docs / Word wrap tables in div/span) lets a table block land
  /// inside a table cell, unwarned.
  /// </summary>
  [Theory]
  [InlineData("<table><tr><td><div><table><tr><td>deep</td></tr></table></div></td></tr></table>")]
  [InlineData("<table><tr><td><section><div><table><tr><td>deep</td></tr></table></div></section></td></tr></table>")]
  public async Task HtmlImportNeverNestsATableInATableCellSilently(string html)
  {
    var import = await Shared.Value.FromHtmlAsync(html);
    var blocks = JsonNode.Parse(import.DocumentJson)!["blocks"]!.AsArray();
    var tableIds = blocks
        .Where(block => block!["type"]!.GetValue<string>() == "table")
        .Select(block => block!["id"]!.GetValue<string>())
        .ToHashSet();
    var nested = blocks.Where(block =>
        block!["type"]!.GetValue<string>() == "table" &&
        block["parent"] is JsonValue parent &&
        tableIds.Contains(parent.GetValue<string>()));

    Assert.True(
        !nested.Any() || import.Warnings.Any(warning => warning.Construct == "table"),
        $"table nested in a cell with no warning: {import.DocumentJson}");
  }

  /// <summary>
  /// Table data crossing C# → Jint → C#: emoji, RTL text, U+2028, escaped
  /// markup, fractional and integral widths, nulls. JSON number spelling may
  /// change (200 vs 200.0), values may not.
  /// </summary>
  [Fact]
  public async Task TableDataSurvivesTheEngineBoundary()
  {
    const string document =
        """
        {"time":1700000000000,"version":"1.0.0","blocks":[
          { "id": "tb", "type": "table", "tunes": { "x": null },
            "data": { "withHeadings": false, "withHeadingColumn": false, "colWidths": [200, 120.125, 0.1, 1e3],
              "initialColWidth": 333.3333333333333,
              "content": [
                ["مرحبا بالعالم", { "blocks": [], "text": "😀 <b>a&amp;b</b> \u2028 \"q\" \\ ", "color": null }],
                [{ "blocks": [], "text": "שלום", "colspan": 1 }, "\u00e9\u0301 z\u200dw"]
              ] } }
        ]}
        """;
    var converter = Shared.Value;
    var texts = await converter.ExtractTextsAsync(document);
    var injected = await converter.InjectTextsAsync(document, texts);

    Assert.True(JsonNode.DeepEquals(JsonNode.Parse(document), JsonNode.Parse(injected)), injected);
  }

  [Fact]
  public async Task ValidationAcceptsALegacyStringCellTable()
  {
    var validation = await Shared.Value.ValidateAsync(TextCellTable);

    Assert.Equal(0, validation.MalformedBlockCount);
    Assert.False(validation.IsEmpty);
  }

  [Theory]
  [InlineData("| a \\| b | c |\n| --- | --- |\n| d | `e \\| f` |\n", new[] { "a | b", "e | f" })]
  [InlineData("| h1 | h2 |\n| --- | --- |\n| only one |\n", new[] { "only one" })]
  [InlineData("| h1 |\n| --- |\n| x | overflow |\n", new[] { "x" })]
  public async Task MarkdownImportKeepsEveryCell(string markdown, string[] words)
  {
    var import = await Shared.Value.FromMarkdownAsync(markdown);
    var text = await Shared.Value.ToPlainTextAsync(import.DocumentJson);

    foreach (var word in words)
    {
      Assert.True(text.Contains(word, StringComparison.Ordinal), $"{word} missing from {text} of {import.DocumentJson}");
    }
  }
}
