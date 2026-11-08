using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Blok.Server.Mcp.Core;

/*
 * `--handle-store files:<dir>`: the reference handle store, for tests and for several blok-mcp
 * processes on one machine. It keeps Node's layout and lock protocol (src/mcp/handle-store-files.ts);
 * nobody points two languages at one directory, so the files need not interoperate.
 *
 *   <handle>.record.json   the record (BlokMcpHandleRecord.ToJson).
 *   <handle>.meta.json     {"v":1,"principal":"<principal>","lastUsedMs":<epoch ms>}; the handle exists while it does.
 *   <handle>.lease         a lock, held while the file exists. Its text is the holder's random token.
 *   principal-<sha256 hex of the principal>.lock
 *                          held while tryAdd counts and adds for that principal.
 *
 * Writes go to `.<name>.<12 hex>.tmp` and are renamed over the target. A lock is a file created
 * exclusively. One older than leaseStale (30 s) belongs to a dead holder: one breaker at a time
 * (`<lock>.break`) deletes it, and only if it still has the token and age seen. Blok renews a held
 * lease (touches it) every 5 s; the store has no timer. Renew, save, release and remove check the token first. The check
 * and the write are two steps, so a holder paused between them can still write once; the source's
 * version check is what keeps that from losing a save. Sweep also deletes crash leftovers.
 *
 * Privacy: records hold document text, undo steps and principals. At start, once: create the
 * directory (mode 0700), then refuse unless it is a directory, not a link, with no group or world
 * bits, owned by this user. Nothing creates it again later. Every file is created with mode 0600.
 */
internal sealed class FilesHandleStore : IBlokMcpHandleStore
{
  private static readonly TimeSpan PrincipalWait = TimeSpan.FromSeconds(10);
  private static readonly TimeSpan Poll = TimeSpan.FromMilliseconds(25);
  private const UnixFileMode PrivateFile = UnixFileMode.UserRead | UnixFileMode.UserWrite;
  private const UnixFileMode PrivateDir = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
  private const UnixFileMode GroupOrWorld =
      UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute
      | UnixFileMode.OtherRead | UnixFileMode.OtherWrite | UnixFileMode.OtherExecute;

  private readonly string dir;
  private readonly TimeSpan leaseStale;

  private FilesHandleStore(string dir, TimeSpan leaseStale)
  {
    this.dir = dir;
    this.leaseStale = leaseStale;
  }

  private static Regex HandlePattern() => SharedHandles.HandlePattern();

  /// <summary>What the directory check reads from the system; tests replace it.</summary>
  internal sealed record Probe(Func<string, Sources.NativePath.NativeStat?> LStat, Func<uint> EffectiveUserId, bool Windows)
  {
    internal static Probe System { get; } = new(Sources.NativePath.LStat, Sources.NativePath.EffectiveUserId, OperatingSystem.IsWindows());
  }

