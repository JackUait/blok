using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Sources;

/// <summary>
/// One JSON file per document id, as Node's files source. Saves of one file run one at
/// a time: a queue inside this process, then a lock file across processes, so the hash
/// check and the rename cannot interleave.
/// </summary>
internal sealed class FilesSource(string dir, McpBundle bundle) : IDocumentSource
{
  // A save holds the lock for one read, one small write and one rename, so an older lock was left by a dead process.
  private static readonly TimeSpan LockStale = TimeSpan.FromSeconds(30);
  private static readonly TimeSpan LockWait = TimeSpan.FromSeconds(2);
  private static readonly TimeSpan LockRetry = TimeSpan.FromMilliseconds(25);

  private readonly ConcurrentDictionary<string, SemaphoreSlim> queues = new(StringComparer.Ordinal);

  public string DocumentTextForm => "file";

  public bool CanList => true;

  internal static string Hash(byte[] bytes)
  {
    return Convert.ToHexStringLower(SHA256.HashData(bytes));
  }

  public async Task<LoadedDocument> LoadAsync(string documentId, CancellationToken cancellationToken)
  {
    var path = await PathOfAsync(documentId, cancellationToken);
    var bytes = ReadBytes(documentId, path);

    if (bytes is null)
    {
      // Throws for a link to a missing file, which a save would refuse.
      WriteTargetOf(documentId, path);

      return new LoadedDocument(new JsonObject { ["blocks"] = new JsonArray() }, null, Missing: true);
    }
    AssertExactName(documentId, path);
    var parsed = await bundle.CallAsync(
        "mcpParseDocument",
        new JsonObject { ["id"] = documentId, ["text"] = Encoding.UTF8.GetString(bytes) },
        cancellationToken);

    if (parsed["error"] is JsonObject error)
    {
      throw new McpHostError(error);
    }

    return new LoadedDocument(parsed["document"]!.DeepClone(), Hash(bytes));
  }

  public async Task<string?> SaveAsync(string documentId, string text, string? ifVersion, CancellationToken cancellationToken)
  {
    var path = await PathOfAsync(documentId, cancellationToken);
    var target = WriteTargetOf(documentId, path);
    // Keyed on the file written, so a link and its target share one queue and one lock.
    var queue = queues.GetOrAdd(SameFileKey(target), _ => new SemaphoreSlim(1, 1));

    await queue.WaitAsync(cancellationToken);
    try
    {
      var held = await LockAsync(documentId, target, cancellationToken);

      try
      {
        return SaveLocked(documentId, path, target, text, ifVersion);
      }
      finally
      {
        TryDelete(held);
      }
    }
    finally
    {
      queue.Release();
    }
  }

  public async Task<bool> SameDocumentAsync(string first, string second)
  {
    var a = await KeyOfAsync(first);
    var b = await KeyOfAsync(second);

    return a is not null && a == b;
  }

