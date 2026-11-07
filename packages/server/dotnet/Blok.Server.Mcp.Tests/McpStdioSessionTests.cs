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
    var core = new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var options = await McpSdkServer.OptionsAsync(core, _ => new McpCallerIdentity("local", null), CancellationToken.None);
    using var output = new MemoryStream();

    before?.Invoke(core);
    await McpStdioSession.RunAsync(core, options, new MemoryStream(Encoding.UTF8.GetBytes(Wire)), output, new TaskCompletionSource().Task)
        .WaitAsync(TimeSpan.FromSeconds(20));

    return [.. Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries)
        .Select(line => JsonNode.Parse(line)!["id"]!.ToJsonString())];
  }

  [Fact]
  public async Task AnswersWhatItReadBeforeStdinEnded()
  {
    var started = DateTime.UtcNow;
    var ids = await AnsweredIdsAsync();

    Assert.Contains("0", ids);
    Assert.Contains("2", ids);
    Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(10));
  }

  // As Node's stop: a call not yet dispatched when stdin ends never runs.
  [Fact]
  public async Task NeverRunsAToolCallThatArrivesAfterStdinEnded()
  {
    var ids = await AnsweredIdsAsync(core => core.InputEnded = true);

    Assert.Equal(["0", "2"], ids);
  }
}
