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
  private static async Task<(LiveSession Session, List<string> Made, LiveRoom Room)> OpenAsync(McpBundle bundle, Action? afterCreate = null, Func<int, string>? pageIds = null)
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
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
      }),
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
    Assert.Equal(HostPageCreatorTests.Orphaned("The batch was cancelled. Nothing was written.", "CANCELLED", false, "page-1"), answer?["error"]?.ToJsonString());
    await room.CloseAsync();
  }
}
