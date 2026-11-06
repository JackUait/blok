using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>A live handle's page inserts: the pages are made before the batch, as a stored handle makes them.</summary>
public sealed class LiveSessionPagesTests(BundleFixture fixture) : IClassFixture<BundleFixture>
{
  private static readonly McpCaller Caller = new(
      "alice", "desk", null, new JsonObject { ["id"] = "agent:alice:desk", ["name"] = "desk", ["kind"] = "agent" }, "desk");

  [Fact]
  public async Task AnInsertedPageTakesTheIdOfThePageMadeForIt()
  {
    var (session, made, room) = await OpenAsync();

    var outcome = await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["id"] = "pg" } }), Caller, null, CancellationToken.None);

    Assert.Equal(true, McpJson.Bool(outcome.Answer?["structuredContent"]?["ok"]));
    Assert.Equal(["page-1"], made);
    Assert.Equal("page-1", McpJson.String(outcome.Answer?["structuredContent"]?["blocks"]?[0]?["data"]?["pageId"]));
    await room.CloseAsync();
  }

  [Fact]
  public async Task ARefusedBatchMakesNoPage()
  {
    var (session, made, room) = await OpenAsync();

    var outcome = await session.ExecuteAsync(Batch(
        new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page" } },
        new JsonObject { ["name"] = "no.suchCommand", ["args"] = new JsonObject() }), Caller, null, CancellationToken.None);

    Assert.Equal(false, McpJson.Bool(outcome.Answer?["structuredContent"]?["ok"]));
    Assert.Empty(made);
    await room.CloseAsync();
  }

  [Fact]
  public async Task ABatchRefusedAfterItsPageWasPreparedStillMakesThePage()
  {
    var (session, made, room) = await OpenAsync();

    var outcome = await session.ExecuteAsync(Batch(
        new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["data"] = new JsonObject { ["title"] = "Child" } } }),
        Caller, null, CancellationToken.None);
    var error = outcome.Answer?["structuredContent"]?["error"];

    Assert.Equal("ORPHANED_SIDE_EFFECT", McpJson.String(error?["code"]));
    Assert.Equal(["page-1"], made);
    Assert.Equal("page-1", McpJson.String(error?["details"]?["orphaned"]?[0]?["prepared"]?["pageId"]));
    await room.CloseAsync();
  }

  [Fact]
  public async Task ANewPageRoomIsEmptyUntilItHoldsABlockOrATitle()
  {
    var (session, _, room) = await OpenAsync();

    Assert.True(await session.IsEmptyAsync());
    await room.Loop.RunAsync(() => room.WriteLocal(new object(), tx => room.Doc.GetMap("page").Set(tx, "title", "Taken")));
    Assert.False(await session.IsEmptyAsync());
    await room.CloseAsync();
  }

  [Fact]
  public async Task PageRenameWritesTheTitleThroughThePagesOwnSession()
  {
    var target = new FakeTarget(Ok(pending: false));
    var (session, _, room) = await OpenAsync(target);

    await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["id"] = "pb" } }), Caller, null, CancellationToken.None);
    var outcome = await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "page.rename", ["args"] = new JsonObject { ["id"] = "pb", ["title"] = "Renamed" } }), Caller, null, CancellationToken.None);
    var answer = outcome.Answer?["structuredContent"];

    Assert.Equal(true, McpJson.Bool(answer?["ok"]));
    Assert.Equal("""[{"pageId":"page-1","applied":true}]""", answer?["results"]?.ToJsonString());
    Assert.Equal("page-1", target.OpenedId);
    Assert.Equal("""{"commands":[{"name":"doc.setTitle","args":{"title":"Renamed"}}]}""", target.Batch?.ToJsonString());
    await room.CloseAsync();
  }

  [Fact]
  public async Task APageWriteTheRoomDidNotConfirmIsSourceUnavailable()
  {
    var (session, _, room) = await OpenAsync(new FakeTarget(Ok(pending: true)));

    await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["id"] = "pb" } }), Caller, null, CancellationToken.None);
    var outcome = await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "page.rename", ["args"] = new JsonObject { ["id"] = "pb", ["title"] = "Renamed" } }), Caller, null, CancellationToken.None);
    var error = outcome.Answer?["structuredContent"]?["error"];

    Assert.Equal("SOURCE_UNAVAILABLE", McpJson.String(error?["code"]));
    Assert.Equal(true, McpJson.Bool(error?["retryable"]));
    Assert.Equal("""{"pending":true,"pageId":"page-1"}""", error?["details"]?.ToJsonString());
    Assert.Equal(0, (int?)error?["commandIndex"]);
    await room.CloseAsync();
  }

  [Fact]
  public async Task PageRenameOfAPageBlockThatPointsAtTheOpenRoomIsRefused()
  {
    var target = new FakeTarget(Ok(pending: false));
    var (session, _, room) = await OpenAsync(target, documentId: "page-1");

    await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["id"] = "pb" } }), Caller, null, CancellationToken.None);
    var outcome = await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "page.rename", ["args"] = new JsonObject { ["id"] = "pb", ["title"] = "Renamed" } }), Caller, null, CancellationToken.None);

    Assert.Equal("INVALID_ARGS", McpJson.String(outcome.Answer?["structuredContent"]?["error"]?["code"]));
    Assert.Null(target.OpenedId);
    await room.CloseAsync();
  }

  private static JsonObject Ok(bool pending) => new()
  {
    ["structuredContent"] = new JsonObject
    {
      ["ok"] = true,
      ["revision"] = "l1",
      ["results"] = new JsonArray(new JsonObject()),
      ["delivery"] = new JsonObject { ["durable"] = !pending, ["pending"] = pending, ["serverSequence"] = null, ["savedVersion"] = null },
    },
    ["isError"] = false,
  };

  private sealed class FakeTarget(JsonObject answer) : IHandleSession
  {
    internal string? OpenedId { get; set; }

    internal JsonNode? Batch { get; private set; }

    public JsonObject Describe() => [];

    public Task<JsonObject> ReadAsync(JsonNode? view, CancellationToken cancellationToken) => throw new NotSupportedException();

    public Task<JsonObject> DescribeAsync(JsonNode? query, CancellationToken cancellationToken) => throw new NotSupportedException();

    public Task<McpExecuteOutcome> ExecuteAsync(JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
    {
      Batch = batch?.DeepClone();

      return Task.FromResult(new McpExecuteOutcome((JsonObject)answer.DeepClone(), null));
    }

    public Task<JsonObject> CloseAsync(string reason) => Task.FromResult(new JsonObject());
  }

  private async Task<(LiveSession Session, List<string> Made, LiveRoom Room)> OpenAsync(FakeTarget? target = null, string documentId = "doc")
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var flags = new McpConfig { PageTitles = "page-map", Sync = new McpSync("ws://127.0.0.1:1/sync", null) }.SurfaceFlags();
    var made = new List<string>();
    var session = new LiveSession(
        room, fixture.Host.Bundle, flags, Caller, true, "", null,
        new LiveVersionHistory(new McpHttpCaller(), "ws://127.0.0.1:1/sync/doc", null, null), TimeSpan.FromMilliseconds(50))
    {
      DocumentId = documentId,
      Pages = new PagePorts
      {
        Create = (_, _) =>
        {
          made.Add($"page-{made.Count + 1}");

          return Task.FromResult(made[^1]);
        },
        Open = (pageId, _, _) =>
        {
          if (target is null)
          {
            throw new InvalidOperationException("No page target.");
          }
          target.OpenedId = pageId;

          return Task.FromResult<IHandleSession>(target);
        },
        TrackClose = _ => { },
      },
    };

    await room.Loop.RunAsync(session.Start);

    return (session, made, room);
  }

  private static JsonObject Batch(params JsonObject[] commands) => new() { ["commands"] = new JsonArray(commands) };
}
