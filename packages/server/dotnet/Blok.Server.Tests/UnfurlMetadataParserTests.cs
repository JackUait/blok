using System.Text;
using Blok.Server.Metadata;
using Xunit;

namespace Blok.Server.Tests;

public sealed class UnfurlMetadataParserTests
{
  private const string Page =
      """
      <html><head>
      <title>Fallback Title</title>
      <meta property="og:title" content="OpenGraph Title">
      <meta name="description" content="Plain description">
      <meta property="og:image" content="/img/cover.png">
      <link rel="icon" href="/favicon.ico">
      </head><body>ignored</body></html>
      """;

  [Fact]
  public void PrefersOpenGraphAndResolvesRelativeUrls()
  {
    var metadata = Parse(Page, "https://example.com/article?x=1");

    Assert.Equal("OpenGraph Title", metadata.Title);
    Assert.Equal("Plain description", metadata.Description);
    Assert.Equal("https://example.com/img/cover.png", metadata.Image);
    Assert.Equal("https://example.com/favicon.ico", metadata.Favicon);
    Assert.Equal("example.com", metadata.Domain);
  }

  [Fact]
  public void FallsBackToTheTitleAndDefaultFavicon()
  {
    var metadata = Parse(
        "<html><head><title>Only Title</title></head></html>",
        "https://example.com/x");

    Assert.Equal("Only Title", metadata.Title);
    Assert.Equal("https://example.com/favicon.ico", metadata.Favicon);
  }

  [Fact]
  public void ReturnsDomainOnlyWhenMetadataIsAbsent()
  {
    var metadata = Parse(
        "<html><body>nothing</body></html>",
        "https://example.com/x");

    Assert.Equal("", metadata.Title);
    Assert.Equal("example.com", metadata.Domain);
  }

  [Fact]
  public void AppliesChannelPrecedenceAfterDocumentOrder()
  {
    var metadata = Parse(
        """
        <html><head>
        <title>Element Title</title>
        <meta name="description" content="Plain description">
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="/twitter.png">
        <meta property="og:image" content="/og.png">
        </head></html>
        """,
        "https://example.com/x");

    Assert.Equal("Twitter Title", metadata.Title);
    Assert.Equal("Twitter description", metadata.Description);
    Assert.Equal("https://example.com/og.png", metadata.Image);
  }

  [Theory]
  [InlineData(
      "<html><body><svg><title>Icon Label</title></svg><p>hi</p></body></html>",
      "")]
  [InlineData(
      "<svg><title>Icon Label</title></svg><title>Real Page</title>",
      "Real Page")]
  [InlineData(
      "<html><head><title>Real Page</title></head><body><svg><title>Icon Label</title></svg></body></html>",
      "Real Page")]
  public void IgnoresForeignNamespaceTitles(string html, string expected)
  {
    Assert.Equal(
        expected,
        Parse(html, "https://example.com/x").Title);
  }

  [Theory]
  [InlineData("https://example.com/article", "https://cdn.example.com/i.png")]
  [InlineData("http://example.com/article", "http://cdn.example.com/i.png")]
  public void ResolvesProtocolRelativeImages(
      string finalUrl,
      string expected)
  {
    var metadata = Parse(
        "<meta property=\"og:image\" content=\"//cdn.example.com/i.png\">",
        finalUrl);

    Assert.Equal(expected, metadata.Image);
  }

  [Theory]
  [InlineData(
      "<link rel=\"mask-icon\" href=\"/mask.svg\"><link rel=\"apple-touch-icon\" href=\"/apple.png\"><link rel=\"ICON SHORTCUT\" href=\"/real.ico\">",
      "https://example.com/real.ico")]
  [InlineData(
      "<link rel=\"shortcut icon\" href=\"/real.ico\">",
      "https://example.com/real.ico")]
  [InlineData(
      "<link rel=\"apple-touch-icon\" href=\"/apple.png\">",
      "https://example.com/apple.png")]
  [InlineData(
      "<link rel=\"mask-icon\" href=\"/mask.svg\">",
      "https://example.com/favicon.ico")]
  [InlineData(
      "<link rel=\"fluid-icon\" href=\"/fluid.png\">",
      "https://example.com/favicon.ico")]
  public void SelectsOnlySupportedIconRelations(
      string html,
      string expected)
  {
    Assert.Equal(
        expected,
        Parse(html, "https://example.com/x").Favicon);
  }

  public static TheoryData<string, string, string> MalformedPages()
  {
    return new TheoryData<string, string, string>
    {
      { "", "", "" },
      { "%%% not html at all %%%", "", "" },
      { "<html><head><meta property=\"og:tit", "", "" },
      {
        "<html><head><meta property=\"og:title\" content=\"Unclosed\"><body><p>text",
        "Unclosed",
        ""
      },
      {
        "<html><head><meta property=\"og:title\"><meta name=\"description\"><title>Real</title></head>",
        "Real",
        ""
      },
      {
        "<html><head><title></title></head><body>x</body></html>",
        "",
        ""
      },
      { "<title>   </title><title>Real</title>", "Real", "" },
      {
        string.Concat(
            Enumerable.Repeat("<div>", 5000)) +
            "<meta property=\"og:title\" content=\"Deep\">" +
            string.Concat(Enumerable.Repeat("</div>", 5000)),
        "",
        ""
      },
    };
  }

