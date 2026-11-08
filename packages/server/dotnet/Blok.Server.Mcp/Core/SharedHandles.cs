namespace Blok.Server.Mcp.Core;

/// <summary>What the core needs from where handles live: this process (<see cref="LocalHandles"/>) or a shared store (<see cref="SharedHandles"/>).</summary>
internal interface IHandleTable
{
  Task AssertRoomAsync(string principal);

  Task<string> AddAsync(string principal, string documentId, IHandleSession session);

  Task<T> UseAsync<T>(string handle, string principal, Func<IHandleSession, string, Task<T>> run);

  /// <summary>As UseAsync, without the session: blok_close checks access this way, so a handle that cannot be rebuilt still closes.</summary>
  Task PeekAsync(string handle, string principal, Func<string, Task> run);

  /// <summary>Forgets the handle once its calls are done; the session returned is closed by the caller.</summary>
  Task<IHandleSession> RemoveAsync(string handle, string principal);

  Task SweepAsync();

  Task CloseAllAsync(Func<IHandleSession, Task> close);
}

/// <summary>Today's table: every handle in this process's <see cref="HandleRegistry{TSession}"/>.</summary>
internal sealed class LocalHandles(HandleRegistry<IHandleSession> registry) : IHandleTable
{
  internal HandleRegistry<IHandleSession> Registry => registry;

  public Task AssertRoomAsync(string principal)
  {
    registry.AssertRoom(principal);

    return Task.CompletedTask;
  }

  public Task<string> AddAsync(string principal, string documentId, IHandleSession session)
  {
    return Task.FromResult(registry.Add(principal, documentId, session));
  }

  public Task<T> UseAsync<T>(string handle, string principal, Func<IHandleSession, string, Task<T>> run)
  {
    return registry.UseAsync(handle, principal, run);
  }

  public Task PeekAsync(string handle, string principal, Func<string, Task> run)
  {
    return registry.UseAsync(handle, principal, async (_, documentId) =>
    {
      await run(documentId);

      return true;
    });
  }

  public Task<IHandleSession> RemoveAsync(string handle, string principal)
  {
    return registry.RemoveAsync(handle, principal);
  }

  public Task SweepAsync()
  {
    return registry.SweepAsync();
  }

  public Task CloseAllAsync(Func<IHandleSession, Task> close)
  {
    return registry.CloseAllAsync(close);
  }
}

