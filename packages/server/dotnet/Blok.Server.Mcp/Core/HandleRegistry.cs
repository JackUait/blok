using System.Security.Cryptography;

namespace Blok.Server.Mcp.Core;

/// <summary>
/// Open handles, as Node's HandleRegistry: one call at a time per handle, an idle
/// expiry and a cap per principal.
/// </summary>
internal sealed class HandleRegistry<TSession>(
    double idleMs,
    double maxPerPrincipal,
    Func<TSession, Task> onExpire,
    Func<long>? now = null,
    Func<string>? newHandle = null)
    where TSession : class
{
  private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
  private readonly Lock gate = new();
  private readonly Func<long> now = now ?? (() => Environment.TickCount64);
  private readonly Func<string> newHandle = newHandle ?? NewHandle;
  private bool closed;

  internal static McpHostError UnknownHandle()
  {
    return McpHostError.Surface("UNKNOWN_HANDLE", "No open document has this handle. It may have expired; call blok_open again.");
  }

  /// <summary>Throws when <see cref="Add"/> would refuse, so a caller refuses before opening.</summary>
  internal void AssertRoom(string principal)
  {
    lock (gate)
    {
      AssertRoomLocked(principal);
    }
  }

  internal string Add(string principal, string documentId, TSession session)
  {
    lock (gate)
    {
      // Again here: concurrent opens can pass AssertRoom together.
      AssertRoomLocked(principal);
      var handle = newHandle();

      entries[handle] = new Entry(principal, documentId, session, now());

      return handle;
    }
  }

  internal async Task<T> UseAsync<T>(string handle, string principal, Func<TSession, string, Task<T>> run)
  {
    Entry entry;

    lock (gate)
    {
      if (!entries.TryGetValue(handle, out var found) || found.Principal != principal)
      {
        throw UnknownHandle();
      }
      entry = found;
      entry.Busy += 1;
      entry.LastUsed = now();
    }

    try
    {
      await entry.Queue.WaitAsync();
      try
      {
        return await run(entry.Session, entry.DocumentId);
      }
      finally
      {
        entry.Queue.Release();
      }
    }
    finally
    {
      lock (gate)
      {
        entry.Busy -= 1;
        entry.LastUsed = now();
      }
    }
  }

  internal async Task<TSession> RemoveAsync(string handle, string principal)
  {
    Entry entry;

    lock (gate)
    {
      if (!entries.TryGetValue(handle, out var found) || found.Principal != principal)
      {
        throw UnknownHandle();
      }
      // New calls are refused before the accepted tail is awaited.
      entries.Remove(handle);
      entry = found;
    }
    await entry.Queue.WaitAsync();
    entry.Queue.Release();

    return entry.Session;
  }

  internal async Task<int> SweepAsync()
  {
    var cutoff = now() - (long)Math.Min(idleMs, long.MaxValue / 2);
    List<Entry> expired;

    lock (gate)
    {
      expired = [];
      foreach (var (handle, entry) in entries.ToArray())
      {
        if (entry.Busy != 0 || entry.LastUsed >= cutoff)
        {
          continue;
        }
        entries.Remove(handle);
        expired.Add(entry);
      }
    }

    var failures = new List<Exception>();

    foreach (var entry in expired)
    {
      try
      {
        await onExpire(entry.Session);
      }
      catch (Exception error)
      {
        failures.Add(error);
      }
    }
    if (failures.Count > 0)
    {
      throw new AggregateException(failures);
    }

    return expired.Count;
  }

  internal async Task CloseAllAsync(Func<TSession, Task> close)
  {
    Entry[] all;

    lock (gate)
    {
      closed = true;
      all = [.. entries.Values];
      entries.Clear();
    }
    await Task.WhenAll(all.Select(async entry =>
    {
      try
      {
        await entry.Queue.WaitAsync();
        entry.Queue.Release();
        await close(entry.Session);
      }
      catch (Exception error)
      {
        await Console.Error.WriteLineAsync($"blok-mcp: closing a handle failed: {error.Message}");
      }
    }));
  }

  internal int Count(string principal)
  {
    lock (gate)
    {
      return entries.Values.Count(entry => entry.Principal == principal);
    }
  }

  private void AssertRoomLocked(string principal)
  {
    if (closed)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The server is shutting down.");
    }
    if (entries.Values.Count(entry => entry.Principal == principal) >= maxPerPrincipal)
    {
      throw McpHostError.Surface(
          "HANDLE_LIMIT",
          $"You already have {McpNumbers.Format(maxPerPrincipal)} open documents. Close one with blok_close.");
    }
  }

  private static string NewHandle()
  {
    return Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
  }

  private sealed class Entry(string principal, string documentId, TSession session, long lastUsed)
  {
    internal string Principal { get; } = principal;

    internal string DocumentId { get; } = documentId;

    internal TSession Session { get; } = session;

    internal SemaphoreSlim Queue { get; } = new(1, 1);

    internal long LastUsed { get; set; } = lastUsed;

    internal int Busy { get; set; }
  }
}

internal static class McpNumbers
{
  /// <summary>A number as JS String() writes it, for the integers these options hold.</summary>
  internal static string Format(double value)
  {
    return value == Math.Floor(value) && Math.Abs(value) < 1e21
        ? value.ToString("0", System.Globalization.CultureInfo.InvariantCulture)
        : value.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
  }
}
