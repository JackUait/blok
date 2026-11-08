using Blok.Server.Mcp.Core;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Blok's tools on a server the host built (WithBlok), next to the host's own tools.</summary>
public sealed class LibraryEmbedTests : IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-embed-").FullName;
  private readonly List<string> asked = [];

  public LibraryEmbedTests()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"title":"Doc","blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private static McpServerTool HostTool(string name)
  {
    return McpServerTool.Create(
        (string? text) => new CallToolResult { Content = [new TextContentBlock { Text = text ?? string.Empty }] },
        new McpServerToolCreateOptions { Name = name, Description = "Echoes the text back." });
  }

  private static McpServerPrompt HostPrompt(string name)
  {
    return McpServerPrompt.Create(
        () => new GetPromptResult { Messages = [new PromptMessage { Role = Role.User, Content = new TextContentBlock { Text = "Hello from the host." } }] },
        new McpServerPromptCreateOptions { Name = name, Description = "Says hello." });
  }

  private async Task<(WebApplication App, HttpClient Client)> StartAsync(Action<IMcpServerBuilder>? host = null, Action<BlokMcpOptions>? configure = null)
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    var mcp = builder.Services
        .AddMcpServer(options => options.ServerInfo = new Implementation { Name = "host-test", Version = "1.0.0" })
        .WithHttpTransport(transport => transport.SessionMode = HttpServerSessionMode.Stateless);

    if (host is null)
    {
      mcp.WithTools([HostTool("host_echo")]).WithPrompts([HostPrompt("host_hello")]);
    }
    else
    {
      host(mcp);
    }
    mcp.WithBlok(options =>
    {
      options.FilesDirectory = dir;
      options.Authorize = (request, _) =>
      {
        lock (asked)
        {
          asked.Add($"{request.Principal} {(request.Write ? "write" : "read")} {request.DocumentId}");
        }

        return ValueTask.FromResult(true);
      };
      configure?.Invoke(options);
    });
    var app = builder.Build();

    app.UseTestSignIn();
    app.MapMcp("/mcp");
    try
    {
      await app.StartAsync();
    }
    catch
    {
      await app.DisposeAsync();
      throw;
    }

    return (app, app.GetTestClient());
  }

  private async Task<JsonArray> StandaloneToolsAsync()
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokMcp(options =>
    {
      options.FilesDirectory = dir;
      options.AllowEveryCallerEveryDocument = true;
    });
    await using var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();

    return (JsonArray)(await McpTestRpc.SendAsync(app.GetTestClient(), "tools/list", []))["result"]!["tools"]!;
  }

  [Fact]
  public async Task ListsTheHostsToolThenBloksToolsAsStandaloneListsThem()
  {
    var standalone = await StandaloneToolsAsync();
    var (app, client) = await StartAsync();

    await using (app)
    {
      var tools = (JsonArray)(await McpTestRpc.SendAsync(client, "tools/list", []))["result"]!["tools"]!;

      Assert.Equal("host_echo", (string?)tools[0]!["name"]);
      Assert.Equal(standalone.Select(tool => tool!.ToJsonString()), tools.Skip(1).Select(tool => tool!.ToJsonString()));
    }
  }

  [Fact]
  public async Task KeepsTheHostsServerInfoAndInstructionsAndAddsNoOthers()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var initialized = (await McpTestRpc.SendAsync(client, "initialize", new JsonObject
      {
        ["protocolVersion"] = "2025-11-25",
        ["capabilities"] = new JsonObject(),
        ["clientInfo"] = new JsonObject { ["name"] = "test", ["version"] = "1" },
      }))["result"]!;

      Assert.Equal("host-test", (string?)initialized["serverInfo"]?["name"]);
      Assert.Null(initialized["instructions"]);
      Assert.NotNull(initialized["capabilities"]?["tools"]);
      Assert.NotNull(initialized["capabilities"]?["prompts"]);
    }
  }

  [Fact]
  public async Task IBlokMcpGivesBloksInstructionsAndNames()
  {
    var (app, _) = await StartAsync();

    await using (app)
    {
      var blok = app.Services.GetRequiredService<IBlokMcp>();

      Assert.StartsWith("How to write rich text in Blok:", await blok.GetInstructionsAsync(), StringComparison.Ordinal);
      Assert.Contains("blok_open", await blok.GetToolNamesAsync());
      Assert.Contains("improve", await blok.GetPromptNamesAsync());
      Assert.False(string.IsNullOrEmpty(await blok.GetVersionAsync()));
    }
  }

  [Fact]
  public async Task TheSignedInUsersSubIsThePrincipalAndTheHostToolStillAnswers()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var echo = await McpTestRpc.CallAsync(client, "host_echo", new JsonObject { ["text"] = "hi" });
      var opened = await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" }, user: "alice");
      var read = await McpTestRpc.ToolAsync(client, "blok_read", new JsonObject { ["handle"] = opened["handle"]!.DeepClone() }, user: "alice");

      Assert.Equal("hi", (string?)echo["result"]?["content"]?[0]?["text"]);
      Assert.Equal("Doc", (string?)read["page"]?["title"]);
      Assert.Equal(["alice read doc", "alice read doc"], asked);
    }
  }

  [Fact]
  public async Task RefusesAnAnonymousCallerWithAProtocolError()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var refused = await McpTestRpc.CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" });

      Assert.Equal(-32600, (int?)refused["error"]?["code"]);
      Assert.Equal("Blok needs a signed-in caller.", (string?)refused["error"]?["message"]);
      Assert.Empty(asked);
    }
  }

  [Fact]
  public async Task RefusesACallerSignedInWithoutAName()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var refused = await McpTestRpc.SendAsync(
          client, "tools/call", new JsonObject { ["name"] = "blok_list_documents", ["arguments"] = new JsonObject() }, signedIn: true);

      Assert.Equal(-32600, (int?)refused["error"]?["code"]);
      Assert.Equal("Blok needs a named caller (sub or NameIdentifier).", (string?)refused["error"]?["message"]);
    }
  }

  [Fact]
  public async Task AnonymousPrincipalServesAnonymousCallers()
  {
    var (app, client) = await StartAsync(configure: options => options.AnonymousPrincipal = "guest");

    await using (app)
    {
      await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" });

      Assert.Equal(["guest read doc"], asked);
    }
  }

  [Fact]
  public async Task AHandleIsBoundToItsOpener()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var opened = await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" }, user: "alice");
      var stolen = await McpTestRpc.ToolAsync(client, "blok_read", new JsonObject { ["handle"] = opened["handle"]!.DeepClone() }, user: "bob");

      Assert.Equal("UNKNOWN_HANDLE", (string?)stolen["error"]?["code"]);
    }
  }

  [Fact]
  public async Task ScopeClaimsAreIgnoredButScopesTheCallerHookGivesAreEnforced()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      // The test sign-in puts a "scope" claim on the user that names no Blok scope.
      var writable = await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }, user: "alice");

      Assert.True((bool?)writable["write"]);
    }
    var (hooked, hookedClient) = await StartAsync(configure: options =>
        options.Caller = (context, _) => ValueTask.FromResult<BlokMcpCallerIdentity?>(new BlokMcpCallerIdentity("alice") { Scopes = ["blok.read"] }));

    await using (hooked)
    {
      var read = await McpTestRpc.ToolAsync(hookedClient, "blok_open", new JsonObject { ["documentId"] = "doc" });
      var write = await McpTestRpc.ToolAsync(hookedClient, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true });

      Assert.NotNull(read["handle"]);
      Assert.Equal("FORBIDDEN", (string?)write["error"]?["code"]);
    }
  }

  [Fact]
  public async Task ACallerHookReturningNullIsAnonymous()
  {
    var (app, client) = await StartAsync(configure: options => options.Caller = (_, _) => ValueTask.FromResult<BlokMcpCallerIdentity?>(null));

    await using (app)
    {
      var refused = await McpTestRpc.CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" }, user: "alice");

      Assert.Equal("Blok needs a signed-in caller.", (string?)refused["error"]?["message"]);
    }
  }

  [Fact]
  public async Task RefusesBloksOwnOAuthAtStart()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => StartAsync(configure: options =>
        options.OAuth = new BlokMcpOAuthOptions { Issuer = "https://issuer.example", Audience = "https://blok.example", JwksUri = new Uri("https://issuer.example/jwks") }));

    Assert.StartsWith("Blok's own OAuth is for the standalone server", refused.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task RefusesAPrincipalAtStart()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => StartAsync(configure: options => options.Principal = "someone"));

    Assert.StartsWith("principal names the standalone caller", refused.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("origins")]
  [InlineData("hosts")]
  [InlineData("remote")]
  public async Task RefusesTheEndpointsOwnGuardsAtStart(string guard)
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => StartAsync(configure: options =>
    {
      switch (guard)
      {
        case "origins":
          options.AllowedOrigins = ["https://app.example"];
          break;
        case "hosts":
          options.AllowedHosts = ["app.example"];
          break;
        default:
          options.TrustRemoteCallers = true;
          break;
      }
    }));

    Assert.Contains("MapBlokMcp", refused.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task RefusesToStartWithoutAPerDocumentCheck()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => StartAsync(configure: options => options.Authorize = null));

    Assert.Contains("needs a per-document check", refused.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task StartsWithATicketRouteAndNoSourceOrCheck()
  {
    var (app, _) = await StartAsync(configure: options =>
    {
      options.FilesDirectory = null;
      options.Authorize = null;
      options.SyncUrl = new Uri("ws://127.0.0.1:9/sync");
      options.TicketUrl = new Uri("http://127.0.0.1:9/tickets");
      options.TicketHostToken = "host-token";
    });

    await app.DisposeAsync();
  }

  [Fact]
  public async Task RefusesToStartWhenAHostToolHasABlokName()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => StartAsync(host: mcp => mcp.WithTools([HostTool("blok_open")])));

    Assert.Equal("Blok already serves blok_open: rename the host's tool or prompt", refused.Message);
  }

  [Fact]
  public async Task RefusesToStartWhenAHostPromptHasABlokName()
  {
    var refused = await Assert.ThrowsAsync<BlokMcpConfigException>(() => StartAsync(host: mcp => mcp.WithPrompts([HostPrompt("improve")])));

    Assert.Equal("Blok already serves improve: rename the host's tool or prompt", refused.Message);
  }

  [Fact]
  public async Task RefusesAListWhenTheHostsListHandlerGivesABlokName()
  {
    var (app, client) = await StartAsync(host: mcp => mcp.WithListToolsHandler((_, _) =>
        ValueTask.FromResult(new ListToolsResult { Tools = [new Tool { Name = "blok_read", InputSchema = JsonDocumentOf("""{"type":"object"}""") }] })));

    await using (app)
    {
      var refused = await McpTestRpc.SendAsync(client, "tools/list", []);

      Assert.Null(refused["result"]);
      Assert.Contains("Blok already serves blok_read", (string?)refused["error"]?["message"], StringComparison.Ordinal);
    }
  }

  [Fact]
  public async Task KeepsTheHostsListAndCallHandlers()
  {
    var (app, client) = await StartAsync(host: mcp => mcp
        .WithListToolsHandler((_, _) => ValueTask.FromResult(new ListToolsResult { Tools = [new Tool { Name = "host_add", InputSchema = JsonDocumentOf("""{"type":"object"}""") }] }))
        .WithCallToolHandler((context, _) => ValueTask.FromResult(new CallToolResult { Content = [new TextContentBlock { Text = $"host ran {context.Params?.Name}" }] })));

    await using (app)
    {
      var tools = (JsonArray)(await McpTestRpc.SendAsync(client, "tools/list", []))["result"]!["tools"]!;
      var hostRan = await McpTestRpc.CallAsync(client, "host_add", []);
      var opened = await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" }, user: "alice");

      Assert.Equal("host_add", (string?)tools[0]!["name"]);
      Assert.Contains(tools, tool => (string?)tool!["name"] == "blok_open");
      Assert.Equal("host ran host_add", (string?)hostRan["result"]?["content"]?[0]?["text"]);
      Assert.NotNull(opened["handle"]);
    }
  }

  [Fact]
  public async Task WorksUnderAHostsAlternateCallHandler()
  {
#pragma warning disable MCPEXP002 // The host's own choice of an experimental SDK handler.
    var (app, client) = await StartAsync(host: mcp => mcp.Services.Configure<McpServerOptions>(options =>
        options.Handlers.CallToolWithAlternateHandler = (_, _) => ValueTask.FromResult<ResultOrAlternate<CallToolResult>>(new CallToolResult
        {
          Content = [new TextContentBlock { Text = "host" }],
        })));
#pragma warning restore MCPEXP002

    await using (app)
    {
      var hostRan = await McpTestRpc.CallAsync(client, "anything", []);
      var opened = await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = "doc" }, user: "alice");

      Assert.Equal("host", (string?)hostRan["result"]?["content"]?[0]?["text"]);
      Assert.NotNull(opened["handle"]);
    }
  }

  [Fact]
  public async Task AToolNeitherServesFallsThroughToTheSdk()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var unknown = await McpTestRpc.CallAsync(client, "nope", [], user: "alice");

      Assert.Equal(-32602, (int?)unknown["error"]?["code"]);
      Assert.Equal("Unknown tool: 'nope'", (string?)unknown["error"]?["message"]);
    }
  }

  [Fact]
  public async Task ServesBloksPromptsBesideTheHosts()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var prompts = (JsonArray)(await McpTestRpc.SendAsync(client, "prompts/list", []))["result"]!["prompts"]!;
      var hello = await McpTestRpc.SendAsync(client, "prompts/get", new JsonObject { ["name"] = "host_hello" });
      var improve = await McpTestRpc.SendAsync(client, "prompts/get", new JsonObject { ["name"] = "improve", ["arguments"] = new JsonObject { ["selection"] = "Hi" } });
      var refused = await McpTestRpc.SendAsync(client, "prompts/get", new JsonObject { ["name"] = "improve" });

      Assert.Equal("host_hello", (string?)prompts[0]!["name"]);
      Assert.Contains(prompts, prompt => (string?)prompt!["name"] == "improve");
      Assert.Equal("Hello from the host.", (string?)hello["result"]?["messages"]?[0]?["content"]?["text"]);
      Assert.Equal("Improve writing", (string?)improve["result"]?["description"]);
      Assert.Equal(-32602, (int?)refused["error"]?["code"]);
      Assert.Equal("Prompt improve needs the selection argument.", (string?)refused["error"]?["message"]);
    }
  }

  [Fact]
  public async Task StandaloneKeepsBloksOwnUnknownToolAndPromptWords()
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokMcp(options =>
    {
      options.FilesDirectory = dir;
      options.AllowEveryCallerEveryDocument = true;
    });
    await using var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();
    var client = app.GetTestClient();
    var tool = await McpTestRpc.CallAsync(client, "blok_nope", []);
    var prompt = await McpTestRpc.SendAsync(client, "prompts/get", new JsonObject { ["name"] = "nope" });

    Assert.Equal("Unknown tool: blok_nope", (string?)tool["error"]?["message"]);
    Assert.Equal("Unknown prompt: nope", (string?)prompt["error"]?["message"]);
  }

  private static System.Text.Json.JsonElement JsonDocumentOf(string json)
  {
    using var document = System.Text.Json.JsonDocument.Parse(json);

    return document.RootElement.Clone();
  }
}
