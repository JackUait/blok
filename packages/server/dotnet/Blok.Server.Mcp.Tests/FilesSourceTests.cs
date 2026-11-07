using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Sources;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class BundleFixture
{
  internal BlokMcpHost Host { get; } = BlokMcpHost.CreateRuntime(1);
}

public sealed class FilesSourceTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-files-").FullName;
  private readonly FilesSource source;

  public FilesSourceTests(BundleFixture fixture)
  {
    source = new FilesSource(dir, fixture.Host.Bundle);
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private static string Sha256(byte[] bytes)
  {
    return Convert.ToHexStringLower(SHA256.HashData(bytes));
  }

  [Fact]
  public async Task SavesTheGivenTextAsRawUtf8AndVersionsItBySha256()
  {
    const string text = "{\n  \"title\": \"é <b> \u2028 \U0001F600\",\n  \"blocks\": []\n}\n";

    var version = await source.SaveAsync("doc", text, null, CancellationToken.None);
    var bytes = await File.ReadAllBytesAsync(Path.Combine(dir, "doc.json"));

    Assert.Equal(Encoding.UTF8.GetBytes(text), bytes);
    Assert.Equal(Sha256(bytes), version);
    Assert.Equal(version, (await source.LoadAsync("doc", CancellationToken.None)).Version);
  }

  [Fact]
  public async Task RefusesASaveWhenTheFileChangedSinceItWasRead()
  {
    await File.WriteAllTextAsync(Path.Combine(dir, "doc.json"), "{\"blocks\":[]}");

    var refused = await Assert.ThrowsAsync<McpHostError>(() => source.SaveAsync("doc", "{}\n", "stale", CancellationToken.None));

    Assert.Equal("DOCUMENT_CHANGED", refused.Code);
  }

  [Fact]
  public async Task SavesThroughASymlinkAndKeepsTheLink()
  {
    var target = Path.Combine(dir, "real.json");

    await File.WriteAllTextAsync(target, "{\"blocks\":[]}");
    File.CreateSymbolicLink(Path.Combine(dir, "alias.json"), "real.json");
    var loaded = await source.LoadAsync("alias", CancellationToken.None);

    await source.SaveAsync("alias", "{\"blocks\":[1]}\n", loaded.Version, CancellationToken.None);

    Assert.NotNull(new FileInfo(Path.Combine(dir, "alias.json")).LinkTarget);
    Assert.Equal("{\"blocks\":[1]}\n", await File.ReadAllTextAsync(target));
  }

  [Fact]
  public async Task RefusesALinkToAMissingFile()
  {
    File.CreateSymbolicLink(Path.Combine(dir, "gone.json"), "nowhere.json");

    var refused = await Assert.ThrowsAsync<McpHostError>(() => source.LoadAsync("gone", CancellationToken.None));

    Assert.Equal("SOURCE_UNAVAILABLE", refused.Code);
    Assert.Equal("gone.json is a link to a missing file.", refused.Message);
  }

  [Fact]
  public async Task WaitsForAFreshLockThenRefuses()
  {
    await File.WriteAllTextAsync(Path.Combine(dir, ".doc.json.lock"), string.Empty);
    var started = DateTime.UtcNow;

    var refused = await Assert.ThrowsAsync<McpHostError>(() => source.SaveAsync("doc", "{}\n", null, CancellationToken.None));

    Assert.Equal("doc.json is being saved by another process. Retry shortly.", refused.Message);
    Assert.True(DateTime.UtcNow - started >= TimeSpan.FromSeconds(1.9));
  }

  [Fact]
  public async Task TakesOverALockOlderThanThirtySeconds()
  {
    var lockPath = Path.Combine(dir, ".doc.json.lock");

    await File.WriteAllTextAsync(lockPath, string.Empty);
    File.SetLastWriteTimeUtc(lockPath, DateTime.UtcNow.AddSeconds(-31));

    await source.SaveAsync("doc", "{}\n", null, CancellationToken.None);

    Assert.False(File.Exists(lockPath));
  }

  [Fact]
  public async Task ReadsAnIdOnlyInItsOwnLetterCase()
  {
    await File.WriteAllTextAsync(Path.Combine(dir, "Doc.json"), "{\"blocks\":[]}");
    var caseInsensitive = File.Exists(Path.Combine(dir, "doc.json"));

    if (!caseInsensitive)
    {
      Assert.True((await source.LoadAsync("doc", CancellationToken.None)).Missing);

      return;
    }
    var refused = await Assert.ThrowsAsync<McpHostError>(() => source.LoadAsync("doc", CancellationToken.None));

    Assert.Equal("INVALID_ARGS", refused.Code);
    Assert.Equal("Doc.json already uses this name with different letter case. This disk ignores case, so the two ids cannot both exist.", refused.Message);
  }

  [Fact]
  public async Task ListsSafeIdsInUtf16OrderWithTitles()
  {
    await File.WriteAllTextAsync(Path.Combine(dir, "b.json"), "{\"title\":\"Beta\",\"blocks\":[]}");
    await File.WriteAllTextAsync(Path.Combine(dir, "a.json"), "{\"title\":\"Alpha\",\"blocks\":[]}");
    await File.WriteAllTextAsync(Path.Combine(dir, ".hidden.json"), "{}");

    var listing = await source.ListAsync(25, null, null, CancellationToken.None);

    Assert.Equal(
        """{"documents":[{"id":"a","title":"Alpha"},{"id":"b","title":"Beta"}],"nextCursor":null}""",
        listing.ToJsonString());
  }

  [Fact]
  public async Task LoadsAMissingDocumentAsEmpty()
  {
    var loaded = await source.LoadAsync("new", CancellationToken.None);

    Assert.True(loaded.Missing);
    Assert.Null(loaded.Version);
    Assert.Equal("""{"blocks":[]}""", loaded.Raw.ToJsonString());
  }

  [Fact]
  public async Task RefusesAnUnsafeIdBeforeTouchingTheDisk()
  {
    var refused = await Assert.ThrowsAsync<McpHostError>(() => source.LoadAsync("../x", CancellationToken.None));

    Assert.Equal("INVALID_ARGS", refused.Code);
    Assert.IsType<JsonObject>(refused.Prebuilt);
  }

  // Node deletes a document's save chain once it settles, so ids seen once do not pile up.
  [Fact]
  public async Task KeepsNoSaveQueueOnceTheSavesSettle()
  {
    await Task.WhenAll(Enumerable.Range(0, 20).Select(i => source.SaveAsync($"doc{i}", "{\"blocks\":[]}", null, CancellationToken.None)));
    // A refused save leaves too.
    await Assert.ThrowsAsync<McpHostError>(() => source.SaveAsync("doc0", "{\"blocks\":[]}", null, CancellationToken.None));

    Assert.Equal(0, source.QueuedFiles);
  }
}
