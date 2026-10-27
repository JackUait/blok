using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentPageCreateTests
{
  private const string Empty = """{"blocks":[]}""";
  private const string WithPage = """{"blocks":[{"id":"pg","type":"page","data":{"pageId":"kept"}}]}""";
  private const string InsertPage = """{"commands":[{"name":"block.insert","args":{"type":"page","id":"np","position":"end"}}]}""";
  private const string DeletePage = """{"commands":[{"name":"block.delete","args":{"id":"pg"}}]}""";
  private const string RoomId = "page-room";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent", "human-1");
  private static readonly Lazy<IBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(1, null, null));

  [Fact]
  public async Task InsertsAPageBlockPointingAtThePageTheHostCreatedForTheActor()
  {
    var pages = new Creator();
    var executor = new BlokAgentExecutor(Runtime.Value);

    var execution = await executor.ExecuteAsync(Empty, InsertPage, Actor, Options(pages));

    Assert.True(Ok(execution), execution.ResultJson);
    Assert.Equal(["host-1"], pages.Created);
    Assert.Equal([Actor], pages.Actors);
    Assert.Equal("host-1", PageIdOf(execution.DocumentJson!, "np"));
  }

  [Fact]
  public async Task ThePageIdTheAgentWritesNeverWinsOverTheHostsPage()
  {
    var pages = new Creator();
    var executor = new BlokAgentExecutor(Runtime.Value);
    const string Forged = """{"commands":[{"name":"block.insert","args":{"type":"page","id":"np","data":{"pageId":"someone-elses"}}}]}""";

    var execution = await executor.ExecuteAsync(Empty, Forged, Actor, Options(pages));

    Assert.True(Ok(execution), execution.ResultJson);
    Assert.Equal("host-1", PageIdOf(execution.DocumentJson!, "np"));
  }

  [Fact]
  public async Task TheContractListsPageAsInsertableOnlyWhenThePageTargetCreatesPages()
  {
    var executor = new BlokAgentExecutor(Runtime.Value);

    Assert.True(PageEntry(await executor.GetContractAsync(Options(new Creator())))["insertable"]!.GetValue<bool>());
    var plain = PageEntry(await executor.GetContractAsync(new BlokAgentOptions { PageTitles = true, PageTarget = new ResolveOnly() }));
    Assert.False(plain["insertable"]!.GetValue<bool>());
    Assert.Equal("host", plain["insertUnavailableReason"]!.GetValue<string>());
    Assert.True(PageEntry(await executor.OpenSession(Actor, Options(new Creator())).GetContractAsync())["insertable"]!.GetValue<bool>());
  }

  [Fact]
  public async Task WithoutACreatorAPageInsertIsUnavailableBecauseOfTheHost()
  {
    var executor = new BlokAgentExecutor(Runtime.Value);

    var execution = await executor.ExecuteAsync(Empty, InsertPage, Actor, new BlokAgentOptions { PageTitles = true, PageTarget = new ResolveOnly() });

    var error = Error(execution);
    Assert.Equal("COMMAND_UNAVAILABLE", error["code"]!.GetValue<string>());
    Assert.Equal("host", error["details"]!["reason"]!.GetValue<string>());
    Assert.Null(execution.DocumentJson);
  }

  [Fact]
  public async Task ARefusedBatchCreatesNoPage()
  {
    var pages = new Creator();
    var executor = new BlokAgentExecutor(Runtime.Value);
    const string Refused = """{"commands":[{"name":"block.insert","args":{"type":"page","id":"np"}},{"name":"block.delete","args":{"id":"missing"}}]}""";

    var execution = await executor.ExecuteAsync(Empty, Refused, Actor, Options(pages));

    Assert.Equal("BLOCK_NOT_FOUND", Error(execution)["code"]!.GetValue<string>());
    Assert.Empty(pages.Created);
  }

  [Fact]
  public async Task AHostThatRefusesTheActorFailsForbiddenAndListsThePagesAlreadyMade()
  {
    var pages = new Creator(refuseAfter: 1);
    var executor = new BlokAgentExecutor(Runtime.Value);
    const string Two = """{"commands":[{"name":"block.insert","args":{"type":"page","id":"a"}},{"name":"block.insert","args":{"type":"page","id":"b"}}]}""";

    var execution = await executor.ExecuteAsync(Empty, Two, Actor, Options(pages));

    var error = Error(execution);
    Assert.Equal("ORPHANED_SIDE_EFFECT", error["code"]!.GetValue<string>());
    Assert.Equal("FORBIDDEN", error["details"]!["cause"]!["code"]!.GetValue<string>());
    Assert.Contains("host-1", error["details"]!["orphaned"]!.ToJsonString(), StringComparison.Ordinal);
    Assert.Null(execution.DocumentJson);

    var alone = await executor.ExecuteAsync(Empty, InsertPage, Actor, Options(new Creator(refuseAfter: 0)));
    Assert.Equal("FORBIDDEN", Error(alone)["code"]!.GetValue<string>());
  }

  [Fact]
  public async Task DeletingAPageBlockRemovesOnlyTheLinkAndNeverAsksTheHost()
  {
    var pages = new Creator();
    var executor = new BlokAgentExecutor(Runtime.Value);

    var execution = await executor.ExecuteAsync(WithPage, DeletePage, Actor, Options(pages));

    Assert.True(Ok(execution), execution.ResultJson);
    Assert.Empty(JsonNode.Parse(execution.DocumentJson!)!["blocks"]!.AsArray());
    Assert.Empty(pages.Created);
    Assert.Empty(pages.Resolved);
  }

  [Fact]
  public async Task ASessionUndoesAPageInsertAndRedoesItWithoutCreatingAgain()
  {
    var pages = new Creator();
    var session = new BlokAgentExecutor(Runtime.Value).OpenSession(Actor, Options(pages));
    var inserted = await session.ExecuteAsync(Empty, InsertPage);
    var undone = await session.ExecuteAsync(inserted.DocumentJson!, """{"commands":[{"name":"history.undo","args":{}}]}""");
    var redone = await session.ExecuteAsync(undone.DocumentJson!, """{"commands":[{"name":"history.redo","args":{}}]}""");

    Assert.True(Ok(redone), redone.ResultJson);
    Assert.Empty(JsonNode.Parse(undone.DocumentJson!)!["blocks"]!.AsArray());
    Assert.Equal("host-1", PageIdOf(redone.DocumentJson!, "np"));
    Assert.Equal(["host-1"], pages.Created);
  }

  [Fact]
  public async Task RefusesToDeleteALockedDatabase()
  {
    var executor = new BlokAgentExecutor(Runtime.Value);
    const string Locked = """
        {"blocks":[{"id":"D","type":"database","data":{"schema":[{"id":"dt","name":"Name","type":"title","position":"a0","databaseLocked":true}],"views":[{"id":"v","name":"Table","type":"table","position":"a0"}],"activeViewId":"v"}}]}
        """;

    var execution = await executor.ExecuteAsync(Locked, """{"commands":[{"name":"block.delete","args":{"id":"D"}}]}""", Actor, Options(new Creator()));

    Assert.Equal("PRECONDITION_FAILED", Error(execution)["code"]!.GetValue<string>());
    Assert.Null(execution.DocumentJson);
  }

  [Fact]
  public async Task InARoomTheInsertedPagePointsAtTheHostsPageAndUndoRedoNeverCreateAgain()
  {
    var endpoint = new FakeDocEndpoint();
    endpoint.HoldsDocument(RoomId, JsonNode.Parse(Empty)!.AsObject());
    var time = new ManualTimeProvider();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(new FakeWorkingSetStore(), endpoint, converter, new CollabRoomOptions(), time, _ => { }, new FakeCollabOperationStore());
    var executor = new BlokAgentExecutor(Runtime.Value, rooms, converter);
    var pages = new Creator();

    var inserted = await executor.ExecuteInRoomAsync(RoomId, InsertPage, Actor, Options(pages));
    Assert.True(Ok(inserted), inserted.ResultJson);
    Assert.Equal("host-1", PageIdOf((await rooms.StateAsync(RoomId)).Json, "np"));

    var undone = await executor.ExecuteInRoomAsync(RoomId, """{"commands":[{"name":"history.undo","args":{}}]}""", Actor, Options(pages));
    Assert.True(Ok(undone), undone.ResultJson);
    Assert.Empty(JsonNode.Parse((await rooms.StateAsync(RoomId)).Json)!["blocks"]!.AsArray());
    var redone = await executor.ExecuteInRoomAsync(RoomId, """{"commands":[{"name":"history.redo","args":{}}]}""", Actor, Options(pages));
    Assert.True(Ok(redone), redone.ResultJson);
    Assert.Equal("host-1", PageIdOf((await rooms.StateAsync(RoomId)).Json, "np"));
    Assert.Equal(["host-1"], pages.Created);

    var deleted = await executor.ExecuteInRoomAsync(RoomId, """{"commands":[{"name":"block.delete","args":{"id":"np"}}]}""", Actor, Options(pages));
    Assert.True(Ok(deleted), deleted.ResultJson);
    Assert.Equal(["host-1"], pages.Created);
    Assert.Empty(pages.Resolved);
  }

  [Fact]
  public async Task InARoomAStaleRevisionCreatesNoPage()
  {
    var endpoint = new FakeDocEndpoint();
    endpoint.HoldsDocument(RoomId, JsonNode.Parse(Empty)!.AsObject());
    var time = new ManualTimeProvider();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(new FakeWorkingSetStore(), endpoint, converter, new CollabRoomOptions(), time, _ => { }, new FakeCollabOperationStore());
    var executor = new BlokAgentExecutor(Runtime.Value, rooms, converter);
    var pages = new Creator();
    var first = await executor.ExecuteInRoomAsync(RoomId, """{"commands":[{"name":"block.insert","args":{"type":"paragraph","id":"p1","position":"end"}}]}""", Actor, Options(pages));
    var old = JsonNode.Parse(first.ResultJson)!["revision"]!.GetValue<string>();
    await executor.ExecuteInRoomAsync(RoomId, """{"commands":[{"name":"block.insert","args":{"type":"paragraph","id":"p2","position":"end"}}]}""", Actor, Options(pages));

    var stale = await executor.ExecuteInRoomAsync(
        RoomId, $$$"""{"expectRevision":"{{{old}}}","commands":[{"name":"block.insert","args":{"type":"page","id":"np","position":"end"}}]}""", Actor, Options(pages));

    Assert.Equal("STALE", Error(stale)["code"]!.GetValue<string>());
    Assert.Empty(pages.Created);
  }

  [Fact]
  public async Task PageRenameAsksTheHostForTheTargetAsThisActor()
  {
    var pages = new Creator();
    var executor = new BlokAgentExecutor(Runtime.Value);

    var execution = await executor.ExecuteAsync(
        WithPage, """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""", Actor, Options(pages));

    Assert.False(Ok(execution), execution.ResultJson);
    Assert.Equal(["kept"], pages.Resolved);
    Assert.Equal([Actor], pages.Actors);
  }

  private const string TwoPages = """{"commands":[{"name":"block.insert","args":{"type":"page","id":"a"}},{"name":"block.insert","args":{"type":"page","id":"b"}}]}""";

  public static TheoryData<string> Failures => new() { "cancel", "error" };

  [Fact]
  public async Task AHostErrorPartwayListsThePagesAlreadyMade()
  {
    var pages = new Creator(throwAfter: 1);
    var executor = new BlokAgentExecutor(Runtime.Value);

    var execution = await executor.ExecuteAsync(Empty, TwoPages, Actor, Options(pages));

    AssertOrphaned(execution, "APPLY_FAILED");
  }

  [Theory]
  [MemberData(nameof(Failures))]
  public async Task AStoredRunThatStopsAfterTheHostMadePagesListsThem(string failure)
  {
    var pages = new Creator();
    var executor = new BlokAgentExecutor(new FailingExecute(Runtime.Value, failure));

    var execution = await executor.ExecuteAsync(Empty, InsertPage, Actor, Options(pages));

    Assert.Equal(["host-1"], pages.Created);
    AssertOrphaned(execution, failure == "cancel" ? "CANCELLED" : "APPLY_FAILED");
  }

  [Theory]
  [MemberData(nameof(Failures))]
  public async Task ARoomRunThatStopsAfterTheHostMadePagesListsThem(string failure)
  {
    var endpoint = new FakeDocEndpoint();
    endpoint.HoldsDocument(RoomId, JsonNode.Parse(Empty)!.AsObject());
    var time = new ManualTimeProvider();
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(new FakeWorkingSetStore(), endpoint, converter, new CollabRoomOptions(), time, _ => { }, new FakeCollabOperationStore());
    var executor = new BlokAgentExecutor(new FailingExecute(Runtime.Value, failure), rooms, converter);
    var pages = new Creator();

    var execution = await executor.ExecuteInRoomAsync(RoomId, InsertPage, Actor, Options(pages));

    Assert.Equal(["host-1"], pages.Created);
    AssertOrphaned(execution, failure == "cancel" ? "CANCELLED" : "APPLY_FAILED");
    Assert.Empty(JsonNode.Parse((await rooms.StateAsync(RoomId)).Json)!["blocks"]!.AsArray());
  }

  private static void AssertOrphaned(BlokAgentExecution execution, string cause)
  {
    var error = Error(execution);
    Assert.Equal("ORPHANED_SIDE_EFFECT", error["code"]!.GetValue<string>());
    Assert.Equal(cause, error["details"]!["cause"]!["code"]!.GetValue<string>());
    Assert.Contains("host-1", error["details"]!["orphaned"]!.ToJsonString(), StringComparison.Ordinal);
    Assert.Null(execution.DocumentJson);
  }

  /// <summary>Lets the page count run, then fails the batch run itself.</summary>
  private sealed class FailingExecute(IBlokRuntime inner, string failure) : IBlokRuntime
  {
    public ValueTask<string> InvokeAsync(string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default) =>
        operation != "agentExecute" ? inner.InvokeAsync(operation, inputJson, timeout, cancellationToken)
        : failure == "cancel" ? throw new OperationCanceledException()
        : throw new InvalidOperationException("The engine broke.");
  }

  private static BlokAgentOptions Options(IBlokPageTarget pages) => new() { PageTitles = true, PageTarget = pages };

  private static bool Ok(BlokAgentExecution execution) => JsonNode.Parse(execution.ResultJson)!["ok"]!.GetValue<bool>();

  private static JsonObject Error(BlokAgentExecution execution) => JsonNode.Parse(execution.ResultJson)!["error"]!.AsObject();

  private static string? PageIdOf(string documentJson, string id) =>
      JsonNode.Parse(documentJson)!["blocks"]!.AsArray()
          .Single(block => block!["id"]!.GetValue<string>() == id)!["data"]!["pageId"]!.GetValue<string>();

  private static string? PageIdOf(byte[] documentJson, string id) => PageIdOf(System.Text.Encoding.UTF8.GetString(documentJson), id);

  private static JsonObject PageEntry(string contractJson) =>
      JsonNode.Parse(contractJson)!["manifest"]!["blocks"]!.AsArray()
          .Single(block => block!["name"]!.GetValue<string>() == "page")!.AsObject();

  private sealed class ResolveOnly : IBlokPageTarget
  {
    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<BlokPageLocation?>(null);
  }

  private sealed class Creator(int refuseAfter = int.MaxValue, int throwAfter = int.MaxValue) : IBlokPageCreator
  {
    internal List<string> Created { get; } = [];
    internal List<BlokAgentActor> Actors { get; } = [];
    internal List<string> Resolved { get; } = [];

    public ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      Actors.Add(actor);
      if (Created.Count >= throwAfter)
      {
        throw new InvalidOperationException("The host's page store is down.");
      }
      if (Created.Count >= refuseAfter)
      {
        return ValueTask.FromResult<string?>(null);
      }
      var pageId = $"host-{Created.Count + 1}";
      Created.Add(pageId);

      return ValueTask.FromResult<string?>(pageId);
    }

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      Resolved.Add(pageId);
      Actors.Add(actor);

      return ValueTask.FromResult<BlokPageLocation?>(null);
    }
  }
}
