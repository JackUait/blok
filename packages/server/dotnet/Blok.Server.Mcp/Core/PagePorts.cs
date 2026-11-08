using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

/// <summary>
/// Page documents under page-map, as Node's createPageDocument and openPageDocument ports.
/// Jint cannot wait on the host mid-batch, so both run around the bundle call.
/// </summary>
internal sealed class PagePorts
{
  /// <summary>Set on the run's output when a page write went out but no ack came.</summary>
  internal const string UnconfirmedKey = "pageWriteUnconfirmed";

  private static readonly JsonObject Unconfirmed = [];

  private const string OpenDocumentMessage = "This page block points at the document you have open. Use doc.setTitle or doc.setIcon instead.";

  /// <summary>Makes one page document under the parent document id and returns its id; null when blok-mcp makes none.</summary>
  internal Func<McpCaller, string, CancellationToken, Task<string>>? Create { get; init; }

  /// <summary>Opens a page's own document with write access, as blok_open does.</summary>
  internal required Func<string, McpCaller, CancellationToken, Task<IHandleSession>> Open { get; init; }

  /// <summary>Holds a page session's close, which nobody waits for, until stop.</summary>
  internal required Action<Task> TrackClose { get; init; }

  internal static bool HasPageAction(JsonNode? batch)
  {
    return batch is JsonObject envelope && envelope["commands"] is JsonArray commands
        && commands.Any(command => command is JsonObject entry && McpJson.String(entry["name"]) is "page.rename" or "page.setIcon");
  }

  /// <summary>The error a host raised, as the bundle builds it for the model.</summary>
  internal static async Task<JsonObject> AgentErrorAsync(McpBundle bundle, McpHostError error, CancellationToken cancellationToken)
  {
    var built = await bundle.CallAsync("mcpErrorAnswer", error.ToInput("blok_execute"), cancellationToken);

    return (JsonObject)built["answer"]!["structuredContent"]!["error"]!.DeepClone();
  }

