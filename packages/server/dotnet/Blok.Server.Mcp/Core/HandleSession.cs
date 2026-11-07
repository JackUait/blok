using System.Text.Json.Nodes;
using Blok.Server.Mcp.Sources;

namespace Blok.Server.Mcp.Core;

/// <summary>Who is calling: the principal, the cleaned client name, OAuth scopes and the agent actor.</summary>
internal sealed record McpCaller(string Principal, string ClientName, IReadOnlyList<string>? Scopes, JsonObject Actor, string PresenceName);

/// <summary>An approval context for blok_execute: client capabilities, the request's replies and the client name.</summary>
internal sealed record McpApproval(JsonNode? Capabilities, JsonNode? Replies, string ClientName);

/// <summary>What blok_execute answered: a tool answer, or a question for the person.</summary>
internal sealed record McpExecuteOutcome(JsonObject? Answer, JsonObject? Ask);

/// <summary>One open handle's document, as Node's HandleSession.</summary>
internal interface IHandleSession
{
  /// <summary>mode, write, durability, contractRevision, exists?, unavailableCommands? (for mcpOpenAnswer).</summary>
  JsonObject Describe();

  Task<JsonObject> ReadAsync(JsonNode? view, CancellationToken cancellationToken);

  Task<JsonObject> DescribeAsync(JsonNode? query, CancellationToken cancellationToken);

  Task<McpExecuteOutcome> ExecuteAsync(JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken);

  /// <returns><c>{ unsavedBatches, hostRecordLags }</c>.</returns>
  Task<JsonObject> CloseAsync(string reason);
}

/// <summary>A stored document: loaded from a source, saved after every changing batch.</summary>
internal sealed class StoredSession : IHandleSession
{
  private readonly McpBundle bundle;
  private readonly IDocumentSource source;
  private readonly string documentId;
  private readonly bool write;
  private readonly JsonObject mcp;
  private readonly JsonObject actor;
  private readonly string contractRevision;
  private readonly bool exists;
  private JsonNode document;
  private JsonNode history = new JsonObject();
  private string? version;
  private bool stale;

  private StoredSession(McpBundle bundle, IDocumentSource source, string documentId, bool write, JsonObject flags, JsonObject actor, string contractRevision, LoadedDocument first)
  {
    // Node creates a page's document mid-batch; Jint cannot wait on the host, so pages are made first.
    this.bundle = bundle;
    this.source = source;
    this.documentId = documentId;
    this.write = write;
    this.actor = actor;
    this.contractRevision = contractRevision;
    mcp = (JsonObject)flags.DeepClone();
    mcp["mode"] = "stored";
    mcp["write"] = write;
    document = first.Raw;
    version = first.Version;
    exists = !first.Missing;
  }

  /// <summary>Set under page-map: page documents this batch makes or writes.</summary>
  private PagePorts? Pages { get; init; }

  /// <summary>Set with a host uploader: runs the batch's upload calls.</summary>
  private UploadPorts? Uploads { get; init; }

  internal static async Task<StoredSession> OpenAsync(
      McpBundle bundle, IDocumentSource source, string documentId, bool write, JsonObject flags, JsonObject actor, string contractRevision,
      PagePorts? pages, UploadPorts? uploads, CancellationToken cancellationToken)
  {
    var first = await source.LoadAsync(documentId, cancellationToken);

    return new StoredSession(bundle, source, documentId, write, flags, actor, contractRevision, first) { Pages = pages, Uploads = uploads };
  }

  public JsonObject Describe()
  {
    return new JsonObject
    {
      ["mode"] = "stored",
      ["write"] = write,
      ["durability"] = "saved-on-execute",
      ["contractRevision"] = contractRevision,
      ["exists"] = exists,
    };
  }

  public async Task<JsonObject> ReadAsync(JsonNode? view, CancellationToken cancellationToken)
  {
    await ReloadIfStaleAsync(cancellationToken);
    var input = SessionInput();

    input["view"] = view?.DeepClone() ?? new JsonObject();

    return (JsonObject)(await bundle.CallAsync("mcpRead", input, cancellationToken))["answer"]!;
  }

  public async Task<JsonObject> DescribeAsync(JsonNode? query, CancellationToken cancellationToken)
  {
    var input = SessionInput();

    input["query"] = query?.DeepClone() ?? new JsonObject();

    return (JsonObject)(await bundle.CallAsync("mcpDescribe", input, cancellationToken))["answer"]!;
  }

