using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Node builds a batch's answer before it saves, so a call that fails to answer saved nothing a retry repeats.</summary>
public sealed class AnswerBeforeSaveTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-answer-").FullName;
  private readonly BundleFixture fixture;

  public AnswerBeforeSaveTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  // The real engine, except the answer of a saved batch fails.
  private sealed class AnswerFails(IBlokRuntime real) : IBlokRuntime
  {
    public ValueTask<string> InvokeAsync(string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      return operation == "mcpExecuteAnswer" && inputJson.Contains("\"durable\":true", StringComparison.Ordinal)
          ? throw new InvalidOperationException("answer failed")
          : real.InvokeAsync(operation, inputJson, timeout, cancellationToken);
    }
  }

  private async Task<(McpServerCore Core, Func<Task<JsonObject?>> Execute)> OpenAsync(McpBundle bundle)
  {
    var core = new McpServerCore(bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var opened = await core.CallToolAsync("blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }, caller, null, CancellationToken.None);
    var handle = opened.Answer?["structuredContent"]?["handle"]?.DeepClone();

    return (core, async () => (await core.CallToolAsync("blok_execute", new JsonObject
    {
      ["handle"] = handle?.DeepClone(),
      ["commands"] = new JsonArray(new JsonObject { ["name"] = "doc.setTitle", ["args"] = new JsonObject { ["title"] = "Kept" } }),
    }, caller, null, CancellationToken.None)).Answer);
  }

  [Fact]
  public async Task ABatchWhoseAnswerFailsIsNotSaved()
  {
    var (core, execute) = await OpenAsync(new McpBundle(new AnswerFails(fixture.Host.Bundle.Runtime)));

    await using (core)
    {
      await Assert.ThrowsAnyAsync<Exception>(execute);
    }

    Assert.Equal("""{"blocks":[]}""", File.ReadAllText(Path.Combine(dir, "doc.json")));
  }

  [Fact]
  public async Task ASavedBatchAnswersWithItsSavedVersion()
  {
    var (core, execute) = await OpenAsync(fixture.Host.Bundle);

    await using (core)
    {
      var delivery = (await execute())?["structuredContent"]?["delivery"];

      Assert.Equal(true, McpJson.Bool(delivery?["durable"]));
      Assert.NotNull(McpJson.String(delivery?["savedVersion"]));
      Assert.Contains("Kept", File.ReadAllText(Path.Combine(dir, "doc.json")), StringComparison.Ordinal);
    }
  }
}
