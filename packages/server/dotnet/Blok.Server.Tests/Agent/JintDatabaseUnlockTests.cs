using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class JintDatabaseUnlockTests
{
  private const string Document = """
      {"blocks":[
        {"id":"db","type":"database","content":[],"data":{"title":"Tasks","activeViewId":"v1",
          "views":[{"id":"v1","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}]}}]}
      """;

  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");

  // The server has no person to ask, so an unlock always stays refused.
  [Fact]
  public async Task UnlockingALockedDatabaseIsRefusedBecauseNoPersonCanBeAsked()
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        Document, """{"commands":[{"name":"database.setLock","args":{"id":"db","locked":false}}]}""", Actor);

    Assert.Null(execution.DocumentJson);
    var result = Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));
    var error = Assert.IsType<JsonObject>(result["error"]);
    Assert.Equal("APPROVAL_REQUIRED", error["code"]?.GetValue<string>());
    Assert.Equal("no-channel", error["details"]?["reason"]?.GetValue<string>());
  }

  private const string FormDocument = """
      {"blocks":[
        {"id":"db","type":"database","content":[],"data":{"title":"Tasks","activeViewId":"v1",
          "views":[{"id":"v1","name":"Signup","type":"form","position":"a0","filters":[],"sorts":[],"visibleProperties":[],"form":{}}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"}]}}]}
      """;

  // Closing a form is the person's to approve, and the server has no person to ask.
  [Fact]
  public async Task ClosingAFormIsRefusedBecauseNoPersonCanBeAsked()
  {
    var error = await ShareErrorAsync("""{"form":{"closed":true}}""");

    Assert.Equal("APPROVAL_REQUIRED", error["code"]?.GetValue<string>());
    Assert.Equal("no-channel", error["details"]?["reason"]?.GetValue<string>());
    Assert.Equal("database.share", error["details"]?["approval"]?["kind"]?.GetValue<string>());
  }

  // The server knows no forms host, so as in the Share panel without one these are not offered at all.
  [Theory]
  [InlineData("""{"form":{"public":true}}""")]
  [InlineData("""{"form":{"anonymous":true}}""")]
  [InlineData("""{"form":{"submissionAccess":"edit"}}""")]
  public async Task AHostOnlySharingChangeIsUnavailable(string changes)
  {
    var error = await ShareErrorAsync(changes);

    Assert.Equal("COMMAND_UNAVAILABLE", error["code"]?.GetValue<string>());
    Assert.Equal("host", error["details"]?["reason"]?.GetValue<string>());
  }

  // No person can change calendar sync in Blok.
  [Fact]
  public async Task CalendarSyncIsRefused()
  {
    var error = await ShareErrorAsync("""{"calendarSync":{"enabled":true,"calendarId":"team"}}""");

    Assert.Equal("PRECONDITION_FAILED", error["code"]?.GetValue<string>());
  }

  private static async Task<JsonObject> ShareErrorAsync(string changes)
  {
    IBlokAgentExecutor executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        FormDocument, $$$"""{"commands":[{"name":"database.updateView","args":{"id":"db","viewId":"v1","changes":{{{changes}}}}}]}""", Actor);

    Assert.Null(execution.DocumentJson);

    return Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson)!["error"]);
  }
}