  /// <summary>Makes and checks the directory now; refuses with blok-mcp's words (exit 2).</summary>
  internal static FilesHandleStore Open(string dir, TimeSpan? leaseStale = null, Probe? probe = null)
  {
    probe ??= Probe.System;
    // No owner or mode bits to check there, so records would be open to whoever can read the folder.
    if (probe.Windows)
    {
      throw new BlokMcpConfigException("--handle-store files: is not supported on Windows; use your own store");
    }
    // A trailing slash would make the link check look at the target, not the link.
    var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));

    Prepare(dir, path, probe);

    return new FilesHandleStore(path, leaseStale ?? TimeSpan.FromSeconds(30));
  }

  // Another user who can read here sees documents; one who can write here could plant a record and take over a handle.
  // Made first, then checked once with one lstat, so nothing can swap it between the checks.
  private static void Prepare(string given, string path, Probe probe)
  {
    try
    {
      if (!Directory.Exists(path) && !File.Exists(path) && !OperatingSystem.IsWindows())
      {
        Directory.CreateDirectory(path, PrivateDir);
      }
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      throw new BlokMcpConfigException($"--handle-store cannot create {given}: {error.Message}");
    }
    var found = probe.LStat(path);

    if (found is not { } entry || (entry.Mode & Sources.NativePath.KindMask) != Sources.NativePath.DirectoryKind
        || (entry.Mode & (int)GroupOrWorld) != 0 || entry.Uid != probe.EffectiveUserId())
    {
      throw new BlokMcpConfigException(
          $"--handle-store directory {given} must be a directory (not a link) owned by this user, with no group or world access (chmod 700)");
    }
  }

  private string RecordPath(string handle) => Path.Combine(dir, $"{handle}.record.json");

  private string MetaPath(string handle) => Path.Combine(dir, $"{handle}.meta.json");

  private string LeasePath(string handle) => Path.Combine(dir, $"{handle}.lease");

  private string PrincipalLock(string principal) =>
      Path.Combine(dir, $"principal-{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(principal)))}.lock");

  private static string Token() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

  private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

  public async ValueTask<int> CountAsync(string principal, TimeSpan idleTimeout, CancellationToken cancellationToken)
  {
    var count = 0;

    foreach (var handle in Handles())
    {
      var meta = ParseMeta(await ReadTextAsync(MetaPath(handle), cancellationToken));

      if (meta is null || meta.Value.Principal != principal)
      {
        continue;
      }
      if (!Expired(meta.Value, idleTimeout) || !await ReapAsync(handle, idleTimeout, cancellationToken))
      {
        count++;
      }
    }

    return count;
  }

  public async ValueTask<bool> TryAddAsync(string handle, BlokMcpHandleRecord record, int maxPerPrincipal, TimeSpan idleTimeout, CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(record);
    if (!HandlePattern().IsMatch(handle))
    {
      throw new ArgumentException($"blok-mcp handle store: \"{handle}\" is not a handle", nameof(handle));
    }
    var lockPath = PrincipalLock(record.Principal);
    var mine = Token();

    if (!await TakeLockAsync(lockPath, mine, PrincipalWait, cancellationToken))
    {
      throw new IOException("blok-mcp handle store: another process holds the principal lock");
    }
    try
    {
      if (await ReadTextAsync(MetaPath(handle), cancellationToken) is not null)
      {
        throw new IOException($"blok-mcp handle store: handle {handle} is taken");
      }
      if (maxPerPrincipal <= 0 || await CountAsync(record.Principal, idleTimeout, cancellationToken) >= maxPerPrincipal)
      {
        return false;
      }
      // The record first, so a crash leaves at most a record nothing names.
      await WriteAtomicAsync(RecordPath(handle), record.ToJson(), cancellationToken);
      await WriteAtomicAsync(MetaPath(handle), Meta(record.Principal, NowMs()), cancellationToken);

      return true;
    }
    finally
    {
      await DropLockAsync(lockPath, mine);
    }
  }

  public async ValueTask<BlokMcpHandleAcquisition> AcquireAsync(string handle, TimeSpan idleTimeout, TimeSpan wait, CancellationToken cancellationToken)
  {
    if (!HandlePattern().IsMatch(handle) || await ReadTextAsync(MetaPath(handle), cancellationToken) is null)
    {
      return BlokMcpHandleAcquisition.Unknown;
    }
    var mine = Token();

    if (!await TakeLockAsync(LeasePath(handle), mine, wait, cancellationToken))
    {
      return BlokMcpHandleAcquisition.Busy;
    }
    try
    {
      var meta = ParseMeta(await ReadTextAsync(MetaPath(handle), cancellationToken));
      var text = meta is null ? null : await ReadTextAsync(RecordPath(handle), cancellationToken);

      if (meta is null || text is null || Expired(meta.Value, idleTimeout))
      {
        Forget(handle);
        await DropLockAsync(LeasePath(handle), mine);

        return BlokMcpHandleAcquisition.Unknown;
      }

      return BlokMcpHandleAcquisition.Leased(new Lease(this, handle, mine, BlokMcpHandleRecord.FromJson(text)));
    }
    catch
    {
      await DropLockAsync(LeasePath(handle), mine);
      throw;
    }
  }

  public async ValueTask SweepAsync(TimeSpan idleTimeout, CancellationToken cancellationToken)
  {
    foreach (var handle in Handles())
    {
      var meta = ParseMeta(await ReadTextAsync(MetaPath(handle), cancellationToken));

      if (meta is null || Expired(meta.Value, idleTimeout))
      {
        await ReapAsync(handle, idleTimeout, cancellationToken);
      }
    }
    // What a crash leaves: nothing refers to these once they are older than a lease can be.
    var names = Directory.EnumerateFiles(dir).Select(Path.GetFileName).OfType<string>().ToHashSet(StringComparer.Ordinal);

    foreach (var name in names.Where(name => Leftover(name, names)))
    {
      var path = Path.Combine(dir, name);

      if (File.Exists(path) && !Fresh(File.GetLastWriteTimeUtc(path)))
      {
        File.Delete(path);
      }
    }
  }

  // Files that belong to a handle's meta file.
  private static readonly string[] OwnedSuffixes = [".record.json", ".lease"];

  private static bool Leftover(string name, HashSet<string> names)
  {
    if (name.EndsWith(".tmp", StringComparison.Ordinal) || name.EndsWith(".break", StringComparison.Ordinal))
    {
      return true;
    }
    var owner = OwnedSuffixes.FirstOrDefault(suffix => name.EndsWith(suffix, StringComparison.Ordinal));

    return owner is not null && !names.Contains($"{name[..^owner.Length]}.meta.json");
  }

  private List<string> Handles()
  {
    const string Suffix = ".meta.json";

    return Directory.EnumerateFiles(dir, $"*{Suffix}")
        .Select(path => Path.GetFileName(path)[..^Suffix.Length])
        .Where(handle => HandlePattern().IsMatch(handle))
        .ToList();
  }

  // An expired handle goes only when nobody leases it; a free lease taken here is given back at once.
  private async Task<bool> ReapAsync(string handle, TimeSpan idleTimeout, CancellationToken cancellationToken)
  {
    var mine = Token();

    if (!await TakeLockAsync(LeasePath(handle), mine, TimeSpan.Zero, cancellationToken))
    {
      return false;
    }
    try
    {
      var meta = ParseMeta(await ReadTextAsync(MetaPath(handle), cancellationToken));

      if (meta is not null && !Expired(meta.Value, idleTimeout))
      {
        return false;
      }
      Forget(handle);

      return true;
    }
    finally
    {
      await DropLockAsync(LeasePath(handle), mine);
    }
  }

  private void Forget(string handle)
  {
    File.Delete(MetaPath(handle));
    File.Delete(RecordPath(handle));
  }

  private static bool Expired((string Principal, long LastUsedMs) meta, TimeSpan idleTimeout) =>
      NowMs() - meta.LastUsedMs > idleTimeout.TotalMilliseconds;

  private static string Meta(string principal, long lastUsedMs) =>
      McpJson.Write(new JsonObject { ["v"] = 1, ["principal"] = principal, ["lastUsedMs"] = lastUsedMs });

  private static (string Principal, long LastUsedMs)? ParseMeta(string? text)
  {
    if (text is null)
    {
      return null;
    }
    try
    {
      return McpJson.Parse(text) is JsonObject meta && McpJson.String(meta["principal"]) is { } principal && McpJson.Number(meta["lastUsedMs"]) is { } lastUsed
          ? (principal, (long)lastUsed)
          : null;
    }
    catch (System.Text.Json.JsonException)
    {
      return null;
    }
  }

  private static async Task<string?> ReadTextAsync(string path, CancellationToken cancellationToken)
  {
    try
    {
      return await File.ReadAllTextAsync(path, Encoding.UTF8, cancellationToken);
    }
    catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
    {
      return null;
    }
  }

  private async Task WriteAtomicAsync(string path, string text, CancellationToken cancellationToken)
  {
    var temp = Path.Combine(dir, $".{Path.GetFileName(path)}.{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6))}.tmp");

    try
    {
      await using (var file = CreateNew(temp))
      {
        await file.WriteAsync(Encoding.UTF8.GetBytes(text), cancellationToken);
      }
      File.Move(temp, path, overwrite: true);
    }
    catch
    {
      File.Delete(temp);
      throw;
    }
  }

  private static FileStream CreateNew(string path)
  {
    // .NET locks a file it opens with FileShare.None against its own readers; a lock here is the file existing, not a flock.
    var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.ReadWrite | FileShare.Delete };

    if (!OperatingSystem.IsWindows())
    {
      options.UnixCreateMode = PrivateFile;
    }

    return new FileStream(path, options);
  }

  private static async Task<bool> TryCreateAsync(string path, string mine)
  {
    try
    {
      await using var file = CreateNew(path);

      await file.WriteAsync(Encoding.UTF8.GetBytes(mine));

      return true;
    }
    // Taken, or let go between the create and a look: either way the caller tries again. A missing directory is an error.
    catch (IOException error) when (error is not DirectoryNotFoundException)
    {
      return false;
    }
  }

  private bool Fresh(DateTime writtenUtc) => DateTime.UtcNow - writtenUtc <= leaseStale;

  // One breaker at a time, and it deletes only the lock it saw go stale, never one taken since.
  private async Task<bool> BreakStaleAsync(string path, string? seen)
  {
    var guard = $"{path}.break";
    var mine = Token();

    if (!await TryCreateAsync(guard, mine))
    {
      if (File.Exists(guard) && !Fresh(File.GetLastWriteTimeUtc(guard)))
      {
        File.Delete(guard);
      }

      return false;
    }
    try
    {
      if (!File.Exists(path))
      {
        return true;
      }
      if (Fresh(File.GetLastWriteTimeUtc(path)) || await ReadTextAsync(path, CancellationToken.None) != seen)
      {
        return false;
      }
      File.Delete(path);

      return true;
    }
    finally
    {
      await DropLockAsync(guard, mine);
    }
  }

  private async Task<bool> TakeLockAsync(string path, string mine, TimeSpan timeout, CancellationToken cancellationToken)
  {
    var deadline = DateTime.UtcNow + timeout;

    while (true)
    {
      if (await TryCreateAsync(path, mine))
      {
        return true;
      }
      var seen = await ReadTextAsync(path, cancellationToken);

      if (File.Exists(path) && !Fresh(File.GetLastWriteTimeUtc(path)) && await BreakStaleAsync(path, seen))
      {
        continue;
      }
      if (DateTime.UtcNow >= deadline)
      {
        return false;
      }
      await Task.Delay(Poll, cancellationToken);
    }
  }

  private static async Task<bool> OwnsAsync(string path, string mine) => await ReadTextAsync(path, CancellationToken.None) == mine;

  private static async Task DropLockAsync(string path, string mine)
  {
    if (await OwnsAsync(path, mine))
    {
      File.Delete(path);
    }
  }

  private sealed class Lease(FilesHandleStore store, string handle, string mine, BlokMcpHandleRecord record) : IBlokMcpHandleLease
  {
    private bool ended;

    public BlokMcpHandleRecord Record { get; } = record;

    private string LeasePath => store.LeasePath(handle);

    public async ValueTask RenewAsync(CancellationToken cancellationToken)
    {
      await ThrowIfLostAsync();
      File.SetLastWriteTimeUtc(LeasePath, DateTime.UtcNow);
    }

    public async ValueTask SaveAsync(BlokMcpHandleRecord record, CancellationToken cancellationToken)
    {
      ArgumentNullException.ThrowIfNull(record);
      await ThrowIfLostAsync();
      await store.WriteAtomicAsync(store.RecordPath(handle), record.ToJson(), cancellationToken);
    }

    public async ValueTask ReleaseAsync(CancellationToken cancellationToken)
    {
      if (ended)
      {
        return;
      }
      ended = true;
      if (!await OwnsAsync(LeasePath, mine))
      {
        return;
      }
      if (ParseMeta(await ReadTextAsync(store.MetaPath(handle), cancellationToken)) is { } meta)
      {
        await store.WriteAtomicAsync(store.MetaPath(handle), Meta(meta.Principal, NowMs()), cancellationToken);
      }
      File.Delete(LeasePath);
    }

    public async ValueTask RemoveAsync(CancellationToken cancellationToken)
    {
      await ThrowIfLostAsync();
      ended = true;
      store.Forget(handle);
      File.Delete(LeasePath);
    }

    private async Task ThrowIfLostAsync()
    {
      if (ended || !await OwnsAsync(LeasePath, mine))
      {
        throw new IOException($"blok-mcp handle store: the lease on {handle} was lost");
      }
    }
  }
}
