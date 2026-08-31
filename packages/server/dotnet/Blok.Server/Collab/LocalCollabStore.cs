using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Text;

namespace Blok.Server.Collab;

internal sealed class LocalCollabStore(
    string directory,
    Action<string>? log = null) : ICollabWorkingSetStore
{
  // open(2) O_RDONLY; the same value on Linux and macOS.
  private const int ReadOnlyFlags = 0;

  // Working sets are private and never served, unlike LocalBlobStore's
  // uploads — no group/other bits on the files or the directory.
  private static readonly UnixFileMode PrivateFileMode =
      UnixFileMode.UserRead | UnixFileMode.UserWrite;
  private static readonly UnixFileMode PrivateDirectoryMode =
      UnixFileMode.UserRead |
      UnixFileMode.UserWrite |
      UnixFileMode.UserExecute;

  public Task<CollabWorkingSet?> ReadAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    return CollabWorkingSetLaw.GuardAsync(
        docId,
        "read",
        async () =>
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
        },
        cancellationToken);
  }

  public Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(updates);

    return CollabWorkingSetLaw.GuardAsync(
        docId,
        "write",
        async () =>
        {
          var document = CollabWorkingSetCodec.EncodeDocument(tag, updates);
          CollabWorkingSetLaw.EnsureWriteDoesNotLowerEpoch(
              docId,
              await ReadTagAsync(docId, cancellationToken),
              tag);
          await ReplaceAtomicallyAsync(docId, document, cancellationToken);
        },
        cancellationToken);
  }

  public Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    return CollabWorkingSetLaw.GuardAsync(
        docId,
        "reset",
        async () =>
        {
          var document = CollabWorkingSetCodec.EncodeDocument(newTag, []);
          CollabWorkingSetLaw.EnsureResetRaisesEpoch(
              docId,
              await ReadTagAsync(docId, cancellationToken),
              newTag);
          await ReplaceAtomicallyAsync(docId, document, cancellationToken);
        },
        cancellationToken);
  }

  // DllImport, not LibraryImport: the source generator emits unsafe code and
  // AllowUnsafeBlocks is off for the whole project.
#pragma warning disable SYSLIB1054
  // The path is marshalled by hand as NUL-terminated UTF-8 so no string
  // marshalling has to be declared.
  [DllImport("libc", EntryPoint = "open", ExactSpelling = true)]
  private static extern int Open(byte[] path, int flags);

  [DllImport("libc", EntryPoint = "fsync", ExactSpelling = true)]
  private static extern int Fsync(int descriptor);

  [DllImport("libc", EntryPoint = "close", ExactSpelling = true)]
  private static extern int Close(int descriptor);
#pragma warning restore SYSLIB1054

  /// <summary>
  /// The renamed file is only durable once the DIRECTORY entry itself is on
  /// disk; a crash in between can leave the doc with the pre-write file.
  /// There is no managed API for it, and Windows orders the metadata itself,
  /// so this is POSIX-only and best effort.
  /// </summary>
  private static void SyncDirectory(string path)
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    var descriptor = Open(
        Encoding.UTF8.GetBytes(path + "\0"),
        ReadOnlyFlags);

    if (descriptor < 0)
    {
      return;
    }

    try
    {
      _ = Fsync(descriptor);
    }
    finally
    {
      _ = Close(descriptor);
    }
  }

  /// <summary>
  /// Header only: the epoch guard runs on every write, and reading the whole
  /// log back to check 12 bytes is what made a keystroke cost two passes over
  /// the file.
  /// </summary>
  private async Task<CollabWorkingSet?> ReadTagAsync(
      string docId,
      CancellationToken cancellationToken)
  {
    var header = new byte[CollabWorkingSetCodec.HeaderLength];

    try
    {
      await using var file = new FileStream(
          PathFor(docId),
          new FileStreamOptions
          {
            Access = FileAccess.Read,
            Mode = FileMode.Open,
            Options = FileOptions.Asynchronous,
            Share = FileShare.Read,
          });
      await file.ReadExactlyAsync(header, cancellationToken);
    }
    catch (FileNotFoundException)
    {
      return null;
    }
    catch (DirectoryNotFoundException)
    {
      return null;
    }
    catch (UnauthorizedAccessException)
    {
      // The path is a directory; ReadAsync reports that, the guard just
      // treats it as absent.
      return null;
    }
    catch (EndOfStreamException)
    {
      return null;
    }

    return CollabWorkingSetCodec.TryDecodeHeader(header, out var tag, out _)
      ? new CollabWorkingSet([], tag)
      : null;
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
      SyncDirectory(directory);
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
