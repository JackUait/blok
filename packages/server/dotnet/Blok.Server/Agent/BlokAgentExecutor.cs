using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Runtime;

namespace Blok.Server.Agent;

internal sealed class BlokAgentExecutor(IBlokRuntime runtime) : IBlokAgentExecutor
{
  private readonly IBlokRuntime runtime = runtime
      ?? throw new ArgumentNullException(nameof(runtime));

  private readonly CollabRoomManager? rooms;
  private readonly ICollabDocConverter? converter;
  private readonly RoomAgentHistory roomHistory = new(TimeProvider.System);

  /// <summary>With rooms, <see cref="ExecuteInRoomAsync"/> edits live documents.</summary>
  internal BlokAgentExecutor(IBlokRuntime runtime, CollabRoomManager? rooms, ICollabDocConverter? converter)
      : this(runtime)
  {
    this.rooms = rooms;
    this.converter = converter;

    if (rooms is not null)
    {
      rooms.DocumentReplaced += roomHistory.Forget;
    }
  }

  public async ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default) =>
      (await RunAsync(documentJson, batchJson, actor, options, null, cancellationToken)).Execution;

  public BlokAgentSession OpenSession(BlokAgentActor actor, BlokAgentOptions? options = null)
  {
    ArgumentNullException.ThrowIfNull(actor);

    return new BlokAgentSession(this, actor, options);
  }

  /// <summary>
  /// A stored batch. With <paramref name="history"/>, Jint takes the session's steps and
  /// hands them back with the batch applied; C# only carries them between calls.
  /// </summary>
  internal async ValueTask<(BlokAgentExecution Execution, JsonObject? History)> RunAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options, JsonObject? history, CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(documentJson);
    ArgumentNullException.ThrowIfNull(batchJson);
    ArgumentNullException.ThrowIfNull(actor);

    var input = Common(options);
    input["document"] = JsonNode.Parse(documentJson);
    input["batch"] = JsonNode.Parse(batchJson);
    input["actor"] = ActorNode(actor);

    if (options is { PageTitles: true, PageTarget: { } pages } && HasPageAction(input["batch"]))
    {
      var done = await RunPageActionAsync(input, actor, pages, cancellationToken);

      return (done, history is null || JsonNode.Parse(done.ResultJson)?["ok"]?.GetValue<bool>() != true
          ? history
          : WroteAnotherDocument(history));
    }

    var (made, refusal) = await CreatePagesAsync(input, options, actor, cancellationToken);

    if (refusal is not null)
    {
      return (refusal, history);
    }

    if (history is not null)
    {
      input["history"] = history.DeepClone();
    }

    JsonNode output;

    try
    {
      output = JsonNode.Parse(await runtime.InvokeAsync(
          "agentExecute", input.ToJsonString(), cancellationToken: cancellationToken))
          ?? throw new InvalidOperationException("The Blok runtime returned no agent execution.");
    }
    catch (Exception error) when (made is { Count: > 0 })
    {
      return (StoppedAfterCreating(error, made), history);
    }
    var result = output["result"]
        ?? throw new InvalidOperationException("The Blok runtime returned no agent result.");
    var ok = result["ok"]?.GetValue<bool>() == true;
    var document = ok
        ? output["document"]?.ToJsonString()
            ?? throw new InvalidOperationException("The Blok runtime returned no document.")
        : null;
    var next = history is null
        ? null
        : output["history"]?.DeepClone() as JsonObject
            ?? throw new InvalidOperationException("The Blok runtime returned no session history.");

    return (new BlokAgentExecution(
        result.ToJsonString(), document, result["revision"]?.GetValue<string>() ?? string.Empty), next);
  }

  /// <summary>
  /// A page action writes the target, not this document, so its step holds no snapshot.
  /// "other" makes history.undo answer UNDO_OTHER_DOCUMENT, as the shared executor marks it.
  /// </summary>
  private static JsonObject WroteAnotherDocument(JsonObject history)
  {
    var next = (JsonObject)history.DeepClone();

    if (next["past"] is not JsonArray past)
    {
      past = [];
      next["past"] = past;
    }
    past.Add("other");

    return next;
  }

  /// <summary>
  /// Jint cannot wait on the host, so the pages a batch inserts are made first: Jint counts them on a
  /// copy (a refused batch makes none), the host creates each one for the actor, and the ids go in as
  /// <c>createdPages</c>, which Jint hands out in batch order.
  /// </summary>
  private async ValueTask<(JsonArray? Created, BlokAgentExecution? Refusal)> CreatePagesAsync(
      JsonObject input, BlokAgentOptions? options, BlokAgentActor actor, CancellationToken cancellationToken)
  {
    if (options is not { PageTitles: true, PageTarget: IBlokPageCreator creator } || !HasInsert(input["batch"]))
    {
      return (null, null);
    }

    var needed = JsonNode.Parse(await runtime.InvokeAsync("agentPagesNeeded", input.ToJsonString(), cancellationToken: cancellationToken)) as JsonObject
        ?? throw new InvalidOperationException("The Blok runtime returned no page count.");

    if (needed["result"] is JsonObject refused)
    {
      return (null, new BlokAgentExecution(refused.ToJsonString(), null, refused["revision"]?.GetValue<string>() ?? string.Empty));
    }

    var created = new JsonArray();
    var count = needed["count"]?.GetValue<int>() ?? 0;

    for (var index = 0; index < count; index++)
    {
      string? pageId;

      try
      {
        cancellationToken.ThrowIfCancellationRequested();
        pageId = await creator.CreateAsync(actor, cancellationToken);
      }
      catch (Exception error) when (created.Count > 0)
      {
        return (null, StoppedAfterCreating(error, created));
      }

      if (string.IsNullOrEmpty(pageId))
      {
        var forbidden = Failure("FORBIDDEN", "The host does not let this agent create a page here. Nothing was written.", false, null);

        return (null, created.Count == 0 ? forbidden : Stranded(forbidden, created));
      }
      created.Add(pageId);
    }

    input["createdPages"] = created;

    return (created, null);
  }

  /// <summary>
  /// The host made pages, then the batch stopped on a cancel or an error, so nothing was written.
  /// The host is told which pages to clean up; the error itself is not passed on.
  /// </summary>
  private static BlokAgentExecution StoppedAfterCreating(Exception error, JsonArray created) => Stranded(error is OperationCanceledException
      ? Failure("CANCELLED", "The batch was cancelled. Nothing was written.", false, null)
      : Failure("APPLY_FAILED", "The batch stopped on a server error. Nothing was written.", true, null), created);

  private static JsonArray Orphaned(JsonArray created) =>
      [.. created.Select(pageId => (JsonNode)new JsonObject
      {
        ["command"] = "block.insert", ["type"] = "page", ["prepared"] = new JsonObject { ["pageId"] = pageId?.DeepClone() },
      })];

  /// <summary>A failure after the host created pages: the batch wrote nothing, and the host is told which pages to clean up.</summary>
  private static BlokAgentExecution Stranded(BlokAgentExecution failed, JsonArray created)
  {
    var result = JsonNode.Parse(failed.ResultJson) as JsonObject
        ?? throw new InvalidOperationException("The agent result is not an object.");

    if (result["error"] is not JsonObject cause || cause["code"]?.GetValue<string>() == "ORPHANED_SIDE_EFFECT")
    {
      return failed;
    }

    var details = new JsonObject { ["orphaned"] = Orphaned(created), ["cause"] = cause.DeepClone() };

    return Failure("ORPHANED_SIDE_EFFECT", $"The batch failed after the host did work for it ({cause["message"]?.GetValue<string>()}). Clean up the listed items.",
        false, details, failed.Revision);
  }

  private static bool HasInsert(JsonNode? batch) =>
      batch is JsonObject source && source["commands"] is JsonArray commands
      && commands.Any(command => command is JsonObject entry
          && entry["name"] is JsonValue name && name.TryGetValue<string>(out var value) && value == "block.insert");

  private static bool HasPageAction(JsonNode? batch) =>
      batch is JsonObject source && source["commands"] is JsonArray commands
      && commands.Any(command => command is JsonObject entry
          && entry["name"] is JsonValue name && name.TryGetValue<string>(out var value)
          && value is "page.rename" or "page.setIcon");

  private async ValueTask<BlokAgentExecution> RunPageActionAsync(
      JsonObject input, BlokAgentActor actor, IBlokPageTarget pages, CancellationToken cancellationToken)
  {
    var output = JsonNode.Parse(await runtime.InvokeAsync(
        "agentPlanHost", input.ToJsonString(), cancellationToken: cancellationToken))
        ?? throw new InvalidOperationException("The Blok runtime returned no host plan.");
    var sourceResult = output["result"] as JsonObject
        ?? throw new InvalidOperationException("The Blok runtime returned no source result.");

    if (sourceResult["ok"]?.GetValue<bool>() != true)
    {
      return SourceExecution(sourceResult);
    }
    var command = output["batch"]?["commands"]?[0] as JsonObject
        ?? throw new InvalidOperationException("The Blok runtime returned no checked host command.");
    var args = command["args"] as JsonObject
        ?? throw new InvalidOperationException("The Blok runtime returned no checked host args.");
    var value = output["view"]?["blocks"]?[0]?["data"]?["pageId"];
    var pageId = value is JsonValue page && page.TryGetValue<string>(out var id) ? id : null;

    cancellationToken.ThrowIfCancellationRequested();
    var location = pageId is null ? null : await pages.ResolveAsync(pageId, actor, cancellationToken);

    if (pageId is null || location is null)
    {
      return PageFailure(sourceResult, pageId);
    }

    var rename = command["name"]?.GetValue<string>() == "page.rename";
    var field = rename ? "title" : "icon";
    var inner = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject
      {
        ["name"] = rename ? "doc.setTitle" : "doc.setIcon",
        ["args"] = new JsonObject { [field] = args[field]?.DeepClone() },
      }),
    }.ToJsonString();
    BlokAgentExecution done;

    switch (location)
    {
      case BlokPageLocation.Stored stored:
        done = await ExecuteAsync(await stored.LoadAsync(cancellationToken), inner, actor, null, cancellationToken);
        if (done.DocumentJson is { } saved)
        {
          cancellationToken.ThrowIfCancellationRequested();
          await stored.SaveAsync(saved, cancellationToken);
        }
        break;
      case BlokPageLocation.Room room:
        done = await ExecuteInRoomAsync(room.DocId, inner, actor, null, cancellationToken);
        break;
      default:
        throw new InvalidOperationException("Unknown page location.");
    }

    var targetResult = JsonNode.Parse(done.ResultJson) as JsonObject
        ?? throw new InvalidOperationException("The target returned no agent result.");
    var warnings = sourceResult["warnings"] as JsonArray
        ?? throw new InvalidOperationException("The source result returned no warnings.");

    if (targetResult["warnings"] is JsonArray targetWarnings)
    {
      foreach (var warning in targetWarnings)
      {
        warnings.Add(warning?.DeepClone());
      }
    }

    if (targetResult["ok"]?.GetValue<bool>() != true)
    {
      var error = targetResult["error"] as JsonObject
          ?? throw new InvalidOperationException("The target failure returned no error.");
      if (error["details"] is not JsonObject details)
      {
        details = new JsonObject();
        error["details"] = details;
      }
      details["pageId"] = pageId;
      targetResult["revision"] = sourceResult["revision"]?.DeepClone();
      targetResult["warnings"] = warnings.DeepClone();

      return SourceExecution(targetResult);
    }

    sourceResult["results"] = new JsonArray(new JsonObject { ["pageId"] = pageId, ["applied"] = true });

    return SourceExecution(sourceResult);
  }

  private static BlokAgentExecution PageFailure(JsonObject sourceResult, string? pageId)
  {
    var details = new JsonObject();

    if (pageId is not null)
    {
      details["pageId"] = pageId;
    }
    var result = new JsonObject
    {
      ["ok"] = false,
      ["revision"] = sourceResult["revision"]?.DeepClone(),
      ["error"] = new JsonObject
      {
        ["code"] = "PRECONDITION_FAILED",
        ["message"] = "The page block points at no page this server can open.",
        ["retryable"] = false,
        ["details"] = details,
      },
      ["warnings"] = sourceResult["warnings"]?.DeepClone(),
    };

    return SourceExecution(result);
  }

  private static BlokAgentExecution SourceExecution(JsonObject result) =>
      new(result.ToJsonString(), null, result["revision"]?.GetValue<string>() ?? string.Empty);

  public async ValueTask<string> GetContractAsync(
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    var output = JsonNode.Parse(await runtime.InvokeAsync(
        "manifest", Common(options).ToJsonString(), cancellationToken: cancellationToken))
        ?? throw new InvalidOperationException("The Blok runtime returned no agent contract.");

    return output["contract"]?.ToJsonString()
        ?? throw new InvalidOperationException("The Blok runtime returned no agent contract.");
  }

  /// <summary>The contract of a <see cref="BlokAgentSession"/>: a call that carries its steps offers history.*.</summary>
  internal async ValueTask<string> GetSessionContractAsync(BlokAgentOptions? options, CancellationToken cancellationToken)
  {
    var input = Common(options);

    input["history"] = new JsonObject();

    var output = JsonNode.Parse(await runtime.InvokeAsync(
        "manifest", input.ToJsonString(), cancellationToken: cancellationToken))
        ?? throw new InvalidOperationException("The Blok runtime returned no agent contract.");

    return output["contract"]?.ToJsonString()
        ?? throw new InvalidOperationException("The Blok runtime returned no agent contract.");
  }

  public async ValueTask<string> GetRoomContractAsync(
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    var output = JsonNode.Parse(await runtime.InvokeAsync(
        "manifest", RoomCommon(options).ToJsonString(), cancellationToken: cancellationToken))
        ?? throw new InvalidOperationException("The Blok runtime returned no agent contract.");

    return output["contract"]?.ToJsonString()
        ?? throw new InvalidOperationException("The Blok runtime returned no agent contract.");
  }

  /// <summary>
  /// Plans the batch inside the room lane: export the live doc, run Jint
  /// <c>agentExecute</c>, translate its edits into room ops (01 §3.14). The
  /// revision is the journal head <c>lineage:sequence</c>, never Jint's hash.
  /// </summary>
  public async ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(batchJson);
    ArgumentNullException.ThrowIfNull(actor);

    if (rooms is null || converter is null)
    {
      return Unavailable("Live rooms need collaboration on this server.");
    }

    var batch = JsonNode.Parse(batchJson) as JsonObject;
    CollabEditPrecondition? expect = null;

    // Removed before Jint, which would compare a journal head with its content hash.
    if (batch is not null && batch.Remove("expectRevision", out var expected))
    {
      expect = ParseHead(expected);

      if (expect is null)
      {
        return Failure("INVALID_ARGS", "In a room, expectRevision is the journal head \"lineage:sequence\" a result returned. Read the room again and pass its revision.", false, null);
      }
    }

    var input = RoomCommon(options);
    input["batch"] = batch is null ? JsonNode.Parse(batchJson) : batch.DeepClone();
    input["actor"] = ActorNode(actor);

    if (VersionCommand(input["batch"]) is { } read)
    {
      return await RunVersionReadAsync(docId, input, read.Name, read.Args, expect, cancellationToken);
    }

    // The source room is only read; the host action writes the target.
    if (options is { PageTitles: true, PageTarget: { } pages } && HasPageAction(input["batch"]))
    {
      var (document, current) = await RoomStateAsync(docId, cancellationToken);

      if (document is null)
      {
        return Failure("APPLY_FAILED", "The room could not be read. Nothing was written.", true, null);
      }

      if (expect is not null && $"{expect.Lineage}:{expect.Sequence}" != current)
      {
        return Failure("STALE", "The room changed since you read it. Read it again, then retry.", true,
            new JsonObject { ["revision"] = current }, current);
      }

      input["document"] = document;

      var acted = await RunPageActionAsync(input, actor, pages, cancellationToken);

      if (JsonNode.Parse(acted.ResultJson)?["ok"]?.GetValue<bool>() == true)
      {
        roomHistory.Add(docId, actor, new RoomAgentHistory.Step { Other = true });
      }

      return WithHead(acted, current);
    }

    if (HistoryCommand(input["batch"]) is { } historyName)
    {
      // Jint checks the batch against the contract the host's options build; only its
      // "nothing to replay" answer, from a session that holds no steps, lets the room replay.
      input["document"] = new JsonObject { ["blocks"] = new JsonArray() };
      var gate = JsonNode.Parse(await runtime.InvokeAsync("agentExecute", input.ToJsonString(), cancellationToken: cancellationToken))?["result"] as JsonObject
          ?? throw new InvalidOperationException("The Blok runtime returned no agent result.");

      if (gate["error"]?["code"]?.GetValue<string>() is not ("NOTHING_TO_UNDO" or "NOTHING_TO_REDO"))
      {
        gate.Remove("revision");

        return new BlokAgentExecution(gate.ToJsonString(), null, string.Empty);
      }

      return await RunRoomHistoryAsync(docId, historyName == "history.undo", actor, expect, cancellationToken);
    }

    JsonArray? created = null;

    if (options is { PageTitles: true, PageTarget: IBlokPageCreator } && HasInsert(input["batch"]))
    {
      var (state, current) = await RoomStateAsync(docId, cancellationToken);

      if (state is null)
      {
        return Failure("APPLY_FAILED", "The room could not be read. Nothing was written.", true, null);
      }

      // Jint never sees expectRevision here, so a stale batch must stop before the host creates pages.
      if (expect is not null && $"{expect.Lineage}:{expect.Sequence}" != current)
      {
        return await StaleAsync(docId, input, current, cancellationToken);
      }

      // Made outside the room lane, so a slow host never holds the room. The lane run checks the count again.
      input["document"] = state;
      var made = await CreatePagesAsync(input, options, actor, cancellationToken);

      input.Remove("document");
      if (made.Refusal is { } refusal)
      {
        return WithHead(refusal, string.Empty);
      }
      created = made.Created;
    }

    JsonObject? planned = null;
    JsonObject? before = null;
    CollabPageMaps? beforeMaps = null;
    var wrote = false;
    RoomAgentHistory.Step? recorded = null;
    var operationId = Guid.NewGuid().ToString("N");
    var digest = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes($"agent\n{actor.Id}\n{batchJson}"));
    CollabEditResult edit;

    try
    {
      edit = await rooms.AgentEditAsync(docId, async (doc, token) =>
      {
        before = await converter.ExportAsync(doc, token) as JsonObject;
        beforeMaps = YDocConverter.ReadPageMaps(doc);
        input["document"] = before?.DeepClone();

        var output = JsonNode.Parse(await runtime.InvokeAsync("agentExecute", input.ToJsonString(), cancellationToken: token)) as JsonObject
            ?? throw new InvalidOperationException("The Blok runtime returned no agent execution.");
        var result = output["result"] as JsonObject
            ?? throw new InvalidOperationException("The Blok runtime returned no agent result.");

        planned = result;

        // A failed batch must not reach the room.
        if (result["ok"]?.GetValue<bool>() != true)
        {
          throw new NoRoomWriteException();
        }

        var ops = RoomEditTranslator.Translate(
            output["edits"] as JsonArray ?? throw new InvalidOperationException("The Blok runtime returned no edits."),
            output["document"] as JsonObject ?? throw new InvalidOperationException("The Blok runtime returned no document."),
            result);

        // A journal room answers zero ops with its head and writes nothing; a plain room would persist.
        if (ops.Count == 0 && !rooms.HasJournal)
        {
          throw new NoRoomWriteException();
        }

        // A read is no step, as the shared executor marks only batches with edits.
        wrote = output["edits"] is JsonArray { Count: > 0 };

        return ops;
      }, operationId, digest, actor.Id, expect, async (doc, token) =>
      {
        if (wrote && before is not null && beforeMaps is not null
            && await converter.ExportAsync(doc, token) is JsonObject after)
        {
          recorded = RoomAgentHistory.Between(before, beforeMaps, after, YDocConverter.ReadPageMaps(doc));
          roomHistory.Add(docId, actor, recorded);
        }
      }, cancellationToken);
    }
    catch (NoRoomWriteException) when (planned is not null)
    {
      // A refusal, or a read with no journal head. Jint's content hash means nothing in a room.
      return WithHead(new BlokAgentExecution(planned.ToJsonString(), null, string.Empty), string.Empty);
    }
    catch (Exception error) when (created is { Count: > 0 } && error is not NoRoomWriteException)
    {
      // The room may have written before the throw, and a page it links is in use.
      if (!await RoomLinksNoneAsync(docId, created))
      {
        throw;
      }

      return StoppedAfterCreating(error, created);
    }

    var head = edit.Receipt is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : string.Empty;

    if (created is { Count: > 0 } && edit.Status != CollabEditStatus.Applied)
    {
      var refused = await RoomRefusalAsync(edit, docId, input, head, cancellationToken);

      return await RoomLinksNoneAsync(docId, created) ? Stranded(refused, created) : refused;
    }

    switch (edit.Status)
    {
      case CollabEditStatus.Applied when planned is not null:
        if (recorded is not null)
        {
          recorded.Lineage = edit.Receipt?.Tag.Lineage;
        }

        return WithHead(new BlokAgentExecution(planned.ToJsonString(), null, head), head);
      default:
        return await RoomRefusalAsync(edit, docId, input, head, cancellationToken);
    }
  }

  /// <summary>The answer for a batch edit the room did not apply.</summary>
  private async ValueTask<BlokAgentExecution> RoomRefusalAsync(
      CollabEditResult edit, string docId, JsonObject input, string head, CancellationToken cancellationToken)
  {
    switch (edit.Status)
    {
      case CollabEditStatus.PreconditionFailed:
        return await StaleAsync(docId, input, head, cancellationToken);
      case CollabEditStatus.PreconditionRequired:
        return Failure("INVALID_ARGS", "This room keeps no journal, so expectRevision cannot be checked. Send the batch without it.", false, null);
      default:
        var retryable = edit.Status is CollabEditStatus.Overloaded or CollabEditStatus.Unavailable
            or CollabEditStatus.Draining or CollabEditStatus.SeedFailed;

        return Failure("APPLY_FAILED", $"The room refused the edit ({edit.Status}). Nothing was written.", retryable,
            new JsonObject { ["status"] = edit.Status.ToString() }, head);
    }
  }

  /// <summary>
  /// True only when a fresh read of the room shows none of these pages linked. A room that
  /// cannot be read counts as linking them, so a host never deletes a page that may be in use.
  /// </summary>
  private async ValueTask<bool> RoomLinksNoneAsync(string docId, JsonArray created)
  {
    JsonObject? document;

    try
    {
      (document, _) = await RoomStateAsync(docId, CancellationToken.None);
    }
    catch (Exception error) when (error is not OutOfMemoryException)
    {
      return false;
    }

    if (document?["blocks"] is not JsonArray blocks)
    {
      return false;
    }
    var ids = created.Select(id => id?.GetValue<string>()).ToHashSet();

    return !blocks.OfType<JsonObject>().Any(block => block["type"]?.GetValue<string>() == "page"
        && block["data"]?["pageId"] is JsonValue value && value.TryGetValue<string>(out var pageId) && ids.Contains(pageId));
  }

  /// <summary>A batch that is only history.undo or history.redo with no args; anything else goes to Jint, which checks it.</summary>
  private static string? HistoryCommand(JsonNode? batch) =>
      batch is JsonObject source && source["commands"] is JsonArray { Count: 1 } commands
      && commands[0] is JsonObject first && first.Count <= 2
      && first["name"] is JsonValue name && name.TryGetValue<string>(out var value)
      && value is "history.undo" or "history.redo"
      && first["args"] is JsonObject { Count: 0 }
          ? value
          : null;

  /// <summary>
  /// Undo or redo of this actor's last room step (<see cref="RoomAgentHistory"/>), planned in
  /// the room lane like a version restore, so a peer write cannot land between check and apply.
  /// </summary>
  private async ValueTask<BlokAgentExecution> RunRoomHistoryAsync(
      string docId, bool undo, BlokAgentActor actor, CollabEditPrecondition? expect, CancellationToken cancellationToken)
  {
    // The head this call pins itself can go stale under a peer's write; the agent's own expectRevision cannot be retried.
    for (var attempt = 0; ; attempt++)
    {
      var execution = await RunRoomHistoryOnceAsync(docId, undo, actor, expect, cancellationToken);

      if (expect is not null || attempt == 2
          || JsonNode.Parse(execution.ResultJson)?["error"]?["code"]?.GetValue<string>() != "STALE")
      {
        return execution;
      }
    }
  }

  private async ValueTask<BlokAgentExecution> RunRoomHistoryOnceAsync(
      string docId, bool undo, BlokAgentActor actor, CollabEditPrecondition? expect, CancellationToken cancellationToken)
  {
    var verb = undo ? "undone" : "redone";
    RoomAgentHistory.Step? step = null;
    CollabEditResult edit;
    var top = roomHistory.Top(docId, actor, undo);

    // Checked before the room: a purged document refuses every edit, and this answer is the true one.
    if (top is null)
    {
      return undo
          ? Failure("NOTHING_TO_UNDO", "This session has no step to undo.", false, null)
          : Failure("NOTHING_TO_REDO", "This session has no undone step to redo.", false, null);
    }

    var lineageChanged = Failure("CONFLICT", $"The room was reset or reloaded since this step, so it can no longer be {verb}. Re-read the document.", true, null);
    var lineage = top.Lineage;

    if (lineage is not null && expect is null)
    {
      var (_, current, _) = await RoomStatusAsync(docId, cancellationToken);
      var colon = current.LastIndexOf(':');

      if (colon <= 0 || current[..colon] != lineage)
      {
        return lineageChanged;
      }

      // Pins the lineage in the lane; a peer write since this read only asks for another try.
      expect = ParseHead(current);
    }

    if (lineage is not null && expect is not null && expect.Lineage != lineage)
    {
      return lineageChanged;
    }

    try
    {
      edit = await rooms!.AgentEditAsync(docId, async (doc, token) =>
      {
        step = roomHistory.Top(docId, actor, undo);

        if (step is not null && step.Lineage is not null && step.Lineage != expect?.Lineage)
        {
          throw new HistoryRefusal("CONFLICT", $"The room was reset or reloaded since this step, so it can no longer be {verb}. Re-read the document.", retryable: true);
        }

        if (step is null)
        {
          throw undo
              ? new HistoryRefusal("NOTHING_TO_UNDO", "This session has no step to undo.")
              : new HistoryRefusal("NOTHING_TO_REDO", "This session has no undone step to redo.");
        }

        if (step.Other)
        {
          throw new HistoryRefusal("UNDO_OTHER_DOCUMENT", "The last batch wrote another document (a sub-page title or icon). history.undo cannot undo it. To revert it, run that command again with the old value.");
        }

        var export = await converter!.ExportAsync(doc, token) as JsonObject ?? [];
        var maps = YDocConverter.ReadPageMaps(doc);

        var projected = RoomAgentHistory.Project(export, maps, step.Ids, step.PageKeys);

        if (!RoomAgentHistory.Same(projected, undo ? step.After : step.Before))
        {
          throw new HistoryRefusal("CONFLICT", $"Someone else changed what this step wrote, so it can no longer be {verb}. Re-read the document before retrying.", retryable: true);
        }

        // Undoing a lock or redoing an unlock unlocks; the server has no person to approve it.
        if (RoomAgentHistory.Unlocks(projected, undo ? step.Before : step.After) is { } unlocked)
        {
          throw new HistoryRefusal("APPROVAL_REQUIRED",
              $"This {(undo ? "undo" : "redo")} would unlock database \"{unlocked}\". Unlocking needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to unlock it themselves.",
              details: new JsonObject { ["reason"] = "no-channel", ["approval"] = new JsonObject { ["kind"] = "database.unlock", ["blockId"] = unlocked } });
        }

        // Who can see or fill out a view is the person's too, and the server cannot ask one.
        if (RoomAgentHistory.Shares(projected, undo ? step.Before : step.After) is { } shared)
        {
          throw new HistoryRefusal("APPROVAL_REQUIRED",
              $"This {(undo ? "undo" : "redo")} would change who can see or fill out view \"{shared.ViewId}\" of database \"{shared.BlockId}\". That needs a person's explicit approval, and nothing here can ask one. Nothing was written. Ask the person to do it themselves.",
              details: new JsonObject { ["reason"] = "no-channel", ["approval"] = new JsonObject { ["kind"] = "database.share", ["blockId"] = shared.BlockId, ["viewId"] = shared.ViewId } });
        }

        var (blocks, target) = RoomAgentHistory.Restore(
            export, maps, step, undo ? step.Before : step.After, undo ? step.PageBefore : step.PageAfter);

        var wanted = undo ? step.Before : step.After;

        return [
          .. CollabRestorePlanner.Plan(export["blocks"] as JsonArray ?? [], YDocConverter.DescribeStructure(doc), blocks, maps, target),
          .. RoomAgentHistory.Stamps(wanted),
        ];
      }, Guid.NewGuid().ToString("N"), System.Security.Cryptography.SHA256.HashData(
          System.Text.Encoding.UTF8.GetBytes($"agent-{verb}\n{actor.Id}\n{Guid.NewGuid():N}")), actor.Id, expect,
      async (doc, token) =>
      {
        if (step is null || await converter!.ExportAsync(doc, token) is not JsonObject now)
        {
          return;
        }

        // What the room holds now is what the opposite replay checks against.
        roomHistory.Replayed(docId, actor, step, undo,
            RoomAgentHistory.Project(now, YDocConverter.ReadPageMaps(doc), step.Ids, step.PageKeys));
      }, cancellationToken);
    }
    catch (HistoryRefusal refusal)
    {
      return Failure(refusal.Code, refusal.Message, refusal.Retryable, refusal.Details);
    }

    var head = edit.Receipt is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : string.Empty;

    if (edit.Status == CollabEditStatus.Applied)
    {
      var result = new JsonObject
      {
        ["ok"] = true,
        ["revision"] = head,
        ["results"] = new JsonArray(new JsonObject()),
        ["refs"] = new JsonObject(),
        ["changed"] = new JsonObject { ["created"] = new JsonArray(), ["updated"] = new JsonArray(), ["moved"] = new JsonArray(), ["removed"] = new JsonArray() },
        ["warnings"] = new JsonArray(),
      };

      return WithHead(new BlokAgentExecution(result.ToJsonString(), null, head), head);
    }

    return edit.Status == CollabEditStatus.PreconditionFailed
        ? Failure("STALE", "The room changed since you read it. Read it again, then retry.", true, new JsonObject { ["revision"] = head }, head)
        : Failure("APPLY_FAILED", $"The room refused the {(undo ? "undo" : "redo")} ({edit.Status}). Nothing was written.",
            edit.Status is CollabEditStatus.Overloaded or CollabEditStatus.Unavailable or CollabEditStatus.Draining or CollabEditStatus.SeedFailed,
            new JsonObject { ["status"] = edit.Status.ToString() }, head);
  }

  /// <summary>Thrown in the room lane when a replay must not write; the room writes nothing.</summary>
  private sealed class HistoryRefusal(string code, string message, bool retryable = false, JsonObject? details = null) : Exception(message)
  {
    internal string Code { get; } = code;
    internal JsonObject? Details { get; } = details;
    internal bool Retryable { get; } = retryable;
  }

  private static (string Name, JsonObject Args)? VersionCommand(JsonNode? batch) =>
      batch is JsonObject source && source["commands"] is JsonArray { Count: > 0 } commands
      && commands[0] is JsonObject first
      && first["name"] is JsonValue name && name.TryGetValue<string>(out var value)
      && value is "history.versions" or "history.read" or "history.changes" or "history.restore"
          ? (value, first["args"] as JsonObject ?? [])
          : null;

  /// <summary>
  /// A version history call: the journal's answer is loaded into the Jint
  /// input, which shapes it as every runtime does. A read runs outside the edit
  /// lane and writes nothing. A restore Jint accepted then goes to the room as
  /// the history route's restore does.
  /// </summary>
  private async ValueTask<BlokAgentExecution> RunVersionReadAsync(
      string docId, JsonObject input, string name, JsonObject args, CollabEditPrecondition? expect,
      CancellationToken cancellationToken)
  {
    var (document, current, status) = await RoomStatusAsync(docId, cancellationToken);

    if (status == CollabStateStatus.Purged)
    {
      return Failure("TOOL_ACTION_FAILED", "The version history failed: this document was deleted.", false, null);
    }

    if (document is null)
    {
      return Failure("APPLY_FAILED", "The room could not be read. Nothing was written.", true, null);
    }

    if (expect is not null && $"{expect.Lineage}:{expect.Sequence}" != current)
    {
      return Failure("STALE", "The room changed since you read it. Read it again, then retry.", true,
          new JsonObject { ["revision"] = current }, current);
    }

    // No history journal: the contract says unavailable and Jint refuses it.
    if (rooms!.HasHistory)
    {
      input["versionHistory"] = await LoadVersionsAsync(docId, name, args, cancellationToken);
    }

    input["document"] = document;
    var output = JsonNode.Parse(await runtime.InvokeAsync("agentExecute", input.ToJsonString(), cancellationToken: cancellationToken))
        ?? throw new InvalidOperationException("The Blok runtime returned no agent execution.");
    var result = output["result"] as JsonObject
        ?? throw new InvalidOperationException("The Blok runtime returned no agent result.");

    if (output["restore"] is JsonValue restore && restore.TryGetValue<string>(out var version))
    {
      // Jint checked the room at `current`; the restore must land on that head or not at all.
      return await RestoreAsync(docId, version, result, input, expect ?? ParseHead(current), cancellationToken);
    }

    return WithHead(new BlokAgentExecution(result.ToJsonString(), null, current), current);
  }

  /// <summary>
  /// The restore Jint checked, as one journalled edit by the agent: the same
  /// RestoreAsync the history route calls, so it stamps the blocks as a
  /// person's restore does, with the version's own stamps.
  /// </summary>
  private async ValueTask<BlokAgentExecution> RestoreAsync(
      string docId, string version, JsonObject result, JsonObject input, CollabEditPrecondition? expect,
      CancellationToken cancellationToken)
  {
    var colon = version.LastIndexOf(':');
    var actor = input["actor"]!["id"]!.GetValue<string>();
    var restored = await rooms!.RestoreAsync(
        docId,
        version[..colon],
        ulong.Parse(version.AsSpan(colon + 1), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture),
        Guid.NewGuid().ToString("N"),
        actor,
        expect,
        cancellationToken);

    switch (restored.History)
    {
      case CollabHistoryStatus.Ready:
        break;
      case CollabHistoryStatus.NotFound:
        return Failure("VERSION_NOT_FOUND", $"There is no version \"{version}\". history.versions lists them.", false, null);
      default:
        return Failure("TOOL_ACTION_FAILED", $"The version history failed: the restore could not run ({restored.History}).",
            RestoreRetryable(restored.History), null);
    }

    var edit = restored.Edit ?? throw new InvalidOperationException("A ready restore carries its edit.");
    var head = edit.Receipt is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : string.Empty;

    switch (edit.Status)
    {
      case CollabEditStatus.Applied:
        return WithHead(new BlokAgentExecution(result.ToJsonString(), null, head), head);
      case CollabEditStatus.PreconditionFailed:
        return Failure("STALE", "The room changed since you read it. Read it again, then retry.", true,
            new JsonObject { ["revision"] = head }, head);
      default:
        var retryable = edit.Status is CollabEditStatus.Overloaded or CollabEditStatus.Unavailable
            or CollabEditStatus.Draining or CollabEditStatus.SeedFailed;

        return Failure("APPLY_FAILED", $"The room refused the restore ({edit.Status}). Nothing was written.", retryable,
            new JsonObject { ["status"] = edit.Status.ToString() }, head);
    }
  }

  /// <summary>What one read needs: the version list, or the documents it names (null when there is no such version).</summary>
  private async ValueTask<JsonObject> LoadVersionsAsync(
      string docId, string name, JsonObject args, CancellationToken cancellationToken)
  {
    // A restore names the version that was current before, so it needs the list too.
    if (name == "history.restore")
    {
      var listed = await LoadVersionsAsync(docId, "history.versions", [], cancellationToken);

      if (listed.ContainsKey("failed"))
      {
        return listed;
      }

      var named = await LoadVersionsAsync(docId, "history.read", args, cancellationToken);

      named["versions"] = listed["versions"]!.DeepClone();

      return named;
    }

    if (name == "history.versions")
    {
      var minutes = args["group"] is JsonValue group && group.TryGetValue<int>(out var value) && value is 1 or 15 or 60
          ? TimeSpan.FromMinutes(value)
          : (TimeSpan?)null;
      var list = await rooms!.HistoryAsync(docId, minutes, cancellationToken);

      if (list.Status != CollabHistoryStatus.Ready)
      {
        return new JsonObject { ["failed"] = $"The version history could not be read ({list.Status}).", ["status"] = HttpStatus(list.Status) };
      }

      var current = list.Lineages.Where(lineage => lineage.Current).Select(lineage => lineage.Lineage).ToHashSet(StringComparer.Ordinal);

      return new JsonObject
      {
        ["versions"] = new JsonArray([.. list.Versions.Select(version =>
        {
          var entry = new JsonObject
          {
            ["version"] = $"{version.Lineage}:{version.Sequence}",
            ["savedAt"] = version.SavedAt?.ToUnixTimeMilliseconds(),
            ["startedAt"] = version.StartedAt?.ToUnixTimeMilliseconds(),
            ["actors"] = new JsonArray([.. version.Actors.Select(actor => (JsonNode)actor)]),
          };

          if (!current.Contains(version.Lineage))
          {
            entry["beforeReset"] = true;
          }

          return (JsonNode)entry;
        })]),
      };
    }

    var names = (name == "history.read" ? new[] { args["version"] } : new[] { args["from"], args["to"] })
        .OfType<JsonValue>()
        .Select(node => node.TryGetValue<string>(out var text) ? text : null)
        .OfType<string>()
        .Distinct(StringComparer.Ordinal);
    var documents = new JsonObject();

    foreach (var version in names)
    {
      var colon = version.LastIndexOf(':');

      if (colon <= 0 || !ulong.TryParse(version.AsSpan(colon + 1), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var sequence))
      {
        documents[version] = null;
        continue;
      }

      var read = await rooms!.ReadVersionAsync(docId, version[..colon], sequence, cancellationToken);

      switch (read.Status)
      {
        case CollabHistoryStatus.Ready:
          documents[version] = JsonNode.Parse(read.Json);
          break;
        case CollabHistoryStatus.NotFound:
          documents[version] = null;
          break;
        default:
          return new JsonObject { ["failed"] = $"Version \"{version}\" could not be read ({read.Status}).", ["status"] = HttpStatus(read.Status) };
      }
    }

    return new JsonObject { ["documents"] = documents };
  }

  /// <summary>
  /// STALE with <c>details.current</c>: Jint re-checks the batch against the
  /// room as it is now, with the head as its expected revision. A head never
  /// equals Jint's content hash, so Jint builds the stale context itself.
  /// </summary>
  private async ValueTask<BlokAgentExecution> StaleAsync(
      string docId, JsonObject input, string head, CancellationToken cancellationToken)
  {
    var plain = Failure("STALE", "The room changed since you read it. Read it again, then retry.", true,
        new JsonObject { ["revision"] = head }, head);
    var (document, current) = await RoomStateAsync(docId, cancellationToken);

    if (document is null || input["batch"] is not JsonObject batch)
    {
      return plain;
    }

    batch["expectRevision"] = current;
    input["document"] = document;

    var output = JsonNode.Parse(await runtime.InvokeAsync("agentExecute", input.ToJsonString(), cancellationToken: cancellationToken));

    if (output?["result"] is not JsonObject result || result["error"]?["code"]?.GetValue<string>() != "STALE")
    {
      return plain;
    }

    return WithHead(new BlokAgentExecution(result.ToJsonString(), null, current), current);
  }

  /// <summary>The room's export and its journal head, read in one lane hold.</summary>
  private async ValueTask<(JsonObject? Document, string Head)> RoomStateAsync(string docId, CancellationToken cancellationToken)
  {
    var (document, head, _) = await RoomStatusAsync(docId, cancellationToken);

    return (document, head);
  }

  private async ValueTask<(JsonObject? Document, string Head, CollabStateStatus Status)> RoomStatusAsync(
      string docId, CancellationToken cancellationToken)
  {
    var state = await rooms!.StateAsync(docId, cancellationToken);
    var head = state.Head is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : string.Empty;

    return state.Status == CollabStateStatus.Ready
        ? (JsonNode.Parse(state.Json) as JsonObject, head, state.Status)
        : (null, head, state.Status);
  }

  /// <summary>
  /// What HistoryEndpoint answers for this refusal. Jint decides from it whether a
  /// retry can help, as it does for MCP's HTTP reads, so the two must stay the same.
  /// </summary>
  /// <summary>
  /// As the shared runtime's restore: never asked twice, so a plain 500 is reported, not retryable.
  /// Mirrors ask(..., retry = false) in src/shared/agent/version-history.ts.
  /// </summary>
  internal static bool RestoreRetryable(CollabHistoryStatus status) => HttpStatus(status) is 429 or (>= 500 and not 500 and not 501);

  private static int HttpStatus(CollabHistoryStatus status) => status switch
  {
    CollabHistoryStatus.NoHistory => 501,
    CollabHistoryStatus.NotFound => 404,
    CollabHistoryStatus.Purged => 403,
    CollabHistoryStatus.Unavailable => 503,
    _ => 500,
  };

  /// <summary>
  /// Every revision a room result carries is the journal head: the top level,
  /// each read result, and a STALE error's details. Jint's content hash means
  /// nothing here, and an agent passes these back as <c>expectRevision</c>.
  /// </summary>
  private static BlokAgentExecution WithHead(BlokAgentExecution execution, string head)
  {
    var result = JsonNode.Parse(execution.ResultJson) as JsonObject
        ?? throw new InvalidOperationException("The agent result is not an object.");

    if (head.Length > 0)
    {
      result["revision"] = head;
    }
    else
    {
      result.Remove("revision");
    }

    var holders = (result["results"] as JsonArray ?? []).OfType<JsonObject>()
        .Append(result["error"]?["details"] as JsonObject)
        .OfType<JsonObject>()
        .Where(holder => holder.ContainsKey("revision"));

    foreach (var holder in holders)
    {
      if (head.Length > 0)
      {
        holder["revision"] = head;
      }
      else
      {
        holder.Remove("revision");
      }
    }

    return new BlokAgentExecution(result.ToJsonString(), execution.DocumentJson, head);
  }

  /// <summary>Thrown inside the room lane when there is nothing to write, so the room writes nothing.</summary>
  private sealed class NoRoomWriteException : Exception;

  private static CollabEditPrecondition? ParseHead(JsonNode? value)
  {
    if (value is not JsonValue text || !text.TryGetValue<string>(out var head))
    {
      return null;
    }

    var colon = head.LastIndexOf(':');

    return colon > 0 && ulong.TryParse(head.AsSpan(colon + 1), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var sequence)
      ? new CollabEditPrecondition(head[..colon], sequence)
      : null;
  }

  private static BlokAgentExecution Failure(string code, string message, bool retryable, JsonObject? details, string revision = "")
  {
    var error = new JsonObject { ["code"] = code, ["message"] = message, ["retryable"] = retryable };

    if (details is not null)
    {
      error["details"] = details;
    }

    var result = new JsonObject { ["ok"] = false, ["error"] = error, ["warnings"] = new JsonArray() };

    if (revision.Length > 0)
    {
      result["revision"] = revision;
    }

    return new BlokAgentExecution(result.ToJsonString(), null, revision);
  }

  internal static BlokAgentExecution Unavailable(string message)
  {
    var result = new JsonObject
    {
      ["ok"] = false,
      ["error"] = new JsonObject
      {
        ["code"] = "COMMAND_UNAVAILABLE",
        ["message"] = message,
        ["retryable"] = false,
        ["details"] = new JsonObject { ["reason"] = "runtime" },
      },
      ["warnings"] = new JsonArray(),
    };

    return new BlokAgentExecution(result.ToJsonString(), null, string.Empty);
  }

  internal static JsonObject Common(BlokAgentOptions? options)
  {
    var services = new JsonArray();

    if (options is { PageTitles: true, PageTarget: not null })
    {
      services.Add("pageBackend");
    }

    var input = new JsonObject { ["services"] = services };

    // Jint inserts a page only with ids C# made first (createdPages), so it lists page as prepared.
    if (options is { PageTitles: true, PageTarget: IBlokPageCreator })
    {
      input["prepares"] = new JsonArray("page");
    }

    if (options?.CustomToolsJson is { } tools)
    {
      input["customTools"] = JsonNode.Parse(tools);
    }

    if (options?.OverridesJson is { } overrides)
    {
      input["overrides"] = JsonNode.Parse(overrides);
    }

    if (options is { BuiltInComments: false })
    {
      input["comments"] = false;
    }

    return input;
  }

  /// <summary>Room calls also read the version history when the journal keeps it.</summary>
  private JsonObject RoomCommon(BlokAgentOptions? options)
  {
    var input = Common(options);

    // A room keeps no per-agent undo history, so its contract says so.
    input["runtime"] = "csharp-live";

    if (rooms is { HasHistory: true })
    {
      ((JsonArray)input["services"]!).Add("versionHistory");
      input["restores"] = true;
    }

    return input;
  }

  internal static JsonObject ActorNode(BlokAgentActor actor)
  {
    var node = new JsonObject { ["id"] = actor.Id, ["name"] = actor.Name, ["kind"] = "agent" };

    if (actor.OnBehalfOf is { } onBehalfOf)
    {
      node["onBehalfOf"] = onBehalfOf;
    }

    return node;
  }
}
