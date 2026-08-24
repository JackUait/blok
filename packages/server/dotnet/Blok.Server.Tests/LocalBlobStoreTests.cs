using System.Text;
using Blok.Server.Storage;
using Xunit;

namespace Blok.Server.Tests;

public sealed class LocalBlobStoreTests : IDisposable
{
  private readonly string directory =
      Path.Combine(Path.GetTempPath(), $"blok-local-store-{Guid.NewGuid():N}");

  [Fact]
  public async Task StoresBytesUnderARandomKeyAndReturnsThePublicUrl()
  {
    var store = CreateStore();
    await using var content = new MemoryStream(Encoding.UTF8.GetBytes("stored bytes"));

    var url = await store.PutAsync(".PNG", "image/png", content, CancellationToken.None);

    var file = Assert.Single(Directory.GetFiles(directory));
    var key = Path.GetFileName(file);
    Assert.Matches("^[0-9a-f]{32}\\.png$", key);
    Assert.Equal($"https://cdn.example.com/files/{key}", url);
    Assert.Equal("stored bytes", await File.ReadAllTextAsync(file, CancellationToken.None));
  }

  [Theory]
  [InlineData("", "")]
  [InlineData(".A", ".a")]
  [InlineData(".AbC123", ".abc123")]
  [InlineData(".123456789012345", ".123456789012345")]
  [InlineData(".", "")]
  [InlineData(".1234567890123456", "")]
  [InlineData(".p ng", "")]
  [InlineData(".tar-gz", "")]
  [InlineData(".p/ng", "")]
  [InlineData(".p\\ng", "")]
  [InlineData(".p\0ng", "")]
  [InlineData("png", "")]
  [InlineData("../../evil.png", "")]
  public async Task KeepsOnlyABoundedAsciiAlphanumericExtension(
      string suppliedExtension,
      string expectedExtension)
  {
    var store = CreateStore();

    await store.PutAsync(
        suppliedExtension,
        "application/octet-stream",
        Stream.Null,
        CancellationToken.None);

    var key = Path.GetFileName(Assert.Single(Directory.GetFiles(directory)));
    Assert.Matches($"^[0-9a-f]{{32}}{RegexEscape(expectedExtension)}$", key);
  }

  [Fact]
  public async Task CreatesTheDestinationDirectoryOnFirstPut()
  {
    var store = CreateStore();

    await store.PutAsync(
        ".txt",
        "text/plain",
        new MemoryStream("bytes"u8.ToArray()),
        CancellationToken.None);

    Assert.True(Directory.Exists(directory));
    Assert.Single(Directory.GetFiles(directory));
  }

  [Fact]
  public async Task DoesNotPublishTheFinalNameBeforeTheCopyCompletes()
  {
    var store = CreateStore();
    await using var content = new PausingStream("partial bytes"u8.ToArray());
    var put = store.PutAsync(
        ".txt",
        "text/plain",
        content,
        CancellationToken.None);

    await content.WaitUntilPausedAsync();

    var inProgress = Assert.Single(Directory.GetFiles(directory));
    Assert.StartsWith(".blok-upload-", Path.GetFileName(inProgress), StringComparison.Ordinal);
    Assert.DoesNotMatch("^[0-9a-f]{32}\\.txt$", Path.GetFileName(inProgress));

    content.Resume();
    var url = await put;

    var completed = Assert.Single(Directory.GetFiles(directory));
    var key = Path.GetFileName(completed);
    Assert.Matches("^[0-9a-f]{32}\\.txt$", key);
    Assert.EndsWith($"/{key}", url, StringComparison.Ordinal);
  }

  [Fact]
  public async Task RemovesTheTemporaryFileWhenTheInputFails()
  {
    var store = CreateStore();
    await using var content = new FailingStream();

    var error = await Assert.ThrowsAsync<IOException>(
        () => store.PutAsync(
            ".txt",
            "text/plain",
            content,
            CancellationToken.None));

    Assert.Equal("connection reset", error.Message);
    Assert.Empty(Directory.GetFileSystemEntries(directory));
  }

  [Fact]
  public async Task RemovesTheTemporaryFileWhenTheCopyIsCancelled()
  {
    var store = CreateStore();
    using var cancellation = new CancellationTokenSource();
    await using var content = new CancellingStream(cancellation);

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => store.PutAsync(
            ".txt",
            "text/plain",
            content,
            cancellation.Token));