  public async Task<JsonObject> ListAsync(int limit, string? query, string? cursor, CancellationToken cancellationToken)
  {
    var names = ListNames();
    var ids = (await bundle.CallAsync("mcpFileIds", new JsonObject { ["names"] = new JsonArray([.. names.Select(name => (JsonNode)name)]) }, cancellationToken))["ids"]
        as JsonArray ?? [];
    var entries = new JsonArray();

    foreach (var id in ids.Select(node => McpJson.String(node) ?? string.Empty))
    {
      string? text;

      try
      {
        text = Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(dir, $"{id}.json")));
      }
      catch (Exception error) when (error is IOException or UnauthorizedAccessException)
      {
        text = null;
      }
      entries.Add(new JsonObject { ["id"] = id, ["text"] = text });
    }
    var input = new JsonObject { ["entries"] = entries, ["limit"] = limit };

    if (query is not null)
    {
      input["query"] = query;
    }
    if (cursor is not null)
    {
      input["cursor"] = cursor;
    }

    return await bundle.CallAsync("mcpFilesList", input, cancellationToken);
  }

  private static McpHostError Unavailable(string message, string path, object cause)
  {
    // The agent sees only `<id>.json`; the full path goes to stderr (stdout is the protocol).
    Console.Error.WriteLine($"blok-mcp files source: {message} ({path}): {cause}");

    return McpHostError.Surface("SOURCE_UNAVAILABLE", message);
  }

  private static McpHostError Changed()
  {
    return McpHostError.Surface("DOCUMENT_CHANGED", "The document changed on disk since you opened it. Read it again, then retry.");
  }

  // Lower case: on a case-insensitive disk `doc` and `DOC` are one file.
  private static string SameFileKey(string target)
  {
    return target.ToLowerInvariant();
  }

  // Null for an id that has no file key: one the id check or the disk refuses.
  private async Task<string?> KeyOfAsync(string documentId)
  {
    try
    {
      return SameFileKey(WriteTargetOf(documentId, await PathOfAsync(documentId, CancellationToken.None)));
    }
    catch (McpHostError)
    {
      return null;
    }
  }

  private static void TryDelete(string path)
  {
    try
    {
      File.Delete(path);
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      // Best effort, as Node's rm({ force: true }) ignores what it cannot remove.
    }
  }

  private static byte[]? ReadBytes(string documentId, string path)
  {
    try
    {
      return File.ReadAllBytes(path);
    }
    catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
    {
      return null;
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      throw Unavailable($"Cannot read {documentId}.json.", path, error.Message);
    }
  }

  private static FileSystemInfo? Lstat(string documentId, string path)
  {
    try
    {
      FileSystemInfo info = new FileInfo(path);

      if (!info.Exists && info.LinkTarget is null)
      {
        info = new DirectoryInfo(path);
        if (!info.Exists && info.LinkTarget is null)
        {
          return null;
        }
      }

      return info;
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      throw Unavailable($"Cannot read {documentId}.json.", path, error.Message);
    }
  }

  private async Task<string> PathOfAsync(string documentId, CancellationToken cancellationToken)
  {
    var checkedId = await bundle.CallAsync("mcpFileId", new JsonObject { ["id"] = documentId }, cancellationToken);

    if (checkedId["error"] is JsonObject error)
    {
      throw new McpHostError(error);
    }

    return Path.Combine(dir, $"{documentId}.json");
  }

  private string[] ListNames()
  {
    try
    {
      return [.. Directory.EnumerateFileSystemEntries(dir).Select(entry => Path.GetFileName(entry))];
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      throw Unavailable("Cannot list the documents directory.", dir, error.Message);
    }
  }

  /*
   * On a case-insensitive disk `SECRET` would open `secret.json` and slip past an
   * authorize hook that names `secret`. realpath gives the on-disk name; a mismatch is
   * a case alias or a symlink, and only a listing tells them apart. Runs after the read.
   */
  private void AssertExactName(string documentId, string path)
  {
    var name = $"{documentId}.json";
    var real = NativePath.RealPath(path);

    // For a link, realpath names the target, so a matching name proves nothing.
    if (real is null || (Path.GetFileName(real) == name && Lstat(documentId, path)?.LinkTarget is null))
    {
      return;
    }
    var names = ListNames();

    if (names.Contains(name, StringComparer.Ordinal))
    {
      return;
    }
    // Named from the listing, not realpath: that would name a symlink's target.
    var taken = names.FirstOrDefault(entry => string.Equals(entry.ToLowerInvariant(), name.ToLowerInvariant(), StringComparison.Ordinal));

    throw McpHostError.Surface("INVALID_ARGS", taken is null
        ? "Document ids are case-sensitive. Use the id exactly as listed."
        : $"{taken} already uses this name with different letter case. This disk ignores case, so the two ids cannot both exist.");
  }

  /*
   * The file a save replaces, fully resolved so every spelling of one file gives one
   * path. A symlinked document is written through to its target, so the link survives;
   * a link to a missing file is refused, not replaced.
   */
  private string WriteTargetOf(string documentId, string path)
  {
    var entry = Lstat(documentId, path);

    if (entry is null)
    {
      return Path.Combine(NativePath.RealPath(dir) ?? dir, Path.GetFileName(path));
    }
    var real = NativePath.RealPath(path);

    if (real is not null)
    {
      return real;
    }
    if (entry.LinkTarget is null)
    {
      return path;
    }

    throw Unavailable($"{documentId}.json is a link to a missing file.", path, "dangling link");
  }

  private async Task<string> LockAsync(string documentId, string target, CancellationToken cancellationToken)
  {
    var path = Path.Combine(Path.GetDirectoryName(target) ?? dir, $".{Path.GetFileName(target).ToLowerInvariant()}.lock");
    var deadline = DateTime.UtcNow + LockWait;

    while (true)
    {
      try
      {
        using (new FileStream(path, FileMode.CreateNew, FileAccess.Write))
        {
        }

        return path;
      }
      catch (IOException) when (File.Exists(path))
      {
        // Held: wait below.
      }
      catch (Exception error) when (error is IOException or UnauthorizedAccessException)
      {
        throw Unavailable($"Cannot write {documentId}.json.", path, error.Message);
      }
      DateTime? held;

      try
      {
        held = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : null;
      }
      catch (Exception error) when (error is IOException or UnauthorizedAccessException)
      {
        held = null;
      }
      // Not atomic: two waiters may both judge one lock stale. Rare, as it needs a crashed holder.
      if (held is DateTime mtime && DateTime.UtcNow - mtime > LockStale)
      {
        TryDelete(path);
        continue;
      }
      if (DateTime.UtcNow >= deadline)
      {
        throw Unavailable($"{documentId}.json is being saved by another process. Retry shortly.", path, "lock held");
      }
      await Task.Delay(LockRetry, cancellationToken);
    }
  }

  private string SaveLocked(string documentId, string path, string target, string text, string? ifVersion)
  {
    // A link pointed elsewhere since the target was resolved would be checked against one file and written to another.
    if (SameFileKey(WriteTargetOf(documentId, path)) != SameFileKey(target))
    {
      throw Changed();
    }
    var current = ReadBytes(documentId, path);

    if (current is not null)
    {
      AssertExactName(documentId, path);
    }
    if ((current is null ? null : Hash(current)) != ifVersion)
    {
      throw Changed();
    }
    var bytes = Encoding.UTF8.GetBytes(text);
    var folder = Path.GetDirectoryName(target) ?? dir;
    // Same folder as the target, so the rename stays on one filesystem and is atomic.
    var temp = Path.Combine(folder, $".{documentId}.{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6))}.tmp");

    try
    {
      UnixFileMode? mode = null;

      if (!OperatingSystem.IsWindows() && File.Exists(target))
      {
        mode = File.GetUnixFileMode(target);
      }
      using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write))
      {
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
      }
      // The umask filters a create mode, so set the original mode explicitly.
      if (mode is UnixFileMode kept && !OperatingSystem.IsWindows())
      {
        File.SetUnixFileMode(temp, kept);
      }
      File.Move(temp, target, overwrite: true);
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      TryDelete(temp);
      throw Unavailable($"Cannot write {documentId}.json.", path, error.Message);
    }
    NativePath.SyncDirectory(folder);

    return Hash(bytes);
  }
}
