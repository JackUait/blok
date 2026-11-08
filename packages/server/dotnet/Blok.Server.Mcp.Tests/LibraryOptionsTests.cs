using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The library's options that mirror Node's createBlokMcpServer (packages/mcp/types/index.d.ts).</summary>
public sealed class LibraryOptionsTests : IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-options-").FullName;

  public LibraryOptionsTests()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private static async Task<(WebApplication App, HttpClient Client)> StartAsync(Action<BlokMcpOptions> configure)
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokMcp(options =>
    {
      options.AllowEveryCallerEveryDocument = true;
      configure(options);
    });
    var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();

    return (app, app.GetTestClient());
  }

  private static async Task<JsonNode> RpcAsync(HttpClient client, string method, JsonObject parameters)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
    {
      Content = new StringContent(
          new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = method, ["params"] = parameters }.ToJsonString(), Encoding.UTF8, "application/json"),
    };

    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
    request.Headers.Add("MCP-Protocol-Version", "2025-11-25");
    using var response = await client.SendAsync(request);
    var text = await response.Content.ReadAsStringAsync();

    return JsonNode.Parse(text.Split('\n').First(line => line.StartsWith("data:", StringComparison.Ordinal))[5..])!["result"]!;
  }

  [Fact]
  public async Task PageTitlesTurnsOnThePageCommands()
  {
    var (app, client) = await StartAsync(options => options.PageTitles = "page-map");

    await using (app)
    {
      Assert.Contains("page.rename", (await RpcAsync(client, "tools/list", [])).ToJsonString(), StringComparison.Ordinal);
    }
  }

  [Fact]
  public async Task RefusesABadManifestOrOverridesWithNodesWords()
  {
    var manifest = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options => options.Manifest = new JsonObject { ["tools"] = 5 }));
    var pageTitles = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options => options.PageTitles = "pages"));

    Assert.Equal("Invalid --manifest file: Not a Blok custom tools file: / missing required field \"formatVersion\"; / missing required field \"blocks\"", manifest.Message);
    Assert.Equal("pageTitles must be one of off, page-map, got \"pages\"", pageTitles.Message);
  }

  // Node's createBlokMcpServer refuses these in the shared check, in these words.
  [Fact]
  public async Task RefusesBadSchemaAndHandleOptionsWithNodesWords()
  {
    var refusals = new (Action<BlokMcpOptions> Set, string Message)[]
    {
      (options => options.Schema = "bogus", "schema must be one of envelope, full, mixed, got \"bogus\""),
      (options => options.HandleIdleTimeout = TimeSpan.Zero, "handleIdleMs must be a positive integer, got 0"),
      (options => options.HandleIdleTimeout = TimeSpan.FromTicks(15_000), "handleIdleMs must be a positive integer, got 1.5"),
      (options => options.MaxHandlesPerPrincipal = 0, "maxHandlesPerPrincipal must be a positive integer, got 0"),
    };

    foreach (var (set, message) in refusals)
    {
      Assert.Equal(message, (await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(set))).Message);
    }
  }

  // Measured on Node: hiding table changes tools/list.
  [Fact]
  public async Task OverridesHideATool()
  {
    var (plain, plainClient) = await StartAsync(_ => { });
    var (hidden, hiddenClient) = await StartAsync(options => options.Overrides = new JsonObject { ["table"] = new JsonObject { ["hidden"] = true } });

    await using (plain)
    await using (hidden)
    {
      Assert.NotEqual((await RpcAsync(plainClient, "tools/list", [])).ToJsonString(), (await RpcAsync(hiddenClient, "tools/list", [])).ToJsonString());
    }
  }

  [Fact]
  public async Task RunsNodesSyncAndTicketChecks()
  {
    var noToken = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options =>
    {
      options.SyncUrl = new Uri("ws://127.0.0.1:1/sync");
      options.TicketUrl = new Uri("http://127.0.0.1:1/tickets");
    }));
    var noTickets = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options => options.SyncUrl = new Uri("ws://127.0.0.1:1/sync")));

    Assert.Equal("--ticket-url needs BLOK_MCP_HOST_TOKEN", noToken.Message);
    Assert.StartsWith("--sync-url needs a ticket mode", noTickets.Message, StringComparison.Ordinal);
  }

  [Fact]
  public async Task APageCreatorNeedsStoredModeWithASource()
  {
    var creator = new HostPageCreatorTests.FakeCreator("host-1");
    var live = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options =>
    {
      options.FilesDirectory = dir;
      options.PageTitles = "page-map";
      options.PageCreator = creator;
      options.SyncUrl = new Uri("ws://127.0.0.1:1/sync");
      options.TicketSecret = "secret";
    }));
    var noSource = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options =>
    {
      options.PageTitles = "page-map";
      options.PageCreator = creator;
    }));
    var rooms = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(options =>
    {
      options.FilesDirectory = dir;
      options.PageTitles = "page-map";
      options.PageCreator = creator;
      options.LiveRooms = true;
    }));

    Assert.Equal("--create-page works in stored mode only: it cannot be used with live rooms (--sync-url)", live.Message);
    Assert.Equal("--create-page needs a document source (--source): the agent opens each new page through it", noSource.Message);
    Assert.Equal("BlokMcpOptions.PageCreator works in stored mode only: it cannot be used with LiveRooms.", rooms.Message);
  }

  [Fact]
  public async Task APageCreatorRegisteredInTheContainerIsNotPickedUp()
  {
    var creator = new HostPageCreatorTests.FakeCreator("host-1");
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton<Blok.Server.Agent.IBlokPageCreator>(creator);
    builder.Services.AddBlokMcp(options =>
    {
      options.AllowEveryCallerEveryDocument = true;
      options.FilesDirectory = dir;
      options.PageTitles = "page-map";
    });
    await using var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();
    var client = app.GetTestClient();
    var opened = await RpcAsync(client, "tools/call", new JsonObject { ["name"] = "blok_open", ["arguments"] = new JsonObject { ["documentId"] = "doc", ["write"] = true } });
    var handle = opened["structuredContent"]!["handle"]!.GetValue<string>();
    var ran = await RpcAsync(client, "tools/call", new JsonObject
    {
      ["name"] = "blok_execute",
      ["arguments"] = new JsonObject { ["handle"] = handle, ["commands"] = new JsonArray(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page" } }) },
    });

    Assert.True(ran["structuredContent"]!["ok"]!.GetValue<bool>());
    Assert.Empty(creator.Requests);
  }

  // Node's hostDecides: with a ticket URL and no source, the host's ticket route is the per-document check.
  [Fact]
  public async Task StartsWithoutAPerDocumentCheckWhenTheHostsTicketsDecide()
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokMcp(options =>
    {
      options.SyncUrl = new Uri("ws://127.0.0.1:1/sync");
      options.TicketUrl = new Uri("http://127.0.0.1:1/tickets");
      options.TicketHostToken = "host-token";
    });
    await using var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();
  }

  [Fact]
  public async Task WritesAsTheHostsAgentActor()
  {
    var (app, client) = await StartAsync(options =>
    {
      options.FilesDirectory = dir;
      options.AgentActor = (principal, clientName) => new BlokMcpAgentActor("bot-1", "Helper") { OnBehalfOf = principal };
    });

    await using (app)
    {
      var open = await RpcAsync(client, "tools/call", new JsonObject { ["name"] = "blok_open", ["arguments"] = new JsonObject { ["documentId"] = "doc", ["write"] = true } });
      var handle = (string)open["structuredContent"]!["handle"]!;

      await RpcAsync(client, "tools/call", new JsonObject
      {
        ["name"] = "blok_execute",
        ["arguments"] = new JsonObject
        {
          ["handle"] = handle,
          ["commands"] = new JsonArray(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "paragraph", ["data"] = new JsonObject { ["text"] = "hi" } } }),
        },
      });
    }

    Assert.Contains("\"bot-1\"", await File.ReadAllTextAsync(Path.Combine(dir, "doc.json")), StringComparison.Ordinal);
  }
}