    Assert.Empty(Directory.GetFileSystemEntries(directory));
  }

  [Fact]
  public async Task StoresAWorldReadableFileWhereUnixModesAreSupported()
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    var store = CreateStore();

    await store.PutAsync(
        ".txt",
        "text/plain",
        new MemoryStream("bytes"u8.ToArray()),
        CancellationToken.None);

    var mode = File.GetUnixFileMode(Assert.Single(Directory.GetFiles(directory)));
    Assert.Equal(
        UnixFileMode.UserRead |
        UnixFileMode.UserWrite |
        UnixFileMode.GroupRead |
        UnixFileMode.OtherRead,
        mode & (UnixFileMode)Convert.ToInt32("777", 8));
  }

  [Fact]
  public async Task DeletesAnOwnedUrlAndTreatsAnAbsentOwnedFileAsDeleted()
  {
    var store = CreateStore();
    var url = await store.PutAsync(
        ".txt",
        "text/plain",
        new MemoryStream("bytes"u8.ToArray()),
        CancellationToken.None);

    await store.DeleteAsync(url + "?download=1#file", CancellationToken.None);
    await store.DeleteAsync(url, CancellationToken.None);

    Assert.Empty(Directory.GetFiles(directory));
  }

  [Theory]
  [MemberData(nameof(ForeignUrls))]
  public async Task RefusesForeignUrlsWithoutTouchingBystanderFiles(string url)
  {
    Directory.CreateDirectory(directory);
    var bystander = Path.Combine(directory, $"{new string('a', 32)}.txt");
    await File.WriteAllTextAsync(
        bystander,
        "bystander",
        CancellationToken.None);
    var store = CreateStore();

    await Assert.ThrowsAsync<ForeignBlobUrlException>(
        () => store.DeleteAsync(url, CancellationToken.None));

    Assert.Equal(
        "bystander",
        await File.ReadAllTextAsync(bystander, CancellationToken.None));
  }

  [Fact]
  public async Task ACancelledDeleteDoesNotRemoveTheFile()
  {
    var store = CreateStore();
    var url = await store.PutAsync(
        ".txt",
        "text/plain",
        new MemoryStream("bytes"u8.ToArray()),
        CancellationToken.None);
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();

    await Assert.ThrowsAnyAsync<OperationCanceledException>(
        () => store.DeleteAsync(url, cancellation.Token));

    Assert.Single(Directory.GetFiles(directory));
  }

  public static TheoryData<string> ForeignUrls
  {
    get
    {
      var key = $"{new string('a', 32)}.txt";

      return new TheoryData<string>
      {
        $"http://cdn.example.com/files/{key}",
        $"https://evil.example.com/files/{key}",
        $"https://cdn.example.com:444/files/{key}",
        $"https://cdn.example.com/other/{key}",
        $"https://cdn.example.com/files-confused/{key}",
        $"https://cdn.example.com/files/sub/{key}",
        $"https://cdn.example.com/files/../{key}",
        $"https://cdn.example.com/files/%2e%2e%2f{key}",
        $"https://cdn.example.com/files/{new string('A', 32)}.txt",
        $"https://cdn.example.com/files/{new string('g', 32)}.txt",
        $"https://cdn.example.com/files/{new string('a', 32)}.TXT",
        $"https://cdn.example.com/files/{new string('a', 32)}.tar-gz",
        $"https://cdn.example.com/files/{new string('a', 32)}.{new string('a', 16)}",
        $"https://cdn.example.com/files/{key}/",
      };
    }
  }

  public void Dispose()
  {
    if (Directory.Exists(directory))
    {
      Directory.Delete(directory, recursive: true);
    }
  }

  private LocalBlobStore CreateStore()
  {
    return new LocalBlobStore(directory, "https://cdn.example.com/files/");
  }

  private static string RegexEscape(string value)
  {
    return value.Replace(".", "\\.", StringComparison.Ordinal);
  }

  private abstract class AsyncReadStream : Stream
  {
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
      throw new NotSupportedException();
    }

    public abstract override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default);

    public override long Seek(long offset, SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(byte[] buffer, int offset, int count)
    {
      throw new NotSupportedException();
    }
  }

  private sealed class FailingStream : AsyncReadStream
  {
    private bool returnedBytes;

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (returnedBytes)
      {
        return ValueTask.FromException<int>(new IOException("connection reset"));
      }

      returnedBytes = true;
      "partial"u8.CopyTo(buffer.Span);

      return ValueTask.FromResult("partial"u8.Length);
    }
  }

  private sealed class CancellingStream(CancellationTokenSource cancellation) : AsyncReadStream
  {
    private bool returnedBytes;

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (returnedBytes)
      {
        return ValueTask.FromCanceled<int>(cancellationToken);
      }

      returnedBytes = true;
      "partial"u8.CopyTo(buffer.Span);
      cancellation.Cancel();

      return ValueTask.FromResult("partial"u8.Length);
    }
  }

  private sealed class PausingStream(byte[] bytes) : AsyncReadStream
  {
    private readonly TaskCompletionSource paused =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource resumed =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool returnedBytes;

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (returnedBytes)
      {
        paused.TrySetResult();
        await resumed.Task.WaitAsync(cancellationToken);

        return 0;
      }

      returnedBytes = true;
      bytes.CopyTo(buffer);

      return bytes.Length;
    }

    public Task WaitUntilPausedAsync()
    {
      return paused.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    public void Resume()
    {
      resumed.TrySetResult();
    }
  }
}
