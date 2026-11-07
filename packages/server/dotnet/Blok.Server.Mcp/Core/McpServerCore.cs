using System.Text.Json.Nodes;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Mcp.Sources;

namespace Blok.Server.Mcp.Core;

/// <summary>What one tools/call came to.</summary>
internal sealed record McpCallResult(string? UnknownTool, JsonObject? Answer, JsonObject? Ask);

/// <summary>
/// The MCP shell: the bundle does every check and builds every answer; this class
/// does the IO between the steps, in Node's dispatcher order.
/// </summary>
internal sealed class McpServerCore : IAsyncDisposable
{
  private readonly McpBundle bundle;
  private readonly McpConfig config;
  private readonly IDocumentSource? source;
  private readonly LiveOpener? live;
  private readonly HandleRegistry<IHandleSession> handles;
  private readonly JsonObject flags;
  private readonly Timer sweeper;
  private readonly SemaphoreSlim surfaceGate = new(1, 1);
  private readonly PagePorts? pages;
  private readonly UploadPorts? uploads;
  // page.rename and page.setIcon close their page session without waiting; stop waits for those closes.
  private readonly HashSet<Task> pageCloses = [];
  // Every tools/call and sweep, so stop waits for it.
  private readonly HashSet<Task> inFlight = [];
  private Task? stopping;
  // Per handle, the last call to arrive: the next one starts after it.
  private readonly Dictionary<string, Task> arrivals = new(StringComparer.Ordinal);
  // Request id -> the place its handle call took when it was read.
  private readonly Dictionary<string, Place> reserved = new(StringComparer.Ordinal);
  // A line whose id was already waiting gets a tag instead: tag -> its place.
  private readonly Dictionary<long, Place> tagged = [];
  private long tags;
  private JsonObject? surface;
  private int stopped;

  internal McpServerCore(McpBundle bundle, McpConfig config, McpHttpCaller http)
  {
    this.bundle = bundle;
    this.config = config;
    source = config.Source switch
    {
      McpSourceConfig.Files files => new FilesSource(files.Dir, bundle),
      McpSourceConfig.Endpoint endpoint => new EndpointSource(endpoint, http),
      _ => null,
    };
    flags = config.SurfaceFlags();
    live = config.Sync is null ? null : new LiveOpener(config, http, bundle, flags, SurfaceAsync);
    // Node's openPageDocument is there under page-map; createPageDocument only where a page can be made.
    pages = config.PageTitles != "page-map" ? null : new PagePorts
    {
      Create = config.Sync is not null ? CreateLivePageAsync : config.Rooms is null && source is not null ? CreatePageAsync : null,
      Open = (pageId, caller, cancellationToken) => OpenSessionAsync(pageId, "auto", true, caller, cancellationToken),
      TrackClose = TrackPageClose,
    };
    uploads = config.Uploads is null ? null : new UploadPorts(config.Uploads, config.LogError);
    if (live is not null)
    {
      live.Pages = pages;
      live.Uploads = uploads;
    }
    handles = new HandleRegistry<IHandleSession>(config.IdleMs, config.MaxHandles, session => session.CloseAsync("expired"));
    var period = TimeSpan.FromMilliseconds(Math.Min(config.IdleMs, 30_000));

    sweeper = new Timer(_ => Track(inFlight, SweepAsync()), null, period, period);
  }

  internal McpBundle Bundle => bundle;

  /// <summary>
  /// How long stop waits for work in flight (server.ts STOP_DRAIN_MS): above the slowest bounded
  /// open, 10 s authorize webhook + 30 s endpoint load.
  /// </summary>
  internal TimeSpan StopDrain { get; set; } = TimeSpan.FromSeconds(45);

  /// <summary>
  /// Closes every handle and waits for each call in flight, so its answer can still go out,
  /// and for page closes. Gives up after <see cref="StopDrain"/>. Runs once.
  /// </summary>
  internal Task StopAsync()
  {
    lock (inFlight)
    {
      stopping ??= StopOnceAsync();

      return stopping;
    }
  }

  internal McpConfig Config => config;

  /// <summary>Stdin ended: a tools/call not yet dispatched never runs, as Node's stop gets there first.</summary>
  internal volatile bool InputEnded;

