using System.IO.Pipelines;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Mcp.Protocol;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Node's stdin end (index.ts stopOnShutdown): the same stop as SIGTERM.</summary>
public sealed class McpStdioSessionTests : IClassFixture<BundleFixture>, IDisposable
{
  private const string Wire =
      "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}\n"
      + "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n"
      + "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"blok_list_documents\",\"arguments\":{}}}\n"
      + "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}\n";

  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-stdio-").FullName;
  private readonly BundleFixture fixture;

  public McpStdioSessionTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private async Task<List<string>> AnsweredIdsAsync(Action<McpServerCore>? before = null)
  {
    return [.. (await RunWireAsync(Wire, before)).Select(line => JsonNode.Parse(line)!["id"]!.ToJsonString())];
  }

  // The lines blok-mcp wrote for this stdin, which ends after the wire.
  private async Task<List<string>> RunWireAsync(string wire, Action<McpServerCore>? before = null)
  {
    var core = new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var options = await McpSdkServer.OptionsAsync(core, _ => new McpCallerIdentity("local", null), CancellationToken.None);
    using var output = new MemoryStream();

    before?.Invoke(core);
    await McpStdioSession.RunAsync(core, options, new MemoryStream(Encoding.UTF8.GetBytes(wire)), output, new TaskCompletionSource().Task)
        .WaitAsync(TimeSpan.FromSeconds(60));

    return [.. Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries)];
  }

  private static string Init => Wire.Split('\n')[0] + "\n" + Wire.Split('\n')[1] + "\n";

  // Node's ReadBuffer drops a line that fails JSONRPCMessageSchema: no answer, and stdin's end stops at once.
  [Theory]
  [InlineData("""{"id":13,"method":"ping"}""")]
  [InlineData("""{"jsonrpc":"1.0","id":14,"method":"ping"}""")]
  [InlineData("""{"jsonrpc":2,"id":15,"method":"ping"}""")]
  [InlineData("""{"jsonrpc":"2.0","id":25,"method":5}""")]
  [InlineData("""{"jsonrpc":"2.0","id":26}""")]
  [InlineData("""{"jsonrpc":"2.0","id":1.5,"method":"ping"}""")]
  [InlineData("""{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}""")]
  [InlineData("""{"jsonrpc":"2.0","id":3,"method":"ping","extra":1}""")]
  [InlineData("""{"jsonrpc":"2.0","id":10,"method":"ping","params":{"_meta":{"progressToken":1.5}}}""")]
  [InlineData("""{"jsonrpc":"2.0","id":11,"method":"ping","params":null}""")]
  [InlineData("""{"jsonrpc":"2.0","id":12,"method":"ping","result":{}}""")]
  [InlineData("""{"jsonrpc":"2.0","id":16,"error":{"code":1.5,"message":"x"}}""")]
  public async Task DropsALineNodesSchemaRefuses(string line)
  {
    var started = DateTime.UtcNow;
    var lines = await RunWireAsync(Init + line + "\n");

    Assert.Single(lines);
    Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(10));
  }

  [Theory]
  [InlineData("""{"jsonrpc":"2.0","id":9007199254740991,"method":"ping"}""", "9007199254740991")]
  [InlineData("""{"jsonrpc":"2.0","id":7e0,"method":"ping"}""", "7")]
  [InlineData("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"ping\"}\r", "4")]
  public async Task AnswersALineNodesSchemaTakes(string line, string id)
  {
    var lines = await RunWireAsync(Init + line + "\n");

    Assert.Equal(2, lines.Count);
    Assert.Contains(lines, answer => JsonNode.Parse(answer)!["id"]!.ToJsonString() == id);
  }

  // Node registers no logging capability, so logging/setLevel is an unknown method.
  [Fact]
  public async Task LoggingSetLevelIsAnUnknownMethod()
  {
    var lines = await RunWireAsync(Init + """{"jsonrpc":"2.0","id":5,"method":"logging/setLevel","params":{"level":"info"}}""" + "\n");

    var answer = lines.Select(line => JsonNode.Parse(line)!).Single(line => line["id"]!.ToJsonString() == "5");

    Assert.Equal("""{"code":-32601,"message":"Method not found"}""", answer["error"]!.ToJsonString());
  }

  [Fact]
  public async Task AnswersWhatItReadBeforeStdinEnded()
  {
    // Far past the 60s wait: a session that sat out the drain limit fails, however slow the machine.
    var ids = await AnsweredIdsAsync(core => core.StopDrain = TimeSpan.FromMinutes(10));

    Assert.Contains("0", ids);
    Assert.Contains("2", ids);
  }

  // Node's transport is closed at stdin's end: a tools/call answer due after it is never written.
  [Fact]
  public async Task NeverAnswersAToolCallTakenAfterStdinEnded()
  {
    var ids = await AnsweredIdsAsync(core => core.InputEnded = true);

    // The SDK answers at once, so their order is not fixed.
    Assert.Equal(["0", "2"], ids.Order(StringComparer.Ordinal));
  }

  // A session over pipes, so a test can read answers before stdin ends.
  private sealed class Live : IAsyncDisposable
  {
    private readonly Pipe input = new();
    private readonly Pipe output = new();
    private readonly List<JsonNode> answers = [];
    private readonly Task reading;

    internal Task Session { get; }

    internal Live(McpServerCore core, ModelContextProtocol.Server.McpServerOptions options, Task stop)
    {
      Session = McpStdioSession.RunAsync(core, options, input.Reader.AsStream(), output.Writer.AsStream(), stop);
      reading = Task.Run(async () =>
      {
        using var lines = new StreamReader(output.Reader.AsStream());

        while (await lines.ReadLineAsync() is string line)
        {
          lock (answers)
          {
            answers.Add(JsonNode.Parse(line)!);
          }
        }
      });
    }

    internal async Task SendAsync(string json)
    {
      await input.Writer.WriteAsync(Encoding.UTF8.GetBytes(json + "\n"));
    }

    internal async Task EndAsync()
    {
      await input.Writer.CompleteAsync();
    }

    internal JsonNode? Answer(string id)
    {
      lock (answers)
      {
        return answers.FirstOrDefault(answer => answer["id"]?.ToJsonString() == id);
      }
    }

    internal async Task<JsonNode> AnswerAsync(string id)
    {
      var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);

      JsonNode? answer;

      while ((answer = Answer(id)) is null)
      {
        Assert.True(DateTime.UtcNow < deadline, $"no answer for {id}");
        await Task.Delay(10);
      }

      return answer;
    }

    public async ValueTask DisposeAsync()
    {
      await input.Writer.CompleteAsync();
      await Session.WaitAsync(TimeSpan.FromSeconds(20));
      await output.Writer.CompleteAsync();
      await reading.WaitAsync(TimeSpan.FromSeconds(20));
    }
  }

  private async Task<(Live Live, string Handle, McpServerCore Core)> OpenForWriteAsync(TaskCompletionSource? stop = null)
  {
    var core = new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var options = await McpSdkServer.OptionsAsync(core, _ => new McpCallerIdentity("local", null), CancellationToken.None);
    var live = new Live(core, options, (stop ?? new TaskCompletionSource()).Task);

    await live.SendAsync(Init.TrimEnd('\n').Split('\n')[0]);
    await live.SendAsync(Init.TrimEnd('\n').Split('\n')[1]);
    await live.SendAsync("""{"jsonrpc":"2.0","id":"open","method":"tools/call","params":{"name":"blok_open","arguments":{"documentId":"doc","write":true}}}""");

    return (live, McpJson.String((await live.AnswerAsync("\"open\""))["result"]!["structuredContent"]!["handle"])!, core);
  }

  private static string SetTitle(string id, string handle) =>
      $$$$"""{"jsonrpc":"2.0","id":{{{{id}}}},"method":"tools/call","params":{"name":"blok_execute","arguments":{"handle":"{{{{handle}}}}","commands":[{"name":"doc.setTitle","args":{"title":"Changed"}}]}}}""";

  // Node closes its transport at stdin's end but still runs what it read: the write is saved, unanswered.
  // Here the SDK can take the line after the reader saw the end, which InputEnded stands for.
  [Fact]
  public async Task SavesAWriteSentRightBeforeStdinEnds()
  {
    var (live, handle, core) = await OpenForWriteAsync();

    core.InputEnded = true;
    await live.SendAsync(SetTitle("10", handle));
    await live.EndAsync();
    await live.DisposeAsync();

    Assert.Contains("Changed", File.ReadAllText(Path.Combine(dir, "doc.json")));
    Assert.Null(live.Answer("10"));
  }

  // Node passes the cancel signal to opens only: an execute already read still runs, with no answer.
  [Fact]
  public async Task ACancelledExecuteStillRunsAndIsNotAnswered()
  {
    var (live, handle, _) = await OpenForWriteAsync();

    await live.SendAsync(SetTitle("10", handle));
    await live.SendAsync("""{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":10}}""");
    await live.SendAsync("""{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"blok_read","arguments":{"handle":"HANDLE"}}}""".Replace("HANDLE", handle, StringComparison.Ordinal));
    await live.AnswerAsync("11");
    await Task.Delay(300);

    Assert.Null(live.Answer("10"));
    await live.DisposeAsync();
    Assert.Contains("Changed", File.ReadAllText(Path.Combine(dir, "doc.json")));
  }
}
