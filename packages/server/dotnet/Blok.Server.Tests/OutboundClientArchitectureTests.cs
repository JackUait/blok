using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Xunit;

namespace Blok.Server.Tests;

public sealed class OutboundClientArchitectureTests
{
  private static readonly HashSet<string> RestrictedTypes =
  [
    "System.Net.Http.HttpClient",
    "System.Net.Http.HttpClientHandler",
    "System.Net.Http.HttpMessageInvoker",
    "System.Net.Http.IHttpClientFactory",
    "System.Net.HttpWebRequest",
    "System.Net.Sockets.Socket",
    "System.Net.Http.SocketsHttpHandler",
    "System.Net.Security.SslStream",
    "System.Net.Sockets.TcpClient",
    "System.Net.WebClient",
    "System.Net.WebRequest",
  ];

  private static readonly HashSet<string> RestrictedTypeNames =
      RestrictedTypes
          .Select(type => type[(type.LastIndexOf('.') + 1)..])
          .ToHashSet(StringComparer.Ordinal);

  private static readonly string GuardOwner =
      Normalize("Blok.Server/Outbound/GuardedOutboundFetcher.cs");
  private static readonly string S3Owner =
      Normalize("Blok.Server/Storage/S3BlobStore.cs");

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
  [InlineData(
      "System.Net.Http.IHttpClientFactory factory = default!;",
      "IHttpClientFactory")]
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
  public void IgnoresRestrictedNamesInCommentsAndStrings()
  {
    var violations = FindViolations(
        [
          new SourceFile(
              "Blok.Server.AspNetCore/Harmless.cs",
              "// new HttpClient();\n" +
              "var example = \"new SocketsHttpHandler();\";"),
        ]);

    Assert.Empty(violations);
  }

