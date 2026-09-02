using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class LocalCollabStoreTests : IDisposable
{
  private const string DocId = "doc-1";
  private const string DocKeyHex =
      "bb0e4f49443794d901e8969ff11bd112e34208a0dcdf0e1eedb480cc9b3c7293";
  private static readonly CollabWorkingSetTag Tag = Tags.At(3);

  private readonly string directory = Path.Combine(
      Path.GetTempPath(),
      $"blok-collab-store-{Guid.NewGuid():N}");
  private readonly List<string> logs = [];

  public void Dispose()
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  [Fact]
  public async Task ReadsAbsentAsNull()
  {
    var store = CreateStore();

    Assert.Null(await store.ReadAsync(DocId, CancellationToken.None));
    Assert.Empty(logs);
  }

  [Fact]
  public async Task WritesThenReadsBackTheWorkingSet()
  {
    var store = CreateStore();
    var updates = Frames([0x01, 0x02], [0x03]);

    await store.WriteAsync(DocId, updates, Tag, CancellationToken.None);

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(updates, stored.Updates);
    Assert.Equal(Tag, stored.Tag);
    var file = Assert.Single(Directory.GetFiles(directory));
    Assert.Equal(DocKeyHex, Path.GetFileName(file));
  }

  [Fact]
  public async Task OverwritesThePreviousWorkingSet()
  {
    var store = CreateStore();
    await store.WriteAsync(
        DocId,
        Frames([0x01]),
        Tag,
        CancellationToken.None);

    var replacement = Frames([0x0a], [0x0b]);
    await store.WriteAsync(
        DocId,
        replacement,
        Tag,
        CancellationToken.None);

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(replacement, stored.Updates);
    Assert.Single(Directory.GetFiles(directory));
  }

  [Fact]
  public async Task ResetRewritesToAnEmptyLogWithTheNewTag()
  {
    var store = CreateStore();
    await store.WriteAsync(
        DocId,
        Frames([0x01]),
        Tag,
        CancellationToken.None);

    var bumped = Tag with { Epoch = Tag.Epoch + 1 };
    await store.ResetAsync(DocId, bumped, CancellationToken.None);

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Empty(stored.Updates);
    Assert.Equal(bumped, stored.Tag);
  }

  [Fact]
  public async Task WriteRefusesToLowerTheEpoch()
  {
    var store = CreateStore();
    var updates = Frames([0x01]);
    await store.WriteAsync(DocId, updates, Tag, CancellationToken.None);

    await Assert.ThrowsAsync<InvalidOperationException>(() =>
        store.WriteAsync(
            DocId,
            Frames([0x02]),
            Tag with { Epoch = Tag.Epoch - 1 },
            CancellationToken.None));

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(updates, stored.Updates);
    Assert.Equal(Tag, stored.Tag);
  }

  [Fact]
  public async Task WriteKeepsTheEpochForOrdinaryAppends()
  {
    var store = CreateStore();
    await store.WriteAsync(
        DocId,
        Frames([0x01]),
        Tag,
        CancellationToken.None);

    var appended = Frames([0x01], [0x02]);
    await store.WriteAsync(DocId, appended, Tag, CancellationToken.None);

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(appended, stored.Updates);
  }

  [Fact]
  public async Task ResetRequiresAStrictlyHigherEpoch()
  {
    var store = CreateStore();
    await store.WriteAsync(
        DocId,
        Frames([0x01]),
        Tag,
        CancellationToken.None);

    await Assert.ThrowsAsync<InvalidOperationException>(() =>
        store.ResetAsync(DocId, Tag, CancellationToken.None));
  }

  [Fact]
  public async Task TreatsACorruptFileAsAbsentAndLogsIt()
  {
    var store = CreateStore();
    Directory.CreateDirectory(directory);
    await File.WriteAllBytesAsync(
        Path.Combine(directory, DocKeyHex),
        "not a working set"u8.ToArray(),
        CancellationToken.None);

    Assert.Null(await store.ReadAsync(DocId, CancellationToken.None));
    Assert.Contains(logs, entry => entry.Contains(DocId));

    // The epoch is lost with the file, so any epoch may re-seed it.
    await store.WriteAsync(
        DocId,
        Frames([0x01]),
        Tag with { Epoch = 0 },
        CancellationToken.None);
    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(0, stored.Tag.Epoch);
  }

  /// <summary>
  /// An intact header over corrupt frames read as absent yet still enforced
  /// its epoch on the next write (the guard reads only the header), so the
  /// doc could never be re-seeded: every join failed closed and a reset
  /// could not raise the epoch either.
  /// </summary>
  [Fact]
  public async Task MovesAnUnreadableFileAsideSoTheEpochGuardSeesNothing()
  {
    var store = CreateStore();
    await store.WriteAsync(DocId, Frames([0x01]), Tag, CancellationToken.None);
    var path = Path.Combine(directory, DocKeyHex);
    var written = await File.ReadAllBytesAsync(path);
    byte[] corrupt = [.. written[..CollabWorkingSetCodec.HeaderLength], 0xff, 0xff, 0xff];
    await File.WriteAllBytesAsync(path, corrupt);

    Assert.Null(await store.ReadAsync(DocId, CancellationToken.None));

    Assert.False(File.Exists(path));
    var aside = Assert.Single(Directory.GetFiles(directory));
    Assert.StartsWith(DocKeyHex + ".unreadable-", Path.GetFileName(aside), StringComparison.Ordinal);
    Assert.Equal(corrupt, await File.ReadAllBytesAsync(aside));
    Assert.Contains(logs, entry => entry.Contains(Path.GetFileName(aside), StringComparison.Ordinal));

    await store.WriteAsync(DocId, Frames([0x02]), Tag with { Epoch = 0 }, CancellationToken.None);
    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(0, stored.Tag.Epoch);
  }

  [Fact]
  public void SweepsStaleTemporaryFilesAtStartupAndKeepsTheRest()
  {
    Directory.CreateDirectory(directory);
    var stale = Path.Combine(directory, ".blok-collab-stale");
    var fresh = Path.Combine(directory, ".blok-collab-fresh");
    var stored = Path.Combine(directory, DocKeyHex);
    File.WriteAllBytes(stale, [1]);
    File.SetLastWriteTimeUtc(stale, DateTime.UtcNow - TimeSpan.FromMinutes(2));
    File.WriteAllBytes(fresh, [1]);
    File.WriteAllBytes(stored, [1]);
    File.SetLastWriteTimeUtc(stored, DateTime.UtcNow - TimeSpan.FromMinutes(2));

    CreateStore();

    Assert.False(File.Exists(stale));
    Assert.True(File.Exists(fresh));
    Assert.True(File.Exists(stored));
  }

  [Fact]
  public async Task CleansUpTheTempFileWhenTheRenameFails()
  {
    var store = CreateStore();
    Directory.CreateDirectory(Path.Combine(directory, DocKeyHex));

    await Assert.ThrowsAnyAsync<IOException>(() =>
        store.WriteAsync(
            DocId,
            Frames([0x01]),
            Tag,
            CancellationToken.None));

    Assert.Empty(Directory.GetFiles(directory));
    Assert.True(Directory.Exists(Path.Combine(directory, DocKeyHex)));
  }

  [Fact]
  public async Task RefusesInvalidUpdatesBeforeTouchingTheDisk()
  {
    var store = CreateStore();
    var updates = Frames([0x01]);
    await store.WriteAsync(DocId, updates, Tag, CancellationToken.None);

    await Assert.ThrowsAsync<ArgumentException>(() =>
        store.WriteAsync(
            DocId,
            [0x01, 0x02],
            Tag,
            CancellationToken.None));

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(updates, stored.Updates);
  }

  [Fact]
  public async Task KeepsTheWorkingSetPrivateOnUnix()
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    var store = CreateStore();
    await store.WriteAsync(
        DocId,
        Frames([0x01]),
        Tag,
        CancellationToken.None);

    // The working set is never served, unlike LocalBlobStore's uploads —
    // no group/other bits.
    Assert.Equal(
        UnixFileMode.UserRead | UnixFileMode.UserWrite,
        File.GetUnixFileMode(Path.Combine(directory, DocKeyHex)));
    Assert.Equal(
        UnixFileMode.UserRead |
        UnixFileMode.UserWrite |
        UnixFileMode.UserExecute,
        File.GetUnixFileMode(directory));
  }

  private LocalCollabStore CreateStore()
  {
    return new LocalCollabStore(directory, logs.Add);
  }

  private static byte[] Frames(params byte[][] updates)
  {
    return CollabWorkingSetCodec.EncodeFrames(updates);
  }
}