  public async Task<McpExecuteOutcome> ExecuteAsync(JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    await ReloadIfStaleAsync(cancellationToken);
    var input = SessionInput();

    input["history"] = history.DeepClone();
    input["batch"] = batch?.DeepClone();
    input["documentText"] = source.DocumentTextForm;
    if (approval is not null)
    {
      var approvalInput = new JsonObject
      {
        ["capabilities"] = approval.Capabilities?.DeepClone(),
        ["clientName"] = approval.ClientName,
      };

      if (approval.Replies is not null)
      {
        approvalInput["replies"] = approval.Replies.DeepClone();
      }
      input["approval"] = approvalInput;
    }
    JsonObject ran;

    if (write && Pages is not null && IsBatchEnvelope(batch) && PagePorts.HasPageAction(batch))
    {
      ran = await Pages.RunActionAsync(bundle, input, caller, IsOpenDocumentAsync, cancellationToken);
    }
    else
    {
      if (write && Pages?.Create is not null && IsBatchEnvelope(batch))
      {
        await Pages.AddCreatedPagesAsync(bundle, input, caller, cancellationToken);
      }
      ran = Uploads is null ? await bundle.CallAsync("agentExecute", input, cancellationToken) : await Uploads.ExecuteAsync(bundle, input, cancellationToken);
    }

    if (ran["ask"] is JsonObject ask)
    {
      return new McpExecuteOutcome(null, ask);
    }
    var result = ran["result"]!;

    document = ran["document"]!.DeepClone();
    if (ran["history"] is JsonNode carried)
    {
      history = carried.DeepClone();
    }
    if (McpJson.Bool(ran["save"]) != true)
    {
      var answerInput = new JsonObject { ["result"] = result.DeepClone() };

      PagePorts.MarkUnconfirmed(ran, answerInput);

      return new McpExecuteOutcome(await AnswerAsync(answerInput, cancellationToken), null);
    }
    // As Node: the answer is built before the save, so nothing that can fail follows it,
    // and a failed answer saved nothing a retry would repeat.
    JsonObject answer;

    try
    {
      answer = await AnswerAsync(new JsonObject
      {
        ["result"] = result.DeepClone(),
        ["delivery"] = new JsonObject
        {
          ["durable"] = true,
          ["pending"] = false,
          ["serverSequence"] = null,
          ["savedVersion"] = null,
        },
      }, cancellationToken);
    }
    catch
    {
      stale = true;
      throw;
    }
    try
    {
      var text = McpJson.String(ran["documentText"]) ?? throw new InvalidOperationException("agentExecute did not return documentText.");
      var saved = await source.SaveAsync(documentId, text, version, cancellationToken);

      version = saved;
      if (answer["structuredContent"]?["delivery"] is JsonObject delivery)
      {
        delivery["savedVersion"] = saved;
      }

      return new McpExecuteOutcome(answer, null);
    }
    catch (McpHostError error)
    {
      // Memory must match the source: drop the refused work. A failed reload retries on the next call.
      stale = true;
      try
      {
        await ReloadAsync(cancellationToken);
      }
      catch (McpHostError)
      {
        // Retried on the next call.
      }

      return new McpExecuteOutcome(await AnswerAsync(new JsonObject
      {
        ["result"] = result.DeepClone(),
        ["failed"] = error.ToInput("blok_execute"),
      }, cancellationToken), null);
    }
  }

  public Task<JsonObject> CloseAsync(string reason)
  {
    return Task.FromResult(new JsonObject { ["unsavedBatches"] = 0, ["hostRecordLags"] = false });
  }

  // The bundle's own check: commands is an array of objects.
  private static bool IsBatchEnvelope(JsonNode? batch)
  {
    return batch is JsonObject envelope && envelope["commands"] is JsonArray commands && commands.All(command => command is JsonObject);
  }

  // A second save of the open document would make this handle's version stale.
  private async Task<bool> IsOpenDocumentAsync(string pageId)
  {
    return pageId == documentId || await source.SameDocumentAsync(pageId, documentId);
  }

  private async Task<JsonObject> AnswerAsync(JsonObject input, CancellationToken cancellationToken)
  {
    return (JsonObject)(await bundle.CallAsync("mcpExecuteAnswer", input, cancellationToken))["answer"]!;
  }

  private JsonObject SessionInput()
  {
    return new JsonObject
    {
      ["mcp"] = mcp.DeepClone(),
      ["document"] = document.DeepClone(),
      ["actor"] = actor.DeepClone(),
    };
  }

  private async Task ReloadIfStaleAsync(CancellationToken cancellationToken)
  {
    if (stale)
    {
      await ReloadAsync(cancellationToken);
    }
  }

  // Node starts a fresh agent on reload, so the undo steps go too.
  private async Task ReloadAsync(CancellationToken cancellationToken)
  {
    var loaded = await source.LoadAsync(documentId, cancellationToken);

    document = loaded.Raw;
    version = loaded.Version;
    history = new JsonObject();
    stale = false;
  }
}