  internal async Task<JsonObject> SurfaceAsync(CancellationToken cancellationToken = default)
  {
    if (surface is not null)
    {
      return surface;
    }
    await surfaceGate.WaitAsync(cancellationToken);
    try
    {
      surface ??= await bundle.CallAsync("mcpSurface", (JsonObject)flags.DeepClone(), cancellationToken);

      return surface;
    }
    finally
    {
      surfaceGate.Release();
    }
  }

  /// <summary>
  /// Calls on one handle reach its queue in the order this was called, as Node's queue takes them.
  /// The SDK starts handlers in arrival order but runs them at once, and the bundle checks before
  /// the queue would reorder them. Each call waits until the one before it has joined the queue.
  /// </summary>
  internal Task<T> InArrivalOrderAsync<T>(string? handle, string? requestId, Func<Task<T>> run, long? tag = null)
  {
    var call = InOrderAsync(handle, requestId, tag, run);

    // Tracked from arrival, so stop also waits for a call still waiting its turn.
    Track(inFlight, call);

    return call;
  }

  /// <summary>
  /// Takes the request's place in its handle's order as it is read off the wire. The SDK's
  /// handler can start after a later request's, so the place is taken here, before it. A line
  /// whose id is already waiting gets its own place under the tag returned, which the reader
  /// writes into the line (<see cref="ArrivalTagMeta"/>), so the two never take each other's.
  /// </summary>
  internal long? Reserve(string requestId, string handle)
  {
    lock (arrivals)
    {
      if (!reserved.ContainsKey(requestId))
      {
        reserved[requestId] = Join(handle);

        return null;
      }
      var tag = ++tags;

      tagged[tag] = Join(handle);

      return tag;
    }
  }

  /// <summary>Where a repeated id's line carries its tag: params._meta, which tools never read.</summary>
  internal const string ArrivalTagMeta = "io.blok/arrival";

  /// <summary>A request answered or cancelled without running gives its place up.</summary>
  internal void Unreserve(string requestId)
  {
    Place? place;

    lock (arrivals)
    {
      reserved.Remove(requestId, out place);
    }
    if (place is not null)
    {
      Leave(place);
    }
  }

  /// <summary>A tagged request the SDK finished without running gives its place up.</summary>
  internal void ReleaseTag(long tag)
  {
    Place? place;

    lock (arrivals)
    {
      tagged.Remove(tag, out place);
    }
    if (place is not null)
    {
      Leave(place);
    }
  }

  private Task<T> InOrderAsync<T>(string? handle, string? requestId, long? tag, Func<Task<T>> run)
  {
    if (handle is null)
    {
      return run();
    }
    Place? place = null;

    lock (arrivals)
    {
      if (!(tag is long mine && tagged.Remove(mine, out place)) && (requestId is null || !reserved.Remove(requestId, out place)))
      {
        place = Join(handle);
      }
    }

    return AfterAsync(place!, run);
  }

  // Under the arrivals lock.
  private Place Join(string handle)
  {
    var place = new Place(handle, arrivals.GetValueOrDefault(handle) ?? Task.CompletedTask, new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));

    arrivals[handle] = place.Mine.Task;

