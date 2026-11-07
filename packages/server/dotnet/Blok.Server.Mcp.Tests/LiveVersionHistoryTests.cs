using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The room's version history routes, as src/mcp/live/version-history.ts calls them.</summary>
public sealed class LiveVersionHistoryTests
{
  private const string Versions = """{"versions":[{"lineage":"L1","sequence":3,"actors":["a"]},{"lineage":"L1","sequence":0,"actors":[]}],"lineages":[{"lineage":"L1","current":true}]}""";

  [Fact]
  public async Task ARestoreLoadsTheVersionListAndTheVersion()
  {
    using var server = new Server((request, _) => request.Url!.AbsolutePath.EndsWith("/history", StringComparison.Ordinal)
        ? (200, Versions)
        : (200, """{"blocks":[]}"""));
    using var http = new McpHttpCaller();
    var history = new LiveVersionHistory(http, server.RoomUrl, null, null);

    var loaded = await history.LoadAsync(Batch("history.restore", new JsonObject { ["version"] = "L1:0" }), CancellationToken.None);

    Assert.Equal("L1:3", loaded?["versions"]?[0]?["version"]?.GetValue<string>());
    Assert.Equal("""{"blocks":[]}""", loaded?["documents"]?["L1:0"]?.ToJsonString());
    Assert.Equal(["/sync/doc/history", "/sync/doc/history/L1/0"], server.Paths);
  }

  [Fact]
  public async Task ARestorePostsWithItsKeyAndPinRetryingA401OnceWithAFreshTicket()
  {
    var answers = new Queue<int>([401, 200]);
    using var server = new Server((_, _) => (answers.Dequeue(), ""));
    using var http = new McpHttpCaller();
    var minted = new List<bool>();
    var history = new LiveVersionHistory(http, server.RoomUrl, "https://app.example.com", fresh =>
    {
      minted.Add(fresh);

      return Task.FromResult<string?>(fresh ? "t2" : "t1");
    });

    var refused = await history.RestoreAsync("L1:0", "L1:3", CancellationToken.None);

    Assert.Null(refused);
    Assert.Equal([false, true], minted);
    Assert.Equal(2, server.Requests.Count);
    Assert.All(server.Requests, request =>
    {
      Assert.Equal("POST", request.Method);
      Assert.Equal("/sync/doc/history/L1/0/restore", request.Path);
      Assert.Equal("\"L1:3\"", request.Headers["If-Match"]);
      Assert.Equal("https://app.example.com", request.Headers["Origin"]);
    });
    Assert.Equal("Bearer t1", server.Requests[0].Headers["Authorization"]);
    Assert.Equal("Bearer t2", server.Requests[1].Headers["Authorization"]);
    Assert.Equal(server.Requests[0].Headers["Blok-Idempotency-Key"], server.Requests[1].Headers["Blok-Idempotency-Key"]);
    Assert.True(Guid.TryParse(server.Requests[0].Headers["Blok-Idempotency-Key"], out _));
  }

  [Theory]
  [InlineData(412, """{"code":"STALE","message":"The document changed since the version history was read, so nothing was restored. Read it again, then retry.","commandIndex":0,"retryable":true}""")]
  [InlineData(404, """{"code":"VERSION_NOT_FOUND","message":"There is no version \"L1:0\". history.versions lists them.","path":"/commands/0/args/version","retryable":false,"commandIndex":0}""")]
  [InlineData(503, """{"code":"TOOL_ACTION_FAILED","message":"The version history failed: The sync server answered 503: busy","retryable":true,"commandIndex":0,"path":"/commands/0/args"}""")]
  [InlineData(500, """{"code":"TOOL_ACTION_FAILED","message":"The version history failed: The sync server answered 500: busy","retryable":false,"commandIndex":0,"path":"/commands/0/args"}""")]
  public async Task ARefusedRestoreIsTheErrorNodeAnswers(int status, string error)
  {
    using var server = new Server((_, _) => (status, "busy\n"));
    using var http = new McpHttpCaller();
    var history = new LiveVersionHistory(http, server.RoomUrl, null, null);

    var refused = await history.RestoreAsync("L1:0", "L1:3", CancellationToken.None);

    Assert.Equal(error, refused?.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
  }

  [Fact]
  public async Task APinTheServerCannotReadIsStaleWithNoRequest()
  {
    using var server = new Server((_, _) => (200, ""));
    using var http = new McpHttpCaller();
    var history = new LiveVersionHistory(http, server.RoomUrl, null, null);

    var refused = await history.RestoreAsync("L1:0", "nope", CancellationToken.None);

    Assert.Equal("STALE", refused?["code"]?.GetValue<string>());
    Assert.Empty(server.Requests);
  }

  private static string NothingListening()
  {
    var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);

    probe.Start();
    var port = ((IPEndPoint)probe.LocalEndpoint).Port;

    probe.Stop();

    return $"ws://127.0.0.1:{port}/sync/doc";
  }

