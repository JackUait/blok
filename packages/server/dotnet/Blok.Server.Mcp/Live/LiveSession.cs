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
  // Not tracked by the undo manager: a person's comment is no undo step, so neither is the agent's.
  private static readonly object CommentOrigin = new();

  // COMMENT_COMMANDS in src/shared/tool-descriptions/database-comments.ts; the planner refuses a batch that mixes them with other writes.
  private static readonly HashSet<string> CommentCommands = new(StringComparer.Ordinal)
  {
    "database.addComment", "database.replyToComment", "database.editComment", "database.resolveComment", "database.deleteComment",
  };

  private readonly LiveRoom room;
  private readonly McpBundle bundle;
  private CollabDocConverter? converter;
  private readonly JsonObject flags;
  private readonly JsonObject actor;
  private readonly bool write;
  private readonly string contractRevision;
  private readonly JsonArray? unavailableCommands;
  private readonly LivePresence presence;
  private readonly LiveVersionHistory history;
  private readonly LiveAgentHistory steps;
  private readonly TimeSpan ackTimeout;
  // Batch number -> its row ids, until every row is acked.
  private readonly Dictionary<int, IReadOnlyList<string>> unacked = [];
  private bool readOnly;
  private string? emptyRevision;
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
    steps = new LiveAgentHistory(room, AgentOrigin, () => Fields);
    presence = new LivePresence(room.SetAwarenessField, room.Provider.SendActivity, actor, caller.PresenceName);
  }

  /// <summary>Call on the room loop right after the open.</summary>
  internal void Start()
  {
    room.ResetUpdateCount();
    presence.Announce();
  }

  /// <summary>Page documents under page-map; null when pages are not documents.</summary>
  internal PagePorts? Pages { get; init; }

  /// <summary>Set with a host uploader: runs the batch's upload calls.</summary>
  internal UploadPorts? Uploads { get; init; }

  /// <summary>Which fields hold rich text: the built-ins, the manifest's and --rich-text-fields.</summary>
  internal RichTextFields Fields { get; init; } = RichTextFields.BuiltIn;

  // Built on first use: Fields is set after the constructor.
  private CollabDocConverter Converter => converter ??= new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(bundle.Runtime), Fields);

  /// <summary>The room's document id: a page block pointing here is refused.</summary>
  internal string DocumentId { get; init; } = string.Empty;

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

  /// <summary>
  /// Whether the room holds no block, title or icon, as createLivePage checks a new page's
  /// view. Read here, not through the bundle: the check must end before the presence
  /// throttle sends the announce, as Node's does.
  /// </summary>
  internal Task<bool> IsEmptyAsync()
  {
    return room.Loop.RunAsync(async () =>
    {
      await ThrowIfEndedAsync(CancellationToken.None);

      return YDocConverter.Export(room.Doc, Fields, null, out _).Count == 0 && YDocConverter.ExportPage(room.Doc).Count == 0;
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
    return room.Loop.RunAsync(() => ExecuteOnLoopAsync(batch, caller, approval, cancellationToken));
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

  private async Task<McpExecuteOutcome> ExecuteOnLoopAsync(JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    await ThrowIfEndedAsync(cancellationToken);
    var mark = room.Outbox.AppendedCount;
    var failuresBefore = room.AppendFailures;
    JsonObject result;
    bool writing;
    JsonObject? pageRun = null;

    // Single lane: the doc must stay as exported until the write is queued.
    room.HoldDocFrames();
    try
    {
      var input = await SessionInputAsync(cancellationToken);
      var replay = HistoryCommand(batch);
      // Undo and redo: the bundle checks the batch and asks what the step unlocks or shares, then the room replays it.
      var gate = replay is null ? null : steps.GateFor(replay == "history.undo");
      var comments = CommentsOnly(batch);

      input["history"] = gate?.History ?? new JsonObject();
      if (gate is not null)
      {
        input["document"] = gate.Document;
        // The bundle keeps carried marks only for the document they were made on.
        if (gate.History.ContainsKey("past") && !gate.History.ContainsKey("revision"))
        {
          gate.History["revision"] = await EmptyRevisionAsync(input, cancellationToken);
        }
      }
      input["batch"] = batch?.DeepClone();
      if (approval is not null)
      {
        input["approval"] = ApprovalInput(approval);
      }
      if (gate is null && await history.LoadAsync(batch, cancellationToken) is { } versions)
      {
        input["versionHistory"] = versions;
      }
      var envelope = batch is JsonObject { } source && source["commands"] is JsonArray commands && commands.All(command => command is JsonObject);
      JsonObject ran;

      if (gate is null && !readOnly && Pages is not null && envelope && PagePorts.HasPageAction(batch))
      {
        ran = await Pages.RunActionAsync(bundle, input, caller, pageId => Task.FromResult(pageId == DocumentId), cancellationToken);
        pageRun = ran;
      }
      else
      {
        if (gate is null && !readOnly && Pages?.Create is not null && envelope)
        {
          await Pages.AddCreatedPagesAsync(bundle, input, caller, cancellationToken);
        }
        ran = Uploads is null ? await bundle.CallAsync("agentExecute", input, cancellationToken) : await Uploads.ExecuteAsync(bundle, input, cancellationToken);
      }

      if (ran["ask"] is JsonObject ask)
      {
        return new McpExecuteOutcome(null, ask);
      }
      result = (JsonObject)ran["result"]!;
      writing = McpJson.Bool(ran["writes"]) == true;
      if (McpJson.Bool(result["ok"]) != true)
      {
        if (gate?.Refusal is { } refusal && McpJson.String(result["error"]?["code"]) == McpJson.String(refusal["when"]))
        {
          result["error"] = refusal["error"]!.DeepClone();
        }
        if (McpJson.String(result["error"]?["code"]) == "APPLY_FAILED")
        {
          readOnly = true;
        }

        return new McpExecuteOutcome(await AnswerAsync(new JsonObject { ["result"] = result.DeepClone() }, cancellationToken), null);
      }
      if (replay is not null)
      {
        var refused = steps.Replay(replay == "history.undo", new JsonObject { ["document"] = ran["document"]?.DeepClone(), ["history"] = ran["history"]?.DeepClone() });

        if (refused is not null)
        {
          // Nothing was written, so nothing is sent: no presence either.
          return new McpExecuteOutcome(await AnswerAsync(new JsonObject
          {
            ["result"] = new JsonObject { ["ok"] = false, ["revision"] = room.Revision, ["error"] = refused, ["warnings"] = result["warnings"]?.DeepClone() ?? new JsonArray() },
          }, cancellationToken), null);
        }
        result["revision"] = room.Revision;
      }
      else if (McpJson.String(ran["restore"]) is { } version)
      {
        // The bundle checked the restore; the room's history route runs it, and the result arrives as a peer update.
        var previous = McpJson.String(result["results"]?[0]?["previous"]);

        if (await history.RestoreAsync(version, previous, cancellationToken) is { } refused)
        {
          return new McpExecuteOutcome(await AnswerAsync(new JsonObject
          {
            ["result"] = new JsonObject { ["ok"] = false, ["revision"] = room.Revision, ["error"] = refused, ["warnings"] = result["warnings"]?.DeepClone() ?? new JsonArray() },
          }, cancellationToken), null);
        }
        steps.MarkRestored(previous);
        // Node applies the room's frames while it waits on the POST, so its revision counts the restored update when it came first.
        room.ReleaseDocFrames();
        room.HoldDocFrames();
        result["revision"] = room.Revision;
      }
      else if (ran["edits"] is JsonArray { Count: > 0 } edits && ran["document"] is JsonObject after)
      {
        var ops = RoomEditTranslator.Translate(edits, after, result);

        var html = ops.Count > 0 ? await Converter.ReadOpsHtmlAsync(room.Doc, ops, cancellationToken) : null;

        if (comments)
        {
          if (html is not null)
          {
            room.WriteLocal(CommentOrigin, _ => YDocConverter.ApplyOps(room.Doc, ops, html));
          }
          // A comment is no undo step, so the history stays as it was (Node's executor).
        }
        else
        {
          steps.Apply(edits, () =>
        {
          if (html is not null)
          {
            room.WriteLocal(AgentOrigin, _ => YDocConverter.ApplyOps(room.Doc, ops, html));
          }
        }, new JsonObject { ["document"] = after.DeepClone(), ["history"] = ran["history"]?.DeepClone() });
        }
      }
      else if (McpJson.Bool(result["ok"]) == true && ran["history"]?["past"] is JsonArray { Count: > 0 } marks && McpJson.String(marks[^1]) == "other")
      {
        steps.MarkOther();
      }
    }
    finally
    {
      room.ReleaseDocFrames();
    }
    presence.AfterBatch(result);
    Task<JsonObject> DeliveredAsync(JsonObject answerInput)
    {
      if (pageRun is not null)
      {
        PagePorts.MarkUnconfirmed(pageRun, answerInput);
      }

      return AnswerAsync(answerInput, cancellationToken);
    }
    if (!writing || room.Protocol == "v1")
    {
      return new McpExecuteOutcome(await DeliveredAsync(new JsonObject { ["result"] = result.DeepClone() }), null);
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

        return new McpExecuteOutcome(await DeliveredAsync(new JsonObject
        {
          ["result"] = result.DeepClone(),
          ["delivery"] = Delivery(true, false, acked.ServerSequence),
        }), null);
      case BatchDelivery.Timeout:
        return new McpExecuteOutcome(await DeliveredAsync(new JsonObject
        {
          ["result"] = result.DeepClone(),
          ["delivery"] = Delivery(false, true, null),
        }), null);
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
      ["document"] = await Converter.ExportAsync(room.Doc, cancellationToken),
      ["actor"] = actor.DeepClone(),
      ["revision"] = new JsonObject { ["now"] = room.Revision, ["afterWrite"] = $"l{room.UpdateCount + 1}" },
    };
  }

  /// <summary>The bundle's content revision of an empty document, read once from a batch that runs nothing.</summary>
  private async Task<string?> EmptyRevisionAsync(JsonObject input, CancellationToken cancellationToken)
  {
    if (emptyRevision is null)
    {
      var probe = (JsonObject)input.DeepClone();

      probe["document"] = new JsonObject { ["blocks"] = new JsonArray() };
      probe["history"] = new JsonObject();
      probe["batch"] = new JsonObject { ["commands"] = new JsonArray() };
      probe.Remove("approval");
      emptyRevision = McpJson.String((await bundle.CallAsync("agentExecute", probe, cancellationToken))["history"]?["revision"]);
    }

    return emptyRevision;
  }

  private static bool CommentsOnly(JsonNode? batch) =>
      batch is JsonObject { } source && source["commands"] is JsonArray commands
      && commands.Any(command => command is JsonObject entry && McpJson.String(entry["name"]) is { } name && CommentCommands.Contains(name));

  /// <summary>The batch's first command when it is history.undo or history.redo; the bundle refuses anything else with it.</summary>
  private static string? HistoryCommand(JsonNode? batch) =>
      batch is JsonObject { } source && source["commands"] is JsonArray { Count: > 0 } commands && commands[0] is JsonObject first
      && McpJson.String(first["name"]) is "history.undo" or "history.redo"
          ? McpJson.String(first["name"])
          : null;

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