    return place;
  }

  private void Leave(Place place)
  {
    lock (arrivals)
    {
      if (arrivals.GetValueOrDefault(place.Handle) == place.Mine.Task)
      {
        arrivals.Remove(place.Handle);
      }
    }
    place.Mine.TrySetResult();
  }

  private async Task<T> AfterAsync<T>(Place place, Func<Task<T>> run)
  {
    try
    {
      await place.Previous;
      HandleArrival.Current.Value = place.Mine;

      return await run();
    }
    finally
    {
      Leave(place);
    }
  }

  internal async Task<McpCaller> CallerAsync(string principal, string? rawClientName, IReadOnlyList<string>? scopes, CancellationToken cancellationToken)
  {
    var input = new JsonObject { ["principal"] = principal };

    if (rawClientName is not null)
    {
      input["clientName"] = rawClientName;
    }
    var named = await bundle.CallAsync("mcpActor", input, cancellationToken);
    var clientName = McpJson.String(named["clientName"]) ?? string.Empty;

    // A host's own actor publishes its name as given (actor.ts agentPresenceName).
    if (config.AgentActor is { } build)
    {
      var actor = build(principal, clientName);

      return new McpCaller(principal, clientName, scopes, actor, McpJson.String(actor["name"]) ?? string.Empty);
    }

    return new McpCaller(
        principal,
        clientName,
        scopes,
        (JsonObject)named["actor"]!.DeepClone(),
        McpJson.String(named["presenceName"]) ?? string.Empty);
  }

  internal async Task<JsonObject> PromptAsync(string name, JsonNode? arguments, CancellationToken cancellationToken)
  {
    var input = new JsonObject { ["name"] = name };

    if (arguments is not null)
    {
      input["arguments"] = arguments.DeepClone();
    }

    return await bundle.CallAsync("mcpPrompt", input, cancellationToken);
  }

  internal Task<McpCallResult> CallToolAsync(string name, JsonObject? arguments, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    var call = DispatchAsync(name, arguments, caller, approval, cancellationToken);

    Track(inFlight, call);

    return call;
  }

  private async Task<McpCallResult> DispatchAsync(string name, JsonObject? arguments, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    var input = new JsonObject
    {
      ["name"] = name,
      ["arguments"] = arguments?.DeepClone() ?? new JsonObject(),
      ["scopes"] = caller.Scopes is null ? null : new JsonArray([.. caller.Scopes.Select(scope => (JsonNode)scope)]),
    };
    var checkedCall = await bundle.CallAsync("mcpCheckCall", input, cancellationToken);

    if (McpJson.String(checkedCall["unknownTool"]) is string unknown)
    {
      return new McpCallResult(unknown, null, null);
    }
    if (checkedCall["answer"] is JsonObject refused)
    {
      return Answer(refused);
    }
    var step = (JsonObject)checkedCall["step"]!;

    try
    {
      return McpJson.String(step["tool"]) switch
      {
        "blok_list_documents" => Answer(new JsonObject
        {
          ["structuredContent"] = await ListDocumentsAsync((JsonObject)step["list"]!, caller, cancellationToken),
          ["isError"] = false,
        }),
        "blok_open" => Answer(await OpenAsync(step, caller, cancellationToken)),
        "blok_close" => Answer(await CloseAsync(McpJson.String(step["handle"])!, caller)),
        _ => await OnHandleAsync(step, caller, approval, cancellationToken),
      };
    }
    catch (McpHostError error)
    {
      var built = await bundle.CallAsync("mcpErrorAnswer", error.ToInput(name), cancellationToken);

      return Answer((JsonObject)built["answer"]!);
    }
    // Node has no such budget; the agent can split the batch, so it is model-fixable.
    catch (Blok.Server.Documents.BlokDocumentConversionException error) when (error.Reason == Blok.Server.Documents.BlokConversionFailure.DocumentTooLarge)
    {
      var tooBig = new McpHostError("INVALID_ARGS", "This call needs more memory than one call may use. Send its commands in smaller batches.", helper: "failure");
      var built = await bundle.CallAsync("mcpErrorAnswer", tooBig.ToInput(name), cancellationToken);

      return Answer((JsonObject)built["answer"]!);
    }
  }

  public async ValueTask DisposeAsync()
  {
    await StopAsync();
    if (Interlocked.Exchange(ref stopped, 1) == 0)
    {
      surfaceGate.Dispose();
    }
  }

  private async Task StopOnceAsync()
  {
    await sweeper.DisposeAsync();
    var work = Task.Run(async () =>
    {
      await Task.WhenAll(handles.CloseAllAsync(session => session.CloseAsync("closed")), DrainAsync());
      // An execute that closeAll waited for may have closed a page session after the first drain.
      await DrainAsync();
    });

    await Task.WhenAny(work, Task.Delay(StopDrain));
  }

  // Work in flight can add more, so it looks again until nothing new is left.
  private async Task DrainAsync()
  {
    var seen = new HashSet<Task>();

    while (true)
    {
      Task[] pending;

      lock (inFlight)
      {
        lock (pageCloses)
        {
          pending = [.. inFlight.Concat(pageCloses).Where(seen.Add)];
        }
      }
      if (pending.Length == 0)
      {
        return;
      }
      await Task.WhenAll(pending.Select(task => task.ContinueWith(_ => { }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default)));
    }
  }

  private static void Track(HashSet<Task> set, Task task)
  {
    lock (set)
    {
      set.Add(task);
    }
    _ = task.ContinueWith(
        done =>
        {
          lock (set)
          {
            set.Remove(done);
          }
        },
        CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
  }

  private static McpCallResult Answer(JsonObject answer)
  {
    return new McpCallResult(null, answer, null);
  }

  private async Task SweepAsync()
  {
    try
    {
      await handles.SweepAsync();
    }
    catch (Exception error)
    {
      // stdout carries the protocol, so failures go to stderr.
      await Console.Error.WriteLineAsync($"blok-mcp: closing an idle handle failed {error.Message}");
    }
  }

  private async Task<bool> AllowedAsync(McpCaller caller, string documentId, bool write, CancellationToken cancellationToken)
  {
    return config.Authorize is null || await config.Authorize(caller.Principal, documentId, write, cancellationToken);
  }

  private async Task<JsonObject> ListAsync(int limit, string? query, string? cursor, McpCaller caller, CancellationToken cancellationToken)
  {
    if (source is null || !source.CanList)
    {
      return new JsonObject { ["documents"] = new JsonArray(), ["nextCursor"] = null, ["supported"] = false };
    }
    var listing = await source.ListAsync(limit, query, cursor, cancellationToken);
    var documents = (listing["documents"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
    // A listed id is a read; without a hook (stdio) every document is visible.
    var allowed = await Task.WhenAll(documents.Select(doc => AllowedAsync(caller, McpJson.String(doc["id"]) ?? string.Empty, false, cancellationToken)));
    var readable = new JsonArray();

    for (var index = 0; index < documents.Length; index++)
    {
      if (allowed[index])
      {
        var entry = (JsonObject)documents[index].DeepClone();

        entry["live"] = config.Live;
        readable.Add(entry);
      }
    }

    return new JsonObject { ["documents"] = readable, ["nextCursor"] = listing["nextCursor"]?.DeepClone(), ["supported"] = true };
  }

  private Task<JsonObject> ListOfRequestAsync(JsonObject request, McpCaller caller, CancellationToken cancellationToken)
  {
    return ListAsync(
        (int)(McpJson.Number(request["limit"]) ?? 25),
        McpJson.String(request["query"]),
        McpJson.String(request["cursor"]),
        caller,
        cancellationToken);
  }

  private async Task<JsonObject> ListDocumentsAsync(JsonObject request, McpCaller caller, CancellationToken cancellationToken)
  {
    var listing = await ListOfRequestAsync(request, caller, cancellationToken);
    var answer = await bundle.CallAsync("mcpListAnswer", new JsonObject { ["request"] = request.DeepClone(), ["listing"] = listing }, cancellationToken);

    if (answer["relist"] is JsonObject relist)
    {
      var relisted = await ListOfRequestAsync(relist, caller, cancellationToken);

      answer = await bundle.CallAsync("mcpListAnswer", new JsonObject
      {
        ["request"] = request.DeepClone(),
        ["listing"] = listing.DeepClone(),
        ["relisted"] = relisted,
      }, cancellationToken);
    }

    return (JsonObject)answer["listing"]!.DeepClone();
  }

  private async Task<JsonObject> OpenAsync(JsonObject step, McpCaller caller, CancellationToken cancellationToken)
  {
    if (step["find"] is not JsonObject find)
    {
      return await OpenFoundAsync(step, McpJson.String(step["documentId"])!, null, caller, cancellationToken);
    }
    var request = new JsonObject { ["limit"] = 25 };

    if (McpJson.String(find["query"]) is string query)
    {
      request["query"] = query;
    }
    var listing = await ListDocumentsAsync(request, caller, cancellationToken);
    var picked = await bundle.CallAsync("mcpPickDocument", new JsonObject { ["find"] = find.DeepClone(), ["listing"] = listing }, cancellationToken);

    if (picked["answer"] is JsonObject answer)
    {
      return answer;
    }
    var open = (JsonObject)picked["open"]!;
    var found = new JsonObject { ["documentId"] = open["documentId"]?.DeepClone(), ["title"] = open["title"]?.DeepClone() };

    return await OpenFoundAsync(step, McpJson.String(open["documentId"])!, found, caller, cancellationToken);
  }

  private async Task<JsonObject> OpenFoundAsync(JsonObject step, string documentId, JsonObject? found, McpCaller caller, CancellationToken cancellationToken)
  {
    var write = McpJson.Bool(step["write"]) == true;

    // Opening can mint a ticket and join a room, so refuse at the cap first.
    handles.AssertRoom(caller.Principal);
    var session = await OpenSessionAsync(documentId, McpJson.String(step["mode"]) ?? "auto", write, caller, cancellationToken);

    try
    {
      JsonNode? view = null;

      if (step["view"] is JsonNode wanted)
      {
        var read = await session.ReadAsync(wanted, cancellationToken);

        if (McpJson.Bool(read["isError"]) == true)
        {
          await CloseQuietlyAsync(session);

          return read;
        }
        view = read["structuredContent"]?.DeepClone();
      }
      // Nobody would hold the handle.
      if (cancellationToken.IsCancellationRequested)
      {
        throw new McpHostError("CANCELLED", "The request was cancelled before the document opened.", helper: "failure");
      }
      var handle = handles.Add(caller.Principal, documentId, session);
      var input = new JsonObject
      {
        ["handle"] = handle,
        ["session"] = session.Describe(),
        ["expiresAfterIdleMs"] = config.IdleMs,
      };

      if (found is not null)
      {
        input["found"] = found;
      }
      if (view is not null)
      {
        input["view"] = view;
      }

      return (JsonObject)(await bundle.CallAsync("mcpOpenAnswer", input, cancellationToken))["answer"]!;
    }
    catch
    {
      await CloseQuietlyAsync(session);
      throw;
    }
  }

  private static async Task CloseQuietlyAsync(IHandleSession session)
  {
    try
    {
      await session.CloseAsync("closed");
    }
    catch (Exception error)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: closing a session failed: {error.Message}");
    }
  }

  private async Task<IHandleSession> OpenSessionAsync(string documentId, string requested, bool write, McpCaller caller, CancellationToken cancellationToken)
  {
    if (!await AllowedAsync(caller, documentId, write, cancellationToken))
    {
      throw McpHostError.Surface("FORBIDDEN", "You may not open this document with this access.");
    }
    var resolved = await bundle.CallAsync("mcpResolveMode", new JsonObject { ["requested"] = requested, ["sync"] = config.Live }, cancellationToken);

    if (resolved["error"] is JsonObject error)
    {
      throw new McpHostError(error);
    }
    if (McpJson.String(resolved["mode"]) == "live")
    {
      if (config.Rooms is { } rooms)
      {
        var surface = await SurfaceAsync(cancellationToken);

        return new RoomSession(
            bundle, rooms, documentId, write, flags, caller.Actor,
            McpJson.String(surface["contractRevision"]?["live"]) ?? string.Empty,
            surface["liveUnavailableCommands"] as JsonArray);
      }
      if (live is null)
      {
        throw McpHostError.Surface("INVALID_ARGS", "Live mode needs blok-mcp to run with --sync-url.");
      }

      return await live.OpenAsync(documentId, write, caller, cancellationToken);
    }
    if (source is null)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "No document source is configured. Start blok-mcp with --source.");
    }
    var revision = McpJson.String((await SurfaceAsync(cancellationToken))["contractRevision"]?["stored"]) ?? string.Empty;

    return await StoredSession.OpenAsync(bundle, source, documentId, write, flags, caller.Actor, revision, pages, uploads, cancellationToken);
  }

  private void TrackPageClose(Task closing)
  {
    Track(pageCloses, closing);
  }

  // The opener's createPage for stored mode: a new id, authorized like a write open, saved empty.
  private async Task<string> CreatePageAsync(McpCaller caller, CancellationToken cancellationToken)
  {
    var pageId = PageIds.Mint();

    try
    {
      if (!await AllowedAsync(caller, pageId, true, cancellationToken))
      {
        throw McpHostError.Surface("FORBIDDEN", "You may not create a page document here.");
      }
      var loaded = await source!.LoadAsync(pageId, cancellationToken);

      // The endpoint source saves without a version check, so this is its only guard against an overwrite.
      if (!loaded.Missing)
      {
        throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The new page id is taken. Try again.");
      }
      var text = await bundle.CallAsync("mcpDocumentText", new JsonObject { ["document"] = new JsonObject { ["blocks"] = new JsonArray() }, ["form"] = source.DocumentTextForm }, cancellationToken);

      await source.SaveAsync(pageId, McpJson.String(text["text"])!, loaded.Version, cancellationToken);

      return pageId;
    }
    catch (McpHostError error)
    {
      // Node names the page in the refusal, keeping the error's own flag.
      throw error.WithDetail("pageId", pageId);
    }
  }

  // The opener's createLivePage: the join runs the ticket mint and the service's own authorization, and loads the room.
  private async Task<string> CreateLivePageAsync(McpCaller caller, CancellationToken cancellationToken)
  {
    var pageId = PageIds.Mint();

    try
    {
      if (!await AllowedAsync(caller, pageId, true, cancellationToken))
      {
        throw McpHostError.Surface("FORBIDDEN", "You may not create a page document here.");
      }
      var session = await live!.OpenAsync(pageId, true, caller, cancellationToken);

      try
      {
        if (!await ((LiveSession)session).IsEmptyAsync())
        {
          throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The new page id is taken. Try again.");
        }
      }
      finally
      {
        // Awaited: this runs inside blok_execute, so nothing else waits for the socket to close.
        try
        {
          await session.CloseAsync("closed");
        }
        catch (Exception error)
        {
          await Console.Error.WriteLineAsync($"blok-mcp: closing a new page room failed: {error.Message}");
        }
      }

      return pageId;
    }
    catch (McpHostError error)
    {
      throw error.WithDetail("pageId", pageId);
    }
  }

  private async Task<JsonObject> CloseAsync(string handle, McpCaller caller)
  {
    // A refused or failed check still closes, so the handle does not keep its --max-handles slot.
    // An unknown handle fails again in remove. Remove waits for use, so it runs outside the callback.
    Exception? refusal = null;

    try
    {
      await handles.UseAsync(handle, caller.Principal, async (_, documentId) =>
      {
        await StillAllowedAsync(caller, documentId, false, CancellationToken.None);

        return true;
      });
    }
    catch (Exception error)
    {
      refusal = error;
    }
    var session = await handles.RemoveAsync(handle, caller.Principal);
    var summary = await session.CloseAsync("closed");

    if (refusal is not null)
    {
      System.Runtime.ExceptionServices.ExceptionDispatchInfo.Throw(refusal);
    }
    var answer = new JsonObject { ["closed"] = true };

    foreach (var (key, value) in summary)
    {
      answer[key] = value?.DeepClone();
    }

    return new JsonObject { ["structuredContent"] = answer, ["isError"] = false };
  }

  private async Task StillAllowedAsync(McpCaller caller, string documentId, bool write, CancellationToken cancellationToken)
  {
    if (!await AllowedAsync(caller, documentId, write, cancellationToken))
    {
      throw McpHostError.Surface("FORBIDDEN", "You no longer have access to this document.");
    }
  }

  private async Task<McpCallResult> OnHandleAsync(JsonObject step, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken)
  {
    var write = McpJson.Bool(step["write"]) == true;
    var call = (JsonObject)step["call"]!;

    return await handles.UseAsync(McpJson.String(step["handle"])!, caller.Principal, async (session, documentId) =>
    {
      await StillAllowedAsync(caller, documentId, write, cancellationToken);

      switch (McpJson.String(call["name"]))
      {
        case "blok_read":
          return Answer(await session.ReadAsync(call["view"], cancellationToken));
        case "blok_describe":
          return Answer(await session.DescribeAsync(call["query"], cancellationToken));
        default:
          var outcome = await session.ExecuteAsync(call["batch"], caller, approval, cancellationToken);

          return outcome.Ask is not null ? new McpCallResult(null, null, outcome.Ask) : Answer(outcome.Answer!);
      }
    });
  }
}

/// <summary>A call's place in its handle's order: the call before it, and its own turn.</summary>
internal sealed record Place(string Handle, Task Previous, TaskCompletionSource Mine);