  [Theory]
  [MemberData(nameof(MalformedPages))]
  public void SurvivesMalformedInput(
      string html,
      string expectedTitle,
      string expectedDescription)
  {
    var metadata = Parse(html, "https://example.com/x");

    Assert.Equal(expectedTitle, metadata.Title);
    Assert.Equal(expectedDescription, metadata.Description);
    Assert.Equal("", metadata.Image);
    Assert.Equal("example.com", metadata.Domain);
    Assert.Equal("https://example.com/favicon.ico", metadata.Favicon);
  }

  [Theory]
  [InlineData("")]
  [InlineData(":")]
  [InlineData("http://[::1")]
  [InlineData("not a url")]
  public void ParsesTextButDropsRelativeUrlsForAnUnusableFinalUrl(
      string finalUrl)
  {
    const string html =
        """
        <title>Still Parsed</title>
        <meta property="og:image" content="/img/cover.png">
        <link rel="icon" href="/site.ico">
        """;

    var metadata = Parse(html, finalUrl);

    Assert.Equal("Still Parsed", metadata.Title);
    Assert.Equal("", metadata.Domain);
    Assert.Equal("", metadata.Image);
    Assert.Equal("", metadata.Favicon);
  }

  [Fact]
  public void KeepsAbsoluteHttpUrlsWithoutAUsableFinalUrl()
  {
    var metadata = Parse(
        """
        <meta property="og:image" content="https://cdn.example.com/i.png">
        <link rel="icon" href="http://cdn.example.com/icon.ico">
        """,
        ":");

    Assert.Equal("https://cdn.example.com/i.png", metadata.Image);
    Assert.Equal("http://cdn.example.com/icon.ico", metadata.Favicon);
  }

  [Fact]
  public void EmptyValuesFallThroughAndDoNotOverwrite()
  {
    var metadata = Parse(
        """
        <title>Element Title</title>
        <meta property="og:title" content="">
        <meta property="og:title" content="Real Title">
        <meta property="og:title" content=" ">
        <meta property="og:description" content="">
        <meta name="description" content="Real description">
        <meta name="description" content="">
        """,
        "https://example.com/x");

    Assert.Equal("Real Title", metadata.Title);
    Assert.Equal("Real description", metadata.Description);
  }

  [Fact]
  public void DropsNonHttpImageAndFaviconUrls()
  {
    var metadata = Parse(
        """
        <meta property="og:image" content="javascript:alert(1)">
        <link rel="icon" href="data:image/svg+xml,&lt;svg onload=alert(1)&gt;">
        """,
        "https://example.com/x");

    Assert.Equal("", metadata.Image);
    Assert.Equal("", metadata.Favicon);
  }

  [Fact]
  public void LowercasesTheDomainAndRemovesOneLeadingWww()
  {
    Assert.Equal(
        "example.com",
        Parse("", "https://WWW.Example.COM:443/x").Domain);
  }

  [Fact]
  public void TrimsAttributesDecodesEntitiesAndMatchesSelectorValuesExactly()
  {
    var metadata = Parse(
        """
        <META PROPERTY="OG:title" CONTENT="Wrong">
        <meta property=" og:title " content=" A &amp; B ">
        <meta NAME=" twitter:description " CONTENT=" D &amp; E ">
        """,
        "https://example.com/x");

    Assert.Equal("A & B", metadata.Title);
    Assert.Equal("D & E", metadata.Description);
  }

  [Fact]
  public void IgnoresTheDocumentBaseElement()
  {
    var metadata = Parse(
        """
        <base href="https://other.example/base/">
        <meta property="og:image" content="image.png">
        """,
        "https://example.com/article/page.html");

    Assert.Equal(
        "https://example.com/article/image.png",
        metadata.Image);
  }

  [Fact]
  public void DecodesBytesAsUtf8WithReplacement()
  {
    var body = new byte[]
    {
      (byte)'<', (byte)'t', (byte)'i', (byte)'t', (byte)'l', (byte)'e', (byte)'>',
      0xc3, 0x28,
      (byte)'<', (byte)'/', (byte)'t', (byte)'i', (byte)'t', (byte)'l', (byte)'e', (byte)'>',
    };

    var metadata = UnfurlMetadataParser.Parse(
        body,
        "https://example.com/x");

    Assert.Equal("�(", metadata.Title);
  }

  private static UnfurlMetadata Parse(
      string html,
      string finalUrl)
  {
    return UnfurlMetadataParser.Parse(
        Encoding.UTF8.GetBytes(html),
        finalUrl);
  }
}
