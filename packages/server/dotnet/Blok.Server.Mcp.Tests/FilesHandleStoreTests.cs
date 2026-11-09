using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Sources;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>--handle-store files:&lt;dir&gt;: the reference store, its locks and its privacy rules.</summary>
[System.Runtime.Versioning.UnsupportedOSPlatform("windows")]
public sealed class FilesHandleStoreTests : IDisposable
{
  private static readonly TimeSpan Idle = TimeSpan.FromMinutes(10);
  private readonly string root = Directory.CreateTempSubdirectory("blok-mcp-handle-store-").FullName;

  private string Dir => Path.Combine(root, "handles");

  public void Dispose()
  {
    Directory.Delete(root, recursive: true);
  }

  internal static BlokMcpHandleRecord Record(string principal = "alice", string documentId = "doc") => new()
  {
    ContractRevision = "rev",
    Principal = principal,
    ClientName = "desk",
    Actor = new JsonObject { ["id"] = $"agent:{principal}:desk", ["name"] = "desk", ["kind"] = "agent" },
    DocumentId = documentId,
    Write = true,
    Document = new JsonObject { ["blocks"] = new JsonArray() },
    History = new JsonObject(),
  };

  private static async Task<IBlokMcpHandleLease> LeaseAsync(FilesHandleStore store, string handle)
  {
    return (await store.AcquireAsync(handle, Idle, TimeSpan.FromSeconds(5), CancellationToken.None)).Lease
        ?? throw new InvalidOperationException("no lease");
  }

