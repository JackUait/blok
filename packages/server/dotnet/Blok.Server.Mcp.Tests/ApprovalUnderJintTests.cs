using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class ApprovalUnderJintTests(BundleFixture fixture) : IClassFixture<BundleFixture>
{
  private static JsonObject Input(JsonNode? replies)
  {
    var approval = new JsonObject { ["capabilities"] = new JsonObject { ["elicitation"] = new JsonObject() }, ["clientName"] = "Desk" };

    if (replies is not null)
    {
      approval["replies"] = replies;
    }

    return new JsonObject
    {
      ["mcp"] = new JsonObject { ["source"] = true, ["mode"] = "stored", ["write"] = true },
      ["document"] = JsonNode.Parse("""
          {"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v",
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],
          "views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}
          """),
      ["actor"] = new JsonObject { ["id"] = "agent:alice:Desk", ["name"] = "Desk (for alice)", ["kind"] = "agent", ["onBehalfOf"] = "alice" },
      ["history"] = new JsonObject(),
      ["documentText"] = "file",
      ["approval"] = approval,
      ["batch"] = JsonNode.Parse("""{"commands":[{"name":"database.setLock","args":{"id":"db","locked":false}}]}"""),
    };
  }

  [Fact]
  public async Task AnAcceptedUnlockAppliesOnTheRetry()
  {
    var asked = await fixture.Host.Bundle.CallAsync("agentExecute", Input(null));
    var key = (string?)asked["ask"]?["key"];

    Assert.NotNull(key);
    var retried = await fixture.Host.Bundle.CallAsync("agentExecute", Input(new JsonObject
    {
      [key] = new JsonObject { ["action"] = "accept", ["content"] = new JsonObject { ["unlock"] = true } },
    }));

    Assert.Equal("""{"ok":true}""", new JsonObject { ["ok"] = retried["result"]?["ok"]?.DeepClone() }.ToJsonString());
    Assert.True((bool?)retried["save"]);
  }
}