  [Fact]
  public void DetectsEscapedRestrictedTypeNames()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server.AspNetCore/Sneaky.cs",
              "var client = new System.Net.Http.H\\u0074tpClient();"),
        ]));

    Assert.Contains(
        "HttpClient",
        violation,
        StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsOnlyTheConfiguredClientSitesInsideTheS3Exemption()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Storage/S3BlobStore.cs",
              """
              using System.Net.Http;
              using System.Net.Sockets;
              sealed class S3BlobStore
              {
                private readonly HttpClient client;

                internal S3BlobStore(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                  var socket = new Socket(default, default, default);
                }

                private static HttpMessageHandler CreateHandler()
                {
                  return new SocketsHttpHandler();
                }
              }
              """),
        ]));

    Assert.Contains("Socket", violation, StringComparison.Ordinal);
    Assert.DoesNotContain("HttpClient", violation, StringComparison.Ordinal);
    Assert.DoesNotContain(
        "SocketsHttpHandler",
        violation,
        StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsASecondS3Client()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Storage/S3BlobStore.cs",
              """
              using System.Net.Http;
              sealed class S3BlobStore
              {
                private readonly HttpClient client;
                private readonly HttpClient second;

                internal S3BlobStore(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                  second = new HttpClient();
                }

                private static HttpMessageHandler CreateHandler()
                {
                  return new SocketsHttpHandler();
                }
              }
              """),
        ]));

    Assert.Contains(
        "HttpClient",
        violation,
        StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsADuplicatedApprovedS3ClientCreation()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Storage/S3BlobStore.cs",
              """
              using System.Net.Http;
              sealed class S3BlobStore
              {
                private readonly HttpClient client;

                internal S3BlobStore(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                  client = new HttpClient(handler, disposeHandler: true);
                }

                private static HttpMessageHandler CreateHandler()
                {
                  return new SocketsHttpHandler();
                }
              }
              """),
        ]));

    Assert.Contains(
        "HttpClient",
        violation,
        StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsAnAliasDeclaredByAnAllowedOwnerAndUsedElsewhere()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Outbound/GuardedOutboundFetcher.cs",
              "global using Outbound = System.Net.Http.HttpClient;"),
          new SourceFile(
              "Blok.Server.AspNetCore/Sneaky.cs",
              "var client = new Outbound();"),
        ]));

    Assert.Contains("HttpClient", violation, StringComparison.Ordinal);
  }

  private static IReadOnlyList<string> FindViolations(
      IReadOnlyList<SourceFile> sources)
  {
    var trees = sources
        .Select(source => CSharpSyntaxTree.ParseText(
            source.Text,
            CSharpParseOptions.Default.WithLanguageVersion(
                LanguageVersion.Latest),
            source.Path))
        .ToArray();
    var compilation = CSharpCompilation.Create(
        "OutboundClientArchitectureLaw",
        [
          CSharpSyntaxTree.ParseText(
              """
              global using System;
              global using System.Collections.Generic;
              global using System.IO;
              global using System.Linq;
              global using System.Net.Http;
              global using System.Threading;
              global using System.Threading.Tasks;
              """),
          .. trees,
        ],
        PlatformReferences(),
        new CSharpCompilationOptions(
            OutputKind.DynamicallyLinkedLibrary));
    var violations = new List<string>();

    for (var index = 0; index < trees.Length; index++)
    {
      var source = sources[index];
      if (source.Path == GuardOwner)
      {
        continue;
      }

      var model = compilation.GetSemanticModel(
          trees[index],
          ignoreAccessibility: true);
      var uses = FindRestrictedUses(
          trees[index].GetRoot(),
          model).ToArray();
      var identifiers = uses
          .Where(use =>
              source.Path != S3Owner ||
              ClassifyS3Use(use) == S3UseSite.None)
          .Select(use => use.Identifier)
          .ToHashSet(StringComparer.Ordinal);

      if (source.Path == S3Owner)
      {
        if (uses.Count(use =>
                ClassifyS3Use(use) == S3UseSite.ClientField) != 1 ||
            uses.Count(use =>
                ClassifyS3Use(use) == S3UseSite.ClientCreation) != 1)
        {
          identifiers.Add("HttpClient");
        }

        if (uses.Count(use =>
                ClassifyS3Use(use) == S3UseSite.HandlerCreation) != 1)
        {
          identifiers.Add("SocketsHttpHandler");
        }
      }

      if (identifiers.Count > 0)
      {
        violations.Add(
            $"{source.Path}: {string.Join(", ", identifiers)}");
      }
    }

    return violations;
  }

  private static IEnumerable<RestrictedUse> FindRestrictedUses(
      SyntaxNode root,
      SemanticModel model)
  {
    foreach (var name in root.DescendantNodes()
        .OfType<SimpleNameSyntax>())
    {
      var alias = model.GetAliasInfo(name);
      var symbol = alias?.Target ??
          model.GetSymbolInfo(name).Symbol;
      var type = symbol as INamedTypeSymbol;
      if (symbol is null)
      {
        type = model.GetTypeInfo(name).Type as INamedTypeSymbol;
      }
      if (type is not null &&
          (RestrictedTypes.Contains(
              type.ToDisplayString(
                  SymbolDisplayFormat.FullyQualifiedFormat)
                  .Replace("global::", "", StringComparison.Ordinal)) ||
           type.TypeKind == TypeKind.Error &&
           RestrictedTypeNames.Contains(type.Name)))
      {
        yield return new RestrictedUse(type.Name, name);
      }
    }

    foreach (var invocation in root.DescendantNodes()
        .OfType<InvocationExpressionSyntax>())
    {
      var name = invocation.Expression switch
      {
        SimpleNameSyntax simpleName => simpleName,
        MemberAccessExpressionSyntax memberAccess => memberAccess.Name,
        MemberBindingExpressionSyntax memberBinding => memberBinding.Name,
        _ => null,
      };

      if (name?.Identifier.ValueText == "AddHttpClient")
      {
        yield return new RestrictedUse("AddHttpClient", name);
      }
    }
  }

  private static S3UseSite ClassifyS3Use(RestrictedUse use)
  {
    if (use.Identifier == "HttpClient" &&
        use.Node.Parent is VariableDeclarationSyntax declaration &&
        declaration.Type == use.Node &&
        declaration.Parent is FieldDeclarationSyntax &&
        declaration.Variables is
        [
        {
          Identifier.ValueText: "client",
        },
        ])
    {
      return S3UseSite.ClientField;
    }

    if (use.Identifier == "HttpClient" &&
        use.Node.Parent is ObjectCreationExpressionSyntax creation &&
        creation.Type == use.Node &&
        creation.Parent is AssignmentExpressionSyntax
        {
          Left: IdentifierNameSyntax
          {
            Identifier.ValueText: "client",
          },
        })
    {
      return S3UseSite.ClientCreation;
    }

    if (use.Identifier == "SocketsHttpHandler" &&
        use.Node.Parent is ObjectCreationExpressionSyntax handlerCreation &&
        handlerCreation.Type == use.Node &&
        handlerCreation.FirstAncestorOrSelf<MethodDeclarationSyntax>() is
        {
          Identifier.ValueText: "CreateHandler",
        })
    {
      return S3UseSite.HandlerCreation;
    }

    return S3UseSite.None;
  }

  private static IEnumerable<MetadataReference> PlatformReferences()
  {
    var assemblies = AppContext.GetData(
        "TRUSTED_PLATFORM_ASSEMBLIES") as string ??
        throw new InvalidOperationException(
            "The trusted platform assembly list is unavailable.");

    return assemblies
        .Split(Path.PathSeparator)
        .Select(path => MetadataReference.CreateFromFile(path));
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

  private enum S3UseSite
  {
    None,
    ClientField,
    ClientCreation,
    HandlerCreation,
  }

  private sealed record SourceFile(string Path, string Text);

  private sealed record RestrictedUse(
      string Identifier,
      SyntaxNode Node);
}
