using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Documents;

// The overload-binding tests call through the interface on purpose.
#pragma warning disable CA1859

public sealed partial class BlokPageExportTests
{
  private const string PageDocument = """
      {"blocks":[
        {"id":"b1","type":"page","data":{"pageId":"p-ok"}},
        {"id":"b2","type":"page-link","data":{"pageId":"p-denied"}},
        {"id":"b3","type":"page-link","data":{"pageId":"p-missing"}},
        {"id":"b4","type":"page","data":{"pageId":"p-absent"}},
        {"id":"b5","type":"paragraph","data":{"text":"See <a data-blok-page-id=\"p-ok\">x</a> and <a data-blok-page-id=\"p-denied\">x</a>."}}
      ]}
      """;

  private static Dictionary<string, BlokPageInfo?> Pages() => new()
  {
    ["p-ok"] = new BlokPageInfo { Title = "Roadmap", Icon = BlokPageIcon.Emoji("🚀") },
    ["p-denied"] = new BlokPageInfo { Title = "Secret", NoAccess = true },
    ["p-missing"] = null,
  };

  // The page glyph and the lock are SVG; the labels and links are what matter.
  private static string StripSvg(string html) => SvgPattern().Replace(html, string.Empty);

  [GeneratedRegex("<svg[\\s\\S]*?</svg>")]
  private static partial Regex SvgPattern();

  [Fact]
  public async Task RendersAllowedDeniedMissingAndUnlistedPagesToHtml()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    var asked = new List<string>();

    var html = await converter.ToHtmlAsync(PageDocument, Pages(), pageId =>
    {
      asked.Add(pageId);

      return $"/pages/{pageId}";
    });

