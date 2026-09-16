using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Plain text used to be the one reader that reported nothing, so a caller
/// could not tell "this document has no text" from "this reader recognised
/// none of it". Markdown has carried a degradation list since it shipped.
/// </summary>
public sealed class BlokPlainTextReportTests
{
  private static IBlokDocumentConverter Converter() => BlokDocuments.Create(poolSize: 1);

  private const string Article = """
      {"blocks":[
        {"id":"h1","type":"header","data":{"text":"Release notes","level":2}},
        {"id":"p1","type":"paragraph","data":{"text":"Ships <b>today</b>."}}
      ]}
      """;

  /// <summary>
  /// Additive, not a replacement: the bare method still answers exactly what it
  /// always did, and the report's text is the same string.
  /// </summary>
  [Fact]
  public async Task ReportsTheSameTextTheBareReaderReturns()
  {
    var converter = Converter();

    var bare = await converter.ToPlainTextAsync(Article);
    var reported = await converter.ToPlainTextWithReportAsync(Article);

    Assert.Equal(bare, reported.Text);
    Assert.Empty(reported.Warnings);
  }

  [Fact]
  public async Task NamesATheReaderDoesNotRecognise()
  {
    var conversion = await Converter().ToPlainTextWithReportAsync(
        """{"blocks":[{"type":"org-chart","data":{"people":["Ada"]}}]}""");

    Assert.Equal(string.Empty, conversion.Text);
    var warning = Assert.Single(conversion.Warnings);
    Assert.Equal("org-chart", warning.Construct);
    Assert.Equal(BlokDegradationActions.Dropped, warning.Action);
    Assert.False(string.IsNullOrWhiteSpace(warning.Detail));
  }

  [Fact]
  public async Task SaysNothingAboutABuiltInBlockThatCarriesNoTextByDesign()
  {
    var conversion = await Converter().ToPlainTextWithReportAsync(
        """{"blocks":[{"type":"divider","data":{}},{"type":"spacer","data":{"height":24}}]}""");

    Assert.Equal(string.Empty, conversion.Text);
    Assert.Empty(conversion.Warnings);
  }

  /// <summary>The same collapsed warning the Markdown path reports.</summary>
  [Fact]
  public async Task ReportsBlocksTooMalformedToRead()
  {
    var conversion = await Converter().ToPlainTextWithReportAsync(
        """{"blocks":[{"type":"paragraph","data":{"text":"Kept"}},{"nope":1},{"nope":2}]}""");

    Assert.Equal("Kept", conversion.Text);
    var warning = Assert.Single(conversion.Warnings);
    Assert.Equal("block", warning.Construct);
    Assert.Contains("2 malformed blocks", warning.Detail, StringComparison.Ordinal);
  }

  /// <summary>The option the bare reader takes reaches the reporting one too.</summary>
  [Fact]
  public async Task CarriesTheHiddenTextOptionThrough()
  {
    var document = """{"blocks":[{"type":"image","data":{"url":"https://x/y.png","alt":"A chart"}}]}""";
    var converter = Converter();

    Assert.Equal(string.Empty, (await converter.ToPlainTextWithReportAsync(document)).Text);
    Assert.Equal("A chart", (await converter.ToPlainTextWithReportAsync(document, includeHiddenText: true)).Text);
  }

  [Fact]
  public async Task RefusesAnInputThatIsNotADocument()
  {
    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        () => Converter().ToPlainTextWithReportAsync("not a document").AsTask());

    Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
  }
}
