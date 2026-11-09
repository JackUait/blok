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
      : this(bundle, source, documentId, write, flags, actor, contractRevision, first.Raw, first.Version, !first.Missing)
  {
  }

  private StoredSession(
      McpBundle bundle, IDocumentSource source, string documentId, bool write, JsonObject flags, JsonObject actor, string contractRevision,
      JsonNode document, string? version, bool exists)
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
    this.document = document;
    this.version = version;
    this.exists = exists;
  }

  /// <summary>Set under page-map: page documents this batch makes or writes.</summary>
  private PagePorts? Pages { get; init; }

  /// <summary>Set with a host uploader: runs the batch's upload calls.</summary>
  private UploadPorts? Uploads { get; init; }

  /// <summary>Who opened the handle: page documents its batches make or open act for them, as Node's portsFor(caller).</summary>
  private McpCaller? Opener { get; init; }

  internal static async Task<StoredSession> OpenAsync(
      McpBundle bundle, IDocumentSource source, string documentId, bool write, JsonObject flags, JsonObject actor, string contractRevision,
      PagePorts? pages, UploadPorts? uploads, CancellationToken cancellationToken, McpCaller? opener = null)
  {
    var first = await source.LoadAsync(documentId, cancellationToken);

    return new StoredSession(bundle, source, documentId, write, flags, actor, contractRevision, first) { Pages = pages, Uploads = uploads, Opener = opener };
  }

  /// <summary>
  /// A handle a shared store kept, rebuilt without a load: the record carries the document. Its
  /// steps hold only while their revision is the document's; the bundle checks that on each batch.
  /// </summary>
  internal static StoredSession Restore(
      McpBundle bundle, IDocumentSource source, BlokMcpHandleRecord record, JsonObject flags, string contractRevision,
      PagePorts? pages, UploadPorts? uploads, McpCaller opener)
  {
    return new StoredSession(bundle, source, record.DocumentId, record.Write, flags, (JsonObject)opener.Actor.DeepClone(), contractRevision, record.Document.DeepClone(), record.Version, true)
    {
      Pages = pages,
      Uploads = uploads,
      Opener = opener,
      history = record.History.DeepClone(),
      stale = record.Stale,
    };
  }

  /// <summary>The handle as a shared store keeps it, for the caller that opened it.</summary>
  internal BlokMcpHandleRecord Snapshot()
  {
    var opener = Opener ?? throw new InvalidOperationException("A stored session without its opener cannot go into a handle store.");

    return new BlokMcpHandleRecord
    {
      ContractRevision = contractRevision,
      Principal = opener.Principal,
      ClientName = opener.ClientName,
      Scopes = opener.Scopes,
      Actor = (JsonObject)opener.Actor.DeepClone(),
      DocumentId = documentId,
      Write = write,
      Version = version,
      Stale = stale,
      Document = document.DeepClone() as JsonObject ?? new JsonObject { ["blocks"] = new JsonArray() },
      History = history.DeepClone() as JsonObject ?? [],
    };
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
    // Pages made for this batch: if it stops before the parent is saved, the answer names them.
    var created = new JsonArray();

    try
    {
      return await RunAsync(batch, caller, input, created, cancellationToken);
    }
    catch (Exception error) when (created.Count > 0)
    {
      // Memory is the parent as saved (or as reloaded after a broken save): a page it links is no orphan.
      var linked = OrphanedPages.Linked(document);
      var unlinked = new JsonArray([.. created.Where(pageId => !linked.Contains(McpJson.String(pageId) ?? string.Empty)).Select(pageId => pageId?.DeepClone())]);

      if (unlinked.Count == 0)
      {
        throw;
      }

      return new McpExecuteOutcome(await Pages!.StrandedAnswerAsync(bundle, error, unlinked), null);
    }
  }

  // Memory takes the batch's document and history only once the call has fully succeeded, so after
  // any failure it still matches the source.
  private async Task<McpExecuteOutcome> RunAsync(JsonNode? batch, McpCaller caller, JsonObject input, JsonArray created, CancellationToken cancellationToken)
  {
    JsonObject ran;

    if (write && Pages is not null && IsBatchEnvelope(batch) && PagePorts.HasPageAction(batch))
    {
      ran = await Pages.RunActionAsync(bundle, input, Opener ?? caller, IsOpenDocumentAsync, cancellationToken);
    }
    else
    {
      if (write && Pages?.Create is not null && IsBatchEnvelope(batch))
      {
        await Pages.AddCreatedPagesAsync(bundle, input, Opener ?? caller, documentId, created, cancellationToken);
        // The batch fails on it and saves nothing; a cancel must not stop its answer.
        if (input.ContainsKey("createPageFailure"))
        {
          cancellationToken = CancellationToken.None;
        }
      }
      ran = Uploads is null ? await bundle.CallAsync("agentExecute", input, cancellationToken) : await Uploads.ExecuteAsync(bundle, input, cancellationToken);
    }

    if (ran["ask"] is JsonObject ask)
    {
      return new McpExecuteOutcome(null, ask);
    }
    var result = ran["result"]!;

    // A failed batch wrote nothing, so memory is the parent as saved.
    if (result is JsonObject outcome)
    {
      if (OrphanedPages.CancelledAfterPages(input))
      {
        OrphanedPages.WrapCancelled(outcome, created);
      }
      OrphanedPages.Filter(outcome, document);
    }
    var nextDocument = ran["document"]!.DeepClone();
    var nextHistory = ran["history"] is JsonNode carried ? carried.DeepClone() : history;

    if (McpJson.Bool(ran["save"]) != true)
    {
      var answerInput = new JsonObject { ["result"] = result.DeepClone() };

      PagePorts.MarkUnconfirmed(ran, answerInput);
      var unsaved = await AnswerAsync(answerInput, cancellationToken);

      document = nextDocument;
      history = nextHistory;

      return new McpExecuteOutcome(unsaved, null);
    }
    // As Node: the answer is built before the save, so nothing that can fail follows it,
    // and a failed answer saved nothing a retry would repeat.
    JsonObject answer;
    string? saved;

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
      var text = McpJson.String(ran["documentText"]) ?? throw new InvalidOperationException("agentExecute did not return documentText.");

      saved = await source.SaveAsync(documentId, text, version, cancellationToken);
    }
    catch (McpHostError error)
    {
      // Drop the refused work. A failed reload retries on the next call.
      stale = true;
      try
      {
        await ReloadAsync(cancellationToken);
      }
      catch (Exception)
      {
        // stale is still set, so the next call reloads.
      }

      return new McpExecuteOutcome(await AnswerAsync(new JsonObject
      {
        ["result"] = result.DeepClone(),
        ["failed"] = error.ToInput("blok_execute"),
      }, cancellationToken), null);
    }
    catch (Exception) when (created.Count > 0)
    {
      // The save may have stored the parent before it failed: only pages the stored parent does not
      // name are orphans. With no parent to read, none are reported, so the host never deletes a used page.
      stale = true;
      var linked = await TryReloadAsync(cancellationToken) ? OrphanedPages.Linked(document) : null;
      var unused = linked is null ? [] : created.Where(pageId => !linked.Contains(McpJson.String(pageId) ?? string.Empty)).Select(pageId => pageId!.DeepClone()).ToList();

      created.Clear();
      unused.ForEach(created.Add);
      throw;
    }
    catch
    {
      // The save may have landed before it failed, so the next call reloads.
      stale = true;
      throw;
    }
    version = saved;
    document = nextDocument;
    history = nextHistory;
    if (answer["structuredContent"]?["delivery"] is JsonObject delivery)
    {
      delivery["savedVersion"] = saved;
    }

    return new McpExecuteOutcome(answer, null);
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

  // Whether the document could be read again.
  private async Task<bool> TryReloadAsync(CancellationToken cancellationToken)
  {
    try
    {
      await ReloadAsync(cancellationToken);

      return true;
    }
    catch (Exception)
    {
      return false;
    }
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