/// <summary>
/// Stored handles in a host's store, so any replica sharing it serves any call (shared-handles.ts).
/// Per call: take the lease, rebuild the session from the record, run it (the source save happens
/// here), save the record if it changed, release. A record that cannot be saved after the source
/// save is removed: the answer stands, and the next call answers UNKNOWN_HANDLE. Calls on one
/// handle keep their arrival order in this process; across replicas the lease runs them one at a
/// time. Live handles hold sockets, so they stay in this process. Stop waits for this process's
/// calls and never touches the store.
/// </summary>
internal sealed partial class SharedHandles : IHandleTable
{
  /// <summary>Handles reach a host's store as keys or file names, so only Blok's own shape gets that far.</summary>
  [System.Text.RegularExpressions.GeneratedRegex("^[A-Za-z0-9_-]{1,128}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant)]
  internal static partial System.Text.RegularExpressions.Regex HandlePattern();

  // Above the slowest stored call (a 30 s endpoint load); a longer wait is better told to retry.
  internal static readonly TimeSpan LeaseWait = TimeSpan.FromSeconds(30);
  // How often the store is swept of idle handles.
  internal static readonly TimeSpan StoreSweep = TimeSpan.FromSeconds(60);
  private const string StoreDown = "The handle store is unavailable. Retry shortly.";

  private readonly HandleRegistry<IHandleSession> local;
  private readonly IBlokMcpHandleStore store;
  private readonly TimeSpan idle;
  private readonly double maxPerPrincipal;
  private readonly Func<Task<string>> contractRevision;
  private readonly Func<BlokMcpHandleRecord, Task<IHandleSession>> restore;
  private readonly Action<string, Exception> log;
  private readonly Func<string> newHandle;
  private readonly Dictionary<string, Task> turns = new(StringComparer.Ordinal);
  private readonly HashSet<Task> inFlight = [];
  private volatile bool closed;

  internal SharedHandles(
      HandleRegistry<IHandleSession> local,
      IBlokMcpHandleStore store,
      TimeSpan idle,
      double maxPerPrincipal,
      Func<Task<string>> contractRevision,
      Func<BlokMcpHandleRecord, Task<IHandleSession>> restore,
      Action<string, Exception> log,
      Func<string>? newHandle = null)
  {
    this.local = local;
    this.store = store;
    this.idle = idle;
    this.maxPerPrincipal = maxPerPrincipal;
    this.contractRevision = contractRevision;
    this.restore = restore;
    this.log = log;
    this.newHandle = newHandle ?? HandleRegistry<IHandleSession>.NewHandleId;
  }

  internal TimeSpan Wait { get; init; } = LeaseWait;

  // Well inside the 30 s a store may keep an unrenewed lease, so a few missed renewals do not lose it.
  internal TimeSpan RenewEvery { get; init; } = TimeSpan.FromSeconds(5);

  public async Task AssertRoomAsync(string principal)
  {
    if (closed)
    {
      throw HandleRegistry<IHandleSession>.ShuttingDown();
    }
    var stored = await ViaStoreAsync(() => store.CountAsync(principal, idle, CancellationToken.None).AsTask());

    if (stored + local.Count(principal) >= maxPerPrincipal)
    {
      throw HandleRegistry<IHandleSession>.HandleLimit(maxPerPrincipal);
    }
  }

  public async Task<string> AddAsync(string principal, string documentId, IHandleSession session)
  {
    if (session is not StoredSession stored)
    {
      await AssertRoomAsync(principal);

      return local.Add(principal, documentId, session);
    }
    if (closed)
    {
      throw HandleRegistry<IHandleSession>.ShuttingDown();
    }
    var handle = newHandle();
    var room = (int)Math.Min(int.MaxValue, maxPerPrincipal - local.Count(principal));
    var record = stored.Snapshot();

    if (!await ViaStoreAsync(() => store.TryAddAsync(handle, record, room, idle, CancellationToken.None).AsTask()))
    {
      throw HandleRegistry<IHandleSession>.HandleLimit(maxPerPrincipal);
    }

    return handle;
  }

  public Task<T> UseAsync<T>(string handle, string principal, Func<IHandleSession, string, Task<T>> run)
  {
    if (local.Has(handle))
    {
      return local.UseAsync(handle, principal, run);
    }

    return LeasedAsync(handle, principal, async lease =>
    {
      var record = lease.Record;

      if (record.ContractRevision != await contractRevision())
      {
        throw McpHostError.Surface("VERSION_SKEW", "This handle was opened on a server with another tool contract. Call blok_open again.");
      }
      var session = await restore(record);
      var before = ((StoredSession)session).Snapshot().ToJson();

      try
      {
        return await run(session, record.DocumentId);
      }
      finally
      {
        await KeepAsync(lease, (StoredSession)session, before);
      }
    });
  }

  public Task PeekAsync(string handle, string principal, Func<string, Task> run)
  {
    if (local.Has(handle))
    {
      return local.UseAsync(handle, principal, async (_, documentId) =>
      {
        await run(documentId);

        return true;
      });
    }

    return LeasedAsync(handle, principal, async lease =>
    {
      await run(lease.Record.DocumentId);

      return true;
    });
  }

  public async Task<IHandleSession> RemoveAsync(string handle, string principal)
  {
    if (local.Has(handle))
    {
      return await local.RemoveAsync(handle, principal);
    }
    await LeasedAsync(handle, principal, async lease =>
    {
      await ViaStoreAsync(async () =>
      {
        await lease.RemoveAsync(CancellationToken.None);

        return true;
      });

      return true;
    });

    return Closed.Instance;
  }

  public async Task SweepAsync()
  {
    await local.SweepAsync();
  }

  /// <summary>The store's own expiry, on its own timer. A failure is logged; the next sweep tries again.</summary>
  internal async Task SweepStoreAsync()
  {
    try
    {
      await store.SweepAsync(idle, CancellationToken.None);
    }
    catch (Exception error)
    {
      log("blok-mcp: sweeping the handle store failed", error);
    }
  }

  public async Task CloseAllAsync(Func<IHandleSession, Task> close)
  {
    closed = true;
    Task[] pending;

    lock (inFlight)
    {
      pending = [.. inFlight];
    }
    await Task.WhenAll(local.CloseAllAsync(close), Task.WhenAll(pending.Select(task => task.ContinueWith(_ => { }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default))));
  }

  // Runs run under the handle's lease, after this process's earlier calls on it, for its owner only.
  private Task<T> LeasedAsync<T>(string handle, string principal, Func<IBlokMcpHandleLease, Task<T>> run)
  {
    // A client's handle string never reaches the store unless it could be one Blok minted.
    if (!HandlePattern().IsMatch(handle))
    {
      return Task.FromException<T>(HandleRegistry<IHandleSession>.UnknownHandle());
    }
    Task previous;
    var mine = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

    lock (turns)
    {
      previous = turns.GetValueOrDefault(handle) ?? Task.CompletedTask;
      turns[handle] = mine.Task;
    }
    lock (inFlight)
    {
      inFlight.Add(mine.Task);
    }
    // The next call on this handle may now take its place after this one.
    HandleArrival.Joined();

    return InTurnAsync(handle, principal, previous, mine, run);
  }

  private async Task<T> InTurnAsync<T>(string handle, string principal, Task previous, TaskCompletionSource mine, Func<IBlokMcpHandleLease, Task<T>> run)
  {
    try
    {
      await previous;
      var acquired = await ViaStoreAsync(() => store.AcquireAsync(handle, idle, Wait, CancellationToken.None).AsTask());

      if (acquired.Lease is not { } lease)
      {
        throw acquired.IsBusy
            ? McpHostError.Surface("SOURCE_UNAVAILABLE", "Another call is using this handle. Retry shortly.")
            : HandleRegistry<IHandleSession>.UnknownHandle();
      }
      // A lost lease shows again when the call saves or removes: the store refuses those.
      var renewer = new Timer(_ => _ = RenewAsync(lease), null, RenewEvery, RenewEvery);

      try
      {
        // Checked here, not by the store: a store bug must not hand one user's handle to another.
        if (lease.Record.V != 1 || lease.Record.Principal != principal)
        {
          throw HandleRegistry<IHandleSession>.UnknownHandle();
        }

        return await run(lease);
      }
      finally
      {
        await renewer.DisposeAsync();
        try
        {
          await lease.ReleaseAsync(CancellationToken.None);
        }
        catch (Exception error)
        {
          log("blok-mcp: releasing a handle lease failed", error);
        }
      }
    }
    finally
    {
      lock (turns)
      {
        if (turns.GetValueOrDefault(handle) == mine.Task)
        {
          turns.Remove(handle);
        }
      }
      mine.TrySetResult();
      lock (inFlight)
      {
        inFlight.Remove(mine.Task);
      }
    }
  }

  private async Task RenewAsync(IBlokMcpHandleLease lease)
  {
    try
    {
      await lease.RenewAsync(CancellationToken.None);
    }
    catch (Exception error)
    {
      log("blok-mcp: renewing a handle lease failed", error);
    }
  }

  private async Task KeepAsync(IBlokMcpHandleLease lease, StoredSession session, string before)
  {
    var after = session.Snapshot();

    if (after.ToJson() == before)
    {
      return;
    }
    try
    {
      await lease.SaveAsync(after, CancellationToken.None);
    }
    catch (Exception error)
    {
      // The source already has the work; a record left behind would save with an old version.
      log("blok-mcp: saving a handle to the handle store failed, so the handle is closed", error);
      try
      {
        await lease.RemoveAsync(CancellationToken.None);
      }
      catch (Exception removing)
      {
        log("blok-mcp: removing a handle from the handle store failed", removing);
      }
    }
  }

  private async Task<T> ViaStoreAsync<T>(Func<Task<T>> call)
  {
    try
    {
      return await call();
    }
    catch (Exception error)
    {
      log("blok-mcp: the handle store failed", error);

      throw McpHostError.Surface("SOURCE_UNAVAILABLE", StoreDown);
    }
  }

  /// <summary>What a removed shared handle closes: nothing is left in this process.</summary>
  private sealed class Closed : IHandleSession
  {
    internal static readonly Closed Instance = new();

    public System.Text.Json.Nodes.JsonObject Describe() => throw new InvalidOperationException("A removed handle has no session.");

    public Task<System.Text.Json.Nodes.JsonObject> ReadAsync(System.Text.Json.Nodes.JsonNode? view, CancellationToken cancellationToken) => throw new InvalidOperationException("A removed handle has no session.");

    public Task<System.Text.Json.Nodes.JsonObject> DescribeAsync(System.Text.Json.Nodes.JsonNode? query, CancellationToken cancellationToken) => throw new InvalidOperationException("A removed handle has no session.");

    public Task<McpExecuteOutcome> ExecuteAsync(System.Text.Json.Nodes.JsonNode? batch, McpCaller caller, McpApproval? approval, CancellationToken cancellationToken) => throw new InvalidOperationException("A removed handle has no session.");

    public Task<System.Text.Json.Nodes.JsonObject> CloseAsync(string reason) =>
        Task.FromResult(new System.Text.Json.Nodes.JsonObject { ["unsavedBatches"] = 0, ["hostRecordLags"] = false });
  }
}
