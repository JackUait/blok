using System.Text.RegularExpressions;
using Xunit;

namespace Blok.Server.Tests;

public sealed partial class OutboundClientArchitectureTests
{
  private static readonly string[] RestrictedIdentifiers =
  [
    "AddHttpClient",
    "HttpClient",
    "HttpClientHandler",
    "HttpMessageInvoker",
    "HttpWebRequest",
    "IHttpClientFactory",
    "Socket",
    "SocketsHttpHandler",
    "SslStream",
    "TcpClient",
    "WebClient",
    "WebRequest",
  ];

  private static readonly string GuardOwner =
      Normalize("Blok.Server/Outbound/GuardedOutboundFetcher.cs");
  private static readonly string S3Owner =
      Normalize("Blok.Server/Storage/S3BlobStore.cs");
  private static readonly HashSet<string> S3AllowedIdentifiers =
  [
    "HttpClient",
    "SocketsHttpHandler",
  ];

  [Fact]
  public void OnlyTheGuardAndConfiguredS3StoreOwnOutboundClients()
  {
    var root = FindDotnetRoot();
    var sources = Directory
        .EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
        .Where(path => !IsGeneratedOrTestSource(root, path))
        .Select(path => new SourceFile(
            Normalize(Path.GetRelativePath(root, path)),
            File.ReadAllText(path)))
        .ToArray();
    var violations = FindViolations(sources);

    Assert.True(
        violations.Count == 0,
        "Outbound networking may only be owned by the guarded fetcher " +
        "or configured S3 store:\n" +
        string.Join("\n", violations));
  }

  [Theory]
  [InlineData(
      "var client = new global::System.Net.Http.HttpClient();",
      "HttpClient")]
  [InlineData(
      "System.Net.Http.HttpClient client = new();",
      "HttpClient")]
  [InlineData(
      "var socket = new global::System.Net.Sockets.Socket(default, default, default);",
      "Socket")]
  [InlineData(
      "using Net = System.Net.Http; var client = new Net.HttpClient();",
      "HttpClient")]
  public void DetectsFullyQualifiedAndTargetTypedConstruction(
      string source,
      string expectedIdentifier)
  {
    var violation = Assert.Single(FindViolations(
        [new SourceFile("Blok.Server.AspNetCore/Sneaky.cs", source)]));

    Assert.Contains(
        expectedIdentifier,
        violation,
        StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsOnlyTheConfiguredClientTypesInsideTheS3Exemption()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Storage/S3BlobStore.cs",
              "HttpClient client = new HttpClient(); " +
              "var socket = new System.Net.Sockets.Socket(default, default, default);"),
        ]));

    Assert.Contains("Socket", violation, StringComparison.Ordinal);
    Assert.DoesNotContain("HttpClient", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsAnAliasDeclaredByAnAllowedOwnerAndUsedElsewhere()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Outbound/GuardedOutboundFetcher.cs",
              "global using Outbound = HttpClient;"),
          new SourceFile(
              "Blok.Server.AspNetCore/Sneaky.cs",
              "var client = new Outbound();"),
        ]));

    Assert.Contains("Outbound", violation, StringComparison.Ordinal);
  }

  private static IReadOnlyList<string> FindViolations(
      IReadOnlyList<SourceFile> sources)
  {
    var aliases = sources
        .SelectMany(source => RelevantAliases()
            .Matches(source.Text)
            .Select(match => match.Groups["alias"].Value))
        .Distinct(StringComparer.Ordinal)
        .ToArray();
    var violations = new List<string>();

    foreach (var source in sources)
    {
      if (source.Path == GuardOwner)
      {
        continue;
      }

      var allowedIdentifiers = source.Path == S3Owner
        ? S3AllowedIdentifiers
        : [];
      var identifiers = RestrictedIdentifiers
          .Concat(aliases)
          .Where(identifier =>
              !allowedIdentifiers.Contains(identifier) &&
              Regex.IsMatch(
                  source.Text,
                  $@"\b{Regex.Escape(identifier)}\b",
                  RegexOptions.CultureInvariant))
          .Distinct(StringComparer.Ordinal)
          .Order(StringComparer.Ordinal)
          .ToArray();

      if (identifiers.Length > 0)
      {
        violations.Add(
            $"{source.Path}: {string.Join(", ", identifiers)}");
      }
    }

    return violations;
  }

  private static string FindDotnetRoot()
  {
    for (var current = new DirectoryInfo(AppContext.BaseDirectory);
         current is not null;
         current = current.Parent)
    {
      if (File.Exists(Path.Combine(
            current.FullName,
            "Blok.Server.slnx")))
      {
        return current.FullName;
      }
    }

    throw new DirectoryNotFoundException(
        "Could not locate the Blok.Server solution root.");
  }

  private static bool IsGeneratedOrTestSource(
      string root,
      string path)
  {
    var relative = Normalize(Path.GetRelativePath(root, path));
    var project = relative.Split('/', 2)[0];

    return relative.Contains("/bin/", StringComparison.Ordinal) ||
        relative.Contains("/obj/", StringComparison.Ordinal) ||
        project.EndsWith(".Tests", StringComparison.Ordinal);
  }

  private static string Normalize(string path)
  {
    return path.Replace(
        Path.DirectorySeparatorChar,
        '/');
  }

  [GeneratedRegex(
      @"(?:global\s+)?using\s+(?<alias>[A-Za-z_]\w*)\s*=\s*" +
      @"[^;\r\n]*\b(?:HttpClient|HttpClientHandler|HttpMessageInvoker|" +
      @"HttpWebRequest|IHttpClientFactory|Socket|SocketsHttpHandler|" +
      @"SslStream|TcpClient|WebClient|WebRequest)\s*;",
      RegexOptions.CultureInvariant)]
  private static partial Regex RelevantAliases();

  private sealed record SourceFile(string Path, string Text);
}
