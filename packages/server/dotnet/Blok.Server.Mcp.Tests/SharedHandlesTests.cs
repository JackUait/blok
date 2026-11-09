using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>BlokMcpOptions.HandleStore: stored handles shared by servers through a host's store.</summary>
public sealed class SharedHandlesTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-shared-").FullName;
  private readonly BundleFixture fixture;
  private readonly List<(string Message, Exception Error)> logged = [];

  public SharedHandlesTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private McpServerCore Core(IBlokMcpHandleStore store, string? pageTitles = null, double maxHandles = 8, McpBundle? bundle = null)
  {
    return new McpServerCore(bundle ?? fixture.Host.Bundle, new McpConfig
    {
      Source = new McpSourceConfig.Files(dir),
      HandleStore = store,
      PageTitles = pageTitles,
      MaxHandlesPerPrincipal = maxHandles,
      LogError = (message, error) => logged.Add((message, error)),
    }, new McpHttpCaller());
  }

  private static async Task<JsonObject> CallAsync(McpServerCore core, McpCaller caller, string name, JsonObject arguments)
  {
    var outcome = await core.CallToolAsync(name, arguments, caller, null, CancellationToken.None);

    return (JsonObject)outcome.Answer!["structuredContent"]!;
  }

  private static async Task<string> OpenAsync(McpServerCore core, McpCaller caller)
  {
    var opened = await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true });

    return McpJson.String(opened["handle"]) ?? throw new InvalidOperationException(opened.ToJsonString());
  }

  private static Task<JsonObject> ExecuteAsync(McpServerCore core, McpCaller caller, string handle, string name, JsonObject args)
  {
    return CallAsync(core, caller, "blok_execute", new JsonObject
    {
      ["handle"] = handle,
      ["commands"] = new JsonArray(new JsonObject { ["name"] = name, ["args"] = args }),
    });
  }

  private static Task<JsonObject> SetTitleAsync(McpServerCore core, McpCaller caller, string handle, string title) =>
      ExecuteAsync(core, caller, handle, "doc.setTitle", new JsonObject { ["title"] = title });

  private static Task<JsonObject> UndoAsync(McpServerCore core, McpCaller caller, string handle) =>
      ExecuteAsync(core, caller, handle, "history.undo", new JsonObject());

  private string Saved() => File.ReadAllText(Path.Combine(dir, "doc.json"));

  private static string? Code(JsonObject answer) => McpJson.String(answer["error"]?["code"]);

  [Fact]
  public async Task AHandleOpenedOnOneServerIsUsedOnAnother()
  {
    var store = new MemoryStore();
    await using var a = Core(store);
    await using var b = Core(store);
    var caller = await a.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(a, caller);

    var ran = await SetTitleAsync(b, caller, handle, "From B");
    var undone = await UndoAsync(a, caller, handle);

    Assert.Equal(true, McpJson.Bool(ran["ok"]));
    Assert.Equal(true, McpJson.Bool(undone["ok"]));
    Assert.DoesNotContain("From B", Saved(), StringComparison.Ordinal);
  }

  [Fact]
  public async Task TheOpenersCallerIsKeptInTheRecord()
  {
    var store = new MemoryStore();
    await using var a = Core(store);
    await using var b = Core(store);
    var opener = await a.CallerAsync("alice", "desk", null, CancellationToken.None);
    var other = await b.CallerAsync("alice", "phone", null, CancellationToken.None);
    var handle = await OpenAsync(a, opener);

    await SetTitleAsync(b, other, handle, "Titled");

    Assert.Equal(McpJson.String(opener.Actor["id"]), McpJson.String(store.Records[handle].Actor["id"]));
    Assert.Equal("desk", store.Records[handle].ClientName);
  }

  [Fact]
  public async Task AStoreWriteThatFailsAfterTheSourceSaveAnswersTheBatchAndDropsTheHandle()
  {
    var store = new MemoryStore();
    await using var core = Core(store);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    store.FailNextSave = true;
    var ran = await SetTitleAsync(core, caller, handle, "Saved");
    var next = await CallAsync(core, caller, "blok_read", new JsonObject { ["handle"] = handle });

    Assert.Equal(true, McpJson.Bool(ran["ok"]));
    Assert.Contains("Saved", Saved(), StringComparison.Ordinal);
    Assert.Equal("UNKNOWN_HANDLE", Code(next));
    Assert.Contains(logged, entry => entry.Message.Contains("handle store", StringComparison.Ordinal));
  }

  [Fact]
  public async Task RestoredStepsMadeOnOtherContentAreLost()
  {
    var store = new MemoryStore();
    await using var core = Core(store);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    await SetTitleAsync(core, caller, handle, "First");
    // A record whose steps were made on other content: the bundle's revision check drops them.
    var record = store.Records[handle];
    var document = (JsonObject)record.Document.DeepClone();

    document["title"] = "Someone else";
    store.Records[handle] = new BlokMcpHandleRecord
    {
      ContractRevision = record.ContractRevision, Principal = record.Principal, ClientName = record.ClientName, Scopes = record.Scopes,
      Actor = record.Actor, DocumentId = record.DocumentId, Write = record.Write, Version = record.Version, Stale = record.Stale,
      Document = document, History = record.History,
    };
    var undone = await UndoAsync(core, caller, handle);

    Assert.Equal("CONFLICT", Code(undone));
  }

  [Fact]
  public async Task ARecordFromAnotherContractAnswersVersionSkew()
  {
    var store = new MemoryStore();
    await using var a = Core(store);
    await using var b = Core(store, pageTitles: "page-map");
    var caller = await a.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(a, caller);

    var read = await CallAsync(b, caller, "blok_read", new JsonObject { ["handle"] = handle });

    Assert.Equal("VERSION_SKEW", Code(read));
  }

  [Fact]
  public async Task AnotherPrincipalOrAnotherRecordFormatIsUnknown()
  {
    var store = new MemoryStore();
    await using var core = Core(store);
    var alice = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var bob = await core.CallerAsync("bob", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, alice);

    Assert.Equal("UNKNOWN_HANDLE", Code(await CallAsync(core, bob, "blok_read", new JsonObject { ["handle"] = handle })));
    var record = store.Records[handle];

    store.Records[handle] = new BlokMcpHandleRecord
    {
      V = 2, ContractRevision = record.ContractRevision, Principal = record.Principal, ClientName = record.ClientName,
      Actor = record.Actor, DocumentId = record.DocumentId, Document = record.Document, History = record.History,
    };
    Assert.Equal("UNKNOWN_HANDLE", Code(await CallAsync(core, alice, "blok_read", new JsonObject { ["handle"] = handle })));
  }

  [Fact]
  public async Task AHandleThatCouldNotBeBlokMintedNeverReachesTheStore()
  {
    var store = new MemoryStore();
    await using var core = Core(store);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);

    var read = await CallAsync(core, caller, "blok_read", new JsonObject { ["handle"] = "../etc" });

    Assert.Equal("UNKNOWN_HANDLE", Code(read));
    Assert.Equal(0, store.Acquires);
  }

  [Fact]
  public async Task AStoreThatThrowsAnswersSourceUnavailableAndIsLogged()
  {
    var store = new MemoryStore();
    await using var core = Core(store);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    store.Down = true;
    var read = await CallAsync(core, caller, "blok_read", new JsonObject { ["handle"] = handle });

    Assert.Equal("""{"code":"SOURCE_UNAVAILABLE","message":"The handle store is unavailable. Retry shortly.","retryable":true}""", read["error"]?.ToJsonString());
    Assert.Contains(logged, entry => entry.Error.Message == "store down");
  }

  [Fact]
  public async Task TheCapCountsHandlesInTheStore()
  {
    var store = new MemoryStore();
    await using var a = Core(store, maxHandles: 2);
    await using var b = Core(store, maxHandles: 2);
    var caller = await a.CallerAsync("alice", "desk", null, CancellationToken.None);

    await OpenAsync(a, caller);
    await OpenAsync(b, caller);
    var third = await CallAsync(a, caller, "blok_open", new JsonObject { ["documentId"] = "doc" });

    Assert.Equal("HANDLE_LIMIT", Code(third));
  }

  [Fact]
  public async Task CloseRemovesTheHandleForEveryServer()
  {
    var store = new MemoryStore();
    await using var a = Core(store);
    await using var b = Core(store);
    var caller = await a.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(a, caller);

    var closed = await CallAsync(b, caller, "blok_close", new JsonObject { ["handle"] = handle });

    Assert.Equal(true, McpJson.Bool(closed["closed"]));
    Assert.Equal("UNKNOWN_HANDLE", Code(await CallAsync(a, caller, "blok_read", new JsonObject { ["handle"] = handle })));
  }

  [Fact]
  public async Task StoppingAServerLeavesItsHandlesInTheStore()
  {
    var store = new MemoryStore();
    var a = Core(store);
    await using var b = Core(store);
    var caller = await a.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(a, caller);

    await a.DisposeAsync();
    var read = await CallAsync(b, caller, "blok_read", new JsonObject { ["handle"] = handle });

    Assert.Null(read["error"]);
  }

  [Fact]
  public async Task BlokRenewsTheLeaseWhileACallHoldsItAndStopsBeforeRelease()
  {
    var store = new MemoryStore();
    var shared = new SharedHandles(
        new HandleRegistry<IHandleSession>(600_000, 8, _ => Task.CompletedTask), store, TimeSpan.FromMinutes(10), 8,
        () => Task.FromResult("rev"), _ => throw new InvalidOperationException("not restored"), (message, error) => logged.Add((message, error)))
    {
      RenewEvery = TimeSpan.FromMilliseconds(40),
    };

    var record = new BlokMcpHandleRecord
    {
      ContractRevision = "rev", Principal = "alice", ClientName = "desk", Actor = new JsonObject { ["id"] = "agent:alice:desk" },
      DocumentId = "doc", Document = new JsonObject { ["blocks"] = new JsonArray() }, History = new JsonObject(),
    };

    await store.TryAddAsync("handle-1", record, 8, TimeSpan.FromMinutes(10), CancellationToken.None);
    store.FailRenews = true;
    await shared.PeekAsync("handle-1", "alice", _ => Task.Delay(300));
    var renewsAtRelease = store.RenewsAtRelease;

    await Task.Delay(200);

    Assert.True(renewsAtRelease >= 3, $"renewed {renewsAtRelease} times");
    Assert.Equal(renewsAtRelease, store.Renews);
    Assert.Contains(logged, entry => entry.Message.Contains("renew", StringComparison.Ordinal));
  }

  [Fact]
  public async Task AnOpenThatFailsAfterTheHandleWasAddedRemovesItFromTheStore()
  {
    var store = new MemoryStore();
    var runtime = new FaultyRuntime(fixture.Host.Bundle.Runtime) { Throws = (operation, _) => operation == "mcpOpenAnswer" };
    await using var core = Core(store, bundle: new McpBundle(runtime));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);

    await Assert.ThrowsAnyAsync<Exception>(() => core.CallToolAsync("blok_open", new JsonObject { ["documentId"] = "doc" }, caller, null, CancellationToken.None));

    Assert.Empty(store.Records);
    Assert.Equal(store.Acquires, store.Releases);
  }

  [Fact]
  public async Task ACorruptRecordIsAnUnknownHandle()
  {
    var storeDir = Path.Combine(dir, "store");
    await using var core = Core(FilesHandleStore.Open(storeDir));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    await File.WriteAllTextAsync(Path.Combine(storeDir, $"{handle}.record.json"), "{");
    var read = await CallAsync(core, caller, "blok_read", new JsonObject { ["handle"] = handle });

    Assert.Equal("UNKNOWN_HANDLE", Code(read));
    Assert.False(File.Exists(Path.Combine(storeDir, $"{handle}.lease")));
  }

  [Fact]
  public async Task TheLeaseIsReleasedEvenWhenRemovingTheHandleFails()
  {
    var store = new MemoryStore();
    await using var core = Core(store);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    store.FailRemoves = true;
    var closed = await CallAsync(core, caller, "blok_close", new JsonObject { ["handle"] = handle });
    store.FailNextSave = true;
    await SetTitleAsync(core, caller, handle, "Saved");

    Assert.Equal("SOURCE_UNAVAILABLE", Code(closed));
    Assert.Equal(store.Acquires, store.Releases);
  }

  private SharedHandles Shared(MemoryStore store, TimeSpan? renewEvery = null, TimeSpan? sweepTimeout = null)
  {
    return new SharedHandles(
        new HandleRegistry<IHandleSession>(600_000, 8, _ => Task.CompletedTask), store, TimeSpan.FromMinutes(10), 8,
        () => Task.FromResult("rev"), _ => throw new InvalidOperationException("not restored"), (message, error) =>
        {
          lock (logged)
          {
            logged.Add((message, error));
          }
        })
    {
      RenewEvery = renewEvery ?? TimeSpan.FromSeconds(5),
      SweepTimeout = sweepTimeout ?? TimeSpan.FromSeconds(30),
    };
  }

  [Fact]
  public async Task ARenewalInFlightEndsBeforeTheLeaseIsReleased()
  {
    var store = new MemoryStore { RenewTakes = TimeSpan.FromMilliseconds(150) };
    var shared = Shared(store, renewEvery: TimeSpan.FromMilliseconds(20));
    var record = new BlokMcpHandleRecord
    {
      ContractRevision = "rev", Principal = "alice", ClientName = "desk", Actor = new JsonObject { ["id"] = "agent:alice:desk" },
      DocumentId = "doc", Document = new JsonObject { ["blocks"] = new JsonArray() }, History = new JsonObject(),
    };

    await store.TryAddAsync("handle-1", record, 8, TimeSpan.FromMinutes(10), CancellationToken.None);
    await shared.PeekAsync("handle-1", "alice", _ => Task.Delay(100));

    Assert.True(store.Renews >= 1, "never renewed");
    Assert.Equal(0, store.RenewingAtRelease);
    Assert.Equal(1, store.MostRenewsAtOnce);
  }

  [Fact]
  public async Task AStoreSweepNeverOverlapsItselfAndTimesOut()
  {
    var store = new MemoryStore { Sweep = _ => Task.Delay(Timeout.Infinite, CancellationToken.None) };
    var shared = Shared(store, sweepTimeout: TimeSpan.FromMilliseconds(100));

    var first = shared.SweepStoreAsync();
    var second = shared.SweepStoreAsync();

    await second.WaitAsync(TimeSpan.FromSeconds(5));
    await first.WaitAsync(TimeSpan.FromSeconds(5));
    await shared.SweepStoreAsync().WaitAsync(TimeSpan.FromSeconds(5));

    // The store ignored the timeout and still runs, so no new sweep starts on top of it.
    Assert.Equal(1, store.Sweeps);
    Assert.Contains(logged, entry => entry.Message == "blok-mcp: sweeping the handle store timed out");
  }

  [Fact]
  public async Task StopCancelsAStoreSweepAndDoesNotWaitForIt()
  {
    var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var store = new MemoryStore
    {
      Sweep = async token =>
      {
        await using (token.Register(() => cancelled.TrySetResult()))
        {
          await Task.Delay(Timeout.Infinite, CancellationToken.None);
        }
      },
    };
    var shared = Shared(store);
    var sweep = shared.SweepStoreAsync();

    await shared.CloseAllAsync(_ => Task.CompletedTask).WaitAsync(TimeSpan.FromSeconds(5));
    await sweep.WaitAsync(TimeSpan.FromSeconds(5));
    await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));

    Assert.DoesNotContain(logged, entry => entry.Message.Contains("sweep", StringComparison.Ordinal));
  }

  /// <summary>The store contract in memory, with switches for faults.</summary>
  internal sealed class MemoryStore : IBlokMcpHandleStore
  {
    private readonly HashSet<string> leased = [];

    internal Dictionary<string, BlokMcpHandleRecord> Records { get; } = [];

    internal bool FailNextSave { get; set; }

    internal bool FailRenews { get; set; }

    internal int Renews { get; private set; }

    internal int RenewsAtRelease { get; private set; }

    internal bool Down { get; set; }

    internal int Acquires { get; private set; }

    internal int Releases { get; private set; }

    internal bool FailRemoves { get; set; }

    internal TimeSpan RenewTakes { get; set; }

    internal int RenewingAtRelease { get; private set; } = -1;

    internal int MostRenewsAtOnce { get; private set; }

    internal int Sweeps { get; private set; }

    internal Func<CancellationToken, Task>? Sweep { get; set; }

    private int renewing;

    public ValueTask<int> CountAsync(string principal, TimeSpan idleTimeout, CancellationToken cancellationToken)
    {
      ThrowIfDown();

      return ValueTask.FromResult(Records.Values.Count(record => record.Principal == principal));
    }

    public ValueTask<bool> TryAddAsync(string handle, BlokMcpHandleRecord record, int maxPerPrincipal, TimeSpan idleTimeout, CancellationToken cancellationToken)
    {
      ThrowIfDown();
      lock (leased)
      {
        if (Records.Values.Count(entry => entry.Principal == record.Principal) >= maxPerPrincipal)
        {
          return ValueTask.FromResult(false);
        }
        Records[handle] = BlokMcpHandleRecord.FromJson(record.ToJson());

        return ValueTask.FromResult(true);
      }
    }

    public async ValueTask<BlokMcpHandleAcquisition> AcquireAsync(string handle, TimeSpan idleTimeout, TimeSpan wait, CancellationToken cancellationToken)
    {
      ThrowIfDown();
      Acquires++;
      var deadline = DateTime.UtcNow + wait;

      while (true)
      {
        lock (leased)
        {
          if (!Records.TryGetValue(handle, out var record))
          {
            return BlokMcpHandleAcquisition.Unknown;
          }
          if (leased.Add(handle))
          {
            return BlokMcpHandleAcquisition.Leased(new Lease(this, handle, BlokMcpHandleRecord.FromJson(record.ToJson())));
          }
        }
        if (DateTime.UtcNow >= deadline)
        {
          return BlokMcpHandleAcquisition.Busy;
        }
        await Task.Delay(10, cancellationToken);
      }
    }

    public ValueTask SweepAsync(TimeSpan idleTimeout, CancellationToken cancellationToken)
    {
      Sweeps++;

      return Sweep is null ? ValueTask.CompletedTask : new ValueTask(Sweep(cancellationToken));
    }

    private void ThrowIfDown()
    {
      if (Down)
      {
        throw new IOException("store down");
      }
    }

    private sealed class Lease(MemoryStore store, string handle, BlokMcpHandleRecord record) : IBlokMcpHandleLease
    {
      public BlokMcpHandleRecord Record { get; } = record;

      public ValueTask SaveAsync(BlokMcpHandleRecord next, CancellationToken cancellationToken)
      {
        if (store.FailNextSave)
        {
          store.FailNextSave = false;
          throw new IOException("store write failed");
        }
        store.Records[handle] = BlokMcpHandleRecord.FromJson(next.ToJson());

        return ValueTask.CompletedTask;
      }

      public async ValueTask RenewAsync(CancellationToken cancellationToken)
      {
        var now = Interlocked.Increment(ref store.renewing);

        lock (store.leased)
        {
          store.Renews++;
          store.MostRenewsAtOnce = Math.Max(store.MostRenewsAtOnce, now);
        }
        try
        {
          await Task.Delay(store.RenewTakes, CancellationToken.None);
          if (store.FailRenews)
          {
            throw new IOException("renew refused");
          }
        }
        finally
        {
          Interlocked.Decrement(ref store.renewing);
        }
      }

      public ValueTask ReleaseAsync(CancellationToken cancellationToken)
      {
        lock (store.leased)
        {
          store.RenewsAtRelease = store.Renews;
          store.RenewingAtRelease = Volatile.Read(ref store.renewing);
          store.Releases++;
          store.leased.Remove(handle);
        }

        return ValueTask.CompletedTask;
      }

      public ValueTask RemoveAsync(CancellationToken cancellationToken)
      {
        if (store.FailRemoves)
        {
          throw new IOException("remove refused");
        }
        // The lease ends with the handle; Blok still calls ReleaseAsync, which counts.
        lock (store.leased)
        {
          store.Records.Remove(handle);
          store.leased.Remove(handle);
        }

        return ValueTask.CompletedTask;
      }
    }
  }
}
