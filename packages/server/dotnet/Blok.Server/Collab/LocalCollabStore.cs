using System.Runtime.ExceptionServices;

namespace Blok.Server.Collab;

internal sealed class LocalCollabStore(
    string directory,
    Action<string>? log = null) : ICollabWorkingSetStore
{
  // Working sets are private and never served, unlike LocalBlobStore's
  // uploads — no group/other bits on the files or the directory.
  private static readonly UnixFileMode PrivateFileMode =
      UnixFileMode.UserRead | UnixFileMode.UserWrite;
  private static readonly UnixFileMode PrivateDirectoryMode =
      UnixFileMode.UserRead |
      UnixFileMode.UserWrite |
      UnixFileMode.UserExecute;

  public async Task<CollabWorkingSet?> ReadAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    var path = PathFor(docId);

    if (Directory.Exists(path))
    {
      log?.Invoke(
          $"collab: the working-set path for \"{docId}\" is a " +
          "directory; treating it as absent");

      return null;
    }

    byte[] document;

    try
    {
      document = await File.ReadAllBytesAsync(path, cancellationToken);
    }
    catch (FileNotFoundException)
    {
      return null;
    }
    catch (DirectoryNotFoundException)
    {
      return null;
    }

    return CollabWorkingSetLaw.DecodeOrAbsent(docId, document, log);
  }

  public async Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(updates);

    var document = CollabWorkingSetCodec.EncodeDocument(tag, updates);
    CollabWorkingSetLaw.EnsureWriteDoesNotLowerEpoch(
        docId,
        await ReadAsync(docId, cancellationToken),
        tag);
    await ReplaceAtomicallyAsync(docId, document, cancellationToken);
  }

  public async Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    var document = CollabWorkingSetCodec.EncodeDocument(newTag, []);
    CollabWorkingSetLaw.EnsureResetRaisesEpoch(
        docId,
        await ReadAsync(docId, cancellationToken),
        newTag);
    await ReplaceAtomicallyAsync(docId, document, cancellationToken);
  }

  private async Task ReplaceAtomicallyAsync(
      string docId,
      byte[] document,
      CancellationToken cancellationToken)
  {
    if (OperatingSystem.IsWindows())
    {
      Directory.CreateDirectory(directory);
    }
    else
    {
      Directory.CreateDirectory(directory, PrivateDirectoryMode);
    }

    var finalPath = PathFor(docId);
    var temporaryPath = Path.Combine(
        directory,
        $".blok-collab-{Guid.NewGuid():N}");
    FileStream? temporaryFile = null;

    try
    {
      var fileOptions = new FileStreamOptions
      {
        Access = FileAccess.Write,
        Mode = FileMode.CreateNew,
        Options = FileOptions.Asynchronous,
        Share = FileShare.None,
      };

      if (!OperatingSystem.IsWindows())
      {
        fileOptions.UnixCreateMode = PrivateFileMode;
      }

      temporaryFile = new FileStream(temporaryPath, fileOptions);

      await temporaryFile.WriteAsync(document, cancellationToken);
      await temporaryFile.FlushAsync(cancellationToken);
      temporaryFile.Flush(flushToDisk: true);
      await temporaryFile.DisposeAsync();
      temporaryFile = null;
      cancellationToken.ThrowIfCancellationRequested();

      File.Move(temporaryPath, finalPath, overwrite: true);
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
          "collab: the working-set write failed and cleanup also failed.",
          [primaryError, .. cleanupErrors]);
    }
  }

  private string PathFor(string docId)
  {
    return Path.Combine(directory, CollabDocKey.For(docId));
  }
}
