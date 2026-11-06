using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// A live handle on a room this app hosts itself (the library form): runs go through
/// ExecuteInRoomAsync with the handle's mcp and approval inputs, so the contract and the
/// refusals are the handle's. The revision is the room's journal head, not Node's l&lt;n&gt;.
/// </summary>
internal sealed class RoomSession(
    McpBundle bundle,
    BlokAgentExecutor rooms,
    string documentId,
    bool write,
    JsonObject flags,
    JsonObject actor,
    string contractRevision,
    JsonArray? unavailableCommands) : IHandleSession
{
  private readonly JsonObject mcp = Handle(flags, write);

  public JsonObject Describe()
  {
    var described = new JsonObject
    {
      ["mode"] = "live",
      ["write"] = write,
      ["durability"] = rooms.HasRoomJournal ? "acknowledged" : "best-effort",
      ["contractRevision"] = contractRevision,
    };

    if (unavailableCommands is { Count: > 0 })
    {
      described["unavailableCommands"] = unavailableCommands.DeepClone();
    }

    return described;
  }

  public Task<JsonObject> ReadAsync(JsonNode? view, CancellationToken cancellationToken)
  {
    return SessionAnswerAsync("mcpRead", "view", view, cancellationToken);
  }

  public Task<JsonObject> DescribeAsync(JsonNode? query, CancellationToken cancellationToken)
  {
    return SessionAnswerAsync("mcpDescribe", "query", query, cancellationToken);
  }

  public async Task<McpExecuteOutcome> ExecuteAsync(JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    var options = new BlokAgentOptions
    {
      Mcp = (JsonObject)mcp.DeepClone(),
      Approval = approval is null ? null : new JsonObject
      {
        ["capabilities"] = approval.Capabilities?.DeepClone(),
        ["clientName"] = approval.ClientName,
        ["replies"] = approval.Replies?.DeepClone(),
      },
    };
    var ran = await rooms.ExecuteInRoomAsync(documentId, McpJson.Write(batch), ActorOf(actor), options, cancellationToken);

    if (ran.Ask is JsonObject ask)
    {
      return new McpExecuteOutcome(null, ask);
    }
    var result = McpJson.Parse(ran.ResultJson) as JsonObject ?? [];
    var input = new JsonObject { ["result"] = result };

    // A journal room commits a write before it answers, so the head names its sequence.
    // A write that changed nothing is durable with no sequence, as Node's live handle answers.
    if (McpJson.Bool(result["ok"]) == true && ran.Writes && rooms.HasRoomJournal)
    {
      var at = ran.Revision.LastIndexOf(':');

      input["delivery"] = new JsonObject
      {
        ["durable"] = true,
        ["pending"] = false,
        ["serverSequence"] = ran.Wrote && at > 0 ? ran.Revision[(at + 1)..] : null,
        ["savedVersion"] = null,
      };
    }
    var answer = await bundle.CallAsync("mcpExecuteAnswer", input, cancellationToken);

    return new McpExecuteOutcome((JsonObject)answer["answer"]!, null);
  }

  public Task<JsonObject> CloseAsync(string reason)
  {
    return Task.FromResult(new JsonObject { ["unsavedBatches"] = 0, ["hostRecordLags"] = false });
  }

  internal static JsonObject Handle(JsonObject flags, bool write)
  {
    var handle = (JsonObject)flags.DeepClone();

    handle["mode"] = "live";
    handle["write"] = write;

    return handle;
  }

  private static BlokAgentActor ActorOf(JsonObject actor)
  {
    return new BlokAgentActor(McpJson.String(actor["id"]) ?? string.Empty, McpJson.String(actor["name"]) ?? string.Empty, McpJson.String(actor["onBehalfOf"]));
  }

  private async Task<JsonObject> SessionAnswerAsync(string operation, string key, JsonNode? value, CancellationToken cancellationToken)
  {
    var (document, head) = await rooms.ReadRoomAsync(documentId, cancellationToken);

    if (document is null)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The room could not be read. Try again.");
    }
    var input = new JsonObject
    {
      ["mcp"] = mcp.DeepClone(),
      ["document"] = document.DeepClone(),
      ["actor"] = actor.DeepClone(),
      [key] = value?.DeepClone() ?? new JsonObject(),
    };

    if (head.Length > 0)
    {
      input["revision"] = new JsonObject { ["now"] = head, ["afterWrite"] = head };
    }

    return (JsonObject)(await bundle.CallAsync(operation, input, cancellationToken))["answer"]!;
  }
}
