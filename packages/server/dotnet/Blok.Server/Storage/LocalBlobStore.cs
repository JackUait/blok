using System.Runtime.ExceptionServices;

namespace Blok.Server.Storage;

internal sealed class LocalBlobStore(
    string directory,
    string publicUrl) : IBlobStore
{
  private const int CopyBufferSize = 81920;
  private static readonly UnixFileMode ServedFileMode =
      UnixFileMode.UserRead |
      UnixFileMode.UserWrite |
      UnixFileMode.GroupRead |
      UnixFileMode.OtherRead;

  private readonly string publicUrl = publicUrl.TrimEnd('/');

  public async Task<string> PutAsync(
      string extension,
      string mimeType,
      Stream content,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(extension);
    ArgumentNullException.ThrowIfNull(mimeType);
    ArgumentNullException.ThrowIfNull(content);

    Directory.CreateDirectory(directory);

    var key = BlobKey.Create(extension);
    var finalPath = Path.Combine(directory, key);
    var temporaryPath = Path.Combine(directory, $".blok-upload-{Guid.NewGuid():N}");
    var url = $"{publicUrl}/{key}";
    FileStream? temporaryFile = null;

    try
    {
      var fileOptions = new FileStreamOptions
      {
        Access = FileAccess.Write,
        BufferSize = CopyBufferSize,
        Mode = FileMode.CreateNew,
        Options = FileOptions.Asynchronous,
        Share = FileShare.None,
      };

      if (!OperatingSystem.IsWindows())
      {
        fileOptions.UnixCreateMode =
            UnixFileMode.UserRead | UnixFileMode.UserWrite;
      }

      temporaryFile = new FileStream(temporaryPath, fileOptions);

      await content.CopyToAsync(
          temporaryFile,
          CopyBufferSize,
          cancellationToken);
      await temporaryFile.FlushAsync(cancellationToken);
      temporaryFile.Flush(flushToDisk: true);
      cancellationToken.ThrowIfCancellationRequested();

      if (!OperatingSystem.IsWindows())
      {
        File.SetUnixFileMode(temporaryPath, ServedFileMode);
      }

      await temporaryFile.DisposeAsync();
      temporaryFile = null;
      cancellationToken.ThrowIfCancellationRequested();

      File.Move(temporaryPath, finalPath);

      return url;
    }
    catch (Exception primaryError)
    {
      var cleanupErrors = new List<Exception>();

      if (temporaryFile is not null)
      {
        try
        {
          await temporaryFile.DisposeAsync();
        }
        catch (Exception cleanupError)
        {
          cleanupErrors.Add(cleanupError);
        }
      }

      try
      {
        File.Delete(temporaryPath);
      }
      catch (Exception cleanupError)
      {
        cleanupErrors.Add(cleanupError);
      }

      if (cleanupErrors.Count == 0)
      {
        ExceptionDispatchInfo.Capture(primaryError).Throw();
      }

      throw new AggregateException(
          "Blob write failed and cleanup also failed.",
          [primaryError, .. cleanupErrors]);
    }
  }

  public Task DeleteAsync(
      string url,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(url);
    cancellationToken.ThrowIfCancellationRequested();

    if (!BlobKey.TryParsePublicUrl(publicUrl, url, out var key))
    {
      throw new ForeignBlobUrlException(url);
    }

    File.Delete(Path.Combine(directory, key));

    return Task.CompletedTask;
  }
}
