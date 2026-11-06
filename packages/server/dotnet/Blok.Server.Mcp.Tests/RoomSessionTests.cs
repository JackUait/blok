using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The library form: live handles on rooms this app hosts, in process.</summary>
public sealed class RoomSessionTests : IClassFixture<BundleFixture>, IDisposable
{
  private const string Locked = """
      {"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v",
      "schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],
      "views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}
      """;

  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-rooms-").FullName;
  private readonly BundleFixture fixture;

  public RoomSessionTests(BundleFixture fixture)
  {
    this.fixture = fixture;
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private sealed class OneDocument(string json) : IDocEndpointClient
  {
    public Task<LoadedDocument> LoadAsync(string docId, CancellationToken cancellationToken)
    {
      return Task.FromResult(new LoadedDocument(JsonNode.Parse(json), null));
    }

    public Task<string?> SaveAsync(string docId, JsonNode outputData, string? version, DocProjection? projection, CancellationToken cancellationToken)
    {
      return Task.FromResult<string?>(null);
    }
  }

  private McpServerCore Core(string document)
  {
    var runtime = fixture.Host.Bundle.Runtime;
    var converter = new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(runtime));
    var rooms = new CollabRoomManager(
        new LocalCollabStore(Path.Combine(dir, "rooms")), new OneDocument(document), converter, new CollabRoomOptions(), TimeProvider.System,
        null, new LocalCollabOperationStore(Path.Combine(dir, "journal")));

    return new McpServerCore(fixture.Host.Bundle, new McpConfig { Rooms = new BlokAgentExecutor(runtime, rooms, converter) }, new McpHttpCaller());
  }

  private static async Task<JsonObject> CallAsync(McpServerCore core, McpCaller caller, string name, JsonObject arguments, JsonNode? replies = null)
  {
    var outcome = await core.CallToolAsync(name, arguments, caller, new McpApproval(new JsonObject { ["elicitation"] = new JsonObject() }, replies, caller.ClientName), CancellationToken.None);

    return outcome.Ask ?? (JsonObject)outcome.Answer!["structuredContent"]!;
  }

  [Fact]
  public async Task OpensLiveOnTheHostsRoomWithTheLiveContract()
  {
    await using var core = Core("""{"blocks":[]}""");
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var surface = await core.SurfaceAsync();

    var opened = await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true });

    Assert.Equal("live", (string?)opened["mode"]);
    Assert.Equal("acknowledged", (string?)opened["durability"]);
    Assert.Equal((string?)surface["contractRevision"]?["live"], (string?)opened["contractRevision"]);
  }

  [Fact]
  public async Task WritesIntoTheRoomAndReadsItBack()
  {
    await using var core = Core("""{"blocks":[]}""");
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }))["handle"];

    var wrote = await CallAsync(core, caller, "blok_execute", new JsonObject
    {
      ["handle"] = handle,
      ["commands"] = new JsonArray(new JsonObject { ["name"] = "doc.setTitle", ["args"] = new JsonObject { ["title"] = "Plan" } }),
    });
    var read = await CallAsync(core, caller, "blok_read", new JsonObject { ["handle"] = handle });

    Assert.True((bool?)wrote["ok"] == true, wrote.ToJsonString());
    Assert.Equal(true, (bool?)wrote["delivery"]?["durable"]);
    Assert.NotNull((string?)wrote["delivery"]?["serverSequence"]);
    Assert.Equal("Plan", (string?)read["page"]?["title"]);
  }

  [Fact]
  public async Task AnUnlockAsksAndAReadOnlyHandleIsRefused()
  {
    await using var core = Core(Locked);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var writer = (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }))["handle"];
    var reader = (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc" }))["handle"];
    var unlock = new JsonArray(new JsonObject { ["name"] = "database.setLock", ["args"] = new JsonObject { ["id"] = "db", ["locked"] = false } });

    var asked = await CallAsync(core, caller, "blok_execute", new JsonObject { ["handle"] = writer, ["commands"] = unlock.DeepClone() });
    var refused = await CallAsync(core, caller, "blok_execute", new JsonObject { ["handle"] = reader, ["commands"] = unlock.DeepClone() });

    Assert.Equal("""["database.unlock","db","Payroll"]""", (string?)asked["key"]);
    Assert.Equal("READ_ONLY", (string?)refused["error"]?["code"]);
  }
}
