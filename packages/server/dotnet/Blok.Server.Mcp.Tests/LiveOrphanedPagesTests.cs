using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Xunit;
using static Blok.Server.Mcp.Tests.StoredFaults;

namespace Blok.Server.Mcp.Tests;

/// <summary>A live batch that made pages and then wrote nothing to the room names them in error.details.orphaned.</summary>
public sealed class LiveOrphanedPagesTests(BundleFixture fixture) : IClassFixture<BundleFixture>
{
  private static async Task<(LiveSession Session, List<string> Made, LiveRoom Room)> OpenAsync(
      McpBundle bundle, Action? afterCreate = null, Func<int, string>? pageIds = null, Action<string, Exception>? log = null, Func<LiveRoom, Task>? seed = null)
  {
    var (room, _) = await LiveRoomTests.OpenAsync();

    if (seed is not null)
    {
      await seed(room);
    }
    var flags = new McpConfig { PageTitles = "page-map", Sync = new McpSync("ws://127.0.0.1:1/sync", null) }.SurfaceFlags();
    var made = new List<string>();
    var session = new LiveSession(
        room, bundle, flags, Caller, true, "", null,
        new LiveVersionHistory(new McpHttpCaller(), "ws://127.0.0.1:1/sync/doc", null, null), TimeSpan.FromMilliseconds(50))
    {
      DocumentId = "doc",
      Pages = Pages((_, _) =>
      {
        made.Add(pageIds?.Invoke(made.Count) ?? $"page-{made.Count + 1}");
        afterCreate?.Invoke();

        return Task.FromResult(made[^1]);
      }, log),
    };

    await room.Loop.RunAsync(session.Start);

    return (session, made, room);
  }

  [Fact]
  public async Task AnEngineFailureAfterAPageWasMadeReportsThePage()
  {
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime) { Throws = (operation, _) => operation == "agentExecute" };
    var (session, made, room) = await OpenAsync(new McpBundle(runtime));

    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));

    Assert.Equal(["page-1"], made);
    Assert.Equal(StoredOrphanedPagesTests.Orphaned("APPLY_FAILED", true, "page-1"), answer?["error"]?.ToJsonString());
    await room.CloseAsync();
  }

  [Fact]
  public async Task AFailureAfterAPageWasMadeIsLoggedToTheHostsLogger()
  {
    var logged = new List<string>();
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime) { Throws = (operation, _) => operation == "agentExecute" };
    var (session, _, room) = await OpenAsync(new McpBundle(runtime), log: (message, error) => logged.Add($"{message}: {error.Message}"));

    await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None);

    Assert.Equal(["blok-mcp: a batch failed after it made pages: agentExecute failed"], logged);
    await room.CloseAsync();
  }

  [Fact]
  public async Task ARoomThatCannotBeReadAfterAFailureIsLoggedToTheHostsLogger()
  {
    var logged = new List<string>();
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime);
    var (session, _, room) = await OpenAsync(
        new McpBundle(runtime),
        // After the page is made: the batch then fails, and so does the room's re-read.
        afterCreate: () => runtime.Throws = (operation, _) => operation is "agentExecute" or "htmlFieldsToSegments",
        log: (message, error) => logged.Add(message),
        seed: room => SeedLegacyTextAsync(room, fixture.Host.Bundle));

    var answer = await Assert.ThrowsAnyAsync<Exception>(() => session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));

    Assert.Equal("agentExecute failed", answer.Message);
    Assert.Equal(["blok-mcp: the room could not be read after a batch failed, so no page is reported"], logged);
    await room.CloseAsync();
  }

  // A paragraph whose text is a plain string: legacy HTML, which every read sends to the runtime.
  private static async Task SeedLegacyTextAsync(LiveRoom room, McpBundle bundle)
  {
    var seed = new Blok.Server.Collab.CollabDocConverter(
        TimeProvider.System, new Blok.Server.Collab.RuntimeRichTextHtmlReader(bundle.Runtime), Blok.Server.Collab.RichTextFields.BuiltIn);

    await room.Loop.RunAsync(() => seed.SeedAsync(room.Doc, JsonNode.Parse("""{"blocks":[{"id":"p1","type":"paragraph","data":{"text":"Hi"}}]}""")!).AsTask());
    await room.Loop.RunAsync(() => room.WriteLocal(new object(), tx =>
    {
      room.Doc.GetMap("blocks").TryGet("p1", out var block);
      ((Blok.Server.Yjs.YMap)block!).TryGet("data", out var data);
      ((Blok.Server.Yjs.YMap)data!).Set(tx, "text", "<b>Hi</b>");
    }));
  }

  [Fact]
  public async Task AFailureAfterThePagesWereMadeLeavesOutAPageTheRoomLinks()
  {
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime);
    string[] ids = ["linked", "linked", "fresh"];
    var (session, made, room) = await OpenAsync(new McpBundle(runtime), pageIds: index => ids[index]);
    var first = Answer(await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None));

    runtime.Throws = (operation, _) => operation == "agentExecute";
    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("b"), InsertPage("c")), Caller, null, CancellationToken.None));

    Assert.Equal(true, McpJson.Bool(first?["ok"]));
    Assert.Equal(["linked", "linked", "fresh"], made);
    Assert.Equal(StoredOrphanedPagesTests.Orphaned("APPLY_FAILED", true, "fresh"), answer?["error"]?.ToJsonString());
    await room.CloseAsync();
  }

  [Fact]
  public async Task AFailureWhoseEveryPageTheRoomLinksReportsNothing()
  {
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime);
    var (session, made, room) = await OpenAsync(new McpBundle(runtime), pageIds: _ => "linked");

    await session.ExecuteAsync(Batch(InsertPage("a")), Caller, null, CancellationToken.None);
    runtime.Throws = (operation, _) => operation == "agentExecute";

    await Assert.ThrowsAsync<InvalidOperationException>(() => session.ExecuteAsync(Batch(InsertPage("b")), Caller, null, CancellationToken.None));
    Assert.Equal(["linked", "linked"], made);
    await room.CloseAsync();
  }

  [Fact]
  public async Task ACancelAfterOnePageStopsBeforeTheNextAndReportsIt()
  {
    using var cancel = new CancellationTokenSource();
    var (session, made, room) = await OpenAsync(fixture.Host.Bundle, () => cancel.Cancel());

    var answer = Answer(await session.ExecuteAsync(Batch(InsertPage("a"), InsertPage("b")), Caller, null, cancel.Token));

    Assert.Equal(["page-1"], made);
    Assert.Equal(HostPageCreatorTests.Cancelled("page-1"), answer?["error"]?.ToJsonString());
    await room.CloseAsync();
  }
}
