using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Sources;
using Xunit;
using static Blok.Server.Mcp.Tests.StoredFaults;

namespace Blok.Server.Mcp.Tests;

/// <summary>
/// A stored batch that made pages and then wrote no parent names them in error.details.orphaned,
/// in Blok.Server's shape (test/unit/server-conformance/fixtures/agent/host.json).
/// </summary>
public sealed class StoredOrphanedPagesTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-orphans-").FullName;
  private readonly BundleFixture fixture;
  private readonly FaultySource source;
  private readonly List<string> made = [];

  public StoredOrphanedPagesTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
    source = new FaultySource(new FilesSource(dir, fixture.Host.Bundle));
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  internal static string Orphaned(string cause, bool retryable, params string[] pageIds)
  {
    var message = cause == "CANCELLED" ? "The batch was cancelled. Nothing was written." : "The batch stopped on a server error. Nothing was written.";
    var orphaned = new JsonArray([.. pageIds.Select(pageId => (JsonNode)new JsonObject
    {
      ["command"] = "block.insert", ["type"] = "page", ["prepared"] = new JsonObject { ["pageId"] = pageId },
    })]);

    return new JsonObject
    {
      ["code"] = "ORPHANED_SIDE_EFFECT",
      ["message"] = $"The batch failed after the host did work for it ({message}). Clean up the listed items.",
      ["retryable"] = false,
      ["details"] = new JsonObject
      {
        ["orphaned"] = orphaned,
        ["cause"] = new JsonObject { ["code"] = cause, ["message"] = message, ["retryable"] = retryable },
      },
    }.ToJsonString();
  }

  private Task<string> Make(McpCaller caller, CancellationToken cancellationToken)
  {
    made.Add($"page-{made.Count + 1}");

    return Task.FromResult(made[^1]);
  }

  private static async Task<string?> TitleAsync(StoredSession session)
  {
    var read = await session.ReadAsync(new JsonObject(), CancellationToken.None);

    return McpJson.String(read["structuredContent"]?["page"]?["title"]);
  }

  [Fact]
  public async Task AnEngineFailureAfterAPageWasMadeReportsThePage()
  {
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime) { Throws = (operation, _) => operation == "agentExecute" };
    var session = await OpenAsync(new McpBundle(runtime), source, Pages(Make));

    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));

    Assert.Equal(["page-1"], made);
    Assert.Equal(false, McpJson.Bool(answer?["ok"]));
    Assert.Equal(Orphaned("APPLY_FAILED", true, "page-1"), answer?["error"]?.ToJsonString());
  }

  [Fact]
  public async Task AFailedAnswerAfterAPageWasMadeReportsThePageAndSavesNothing()
  {
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime)
    {
      Throws = (operation, input) => operation == "mcpExecuteAnswer" && input.Contains("\"durable\":true", StringComparison.Ordinal),
    };
    var session = await OpenAsync(new McpBundle(runtime), source, Pages(Make));

    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));

    Assert.Equal(Orphaned("APPLY_FAILED", true, "page-1"), answer?["error"]?.ToJsonString());
    Assert.Equal(0, source.Saves);
  }

  [Fact]
  public async Task APlainSaveFailureAfterAPageWasMadeReportsThePageAndDropsTheEdit()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source, Pages(Make));

    source.NextSave = new IOException("disk full");
    var answer = Answer(await session.ExecuteAsync(Batch(SetTitle("Unsaved"), InsertPage("a")), Caller, null, CancellationToken.None));

    Assert.Equal(Orphaned("APPLY_FAILED", true, "page-1"), answer?["error"]?.ToJsonString());
    Assert.Null(await TitleAsync(session));
  }

  [Fact]
  public async Task ASaveThatStoredTheParentBeforeItFailedReportsNoPageTheParentNames()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source, Pages(Make));

    source.NextSaveAfterWrite = new TimeoutException("no answer after the write");

    await Assert.ThrowsAsync<TimeoutException>(() => session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));
    Assert.Contains("page-1", File.ReadAllText(Path.Combine(dir, "doc.json")), StringComparison.Ordinal);
  }

  [Fact]
  public async Task ASaveFailureWhoseReloadAlsoFailsReportsNothing()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source, Pages(Make));

    source.NextSave = new IOException("disk full");
    source.NextLoad = new IOException("source down");

    await Assert.ThrowsAsync<IOException>(() => session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));
    Assert.Equal(["page-1"], made);
  }

  [Fact]
  public async Task AnUnexpectedCreateFailureAfterAPageWasMadeReportsTheMadeOne()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source, Pages((caller, cancellationToken) =>
        made.Count == 0 ? Make(caller, cancellationToken) : throw new HttpRequestException("host down")));

    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a"), InsertPage("b")), Caller, null, CancellationToken.None));

    Assert.Equal(["page-1"], made);
    Assert.Equal(Orphaned("APPLY_FAILED", true, "page-1"), answer?["error"]?.ToJsonString());
    Assert.Equal(0, source.Saves);
  }

  [Fact]
  public async Task ACancelAfterOnePageStopsBeforeTheNextAndReportsIt()
  {
    using var cancel = new CancellationTokenSource();
    // The host ignores the token, as a host may: the loop itself must stop.
    var session = await OpenAsync(fixture.Host.Bundle, source, Pages(async (caller, cancellationToken) =>
    {
      var pageId = await Make(caller, cancellationToken);

      await cancel.CancelAsync();

      return pageId;
    }));

    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a"), InsertPage("b")), Caller, null, cancel.Token));

    Assert.Equal(["page-1"], made);
    Assert.Equal(Orphaned("CANCELLED", false, "page-1"), answer?["error"]?.ToJsonString());
    Assert.Equal(0, source.Saves);
  }

  [Fact]
  public async Task ARefusedParentSaveStaysUnreportedAsDocumented()
  {
    var session = await OpenAsync(fixture.Host.Bundle, source, Pages(Make));

    source.NextSave = McpHostError.Surface("CONFLICT", "Someone else saved it.");
    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));

    Assert.Equal("CONFLICT", McpJson.String(answer?["error"]?["code"]));
    Assert.Null(answer?["error"]?["details"]?["orphaned"]);
  }
}