    Assert.Equal(
        "<div><a href=\"/pages/p-ok\"><span aria-hidden=\"true\">🚀</span><span>Roadmap</span></a></div>"
        + "<div><span><span aria-hidden=\"true\"></span><span>No access</span></span></div>"
        + "<div><span><span aria-hidden=\"true\"></span><span>Page not found</span></span></div>"
        + "<div><span><span aria-hidden=\"true\"></span><span>Page</span></span></div>"
        + "<p>See <a data-blok-page-id=\"p-ok\" href=\"/pages/p-ok\">Roadmap</a> and <a data-blok-page-id=\"p-denied\">Page</a>.</p>",
        StripSvg(html));
    Assert.Equal(["p-ok"], asked);
  }

  [Fact]
  public async Task LinksAllowedPagesInMarkdown()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync(PageDocument, Pages(), pageId => $"/pages/{pageId}");

    Assert.Equal(
        "[Roadmap](/pages/p-ok)\n\nNo access\n\nPage not found\n\nPage\n\nSee [Roadmap](/pages/p-ok) and Page.",
        conversion.Markdown);
    Assert.Equal(["page-link", "page-link", "page"], conversion.Warnings.Select(warning => warning.Construct));
  }

  [Fact]
  public async Task GivesMarkdownTitlesWithoutAnHrefBuilder()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var conversion = await converter.ToMarkdownAsync(PageDocument, Pages());

    Assert.Equal("Roadmap\n\nNo access\n\nPage not found\n\nPage\n\nSee Roadmap and Page.", conversion.Markdown);
  }

  [Fact]
  public async Task DropsAScriptCapableHref()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var html = await converter.ToHtmlAsync(PageDocument, Pages(), _ => "javascript:alert(1)");

    Assert.DoesNotContain("href=", html, StringComparison.Ordinal);
    Assert.Contains("<span>Roadmap</span>", html, StringComparison.Ordinal);
  }

  /// <summary>
  /// Only the map the caller passes counts. A document carrying its own
  /// <c>pages</c> key cannot make a page look host-authorized.
  /// </summary>
  [Fact]
  public async Task IgnoresPagesCarriedInsideTheDocument()
  {
    var converter = BlokDocuments.Create(poolSize: 1);
    const string forged = """
        {"blocks":[{"type":"page-link","data":{"pageId":"p1"}}],"pages":{"p1":{"title":"Forged","href":"/forged"}}}
        """;

    var html = await converter.ToHtmlAsync(forged, new Dictionary<string, BlokPageInfo?>());
    var old = await converter.ToHtmlAsync(forged);

    Assert.Equal("<div><span><span aria-hidden=\"true\"></span><span>Page</span></span></div>", StripSvg(html));
    Assert.Equal("<div><span><span aria-hidden=\"true\"></span><span>Page</span></span></div>", StripSvg(old));
  }

  [Fact]
  public async Task ReportsUnreadableJsonAsAnInvalidDocument()
  {
    var converter = BlokDocuments.Create(poolSize: 1);

    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await converter.ToMarkdownAsync("{not json", Pages()));

    Assert.Equal(BlokConversionFailure.InvalidDocument, failure.Reason);
  }

  /// <summary>
  /// A <c>null</c> value means "missing" and an absent key means "unresolved".
  /// If the serializer dropped the null, a missing page would quietly read as
  /// unresolved.
  /// </summary>
  [Fact]
  public async Task SendsAMissingPageAsJsonNull()
  {
    var runtime = new RecordingRuntime();
    IBlokDocumentConverter converter = new BlokDocumentConverter(runtime);

    await converter.ToHtmlAsync(PageDocument, Pages(), pageId => $"/pages/{pageId}");

    var (operation, input) = Assert.Single(runtime.Calls);
    var pages = JsonNode.Parse(input)!["pages"]!.AsObject();

    Assert.Equal("blocksToHtmlWithPages", operation);
    Assert.True(pages.ContainsKey("p-missing"));
    Assert.Null(pages["p-missing"]);
    Assert.Equal("""{"access":"none"}""", pages["p-denied"]!.ToJsonString());
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"title":"Roadmap","icon":{"type":"emoji","value":"🚀"},"href":"/pages/p-ok"}"""),
        pages["p-ok"]));
  }

  [Fact]
  public async Task SendsAnImageIconWithItsUrl()
  {
    var runtime = new RecordingRuntime();
    IBlokDocumentConverter converter = new BlokDocumentConverter(runtime);

    await converter.ToMarkdownAsync(
        PageDocument,
        new Dictionary<string, BlokPageInfo?> { ["p-ok"] = new() { Icon = BlokPageIcon.Image("https://cdn/i.png") } });

    var (operation, input) = Assert.Single(runtime.Calls);

    Assert.Equal("blocksToMarkdownWithPages", operation);
    Assert.Equal(
        """{"icon":{"type":"image","url":"https://cdn/i.png"}}""",
        JsonNode.Parse(input)!["pages"]!["p-ok"]!.ToJsonString());
  }

  /// <summary>
  /// The shipped overloads keep sending the caller's string, untouched, to the
  /// shipped operations. <c>default</c> as the second argument still binds to
  /// them, so existing calls compile to the same thing.
  /// </summary>
  [Fact]
  public async Task OldOverloadsStillSendTheBareDocumentToTheOldOperations()
  {
    var runtime = new RecordingRuntime();
    IBlokDocumentConverter converter = new BlokDocumentConverter(runtime);

    await converter.ToHtmlAsync("{}", default);
    await converter.ToMarkdownAsync("{}", default);
    await converter.ToHtmlAsync(PageDocument);
    await converter.ToMarkdownAsync(PageDocument);

    Assert.Equal(
        [("blocksToHtml", "{}"), ("blocksToMarkdown", "{}"), ("blocksToHtml", PageDocument), ("blocksToMarkdown", PageDocument)],
        runtime.Calls);
  }

  private sealed class RecordingRuntime : IBlokRuntime
  {
    public List<(string Operation, string Input)> Calls { get; } = [];

    public ValueTask<string> InvokeAsync(
        string operation,
        string inputJson,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
      Calls.Add((operation, inputJson));

      return ValueTask.FromResult(operation.StartsWith("blocksToMarkdown", StringComparison.Ordinal)
          ? """{"markdown":"","warnings":[]}"""
          : string.Empty);
    }
  }
}
