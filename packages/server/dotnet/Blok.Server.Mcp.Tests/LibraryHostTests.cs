using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.AspNetCore;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class LibraryHostTests : IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-library-").FullName;

  public LibraryHostTests()
  {
    File.WriteAllText(Path.Combine(dir, "open.json"), """{"title":"Open","blocks":[]}""");
    File.WriteAllText(Path.Combine(dir, "secret.json"), """{"title":"Secret","blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private sealed class OnlyOpen : IBlokAuthorization
  {
    public List<string> Asked { get; } = [];

    public ValueTask<bool> CanReadDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    {
      Asked.Add($"{user.FindFirst("sub")?.Value} read {documentId}");

      return ValueTask.FromResult(documentId == "open");
    }

    public ValueTask<bool> CanWriteDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    {
      Asked.Add($"{user.FindFirst("sub")?.Value} write {documentId}");

      return ValueTask.FromResult(false);
    }
  }

  private async Task<(WebApplication App, HttpClient Client)> StartAsync(Action<IServiceCollection>? services = null)
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    services?.Invoke(builder.Services);
    builder.Services.AddBlokMcp(options =>
    {
      options.FilesDirectory = dir;
      options.Principal = "alice";
    });
    var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();

    return (app, app.GetTestClient());
  }

  private static async Task<JsonObject> CallAsync(HttpClient client, string name, JsonObject arguments)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
    {
      Content = new StringContent(
          new JsonObject
          {
            ["jsonrpc"] = "2.0",
            ["id"] = 1,
            ["method"] = "tools/call",
            ["params"] = new JsonObject { ["name"] = name, ["arguments"] = arguments },
          }.ToJsonString(),
          Encoding.UTF8,
          "application/json"),
    };

    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
    request.Headers.Add("MCP-Protocol-Version", "2025-11-25");
    using var response = await client.SendAsync(request);
    var text = await response.Content.ReadAsStringAsync();
    var data = text.Split('\n').First(line => line.StartsWith("data:", StringComparison.Ordinal))[5..];

    return (JsonObject)JsonNode.Parse(data)!["result"]!["structuredContent"]!;
  }

  [Fact]
  public async Task ServesTheToolsOverTheMappedEndpoint()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      var listing = await CallAsync(client, "blok_list_documents", []);

      Assert.Equal(
          """{"documents":[{"id":"open","title":"Open","live":false},{"id":"secret","title":"Secret","live":false}],"nextCursor":null,"supported":true}""",
          listing.ToJsonString());
    }
  }

  [Fact]
  public async Task AsksTheRegisteredBlokAuthorizationForTheConfiguredPrincipal()
  {
    var rules = new OnlyOpen();
    var (app, client) = await StartAsync(services => services.AddSingleton<IBlokAuthorization>(rules));

    await using (app)
    {
      var refused = await CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "secret" });
      var readOnly = await CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "open", ["write"] = true });
      var opened = await CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "open" });

      Assert.Equal("FORBIDDEN", (string?)refused["error"]?["code"]);
      Assert.Equal("FORBIDDEN", (string?)readOnly["error"]?["code"]);
      Assert.Equal("stored", (string?)opened["mode"]);
      Assert.Equal(["alice read secret", "alice read open", "alice write open", "alice read open"], rules.Asked);
    }
  }

  [Fact]
  public async Task LeavesTheAppsDefaultSchemeAloneWithoutOAuth()
  {
    var (app, _) = await StartAsync();

    await using (app)
    {
      var schemes = app.Services.GetService<Microsoft.AspNetCore.Authentication.IAuthenticationSchemeProvider>();

      Assert.True(schemes is null || (await schemes.GetAllSchemesAsync()).All(scheme => scheme.Name != "BlokMcpBearer"));
    }
  }

  [Fact]
  public async Task AnswersGetWith405()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      using var response = await client.GetAsync(new Uri("/mcp", UriKind.Relative));

      Assert.Equal(405, (int)response.StatusCode);
      Assert.Equal("POST", response.Content.Headers.Allow.Single());
    }
  }
}
