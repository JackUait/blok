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

  /// <summary>With rooms, <see cref="ExecuteInRoomAsync"/> edits live documents.</summary>
  internal BlokAgentExecutor(IBlokRuntime runtime, CollabRoomManager? rooms, ICollabDocConverter? converter)
      : this(runtime)
  {
    this.rooms = rooms;
    this.converter = converter;
  }

  public async ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
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
      return await RunPageActionAsync(input, actor, pages, cancellationToken);
    }

    var output = JsonNode.Parse(await runtime.InvokeAsync(
        "agentExecute", input.ToJsonString(), cancellationToken: cancellationToken))
        ?? throw new InvalidOperationException("The Blok runtime returned no agent execution.");
    var result = output["result"]
        ?? throw new InvalidOperationException("The Blok runtime returned no agent result.");
    var ok = result["ok"]?.GetValue<bool>() == true;
    var document = ok
        ? output["document"]?.ToJsonString()
            ?? throw new InvalidOperationException("The Blok runtime returned no document.")
        : null;

    return new BlokAgentExecution(
        result.ToJsonString(), document, result["revision"]?.GetValue<string>() ?? string.Empty);
  }

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
    var location = pageId is null ? null : await pages.ResolveAsync(pageId, cancellationToken);

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

      return WithHead(await RunPageActionAsync(input, actor, pages, cancellationToken), current);
    }

    JsonObject? planned = null;
    var operationId = Guid.NewGuid().ToString("N");
    var digest = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes($"agent\n{actor.Id}\n{batchJson}"));
    CollabEditResult edit;

    try
    {
      edit = await rooms.AgentEditAsync(docId, async (doc, token) =>
      {
        input["document"] = await converter.ExportAsync(doc, token);

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

        return ops;
      }, operationId, digest, actor.Id, expect, cancellationToken);
    }
    catch (NoRoomWriteException) when (planned is not null)
    {
      // A refusal, or a read with no journal head. Jint's content hash means nothing in a room.
      return WithHead(new BlokAgentExecution(planned.ToJsonString(), null, string.Empty), string.Empty);
    }

    var head = edit.Receipt is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : string.Empty;

    switch (edit.Status)
    {
      case CollabEditStatus.Applied when planned is not null:
        return WithHead(new BlokAgentExecution(planned.ToJsonString(), null, head), head);
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

  private static (string Name, JsonObject Args)? VersionCommand(JsonNode? batch) =>
      batch is JsonObject source && source["commands"] is JsonArray { Count: > 0 } commands
      && commands[0] is JsonObject first
      && first["name"] is JsonValue name && name.TryGetValue<string>(out var value)
      && value is "history.versions" or "history.read" or "history.changes"
          ? (value, first["args"] as JsonObject ?? [])
          : null;

  /// <summary>
  /// A version history read: the journal's answer is loaded into the Jint
  /// input, which shapes it as every runtime does. Outside the edit lane: it writes nothing.
  /// </summary>
  private async ValueTask<BlokAgentExecution> RunVersionReadAsync(
      string docId, JsonObject input, string name, JsonObject args, CollabEditPrecondition? expect,
      CancellationToken cancellationToken)
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

    return WithHead(new BlokAgentExecution(result.ToJsonString(), null, current), current);
  }

  /// <summary>What one read needs: the version list, or the documents it names (null when there is no such version).</summary>
  private async ValueTask<JsonObject> LoadVersionsAsync(
      string docId, string name, JsonObject args, CancellationToken cancellationToken)
  {
    if (name == "history.versions")
    {
      var minutes = args["group"] is JsonValue group && group.TryGetValue<int>(out var value) && value is 1 or 15 or 60
          ? TimeSpan.FromMinutes(value)
          : (TimeSpan?)null;
      var list = await rooms!.HistoryAsync(docId, minutes, cancellationToken);

      if (list.Status != CollabHistoryStatus.Ready)
      {
        return new JsonObject { ["failed"] = $"The version history could not be read ({list.Status})." };
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
          return new JsonObject { ["failed"] = $"Version \"{version}\" could not be read ({read.Status})." };
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
    var state = await rooms!.StateAsync(docId, cancellationToken);
    var head = state.Head is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : string.Empty;

    return state.Status == CollabStateStatus.Ready ? (JsonNode.Parse(state.Json) as JsonObject, head) : (null, head);
  }

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

    if (options?.CustomToolsJson is { } tools)
    {
      input["customTools"] = JsonNode.Parse(tools);
    }

    if (options?.OverridesJson is { } overrides)
    {
      input["overrides"] = JsonNode.Parse(overrides);
    }

    return input;
  }

  /// <summary>Room calls also read the version history when the journal keeps it.</summary>
  private JsonObject RoomCommon(BlokAgentOptions? options)
  {
    var input = Common(options);

    if (rooms is { HasHistory: true })
    {
      ((JsonArray)input["services"]!).Add("versionHistory");
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
