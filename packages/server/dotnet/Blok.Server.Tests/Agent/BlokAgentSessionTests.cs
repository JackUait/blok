using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentSessionTests
{
  private const string Document = """{"blocks":[{"id":"p","type":"paragraph","data":{"text":[{"text":"Hello"}]}}]}""";
  private const string Undo = """{"commands":[{"name":"history.undo","args":{}}]}""";
  private const string Redo = """{"commands":[{"name":"history.redo","args":{}}]}""";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");
  private static readonly Lazy<IBlokAgentExecutor> Executor = new(() => BlokDocuments.CreateAgentExecutor(poolSize: 1));

  private static string Rename(string title) =>
      new JsonObject
      {
        ["commands"] = new JsonArray(new JsonObject
        {
          ["name"] = "doc.setTitle",
          ["args"] = new JsonObject { ["title"] = title },
        }),
      }.ToJsonString();

  private static JsonObject Result(BlokAgentExecution execution) =>
      Assert.IsType<JsonObject>(JsonNode.Parse(execution.ResultJson));

  private static string? Title(string? documentJson) =>
      documentJson is null ? null : JsonNode.Parse(documentJson)?["title"]?.GetValue<string>();

  private static string Saved(BlokAgentExecution execution)
  {
    Assert.True(Result(execution)["ok"]!.GetValue<bool>(), execution.ResultJson);

    return Assert.IsType<string>(execution.DocumentJson);
  }

  [Fact]
  public async Task UndoesAndRedoesItsOwnBatchesAcrossCalls()
  {
    var session = Executor.Value.OpenSession(Actor);

    var one = Saved(await session.ExecuteAsync(Document, Rename("One")));
    var two = Saved(await session.ExecuteAsync(one, Rename("Two")));
    var undone = Saved(await session.ExecuteAsync(two, Undo));

    Assert.Equal("One", Title(undone));
    var first = Saved(await session.ExecuteAsync(undone, Undo));

    Assert.Null(Title(first));
    var redone = Saved(await session.ExecuteAsync(first, Redo));

    Assert.Equal("One", Title(redone));
    var last = Saved(await session.ExecuteAsync(redone, Redo));

    Assert.Equal("Two", Title(last));
    var nothing = await session.ExecuteAsync(last, Redo);

    Assert.Equal("NOTHING_TO_REDO", Result(nothing)["error"]!["code"]!.GetValue<string>());
    Assert.Null(nothing.DocumentJson);
  }

  [Fact]
  public async Task RefusesToUndoOverSomeoneElsesSave()
  {
    var session = Executor.Value.OpenSession(Actor);
    var mine = Saved(await session.ExecuteAsync(Document, Rename("Mine")));
    var theirs = JsonNode.Parse(mine)!.AsObject();

    theirs["title"] = "Theirs";
    var refused = await session.ExecuteAsync(theirs.ToJsonString(), Undo);

    Assert.Equal("CONFLICT", Result(refused)["error"]!["code"]!.GetValue<string>());
    Assert.Null(refused.DocumentJson);
  }

  [Fact]
  public async Task SessionsKeepTheirOwnSteps()
  {
    var a = Executor.Value.OpenSession(Actor);
    var b = Executor.Value.OpenSession(Actor);

    Saved(await a.ExecuteAsync(Document, Rename("A")));
    var refused = await b.ExecuteAsync(Document, Undo);

    Assert.Equal("NOTHING_TO_UNDO", Result(refused)["error"]!["code"]!.GetValue<string>());
  }

  [Fact]
  public async Task AnswersUndoOtherDocumentAfterAPageAction()
  {
    const string source = """{"blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}""";
    var options = new BlokAgentOptions { PageTitles = true, PageTarget = new StoredPage() };
    var session = Executor.Value.OpenSession(Actor, options);

    var named = Saved(await session.ExecuteAsync(source, Rename("Source")));
    var renamed = await session.ExecuteAsync(
        named, """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""");

    Assert.True(Result(renamed)["ok"]!.GetValue<bool>(), renamed.ResultJson);
    var refused = await session.ExecuteAsync(named, Undo);

    Assert.Equal("UNDO_OTHER_DOCUMENT", Result(refused)["error"]!["code"]!.GetValue<string>());
  }

  [Fact]
  public async Task OffersHistoryInTheStoredContractButNotInARoom()
  {
    var stored = JsonNode.Parse(await Executor.Value.GetContractAsync())!;
    var room = JsonNode.Parse(await Executor.Value.GetRoomContractAsync())!;

    foreach (var name in new[] { "history.undo", "history.redo" })
    {
      Assert.True(Command(stored, name)["available"]!.GetValue<bool>());
      Assert.False(Command(room, name)["available"]!.GetValue<bool>());
      Assert.Equal("runtime", Command(room, name)["unavailableReason"]!.GetValue<string>());
    }
  }

  private static JsonObject Command(JsonNode contract, string name) =>
      Assert.Single(contract["commands"]!.AsArray().OfType<JsonObject>(), command => command["name"]?.GetValue<string>() == name);

  private sealed class StoredPage : IBlokPageTarget
  {
    private string document = """{"blocks":[]}""";

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<BlokPageLocation?>(new BlokPageLocation.Stored(
            _ => ValueTask.FromResult(document),
            (json, _) =>
            {
              document = json;

              return ValueTask.CompletedTask;
            }));
  }
}
