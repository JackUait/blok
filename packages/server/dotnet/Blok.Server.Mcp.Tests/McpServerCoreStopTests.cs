using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Stop (server.ts assembleMcp stop) and handle lifetime through the dispatcher.</summary>
public sealed class McpServerCoreStopTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-stop-").FullName;
  private readonly BundleFixture fixture;

  public McpServerCoreStopTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private McpServerCore Core(McpAuthorize authorize, double maxHandles = 8)
  {
    return new McpServerCore(fixture.Host.Bundle, new McpConfig
    {
      Source = new McpSourceConfig.Files(dir),
      Authorize = authorize,
      MaxHandlesPerPrincipal = maxHandles,
    }, new McpHttpCaller());
  }

  private static Task<McpCallResult> OpenAsync(McpServerCore core, McpCaller caller)
  {
    return core.CallToolAsync("blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }, caller, null, CancellationToken.None);
  }

  [Fact]
  public async Task StopWaitsForACallInFlight()
  {
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var gate = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    await using var core = Core((_, _, _, _) =>
    {
      entered.TrySetResult();

      return gate.Task;
    });
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var open = OpenAsync(core, caller);

    await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
    var stop = core.StopAsync();
    await Task.Delay(200);

    Assert.False(open.IsCompleted);
    Assert.False(stop.IsCompleted);
    gate.SetResult(true);
    await stop.WaitAsync(TimeSpan.FromSeconds(10));
    Assert.True(open.IsCompleted);
  }

  [Fact]
  public async Task StopGivesUpOnACallThatNeverEnds()
  {
    await using var core = Core((_, _, _, _) => new TaskCompletionSource<bool>().Task);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    _ = OpenAsync(core, caller);

    core.StopDrain = TimeSpan.FromMilliseconds(300);
    await core.StopAsync().WaitAsync(TimeSpan.FromSeconds(10));
  }

  [Fact]
  public async Task ACloseRefusedForLostAccessStillFreesTheHandlesPlace()
  {
    var allowed = true;
    await using var core = Core((_, _, _, _) => Task.FromResult(allowed), maxHandles: 1);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = McpJson.String((await OpenAsync(core, caller)).Answer?["structuredContent"]?["handle"]);

    allowed = false;
    var closed = await core.CallToolAsync("blok_close", new JsonObject { ["handle"] = handle }, caller, null, CancellationToken.None);
    allowed = true;
    var reopened = await OpenAsync(core, caller);

    Assert.Equal("FORBIDDEN", McpJson.String(closed.Answer?["structuredContent"]?["error"]?["code"]));
    Assert.Equal(false, McpJson.Bool(reopened.Answer?["isError"]));
  }

  [Fact]
  public async Task ACallOnAHandleGoesOnOnlyOnceTheCallBeforeItJoinedTheQueue()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var started = new List<int>();
    var joined = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var first = core.InArrivalOrderAsync("h", async () =>
    {
      started.Add(1);
      await joined.Task;
      HandleArrival.Joined();
      await Task.Delay(100);

      return 1;
    });
    var second = core.InArrivalOrderAsync("h", () =>
    {
      started.Add(2);

      return Task.FromResult(2);
    });

    await Task.Delay(100);
    Assert.Equal([1], started);
    joined.SetResult();
    await second.WaitAsync(TimeSpan.FromSeconds(10));
    Assert.False(first.IsCompleted);
    Assert.Equal([1, 2], started);
  }
}
