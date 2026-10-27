using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class JintCommentHostTests
{
  private const string Document = """
      {"blocks":[
        {"id":"db","type":"database","content":["r"],"data":{"title":"Tasks","activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"}]}},
        {"id":"r","type":"database-row","parent":"db","content":["th"],"data":{"position":"a0","properties":{"t":"Row"}}},
        {"id":"th","type":"database-comment","parent":"r","content":[],"data":{"text":"Please fix","createdAt":1,"authorId":"u1"}}]}
      """;

  private const string Reply = """{"commands":[{"name":"database.replyToComment","args":{"id":"db","threadId":"th","text":"Hidden"}}]}""";

  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");

  [Fact]
  public async Task ACommentWriteRunsByDefault()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(Document, Reply, Actor);

    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.True(result["ok"]?.GetValue<bool>());
    Assert.Contains("Hidden", execution.DocumentJson);
  }

  // A host that keeps comments in its own system opts out: people there would never see these blocks.
  [Fact]
  public async Task ACommentWriteIsUnavailableOnceTheHostOptsOut()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(Document, Reply, Actor, new BlokAgentOptions { BuiltInComments = false });

    Assert.Null(execution.DocumentJson);
    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    Assert.Equal("COMMAND_UNAVAILABLE", result["error"]?["code"]?.GetValue<string>());
    Assert.Equal("host", result["error"]?["details"]?["reason"]?.GetValue<string>());
  }
}
