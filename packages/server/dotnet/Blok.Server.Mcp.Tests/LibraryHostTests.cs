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

  private sealed class SeesRoles : IBlokAuthorization
  {
    public List<string> Seen { get; } = [];

    public ValueTask<bool> CanReadDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    {
      Seen.Add($"{user.FindFirst("sub")?.Value} {user.FindFirst("role")?.Value}");

      return ValueTask.FromResult(true);
    }

    public ValueTask<bool> CanWriteDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    {
      return ValueTask.FromResult(true);
    }
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

  private async Task<(WebApplication App, HttpClient Client)> StartAsync(Action<IServiceCollection>? services = null, Action<BlokMcpOptions>? configure = null, ClaimsPrincipal? user = null)
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    services?.Invoke(builder.Services);
    builder.Services.AddBlokMcp(options =>
    {
      options.FilesDirectory = dir;
      options.Principal = "alice";
      if (configure is null)
      {
        options.AllowEveryCallerEveryDocument = true;
      }
      configure?.Invoke(options);
    });
    var app = builder.Build();

    if (user is not null)
    {
      app.Use((context, next) =>
      {
        context.User = user;

        return next(context);
      });
    }
    app.MapBlokMcp();
    await app.StartAsync();

    return (app, app.GetTestClient());
  }

  private static HttpRequestMessage ListRequest(string? origin, string? host)
  {
    var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
    {
      Content = new StringContent(
          """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blok_list_documents","arguments":{}}}""",
          Encoding.UTF8,
          "application/json"),
    };

    request.Headers.TryAddWithoutValidation("Accept", "application/json, text/event-stream");
    request.Headers.Add("MCP-Protocol-Version", "2025-11-25");
    if (origin is not null)
    {
      request.Headers.TryAddWithoutValidation("Origin", origin);
    }
    if (host is not null)
    {
      request.Headers.Host = host;
    }

    return request;
  }

  private static async Task<int> StatusAsync(HttpClient client, string? origin, string? host = null)
  {
    using var request = ListRequest(origin, host);
    using var response = await client.SendAsync(request);

    return (int)response.StatusCode;
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

  // Node's HTTP server needs a per-document check: OAuth names the caller, not what it may open.
  [Fact]
  public async Task RefusesToStartWithNoPerDocumentCheck()
  {
    var bare = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(configure: _ => { }));
    var oauthOnly = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(configure: options =>
        options.OAuth = new BlokMcpOAuthOptions { Issuer = "https://issuer.test", Audience = "https://mcp.test/mcp", JwksUri = new Uri("https://issuer.test/jwks") }));

    Assert.Contains("AllowEveryCallerEveryDocument", bare.Message, StringComparison.Ordinal);
    Assert.Equal(bare.Message, oauthOnly.Message);
  }

  [Fact]
  public async Task StartsWithAnAuthorizeHookOrABlokAuthorizationRegisteredAfterIt()
  {
    var (hooked, _) = await StartAsync(configure: options => options.Authorize = (_, _) => ValueTask.FromResult(true));
    await hooked.DisposeAsync();
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokMcp(options => options.FilesDirectory = dir);
    builder.Services.AddSingleton<IBlokAuthorization>(new OnlyOpen());
    await using var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();
  }

  [Fact]
  public async Task RunsNodesUploadLimitChecks()
  {
    var error = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(configure: options =>
    {
      options.AllowEveryCallerEveryDocument = true;
      options.Uploads = new BlokMcpUploads
      {
        Uploader = new BlokMcpUploader { UploadByFile = (_, _, _) => ValueTask.FromResult(new BlokMcpUploadedFile(new Uri("https://cdn.test/a"))) },
        Limits = new Dictionary<string, BlokMcpUploadLimits> { ["pdf"] = new() },
      };
    }));

    Assert.Equal("uploads.limits.pdf is not a kind: use image, video, audio or file", error.Message);
  }

  // A web page the user visits must not drive the agent's tools (Node: loopback pages only).
  [Fact]
  public async Task RefusesAForeignOriginAndTakesALoopbackOneOrNone()
  {
    var (app, client) = await StartAsync();

    await using (app)
    {
      Assert.Equal(403, await StatusAsync(client, "https://evil.example"));
      Assert.Equal(403, await StatusAsync(client, "http://localhost.evil.example:3000"));
      Assert.Equal(200, await StatusAsync(client, "http://localhost:3000"));
      Assert.Equal(200, await StatusAsync(client, "http://127.0.0.1"));
      Assert.Equal(200, await StatusAsync(client, null));
    }
  }

  [Fact]
  public async Task TakesOnlyTheConfiguredOriginsAndHosts()
  {
    var (app, client) = await StartAsync(configure: options =>
    {
      options.AllowEveryCallerEveryDocument = true;
      options.AllowedOrigins = ["https://app.example"];
      options.AllowedHosts = ["mcp.example"];
    });

    await using (app)
    {
      Assert.Equal(200, await StatusAsync(client, "https://app.example", "mcp.example"));
      Assert.Equal(200, await StatusAsync(client, null, "MCP.example:8443"));
      Assert.Equal(403, await StatusAsync(client, "http://localhost:3000", "mcp.example"));
      Assert.Equal(403, await StatusAsync(client, null, "attacker.example"));
    }
  }

  [Fact]
  public async Task GivesTheHostsRulesTheSignedInUser()
  {
    var rules = new SeesRoles();
    var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "bob"), new Claim("role", "editor")], "host"));
    var (app, client) = await StartAsync(services => services.AddSingleton<IBlokAuthorization>(rules), _ => { }, user);

    await using (app)
    {
      var opened = await CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "open" });

      Assert.Equal("stored", (string?)opened["mode"]);
      Assert.Equal(["bob editor"], rules.Seen);
    }
  }

  // Node never gives a signed-in caller the default principal: a token naming no one is refused.
  [Fact]
  public async Task RefusesASignedInUserWhoIsNotNamed()
  {
    var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim("role", "editor")], "host"));
    var (app, client) = await StartAsync(user: user);

    await using (app)
    {
      Assert.Equal(401, await StatusAsync(client, null));
    }
  }

  // The 401's WWW-Authenticate names this URL, so the app must serve it.
  [Fact]
  public async Task ServesTheProtectedResourceMetadataWithOAuth()
  {
    var (app, client) = await StartAsync(configure: options =>
    {
      options.Authorize = (_, _) => ValueTask.FromResult(true);
      options.OAuth = new BlokMcpOAuthOptions { Issuer = "https://issuer.test", Audience = "https://mcp.test/mcp", JwksUri = new Uri("https://issuer.test/jwks") };
    });

    await using (app)
    {
      using var response = await client.GetAsync(new Uri("/.well-known/oauth-protected-resource", UriKind.Relative));

      Assert.Equal(200, (int)response.StatusCode);
      Assert.Equal(
          """{"resource":"https://mcp.test/mcp","authorization_servers":["https://issuer.test"],"scopes_supported":["blok.read","blok.write"],"bearer_methods_supported":["header"]}""",
          await response.Content.ReadAsStringAsync());
    }
  }

  // As blok-mcp's stop: the app's shutdown waits for a call in flight, so its answer goes out.
  [Fact]
  public async Task ShutdownWaitsForACallInFlight()
  {
    var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    var asked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var (app, client) = await StartAsync(configure: options => options.Authorize = async (_, _) =>
    {
      asked.TrySetResult();

      return await release.Task;
    });

    await using (app)
    {
      var call = CallAsync(client, "blok_open", new JsonObject { ["documentId"] = "open" });

      await asked.Task.WaitAsync(TimeSpan.FromSeconds(10));
      var stop = app.StopAsync();

      await Task.Delay(500);
      Assert.False(stop.IsCompleted);
      release.SetResult(true);
      await stop.WaitAsync(TimeSpan.FromSeconds(10));
      // Its answer still goes out: an open that lands after stop is refused, as Node's handles do.
      Assert.Equal("The server is shutting down.", (string?)(await call)["error"]?["message"]);
    }
  }
}
