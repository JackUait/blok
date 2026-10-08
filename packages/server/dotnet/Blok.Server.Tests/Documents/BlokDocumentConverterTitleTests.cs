using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// The title exports are new method names with default bodies, so an existing
/// implementation of the public interface keeps compiling.
/// </summary>
public sealed class BlokDocumentConverterTitleTests
{
  private const string Titled = """
      {"title":"Plan","icon":{"type":"emoji","value":"🚀"},"blocks":[
        {"id":"p1","type":"paragraph","data":{"text":"Body"}}
      ]}
      """;

  private static IBlokDocumentConverter Converter() => BlokDocuments.Create(poolSize: 1);

  [Fact]
  public async Task WritesTheTitleAsAnH1()
  {
    var converter = Converter();

    Assert.Equal(
        "<h1><span aria-hidden=\"true\">🚀</span> Plan</h1><p>Body</p>",
        await converter.ToHtmlWithTitleAsync(Titled));
    Assert.Equal(
        "<h1><span aria-hidden=\"true\">🚀</span> Plan</h1><p>Body</p>",
        await converter.ToHtmlWithTitleAsync(Titled, new Dictionary<string, BlokPageInfo?>()));
  }

  [Fact]
  public async Task WritesTheTitleAsAMarkdownHeading()
  {
    var converter = Converter();

    var bare = await converter.ToMarkdownWithTitleAsync(Titled);
    var paged = await converter.ToMarkdownWithTitleAsync(Titled, new Dictionary<string, BlokPageInfo?>());

    Assert.Equal("# 🚀 Plan\n\nBody", bare.Markdown);
    Assert.Equal("# 🚀 Plan\n\nBody", paged.Markdown);
  }

  [Fact]
  public async Task WritesTheTitleAsTheFirstPlainTextLine()
  {
    Assert.Equal("Plan\n\nBody", await Converter().ToPlainTextWithTitleAsync(Titled));
  }

  [Fact]
  public async Task LeavesTheExistingMethodsOutputUnchanged()
  {
    var converter = Converter();

    Assert.Equal("<p>Body</p>", await converter.ToHtmlAsync(Titled));
    Assert.Equal("<p>Body</p>", await converter.ToHtmlAsync(Titled, new Dictionary<string, BlokPageInfo?>()));
    Assert.Equal("Body", (await converter.ToMarkdownAsync(Titled)).Markdown);
    Assert.Equal("Body", (await converter.ToMarkdownAsync(Titled, new Dictionary<string, BlokPageInfo?>())).Markdown);
    Assert.Equal("Body", await converter.ToPlainTextAsync(Titled));
  }

  [Fact]
  public async Task AnImplementationWithoutTheTitleMethodsCompilesAndRefusesThem()
  {
    IBlokDocumentConverter converter = new OlderConverter();
    var pages = new Dictionary<string, BlokPageInfo?>();

    await Assert.ThrowsAsync<NotSupportedException>(async () => await converter.ToHtmlWithTitleAsync(Titled));
    await Assert.ThrowsAsync<NotSupportedException>(async () => await converter.ToHtmlWithTitleAsync(Titled, pages));
    await Assert.ThrowsAsync<NotSupportedException>(async () => await converter.ToMarkdownWithTitleAsync(Titled));
    await Assert.ThrowsAsync<NotSupportedException>(async () => await converter.ToMarkdownWithTitleAsync(Titled, pages));
    await Assert.ThrowsAsync<NotSupportedException>(async () => await converter.ToPlainTextWithTitleAsync(Titled));
  }

  /// <summary>
  /// Written against the interface as it shipped in 1.16.1. Its members throw a
  /// different exception, so a NotSupportedException can only come from the
  /// interface's default bodies.
  /// </summary>
  private sealed class OlderConverter : IBlokDocumentConverter
  {
    public ValueTask<string> GetVersionAsync(CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokMarkdownConversion> ToMarkdownAsync(
        string documentJson,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokMarkdownConversion> ToMarkdownAsync(
        string documentJson,
        IReadOnlyDictionary<string, BlokPageInfo?> pages,
        Func<string, string>? pageHref = null,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<string> GetSchemaAsync(CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<IReadOnlyList<string>> ExtractTextsAsync(
        string documentJson,
        bool includeCode = false,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<string> InjectTextsAsync(
        string documentJson,
        IReadOnlyList<string> texts,
        bool includeCode = false,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokPageIndex> GetPageIndexAsync(
        string documentJson,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<string> RemapPageDocumentAsync(
        string documentJson,
        IReadOnlyDictionary<string, string> blockIds,
        IReadOnlyDictionary<string, string> pageIds,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<string> ToHtmlAsync(string documentJson, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<string> ToHtmlAsync(
        string documentJson,
        IReadOnlyDictionary<string, BlokPageInfo?> pages,
        Func<string, string>? pageHref = null,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<string> ToPlainTextAsync(
        string documentJson,
        bool includeHiddenText = false,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokPlainTextConversion> ToPlainTextWithReportAsync(
        string documentJson,
        bool includeHiddenText = false,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokDocumentValidation> ValidateAsync(
        string? documentJson,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokImportConversion> FromMarkdownAsync(
        string markdown,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();

    public ValueTask<BlokImportConversion> FromHtmlAsync(
        string html,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException();
  }
}
