using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// A live handle on a remote room (live-session.ts): plans each batch in the
/// bundle against the local doc, writes it as one transaction, and reports
/// what the room did with it.
/// </summary>
internal sealed class LiveSession : IHandleSession
{
  private static readonly object AgentOrigin = new();

  private readonly LiveRoom room;
  private readonly McpBundle bundle;
  private readonly CollabDocConverter converter;
  private readonly JsonObject flags;
  private readonly JsonObject actor;
  private readonly bool write;
  private readonly string contractRevision;
  private readonly JsonArray? unavailableCommands;
  private readonly LivePresence presence;
  private readonly LiveVersionHistory history;
  private readonly TimeSpan ackTimeout;
  // Batch number -> its row ids, until every row is acked.
  private readonly Dictionary<int, IReadOnlyList<string>> unacked = [];
  private bool readOnly;
  private int batches;

  internal LiveSession(
      LiveRoom room, McpBundle bundle, JsonObject flags, McpCaller caller, bool write, string contractRevision,
      JsonArray? unavailableCommands, LiveVersionHistory history, TimeSpan? ackTimeout = null)
  {
    this.room = room;
    this.bundle = bundle;
    this.flags = flags;
    actor = caller.Actor;
    this.write = write;
    this.contractRevision = contractRevision;
    this.unavailableCommands = unavailableCommands;
    this.history = history;
    this.ackTimeout = ackTimeout ?? TimeSpan.FromSeconds(10);
    readOnly = !write;
    converter = new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(bundle.Runtime));
    presence = new LivePresence(room.SetAwarenessField, room.Provider.SendActivity, actor, caller.PresenceName);
  }

  /// <summary>Call on the room loop right after the open.</summary>
  internal void Start()
  {
    room.ResetUpdateCount();
    presence.Announce();
  }

  public JsonObject Describe()
  {
    var described = new JsonObject
    {
      ["mode"] = "live",
      ["write"] = write,
      ["durability"] = room.Protocol == "v2" ? "acknowledged" : "best-effort",
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
    return room.Loop.RunAsync(async () =>
    {
      await ThrowIfEndedAsync(cancellationToken);
      var input = await SessionInputAsync(cancellationToken);

      input["view"] = view?.DeepClone() ?? new JsonObject();

      return (JsonObject)(await bundle.CallAsync("mcpRead", input, cancellationToken))["answer"]!;
    });
  }

  public Task<JsonObject> DescribeAsync(JsonNode? query, CancellationToken cancellationToken)
  {
    return room.Loop.RunAsync(async () =>
    {
      var input = await SessionInputAsync(cancellationToken);

      input["query"] = query?.DeepClone() ?? new JsonObject();

      return (JsonObject)(await bundle.CallAsync("mcpDescribe", input, cancellationToken))["answer"]!;
    });
  }

  public Task<McpExecuteOutcome> ExecuteAsync(JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    return room.Loop.RunAsync(() => ExecuteOnLoopAsync(batch, approval, cancellationToken));
  }

  public Task<JsonObject> CloseAsync(string reason)
  {
    return room.Loop.RunAsync(async () =>
    {
      var summary = new JsonObject { ["unsavedBatches"] = NotSaved().Count, ["hostRecordLags"] = room.Protocol == "v2" };

      presence.Clear();
      await room.CloseAsync();

      return summary;
    });
  }

  private async Task<McpExecuteOutcome> ExecuteOnLoopAsync(JsonNode? batch, McpApproval? approval, CancellationToken cancellationToken)
  {
    await ThrowIfEndedAsync(cancellationToken);
    var mark = room.Outbox.AppendedCount;
    var failuresBefore = room.AppendFailures;
    JsonObject result;
    bool writing;

    // Single lane: the doc must stay as exported until the write is queued.
    room.HoldDocFrames();
    try
    {
      var input = await SessionInputAsync(cancellationToken);

      input["history"] = new JsonObject();
      input["batch"] = batch?.DeepClone();
      if (approval is not null)
      {
        input["approval"] = ApprovalInput(approval);
      }
      if (await history.LoadAsync(batch, cancellationToken) is { } versions)
      {
        input["versionHistory"] = versions;
      }
      var ran = await bundle.CallAsync("agentExecute", input, cancellationToken);

      if (ran["ask"] is JsonObject ask)
      {
        return new McpExecuteOutcome(null, ask);
      }
      result = (JsonObject)ran["result"]!;
      writing = McpJson.Bool(ran["writes"]) == true;
      if (McpJson.Bool(result["ok"]) != true)
      {
        if (McpJson.String(result["error"]?["code"]) == "APPLY_FAILED")
        {
          readOnly = true;
        }

        return new McpExecuteOutcome(await AnswerAsync(new JsonObject { ["result"] = result.DeepClone() }, cancellationToken), null);
      }
      if (ran["restore"] is not null)
      {
        return new McpExecuteOutcome(await FailedAsync(result, McpHostError.Surface("SOURCE_UNAVAILABLE", "Restoring a version is not served on remote live rooms yet."), cancellationToken), null);
      }
      if (ran["edits"] is JsonArray { Count: > 0 } edits && ran["document"] is JsonObject after)
      {
        var ops = RoomEditTranslator.Translate(edits, after, result);

        if (ops.Count > 0)
        {
          var html = await converter.ReadOpsHtmlAsync(room.Doc, ops, cancellationToken);

          room.WriteLocal(AgentOrigin, _ => YDocConverter.ApplyOps(room.Doc, ops, html));
        }
      }
    }
    finally
    {
      room.ReleaseDocFrames();
    }
    presence.AfterBatch(result);
    if (!writing || room.Protocol == "v1")
    {
      return new McpExecuteOutcome(await AnswerAsync(new JsonObject { ["result"] = result.DeepClone() }, cancellationToken), null);
    }
    // A write the outbox could not take is in our doc but never reaches the room.
    if (room.AppendFailures != failuresBefore)
    {
      readOnly = true;

      return new McpExecuteOutcome(await FailedAsync(result, McpHostError.Surface(
          "APPLY_FAILED",
          "The batch changed the local copy but could not be queued for the room. It was not saved; open the document again.",
          new JsonObject { ["stage"] = "journal" }), cancellationToken), null);
    }
    var ids = room.Outbox.IdsSince(mark);
    var number = ++batches;

    unacked[number] = ids;
    var fate = await WaitOrEndAsync(ids);

    if (fate is null)
    {
      return new McpExecuteOutcome(await FailedAsync(result, await EndErrorAsync(room.End!, cancellationToken), cancellationToken), null);
    }
    switch (fate)
    {
      case BatchDelivery.Acked acked:
        unacked.Remove(number);

        return new McpExecuteOutcome(await AnswerAsync(new JsonObject
        {
          ["result"] = result.DeepClone(),
          ["delivery"] = Delivery(true, false, acked.ServerSequence),
        }, cancellationToken), null);
      case BatchDelivery.Timeout:
        return new McpExecuteOutcome(await AnswerAsync(new JsonObject
        {
          ["result"] = result.DeepClone(),
          ["delivery"] = Delivery(false, true, null),
        }, cancellationToken), null);
      case BatchDelivery.Quarantined { Reason: RoomProvider.RelineageReason }:
        // A reset lost this batch too, so it stays in unacked.
        return new McpExecuteOutcome(await FailedAsync(result, await EndErrorAsync(new RoomEnd(true, null), cancellationToken), cancellationToken), null);
      case BatchDelivery.Quarantined { Reason: "read-only" }:
        unacked.Remove(number);
        readOnly = true;

        return new McpExecuteOutcome(await FailedAsync(result, McpHostError.Surface("READ_ONLY", "The room refused the write: this agent may only read. The batch was not saved."), cancellationToken), null);
      case BatchDelivery.Quarantined quarantined:
        unacked.Remove(number);

        return new McpExecuteOutcome(await FailedAsync(result, McpHostError.Surface(
            "REJECTED", "The room refused this batch. It was not saved.", new JsonObject { ["rejectionCode"] = quarantined.Reason }), cancellationToken), null);
      default:
        throw new InvalidOperationException("Unknown batch delivery.");
    }
  }

  // Null when the room ended first; the batch stays in unacked, so close() and ROOM_RESET still count it.
  private async Task<BatchDelivery?> WaitOrEndAsync(IReadOnlyList<string> ids)
  {
    if (room.End is not null)
    {
      return null;
    }
    using var ending = new CancellationTokenSource();
    var ended = false;
    void OnEnd(RoomEnd _)
    {
      ended = true;
      ending.Cancel();
    }

    room.Ended += OnEnd;
    try
    {
      var fate = await room.Outbox.WaitForAsync(ids, room.Loop, ackTimeout, ending.Token);

      return ended ? null : fate;
    }
    finally
    {
      room.Ended -= OnEnd;
    }
  }

  private List<int> NotSaved()
  {
    foreach (var (number, ids) in unacked.ToList())
    {
      if (ids.All(room.Outbox.IsAcked))
      {
        unacked.Remove(number);
      }
    }

    return [.. unacked.Keys];
  }

  private async Task ThrowIfEndedAsync(CancellationToken cancellationToken)
  {
    if (room.End is { } end)
    {
      throw await EndErrorAsync(end, cancellationToken);
    }
  }

  private async Task<McpHostError> EndErrorAsync(RoomEnd end, CancellationToken cancellationToken)
  {
    if (end.Reset)
    {
      return McpHostError.Surface(
          "ROOM_RESET",
          "The room's history was reset. Work not acknowledged is lost; open the document again.",
          new JsonObject { ["notSavedBatches"] = new JsonArray([.. NotSaved().Select(number => (JsonNode)number)]) });
    }
    var input = new JsonObject();

    if (end.Terminal is not null)
    {
      input["terminal"] = end.Terminal;
    }

    return new McpHostError((JsonObject)(await bundle.CallAsync("mcpRoomError", input, cancellationToken))["error"]!);
  }

  private async Task<JsonObject> SessionInputAsync(CancellationToken cancellationToken)
  {
    var mcp = (JsonObject)flags.DeepClone();

    mcp["mode"] = "live";
    mcp["write"] = !readOnly;

    return new JsonObject
    {
      ["mcp"] = mcp,
      ["document"] = await converter.ExportAsync(room.Doc, cancellationToken),
      ["actor"] = actor.DeepClone(),
      ["revision"] = new JsonObject { ["now"] = room.Revision, ["afterWrite"] = $"l{room.UpdateCount + 1}" },
    };
  }

  private static JsonObject ApprovalInput(McpApproval approval)
  {
    var input = new JsonObject
    {
      ["capabilities"] = approval.Capabilities?.DeepClone(),
      ["clientName"] = approval.ClientName,
    };

    if (approval.Replies is not null)
    {
      input["replies"] = approval.Replies.DeepClone();
    }

    return input;
  }

  private static JsonObject Delivery(bool durable, bool pending, string? serverSequence)
  {
    return new JsonObject
    {
      ["durable"] = durable,
      ["pending"] = pending,
      ["serverSequence"] = serverSequence,
      ["savedVersion"] = null,
    };
  }

  private async Task<JsonObject> FailedAsync(JsonObject result, McpHostError error, CancellationToken cancellationToken)
  {
    return await AnswerAsync(new JsonObject { ["result"] = result.DeepClone(), ["failed"] = error.ToInput("blok_execute") }, cancellationToken);
  }

  private async Task<JsonObject> AnswerAsync(JsonObject input, CancellationToken cancellationToken)
  {
    return (JsonObject)(await bundle.CallAsync("mcpExecuteAnswer", input, cancellationToken))["answer"]!;
  }
}
