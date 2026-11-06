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
    "System.Net.WebSockets.ClientWebSocket",
  ];

  private static readonly HashSet<string> RestrictedTypeNames =
      RestrictedTypes
          .Select(type => type[(type.LastIndexOf('.') + 1)..])
          .ToHashSet(StringComparer.Ordinal);

  private static readonly string GuardOwner =
      Normalize("Blok.Server/Outbound/GuardedOutboundFetcher.cs");
  private static readonly string S3Owner =
      Normalize("Blok.Server/Storage/S3BlobStore.cs");
  private static readonly string DocEndpointOwner =
      Normalize("Blok.Server/Collab/DocEndpointClient.cs");
  // blok-mcp calls hosts the operator names, loopback included (the endpoint
  // source, ticket route, authorize webhook and JWKS), which the guard refuses.
  private static readonly string McpOwner =
      Normalize("Blok.Server.Mcp/Outbound/McpHttpCaller.cs");
  // blok-mcp joining a sync room at the operator's --sync-url. It is the one
  // place a ClientWebSocket may be created: ONE creation, inside ConnectAsync,
  // over ONE HttpMessageInvoker field `invoker` built from ONE SocketsHttpHandler
  // made in CreateHandler, and no other outbound type.
  private static readonly string RoomSocketOwner =
      Normalize("Blok.Server.Mcp/Outbound/McpRoomSocket.cs");

  // Every owner outside the guard is pinned to ONE client field, ONE client
  // creation and ONE SocketsHttpHandler factory named CreateHandler.
  private static readonly HashSet<string> PinnedOwners =
      [S3Owner, DocEndpointOwner, McpOwner];

  [Fact]
  public void OnlyTheDocumentedOwnersOwnOutboundClients()
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
        "Outbound networking may only be owned by the guarded fetcher, " +
        "the configured S3 store, the doc-endpoint client or blok-mcp's " +
        "HTTP caller and room socket:\n" +
        string.Join("\n", violations));
  }

  [Fact]
  public void GuardedFetcherDoesNotCloneTheCompletedResponseBuffer()
  {
    var root = FindDotnetRoot();
    var source = File.ReadAllText(
        Path.Combine(root, "Blok.Server", "Outbound", "GuardedOutboundFetcher.cs"));
    var method = CSharpSyntaxTree.ParseText(source)
        .GetRoot()
        .DescendantNodes()
        .OfType<MethodDeclarationSyntax>()
        .Single(candidate =>
            candidate.Identifier.ValueText == "ReadDecodedAsync");
    var clones = method.DescendantNodes()
        .OfType<InvocationExpressionSyntax>()
        .Where(invocation =>
            invocation.Expression is MemberAccessExpressionSyntax access &&
            access.Name.Identifier.ValueText == "ToArray");

    Assert.Empty(clones);
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

                private static SocketsHttpHandler CreateHandler()
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

                private static SocketsHttpHandler CreateHandler()
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

                private static SocketsHttpHandler CreateHandler()
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

  // The room socket's whole outbound surface: one ClientWebSocket in ConnectAsync,
  // one HttpMessageInvoker field over one SocketsHttpHandler from CreateHandler.
  private const string RoomSocketShape =
      """
      using System.Net.Http;
      using System.Net.WebSockets;
      static class McpRoomSocket
      {
        private static readonly HttpMessageInvoker invoker = new(CreateHandler());

        static WebSocket ConnectAsync()
        {
          var socket = new ClientWebSocket();
          return socket;
        }

        private static SocketsHttpHandler CreateHandler()
        {
          return new SocketsHttpHandler();
        }
        /*EXTRA*/
      }
      """;

  [Fact]
  public void AllowsTheRoomSocketShape()
  {
    var violations = FindViolations(
        [new SourceFile("Blok.Server.Mcp/Outbound/McpRoomSocket.cs", RoomSocketShape)]);

    Assert.Empty(violations);
  }

  [Theory]
  [InlineData("static SocketsHttpHandler Other() { return new SocketsHttpHandler(); }", "SocketsHttpHandler")]
  [InlineData("private static readonly HttpMessageInvoker second = new(CreateHandler());", "HttpMessageInvoker")]
  [InlineData("static object Open() { return new HttpMessageInvoker(CreateHandler()); }", "HttpMessageInvoker")]
  [InlineData("static object Open() { return new ClientWebSocket(); }", "ClientWebSocket")]
  [InlineData("static object Open() { return new HttpClient(); }", "HttpClient")]
  public void PinsTheRoomSocketToOneInvokerOverOneHandler(string extra, string expectedIdentifier)
  {
    var violation = Assert.Single(FindViolations(
        [new SourceFile("Blok.Server.Mcp/Outbound/McpRoomSocket.cs", RoomSocketShape.Replace("/*EXTRA*/", extra, StringComparison.Ordinal))]));

    Assert.Contains(expectedIdentifier, violation, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("private static readonly HttpMessageInvoker invoker = new(CreateHandler());", "HttpMessageInvoker")]
  [InlineData("return new SocketsHttpHandler();", "SocketsHttpHandler")]
  public void DetectsARoomSocketMissingItsInvokerOrHandler(string removed, string expectedIdentifier)
  {
    var source = RoomSocketShape.Replace(removed, removed.StartsWith("return", StringComparison.Ordinal) ? "return null!;" : string.Empty, StringComparison.Ordinal);
    var violation = Assert.Single(FindViolations(
        [new SourceFile("Blok.Server.Mcp/Outbound/McpRoomSocket.cs", source)]));

    Assert.Contains(expectedIdentifier, violation, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("var a = new ClientWebSocket(); var b = new ClientWebSocket();", "ClientWebSocket")]
  [InlineData("ClientWebSocket socket = new();", "ClientWebSocket")]
  [InlineData("var socket = new ClientWebSocket(); var client = new System.Net.Http.HttpClient();", "HttpClient")]
  public void PinsTheRoomSocketOwnerToOneCreationAndNothingElse(
      string body,
      string expectedIdentifier)
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server.Mcp/Outbound/McpRoomSocket.cs",
              "using System.Net.WebSockets;\n" +
              "static class McpRoomSocket { static object ConnectAsync() { " +
              body +
              " return null; } }"),
        ]));

    Assert.Contains(expectedIdentifier, violation, StringComparison.Ordinal);
  }

  [Fact]
  public void RefusesAClientWebSocketCreatedOutsideTheRoomSocketConnect()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server.Mcp/Outbound/McpRoomSocket.cs",
              "using System.Net.WebSockets;\n" +
              "static class McpRoomSocket { static object Open() { return new ClientWebSocket(); } }"),
        ]));

    Assert.Contains("ClientWebSocket", violation, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("Blok.Server.AspNetCore/Sneaky.cs")]
  [InlineData("Blok.Server/Collab/DocEndpointClient.cs")]
  [InlineData("Blok.Server/Storage/S3BlobStore.cs")]
  [InlineData("Blok.Server.Mcp/Outbound/McpHttpCaller.cs")]
  public void RestrictsClientWebSocketEverywhereIncludingThePinnedOwners(
      string path)
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              path,
              "var socket = new System.Net.WebSockets.ClientWebSocket();"),
        ]));

    Assert.Contains("ClientWebSocket", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void AllowsOnlyTheConfiguredClientSitesInsideTheDocEndpointExemption()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Collab/DocEndpointClient.cs",
              """
              using System.Net.Http;
              using System.Net.Sockets;
              sealed class DocEndpointClient
              {
                private readonly HttpClient client;

                internal DocEndpointClient(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                  var socket = new Socket(default, default, default);
                }

                private static SocketsHttpHandler CreateHandler()
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
  public void DetectsASecondDocEndpointClient()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Collab/DocEndpointClient.cs",
              """
              using System.Net.Http;
              sealed class DocEndpointClient
              {
                private readonly HttpClient client;
                private readonly HttpClient second;

                internal DocEndpointClient(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                  second = new HttpClient();
                }

                private static SocketsHttpHandler CreateHandler()
                {
                  return new SocketsHttpHandler();
                }
              }
              """),
        ]));

    Assert.Contains("HttpClient", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsADuplicatedApprovedDocEndpointClientCreation()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Collab/DocEndpointClient.cs",
              """
              using System.Net.Http;
              sealed class DocEndpointClient
              {
                private readonly HttpClient client;

                internal DocEndpointClient(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                  client = new HttpClient(handler, disposeHandler: true);
                }

                private static SocketsHttpHandler CreateHandler()
                {
                  return new SocketsHttpHandler();
                }
              }
              """),
        ]));

    Assert.Contains("HttpClient", violation, StringComparison.Ordinal);
  }

  [Fact]
  public void DetectsADocEndpointClientWithoutTheHandlerFactory()
  {
    var violation = Assert.Single(FindViolations(
        [
          new SourceFile(
              "Blok.Server/Collab/DocEndpointClient.cs",
              """
              using System.Net.Http;
              sealed class DocEndpointClient
              {
                private readonly HttpClient client;

                internal DocEndpointClient(HttpMessageHandler handler)
                {
                  client = new HttpClient(handler, disposeHandler: true);
                }
              }
              """),
        ]));

    Assert.Contains(
        "SocketsHttpHandler",
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

  private static List<string> FindViolations(
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
              !PinnedOwners.Contains(source.Path) ||
              ClassifyPinnedUse(use) == PinnedUseSite.None)
          .Where(use =>
              source.Path != RoomSocketOwner ||
              !IsAllowedRoomSocketUse(use, uses))
          .Select(use => use.Identifier)
          .ToHashSet(StringComparer.Ordinal);

      if (source.Path == RoomSocketOwner)
      {
        if (uses.Count(IsRoomInvokerField) != 1)
        {
          identifiers.Add("HttpMessageInvoker");
        }

        if (uses.Count(use => ClassifyPinnedUse(use) == PinnedUseSite.HandlerReturn) != 1 ||
            uses.Count(use => ClassifyPinnedUse(use) == PinnedUseSite.HandlerCreation) != 1)
        {
          identifiers.Add("SocketsHttpHandler");
        }
      }

      if (PinnedOwners.Contains(source.Path))
      {
        if (uses.Count(use =>
                ClassifyPinnedUse(use) == PinnedUseSite.ClientField) != 1 ||
            uses.Count(use =>
                ClassifyPinnedUse(use) == PinnedUseSite.ClientCreation) != 1)
        {
          identifiers.Add("HttpClient");
        }

        if (uses.Count(use =>
                ClassifyPinnedUse(use) == PinnedUseSite.HandlerReturn) != 1 ||
            uses.Count(use =>
                ClassifyPinnedUse(use) == PinnedUseSite.HandlerCreation) != 1)
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

  private static bool IsAllowedRoomSocketUse(RestrictedUse use, RestrictedUse[] uses)
  {
    return ((IsRoomSocketCreation(use) || IsRoomSocketVar(use)) && uses.Count(IsRoomSocketCreation) == 1) ||
        (IsRoomInvokerField(use) && uses.Count(IsRoomInvokerField) == 1) ||
        (ClassifyPinnedUse(use) is PinnedUseSite.HandlerReturn or PinnedUseSite.HandlerCreation &&
         uses.Count(other => ClassifyPinnedUse(other) == ClassifyPinnedUse(use)) == 1);
  }

  // `private static readonly HttpMessageInvoker invoker = new(CreateHandler());`
  private static bool IsRoomInvokerField(RestrictedUse use)
  {
    return use.Identifier == "HttpMessageInvoker" &&
        use.Node.Parent is VariableDeclarationSyntax declaration &&
        declaration.Type == use.Node &&
        declaration.Parent is FieldDeclarationSyntax &&
        declaration.Variables is
        [
        {
          Identifier.ValueText: "invoker",
          Initializer.Value: ImplicitObjectCreationExpressionSyntax
          {
            ArgumentList.Arguments:
            [
            {
              Expression: InvocationExpressionSyntax
              {
                Expression: IdentifierNameSyntax { Identifier.ValueText: "CreateHandler" },
              },
            },
            ],
          },
        },
        ];
  }

  private static bool IsRoomSocketCreation(RestrictedUse use)
  {
    return use.Identifier == "ClientWebSocket" &&
        use.Node.Parent is ObjectCreationExpressionSyntax creation &&
        creation.Type == use.Node &&
        creation.FirstAncestorOrSelf<MethodDeclarationSyntax>() is
        {
          Identifier.ValueText: "ConnectAsync",
        };
  }

  // `var socket = new ClientWebSocket();` resolves `var` to the type too.
  private static bool IsRoomSocketVar(RestrictedUse use)
  {
    return use.Node is IdentifierNameSyntax { IsVar: true } &&
        use.Node.Parent is VariableDeclarationSyntax
        {
          Variables: [{ Initializer.Value: ObjectCreationExpressionSyntax creation }],
        } &&
        IsRoomSocketCreation(new RestrictedUse("ClientWebSocket", creation.Type));
  }

  private static PinnedUseSite ClassifyPinnedUse(RestrictedUse use)
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
      return PinnedUseSite.ClientField;
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
      return PinnedUseSite.ClientCreation;
    }

    if (use.Identifier == "SocketsHttpHandler" &&
        use.Node.Parent is MethodDeclarationSyntax
        {
          Identifier.ValueText: "CreateHandler",
          ReturnType: var returnType,
        } &&
        returnType == use.Node)
    {
      return PinnedUseSite.HandlerReturn;
    }

    if (use.Identifier == "SocketsHttpHandler" &&
        use.Node.Parent is ObjectCreationExpressionSyntax handlerCreation &&
        handlerCreation.Type == use.Node &&
        handlerCreation.FirstAncestorOrSelf<MethodDeclarationSyntax>() is
        {
          Identifier.ValueText: "CreateHandler",
        })
    {
      return PinnedUseSite.HandlerCreation;
    }

    return PinnedUseSite.None;
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

  private enum PinnedUseSite
  {
    None,
    ClientField,
    ClientCreation,
    HandlerReturn,
    HandlerCreation,
  }

  private sealed record SourceFile(string Path, string Text);

  private sealed record RestrictedUse(
      string Identifier,
      SyntaxNode Node);
}
