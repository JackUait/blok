using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class JintAttributionTests
{
  private const string Document = """
      {"blocks":[
        {"id":"db","type":"database","data":{"title":"Tasks","activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[
            {"id":"t","name":"Name","type":"title","position":"a0"},
            {"id":"cb","name":"Creator","type":"createdBy","position":"a1"}]}}]}
      """;

  private const string WithRow = """
      {"blocks":[
        {"id":"db","type":"database","content":["r1"],"data":{"title":"Tasks","activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[
            {"id":"t","name":"Name","type":"title","position":"a0"},
            {"id":"cb","name":"Creator","type":"createdBy","position":"a1"}]}},
        {"id":"r1","type":"database-row","parent":"db","createdAt":1767323045000,"createdBy":"u1",
          "lastEditedAt":1767323045000,"lastEditedBy":"u2","data":{"title":"One","position":"a0","properties":{"t":"One"}}}]}
      """;

  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");

  [Fact]
  public async Task WhatTheAgentCreatesIsCreatedNowByThePersonWithTheAgent()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(Document, """
        {"commands":[
          {"name":"block.insert","args":{"id":"n1","type":"paragraph","data":{"text":"new"},"position":"end"}},
          {"name":"database.addRow","args":{"id":"db","values":{"t":"Row"}}}]}
        """, Actor);

    var saved = Assert.IsType<JsonArray>(JsonNode.Parse(Assert.IsType<string>(execution.DocumentJson))?["blocks"]);
    var created = saved.OfType<JsonObject>()
        .Where(block => (string?)block["id"] == "n1" || (string?)block["type"] == "database-row").ToList();

    Assert.Equal(2, created.Count);
    Assert.All(created, block =>
    {
      Assert.True(block["createdAt"] is JsonValue at && at.TryGetValue<double>(out _), block.ToJsonString());
      Assert.Equal("human-1", (string?)block["createdBy"]);
      Assert.Equal("agent-cs", (string?)block["createdWith"]);
    });
  }

  // C# has no user directory: a read names people by id only.
  [Fact]
  public async Task AReadGivesPeopleAsIdsWithoutADirectory()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var execution = await executor.ExecuteAsync(
        WithRow, """{"commands":[{"name":"doc.read","args":{"ids":["r1"]}}]}""", Actor);

    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    var view = Assert.IsType<JsonObject>(Assert.IsType<JsonArray>(result["results"])[0]);
    var row = Assert.IsType<JsonObject>(Assert.Single(Assert.IsType<JsonArray>(view["blocks"])));
    Assert.True(JsonNode.DeepEquals(JsonNode.Parse("""[{"id":"u1"}]"""), row["computed"]?["cb"]), row.ToJsonString());
    Assert.True(JsonNode.DeepEquals(
        JsonNode.Parse("""{"lastEditedAt":"2026-01-02T03:04:05.000Z","lastEditedBy":{"id":"u2"}}"""),
        row["meta"]), row.ToJsonString());
  }
}