  // Node's fetch error: "fetch failed", and no answer is worth a retry.
  [Fact]
  public async Task NoAnswerFromTheHistoryRouteIsWorthARetryInNodesWords()
  {
    using var http = new McpHttpCaller();
    var history = new LiveVersionHistory(http, NothingListening(), null, null);

    var loaded = await history.LoadAsync(Batch("history.versions", []), CancellationToken.None);
    var restore = await history.RestoreAsync("L1:0", null, CancellationToken.None);

    Assert.Equal("""{"failed":"The sync server could not be reached: fetch failed","retryable":true}""", loaded?.ToJsonString());
    Assert.Equal("The version history failed: The sync server could not be reached: fetch failed", restore?["message"]?.GetValue<string>());
    Assert.True(restore?["retryable"]?.GetValue<bool>());
  }

  // Node's ask() puts a refused mint's message after "The version history failed: ",
  // and a refusal says nothing of a retry. No request goes out without a ticket.
  [Fact]
  public async Task ARefusedTicketIsAFailedHistoryInNodesWords()
  {
    using var server = new Server((_, _) => (200, Versions));
    using var http = new McpHttpCaller();
    var history = new LiveVersionHistory(http, server.RoomUrl, null, _ =>
        throw Blok.Server.Mcp.Core.McpHostError.Surface("FORBIDDEN", "The host did not grant this document to this agent."));

    var loaded = await history.LoadAsync(Batch("history.versions", []), CancellationToken.None);
    var restore = await history.RestoreAsync("L1:0", null, CancellationToken.None);

    Assert.Equal("""{"failed":"The host did not grant this document to this agent."}""", loaded?.ToJsonString());
    Assert.Equal(
        """{"code":"TOOL_ACTION_FAILED","message":"The version history failed: The host did not grant this document to this agent.","retryable":false,"commandIndex":0,"path":"/commands/0/args"}""",
        restore?.ToJsonString());
    Assert.Empty(server.Requests);
  }

  private static JsonObject Batch(string name, JsonObject args) =>
      new() { ["commands"] = new JsonArray(new JsonObject { ["name"] = name, ["args"] = args }) };

  private sealed record Seen(string Method, string Path, Dictionary<string, string> Headers);

  private sealed class Server : IDisposable
  {
    private readonly HttpListener listener = new();
    private readonly Func<HttpListenerRequest, int, (int Status, string Body)> answer;

    internal Server(Func<HttpListenerRequest, int, (int Status, string Body)> answer)
    {
      this.answer = answer;
      var port = FreePort();

      listener.Prefixes.Add($"http://127.0.0.1:{port}/");
      listener.Start();
      RoomUrl = $"ws://127.0.0.1:{port}/sync/doc";
      _ = Task.Run(ServeAsync);
    }

    internal string RoomUrl { get; }

    internal List<Seen> Requests { get; } = [];

    internal List<string> Paths => [.. Requests.Select(request => request.Path)];

    public void Dispose()
    {
      listener.Close();
    }

    private async Task ServeAsync()
    {
      while (listener.IsListening)
      {
        HttpListenerContext context;

        try
        {
          context = await listener.GetContextAsync();
        }
        catch (Exception error) when (error is HttpListenerException or ObjectDisposedException)
        {
          return;
        }
        var request = context.Request;

        lock (Requests)
        {
          Requests.Add(new Seen(request.HttpMethod, request.Url!.AbsolutePath,
              request.Headers.AllKeys.OfType<string>().ToDictionary(key => key, key => request.Headers[key] ?? "", StringComparer.OrdinalIgnoreCase)));
        }
        var (status, body) = answer(request, Requests.Count);
        var bytes = Encoding.UTF8.GetBytes(body);

        context.Response.StatusCode = status;
        await context.Response.OutputStream.WriteAsync(bytes);
        context.Response.Close();
      }
    }

    private static int FreePort()
    {
      using var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);

      probe.Start();

      return ((IPEndPoint)probe.LocalEndpoint).Port;
    }
  }
}
