using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Text;

namespace Blok.Server.Collab;

internal sealed class LocalCollabStore : ICollabWorkingSetStore
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
  private int modeWarned;

  private readonly string directory;
  private readonly Action<string>? log;

  internal LocalCollabStore(string directory, Action<string>? log = null)
  {
    this.directory = directory;
    this.log = log;
    SweepTemporaryFiles();
  }

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

          var stored = CollabWorkingSetLaw.DecodeOrAbsent(docId, document, log);

          if (stored is null)
          {
            MoveAside(docId, path);
          }

          return stored;
        },
        cancellationToken);
  }

  /// <summary>
  /// The header of an unreadable file may still be intact, and the write
  /// guard reads only the header: left in place, it would refuse every
  /// re-seed under a lower epoch and no API could recover the doc.
  /// </summary>
  /// <remarks>
  /// THIS DESTROYS <see cref="LocalCollabOperationStore"/>'S FAIL-CLOSED
  /// IMPORT. That store refuses to open a document whose working set does not
  /// decode, precisely so a damaged file is never served as a blank page and
  /// overwritten by the first edit. Once this rename has run it sees no file
  /// at all, seeds an empty document, and the guarantee is gone. So the
  /// operation store must open a document BEFORE anything calls
  /// <see cref="ReadAsync"/> on it.
  /// </remarks>
  private void MoveAside(string docId, string path)
  {
    var aside = $"{path}.unreadable-{DateTime.UtcNow:yyyyMMdd'T'HHmmssfff'Z'}";

    try
    {
      File.Move(path, aside);
      log?.Invoke(
          $"collab: moved the unreadable working set for \"{docId}\" to " +
          $"{Path.GetFileName(aside)}");
    }
    catch (Exception error)
    {
      log?.Invoke(
          $"collab: could not move the unreadable working set for \"{docId}\" " +
          $"aside: {error.Message}");
    }
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

    int descriptor;

    try
    {
      descriptor = Open(
          Encoding.UTF8.GetBytes(path + "\0"),
          ReadOnlyFlags);
    }
    catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException)
    {
      return;
    }

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
  /// ReplaceAtomicallyAsync deletes its own temp file on failure, so one
  /// still here belongs to a writer that died. Anything under a minute old
  /// may be mid-write by another process, and the sweep is best effort.
  /// </summary>
  private void SweepTemporaryFiles()
  {
    if (!Directory.Exists(directory))
    {
      return;
    }

    var cutoff = DateTime.UtcNow - TimeSpan.FromMinutes(1);

    try
    {
      foreach (var file in Directory.EnumerateFiles(directory, ".blok-collab-*"))
      {
        if (File.GetLastWriteTimeUtc(file) < cutoff)
        {
          File.Delete(file);
          log?.Invoke(
              $"collab: removed the orphaned temporary working-set file {Path.GetFileName(file)}");
        }
      }
    }
    catch (Exception error)
    {
      log?.Invoke(
          $"collab: could not sweep temporary working-set files: {error.Message}");
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
      TightenExistingDirectory();
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

  /// <summary>
  /// CreateDirectory leaves an existing directory's mode alone. chmod needs
  /// ownership, which a bind mount may not give this process, so a refusal
  /// is one warning, never a failed write.
  /// </summary>
  [System.Runtime.Versioning.UnsupportedOSPlatform("windows")]
  private void TightenExistingDirectory()
  {
    try
    {
      File.SetUnixFileMode(directory, PrivateDirectoryMode);
    }
    catch (UnauthorizedAccessException)
    {
      if (Interlocked.Exchange(ref modeWarned, 1) == 0)
      {
        log?.Invoke(
            $"collab: could not make \"{directory}\" private (this process does not own it); " +
            "its mode is left as found.");
      }
    }
  }

  private string PathFor(string docId)
  {
    return Path.Combine(directory, CollabDocKey.For(docId));
  }
}