  [Fact]
  public void MakesTheDirectoryPrivate()
  {
    FilesHandleStore.Open(Dir);

    Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(Dir));
  }

  [Fact]
  public async Task WritesEveryFilePrivate()
  {
    var store = FilesHandleStore.Open(Dir);

    Assert.True(await store.TryAddAsync("h1", Record(), 8, Idle, CancellationToken.None));
    var lease = await LeaseAsync(store, "h1");

    Assert.All(Directory.GetFiles(Dir), path => Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path)));
    await lease.ReleaseAsync(CancellationToken.None);
  }

  [Theory]
  [InlineData(UnixFileMode.GroupWrite)]
  [InlineData(UnixFileMode.OtherRead)]
  [InlineData(UnixFileMode.GroupExecute)]
  public void RefusesADirectoryOthersCanReach(UnixFileMode extra)
  {
    Directory.CreateDirectory(Dir);
    File.SetUnixFileMode(Dir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | extra);

    var refused = Assert.Throws<BlokMcpConfigException>(() => FilesHandleStore.Open(Dir));

    Assert.Contains("chmod 700", refused.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("")]
  [InlineData("/")]
  public void RefusesALinkEvenWithATrailingSlash(string suffix)
  {
    var target = Path.Combine(root, "target");

    Directory.CreateDirectory(target, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    Directory.CreateSymbolicLink(Dir, target);

    Assert.Throws<BlokMcpConfigException>(() => FilesHandleStore.Open(Dir + suffix));
  }

  [Fact]
  public void RefusesAFile()
  {
    File.WriteAllText(Dir, "not a directory");

    Assert.Throws<BlokMcpConfigException>(() => FilesHandleStore.Open(Dir));
  }

  [Fact]
  public void LStatReadsTheEntrysOwnerModeAndKind()
  {
    var target = Path.Combine(root, "target");

    Directory.CreateDirectory(target, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    Directory.CreateSymbolicLink(Dir, target);

    var directory = NativePath.LStat(target);
    var link = NativePath.LStat(Dir);

    Assert.NotNull(directory);
    Assert.Equal(NativePath.EffectiveUserId(), directory.Value.Uid);
    Assert.Equal(NativePath.DirectoryKind, directory.Value.Mode & NativePath.KindMask);
    Assert.Equal(0b111_000_000, directory.Value.Mode & 0b111_111_111);
    Assert.Equal(NativePath.LinkKind, link!.Value.Mode & NativePath.KindMask);
    Assert.Null(NativePath.LStat(Path.Combine(root, "missing")));
  }

  [Theory]
  [InlineData(1000u, 1001u)]
  [InlineData(0u, 1001u)]
  public void RefusesADirectoryAnotherUserOwnsEvenForRoot(uint me, uint owner)
  {
    var refused = Assert.Throws<BlokMcpConfigException>(() => FilesHandleStore.Open(Dir, probe: new FilesHandleStore.Probe(
        path => NativePath.LStat(path) is { } real ? real with { Uid = owner } : null,
        () => me,
        Windows: false)));

    Assert.Contains("owned by this user", refused.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void IsRefusedOnWindows()
  {
    var refused = Assert.Throws<BlokMcpConfigException>(() => FilesHandleStore.Open(Dir, probe: new FilesHandleStore.Probe(NativePath.LStat, NativePath.EffectiveUserId, Windows: true)));

    Assert.Equal("--handle-store files: is not supported on Windows; use your own store", refused.Message);
    Assert.False(Directory.Exists(Dir));
  }

  [Fact]
  public async Task AddsCountsAndLeasesARecord()
  {
    var store = FilesHandleStore.Open(Dir);
    var record = Record();

    Assert.True(await store.TryAddAsync("h1", record, 8, Idle, CancellationToken.None));
    Assert.Equal(1, await store.CountAsync("alice", Idle, CancellationToken.None));
    Assert.Equal(0, await store.CountAsync("bob", Idle, CancellationToken.None));
    var lease = await LeaseAsync(store, "h1");

    Assert.Equal(record.ToJson(), lease.Record.ToJson());
    Assert.True((await store.AcquireAsync("h1", Idle, TimeSpan.FromMilliseconds(100), CancellationToken.None)).IsBusy);
    await lease.ReleaseAsync(CancellationToken.None);
    Assert.NotNull((await store.AcquireAsync("h1", Idle, TimeSpan.Zero, CancellationToken.None)).Lease);
  }

  [Fact]
  public async Task AnUnknownOrBadHandleIsUnknown()
  {
    var store = FilesHandleStore.Open(Dir);

    Assert.Same(BlokMcpHandleAcquisition.Unknown, await store.AcquireAsync("nope", Idle, TimeSpan.Zero, CancellationToken.None));
    Assert.Same(BlokMcpHandleAcquisition.Unknown, await store.AcquireAsync("../x", Idle, TimeSpan.Zero, CancellationToken.None));
  }

  [Fact]
  public async Task CountAndAddIsAtomicUnderConcurrentAdds()
  {
    var store = FilesHandleStore.Open(Dir);

    var added = await Task.WhenAll(Enumerable.Range(0, 12).Select(index => Task.Run(async () =>
        await store.TryAddAsync($"h{index}", Record(), 3, Idle, CancellationToken.None))));

    Assert.Equal(3, added.Count(ok => ok));
    Assert.Equal(3, await store.CountAsync("alice", Idle, CancellationToken.None));
  }

  [Fact]
  public async Task ALostLeaseCannotSaveOrRemove()
  {
    var store = FilesHandleStore.Open(Dir, leaseStale: TimeSpan.FromMilliseconds(200));

    await store.TryAddAsync("h1", Record(), 8, Idle, CancellationToken.None);
    var first = await LeaseAsync(store, "h1");

    await Task.Delay(400);
    // The first holder looks dead: a second one takes the lease over.
    var second = await LeaseAsync(store, "h1");

    await Assert.ThrowsAsync<IOException>(async () => await first.SaveAsync(Record(documentId: "changed"), CancellationToken.None));
    await Assert.ThrowsAsync<IOException>(async () => await first.RemoveAsync(CancellationToken.None));
    await Assert.ThrowsAsync<IOException>(async () => await first.RenewAsync(CancellationToken.None));
    await first.ReleaseAsync(CancellationToken.None);
    Assert.Equal("doc", second.Record.DocumentId);
    await second.ReleaseAsync(CancellationToken.None);
    Assert.Equal("doc", (await LeaseAsync(store, "h1")).Record.DocumentId);
  }

  [Fact]
  public async Task ARenewedLeaseIsNotTakenOverPastTheStaleTime()
  {
    var store = FilesHandleStore.Open(Dir, leaseStale: TimeSpan.FromMilliseconds(400));

    await store.TryAddAsync("h1", Record(), 8, Idle, CancellationToken.None);
    var first = await LeaseAsync(store, "h1");

    for (var step = 0; step < 8; step++)
    {
      await Task.Delay(100);
      await first.RenewAsync(CancellationToken.None);
    }

    Assert.True((await store.AcquireAsync("h1", Idle, TimeSpan.FromMilliseconds(100), CancellationToken.None)).IsBusy);
    await first.SaveAsync(Record(documentId: "saved"), CancellationToken.None);
    await first.ReleaseAsync(CancellationToken.None);
  }

  [Fact]
  public async Task AnUnrenewedLeaseGoesStaleOnItsOwn()
  {
    var store = FilesHandleStore.Open(Dir, leaseStale: TimeSpan.FromMilliseconds(200));

    await store.TryAddAsync("h1", Record(), 8, Idle, CancellationToken.None);
    var first = await LeaseAsync(store, "h1");

    await Task.Delay(400);

    // The store has no timer of its own: without Blok's renew the lease is taken over.
    Assert.NotNull((await store.AcquireAsync("h1", Idle, TimeSpan.FromMilliseconds(100), CancellationToken.None)).Lease);
    await first.ReleaseAsync(CancellationToken.None);
  }

  [Fact]
  public async Task SweepDeletesOnlyIdleRecordsNobodyLeases()
  {
    var store = FilesHandleStore.Open(Dir);

    await store.TryAddAsync("idle", Record(), 8, Idle, CancellationToken.None);
    await store.TryAddAsync("leased", Record(), 8, Idle, CancellationToken.None);
    await Task.Delay(300);
    await store.TryAddAsync("fresh", Record(), 8, Idle, CancellationToken.None);
    var held = await LeaseAsync(store, "leased");

    await store.SweepAsync(TimeSpan.FromMilliseconds(200), CancellationToken.None);

    Assert.Same(BlokMcpHandleAcquisition.Unknown, await store.AcquireAsync("idle", Idle, TimeSpan.Zero, CancellationToken.None));
    Assert.True(File.Exists(Path.Combine(Dir, "leased.record.json")));
    Assert.NotNull((await store.AcquireAsync("fresh", Idle, TimeSpan.Zero, CancellationToken.None)).Lease);
    await held.ReleaseAsync(CancellationToken.None);
  }

  [Fact]
  public async Task AnExpiredHandleIsUnknownAndNoLongerCounts()
  {
    var store = FilesHandleStore.Open(Dir);

    await store.TryAddAsync("h1", Record(), 8, Idle, CancellationToken.None);
    await Task.Delay(300);

    Assert.Equal(0, await store.CountAsync("alice", TimeSpan.FromMilliseconds(200), CancellationToken.None));
    Assert.Same(BlokMcpHandleAcquisition.Unknown, await store.AcquireAsync("h1", TimeSpan.FromMilliseconds(200), TimeSpan.Zero, CancellationToken.None));
  }

  [Fact]
  public async Task RemoveForgetsTheHandle()
  {
    var store = FilesHandleStore.Open(Dir);

    await store.TryAddAsync("h1", Record(), 8, Idle, CancellationToken.None);
    var lease = await LeaseAsync(store, "h1");

    await lease.RemoveAsync(CancellationToken.None);

    Assert.Same(BlokMcpHandleAcquisition.Unknown, await store.AcquireAsync("h1", Idle, TimeSpan.Zero, CancellationToken.None));
    Assert.Empty(Directory.GetFiles(Dir, "h1.*"));
  }

  [Fact]
  public void ARecordRoundTripsThroughJsonKeepingNullAndEmptyScopesApart()
  {
    var none = Record();
    var empty = new BlokMcpHandleRecord
    {
      ContractRevision = "rev",
      Principal = "alice",
      ClientName = "desk",
      Scopes = [],
      Actor = new JsonObject { ["id"] = "a" },
      DocumentId = "doc",
      Document = new JsonObject { ["blocks"] = new JsonArray() },
      History = new JsonObject(),
      Version = "v1",
      Stale = true,
    };

    Assert.Null(BlokMcpHandleRecord.FromJson(none.ToJson()).Scopes);
    Assert.Empty(BlokMcpHandleRecord.FromJson(empty.ToJson()).Scopes!);
    Assert.Equal(empty.ToJson(), BlokMcpHandleRecord.FromJson(empty.ToJson()).ToJson());
    Assert.StartsWith("""{"v":1,"contractRevision":"rev","principal":"alice","clientName":"desk","scopes":null,""", none.ToJson(), StringComparison.Ordinal);
  }
}