  /*
   * Makes the batch's pages first and passes their ids as createdPages. A page the host
   * could not make goes in as createPageFailure: the bundle fails that insert with it, and
   * after earlier pages names them as orphans (with commandIndex and revision). A cancel after
   * a page was made goes in the same way, as CANCELLED. Any other throw leaves the pages made
   * so far in created, for StrandedAnswerAsync.
   */
  internal async Task AddCreatedPagesAsync(McpBundle bundle, JsonObject input, McpCaller caller, string parentDocumentId, JsonArray created, CancellationToken cancellationToken)
  {
    var needed = await bundle.CallAsync("agentPagesNeeded", input, cancellationToken);

    for (var count = PageIds.ToMake(needed); count > 0; count--)
    {
      // A host may ignore the token, so a cancel must also stop the loop here.
      if (cancellationToken.IsCancellationRequested && created.Count > 0)
      {
        input["createPageFailure"] = AsIs(Cancelled);
        break;
      }
      cancellationToken.ThrowIfCancellationRequested();
      try
      {
        created.Add(await Create!(caller, parentDocumentId, cancellationToken));
      }
      catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested && created.Count > 0)
      {
        input["createPageFailure"] = AsIs(Cancelled);
        break;
      }
      catch (McpHostError error)
      {
        // As the error input mcpErrorAnswer takes: its helper decides retryable.
        input["createPageFailure"] = error.HostStopped && created.Count > 0 ? AsIs(ServerStop) : error.ToInput("blok_execute");
        break;
      }
    }
    input["createdPages"] = created.DeepClone();
  }

  /// <summary>Blok.Server's cause for a batch a host failure stopped after it made pages.</summary>
  internal static JsonObject ServerStop => new() { ["code"] = "APPLY_FAILED", ["message"] = "The batch stopped on a server error. Nothing was written.", ["retryable"] = true };

  private static JsonObject Cancelled => new() { ["code"] = "CANCELLED", ["message"] = "The batch was cancelled. Nothing was written.", ["retryable"] = false };

  private static JsonObject AsIs(JsonObject error)
  {
    return new JsonObject { ["tool"] = "blok_execute", ["helper"] = "as-is", ["error"] = error };
  }

  /*
   * The host made pages, then the batch stopped on a cancel or a server error before the parent
   * was written. The answer names the pages to clean up, in Blok.Server's shape
   * (BlokAgentExecutor.StoppedAfterCreating). It is built without the token: a cancel would stop it too.
   */
  internal static async Task<JsonObject> StrandedAnswerAsync(McpBundle bundle, Exception error, JsonArray created)
  {
    var cancelled = error is OperationCanceledException;

    if (!cancelled)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: a batch failed after it made pages: {error}");
    }
    var cause = cancelled ? Cancelled : ServerStop;
    var orphaned = new JsonArray([.. created.Select(pageId => (JsonNode)new JsonObject
    {
      ["command"] = "block.insert",
      ["type"] = "page",
      ["prepared"] = new JsonObject { ["pageId"] = pageId?.DeepClone() },
    })]);
    var result = new JsonObject
    {
      ["ok"] = false,
      ["error"] = new JsonObject
      {
        ["code"] = "ORPHANED_SIDE_EFFECT",
        ["message"] = $"The batch failed after the host did work for it ({McpJson.String(cause["message"])}). Clean up the listed items.",
        ["retryable"] = false,
        ["details"] = new JsonObject { ["orphaned"] = orphaned, ["cause"] = cause },
      },
      ["warnings"] = new JsonArray(),
    };
    var built = await bundle.CallAsync("mcpExecuteAnswer", new JsonObject { ["result"] = result }, CancellationToken.None);

    return (JsonObject)built["answer"]!;
  }

  /*
   * page.rename and page.setIcon (page-titles.ts): the bundle checks the batch and names the page,
   * then the host writes the title or icon in that page's own document. The answer has
   * agentExecute's shape. The source document is not changed, so it saves nothing.
   */
  internal async Task<JsonObject> RunActionAsync(
      McpBundle bundle, JsonObject input, McpCaller caller, Func<string, Task<bool>> isOpenDocument, CancellationToken cancellationToken)
  {
    // The bundle refuses a mixed batch itself, in Node's shape.
    var planned = await bundle.CallAsync("agentPlanHost", input, cancellationToken);
    var result = (JsonObject)planned["result"]!.DeepClone();

    if (McpJson.Bool(result["ok"]) != true)
    {
      return Ran(input, result);
    }
    var warnings = result["warnings"] as JsonArray ?? [];
    var revision = result["revision"];
    var command = (JsonObject)planned["batch"]!["commands"]![0]!;
    var blockId = McpJson.String(command["args"]?["id"]) ?? string.Empty;

    if (McpJson.String(planned["view"]?["blocks"]?[0]?["data"]?["pageId"]) is not { } pageId)
    {
      return Ran(input, Failure(revision, Error("INVALID_ARGS", $"Block \"{blockId}\" is not a page block with a pageId.", false, new JsonObject { ["blockId"] = blockId }, 0), warnings));
    }
    if (await isOpenDocument(pageId))
    {
      return Ran(input, Failure(revision, Error("INVALID_ARGS", OpenDocumentMessage, false, new JsonObject { ["pageId"] = pageId }, 0), warnings));
    }
    var rename = McpJson.String(command["name"]) == "page.rename";
    var field = rename ? "title" : "icon";
    var write = new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject
      {
        ["name"] = rename ? "doc.setTitle" : "doc.setIcon",
        ["args"] = new JsonObject { [field] = command["args"]?[field]?.DeepClone() },
      }),
    };
    var refused = await WriteAsync(bundle, pageId, write, caller, cancellationToken);
    var unconfirmed = ReferenceEquals(refused, Unconfirmed);

    if (refused is not null && !unconfirmed)
    {
      var details = refused["details"] as JsonObject ?? [];

      details["pageId"] = pageId;
      refused["details"] = details;
      refused["commandIndex"] ??= 0;

      return Ran(input, Failure(revision, refused, warnings));
    }
    result["results"] = new JsonArray(new JsonObject { ["pageId"] = pageId, ["applied"] = true });
    var ran = Ran(input, result, wroteOther: true);

    if (unconfirmed)
    {
      ran[UnconfirmedKey] = true;
    }

    return ran;
  }

  // Null when the page took the write, Unconfirmed when no ack came; otherwise the error, as Node's executor keeps it.
  private async Task<JsonObject?> WriteAsync(McpBundle bundle, string pageId, JsonObject batch, McpCaller caller, CancellationToken cancellationToken)
  {
    IHandleSession session;

    try
    {
      session = await Open(pageId, caller, cancellationToken);
    }
    catch (McpHostError error)
    {
      return await AgentErrorAsync(bundle, error, cancellationToken);
    }
    try
    {
      var outcome = await session.ExecuteAsync(batch, caller, null, cancellationToken);
      var answer = outcome.Answer?["structuredContent"] as JsonObject
          ?? throw new InvalidOperationException("A page write asked a question.");

      if (McpJson.Bool(answer["ok"]) != true)
      {
        return (JsonObject)answer["error"]!.DeepClone();
      }
      // No ack came, but the write went out and may still land: the batch says so in its delivery.
      if (McpJson.Bool(answer["delivery"]?["pending"]) == true)
      {
        return Unconfirmed;
      }

      return null;
    }
    catch (McpHostError error)
    {
      return await AgentErrorAsync(bundle, error, cancellationToken);
    }
    finally
    {
      TrackClose(CloseQuietlyAsync(session));
    }
  }

  /*
   * A batch whose page write went out unacknowledged is not durable, even when its own room
   * acked: the answer's delivery says pending (page-titles.ts createPageDeliveryTracker).
   */
  internal static void MarkUnconfirmed(JsonObject ran, JsonObject answerInput)
  {
    if (McpJson.Bool(ran[UnconfirmedKey]) != true || McpJson.Bool(answerInput["result"]?["ok"]) != true || answerInput.ContainsKey("failed"))
    {
      return;
    }
    var delivery = answerInput["delivery"]?.DeepClone() as JsonObject
        ?? new JsonObject { ["durable"] = false, ["pending"] = false, ["serverSequence"] = null, ["savedVersion"] = null };

    delivery["durable"] = false;
    delivery["pending"] = true;
    answerInput["delivery"] = delivery;
  }

  private static async Task CloseQuietlyAsync(IHandleSession session)
  {
    try
    {
      await session.CloseAsync("closed");
    }
    catch (Exception error)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: closing a page target failed: {error.Message}");
    }
  }

  private static JsonObject Error(string code, string message, bool retryable, JsonObject? details, int commandIndex)
  {
    var error = new JsonObject { ["code"] = code, ["message"] = message, ["retryable"] = retryable };

    if (details is not null)
    {
      error["details"] = details;
    }
    error["commandIndex"] = commandIndex;

    return error;
  }

  private static JsonObject Failure(JsonNode? revision, JsonObject error, JsonArray warnings)
  {
    var result = new JsonObject { ["ok"] = false };

    if (revision is not null)
    {
      result["revision"] = revision.DeepClone();
    }
    result["error"] = error;
    result["warnings"] = warnings.DeepClone();

    return result;
  }

  /*
   * agentExecute's output for the page action. A step that wrote only another document is
   * marked "other" in the carried history, so history.undo answers UNDO_OTHER_DOCUMENT.
   */
  private static JsonObject Ran(JsonObject input, JsonObject result, bool wroteOther = false)
  {
    var ran = new JsonObject
    {
      ["result"] = result,
      ["document"] = input["document"]?.DeepClone(),
      ["edits"] = new JsonArray(),
      ["writes"] = true,
      ["save"] = false,
    };

    if (input["history"] is JsonObject carried)
    {
      var history = (JsonObject)carried.DeepClone();

      if (wroteOther)
      {
        if (history["past"] is not JsonArray past)
        {
          past = [];
          history["past"] = past;
        }
        past.Add("other");
        history["future"] ??= new JsonArray();
        // The bundle keeps carried steps only for the document they were made on.
        history["revision"] ??= result["revision"]?.DeepClone();
      }
      ran["history"] = history;
    }

    return ran;
  }
}
