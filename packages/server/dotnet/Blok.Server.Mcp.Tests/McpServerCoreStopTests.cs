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
    var first = core.InArrivalOrderAsync("h", null, async () =>
    {
      started.Add(1);
      await joined.Task;
      HandleArrival.Joined();
      await Task.Delay(100);

      return 1;
    });
    var second = core.InArrivalOrderAsync("h", null, () =>
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

  [Fact]
  public async Task APlaceTakenWhenTheRequestWasReadComesBeforeALaterOne()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var started = new List<string>();

    core.Reserve("1", "h");
    core.Reserve("2", "h");
    var second = core.InArrivalOrderAsync("h", "2", () =>
    {
      started.Add("2");

      return Task.FromResult(2);
    });
    await Task.Delay(100);
    Assert.Empty(started);

    var first = core.InArrivalOrderAsync("h", "1", () =>
    {
      started.Add("1");

      return Task.FromResult(1);
    });

    await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(10));
    Assert.Equal(["1", "2"], started);
  }

  [Fact]
  public async Task AnAnsweredRequestThatNeverRanGivesItsPlaceUp()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));

    core.Reserve("1", "h");
    core.Unreserve("1");

    Assert.Equal(2, await core.InArrivalOrderAsync("h", null, () => Task.FromResult(2)).WaitAsync(TimeSpan.FromSeconds(10)));
  }

  [Fact]
  public async Task StdinTakesHandlePlacesInTheOrderTheLinesArrive()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var wire = "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_execute\",\"arguments\":{\"handle\":\"h\"}}}\n"
        + "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_execute\",\"arguments\":{\"handle\":\"h\"}}}\n";
    await using var input = new Blok.Server.Mcp.Protocol.McpOrderedInput(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(wire)), core);
    var buffer = new byte[7];

    while (await input.ReadAsync(buffer) > 0)
    {
    }
    var started = new List<string>();
    var third = core.InArrivalOrderAsync("h", "3", () =>
    {
      started.Add("3");

      return Task.FromResult(3);
    });
    await Task.Delay(100);
    var second = core.InArrivalOrderAsync("h", "2", () =>
    {
      started.Add("2");

      return Task.FromResult(2);
    });

    await Task.WhenAll(second, third).WaitAsync(TimeSpan.FromSeconds(10));
    Assert.Equal(["2", "3"], started);
  }

  [Fact]
  public async Task AStdinMessageOverTenMebibytesEndsTheInputAndIsNeverPassedOn()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var big = new string('x', Blok.Server.Mcp.Protocol.McpOrderedInput.MaxMessageBytes + 1);
    var wire = System.Text.Encoding.UTF8.GetBytes($"{{\"id\":1}}\n{big}\n{{\"id\":2}}\n");
    await using var input = new Blok.Server.Mcp.Protocol.McpOrderedInput(new MemoryStream(wire), core);
    using var passed = new MemoryStream();

    await input.CopyToAsync(passed);

    Assert.Equal("{\"id\":1}\n", System.Text.Encoding.UTF8.GetString(passed.ToArray()));
  }

  [Fact]
  public async Task AStdinMessageOfTenMebibytesIsPassedOnWhole()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var line = new string('x', Blok.Server.Mcp.Protocol.McpOrderedInput.MaxMessageBytes);
    await using var input = new Blok.Server.Mcp.Protocol.McpOrderedInput(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(line + "\n")), core);
    using var passed = new MemoryStream();

    await input.CopyToAsync(passed);

    Assert.Equal(line.Length + 1, passed.Length);
  }

  [Fact]
  public async Task StdinDropsAParamsThatIsNotAnObjectAndReadsARepeatedKeyAsItsLastValue()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var wire = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":\"x\"}\n"
        + "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_read\",\"arguments\":\"x\"}}\n"
        + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_execute\",\"arguments\":{\"handle\":\"other\",\"handle\":\"h\"}}}\n"
        + "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_execute\",\"arguments\":{\"handle\":\"h\"}}}\n";
    await using var input = new Blok.Server.Mcp.Protocol.McpOrderedInput(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(wire)), core);
    using var passed = new MemoryStream();

    await input.CopyToAsync(passed);
    // Node's SDK never answers the first line, so the SDK here never gets it.
    Assert.Equal(
        "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_read\",\"arguments\":\"x\"}}\n"
        + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_execute\",\"arguments\":{\"handle\":\"h\"}}}\n"
        + "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_execute\",\"arguments\":{\"handle\":\"h\"}}}\n",
        System.Text.Encoding.UTF8.GetString(passed.ToArray()));
    var started = new List<string>();
    var third = core.InArrivalOrderAsync("h", "3", () =>
    {
      started.Add("3");

      return Task.FromResult(3);
    });
    await Task.Delay(100);
    var second = core.InArrivalOrderAsync("h", "2", () =>
    {
      started.Add("2");

      return Task.FromResult(2);
    });

    await Task.WhenAll(second, third).WaitAsync(TimeSpan.FromSeconds(10));
    Assert.Equal(["2", "3"], started);
  }

  // JSON.parse reads 101.0 as 101, and Node answers id 101; the SDK here cannot read 101.0 at all.
  [Fact]
  public async Task StdinWritesAnIdOf101Point0As101AndBooksItsTurnUnderIt()
  {
    await using var core = Core((_, _, _, _) => Task.FromResult(true));
    var wire = "{\"jsonrpc\":\"2.0\",\"id\":101.0,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_read\",\"arguments\":{\"handle\":\"h\"}}}\n";
    await using var input = new Blok.Server.Mcp.Protocol.McpOrderedInput(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(wire)), core);
    using var passed = new MemoryStream();

    await input.CopyToAsync(passed);
    Assert.Equal(
        "{\"jsonrpc\":\"2.0\",\"id\":101,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_read\",\"arguments\":{\"handle\":\"h\"}}}\n",
        System.Text.Encoding.UTF8.GetString(passed.ToArray()));
    // The turn booked under "101" is the one the call takes, so the handle is not held.
    Assert.Equal(7, await core.InArrivalOrderAsync("h", "101", () => Task.FromResult(7)).WaitAsync(TimeSpan.FromSeconds(10)));
    Assert.Equal(8, await core.InArrivalOrderAsync("h", "102", () => Task.FromResult(8)).WaitAsync(TimeSpan.FromSeconds(10)));
  }
}
