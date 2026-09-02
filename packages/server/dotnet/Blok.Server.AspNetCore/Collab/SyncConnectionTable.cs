namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// Live sync connections: per (doc, principal), capped by
/// CollabMaxConnectionsPerUserPerDoc, and process-wide, capped by
/// CollabMaxConnections. Kestrel exposes no way to read its own upgraded
/// count, so the process-wide slot is counted here to refuse BEFORE a room
/// is seeded.
/// </summary>
internal sealed class SyncConnectionTable(BlokServerOptions options)
{
  private readonly Dictionary<(string Doc, string Principal), int> counts = [];
  private long live;

  /// <summary>Null when the process is at its ceiling; dispose the slot when the request ends.</summary>
  internal IDisposable? TryEnter()
  {
    var ceiling = options.CollabMaxConnections;

    if (Interlocked.Increment(ref live) > ceiling && ceiling > 0)
    {
      Interlocked.Decrement(ref live);

      return null;
    }

    return new Slot(this);
  }

  /// <summary>Null when the principal already holds the cap for this doc; dispose the lease to free the slot.</summary>
  internal IDisposable? TryReserve(string doc, string principal)
  {
    lock (counts)
    {
      var key = (doc, principal);
      counts.TryGetValue(key, out var count);

      if (count >= options.CollabMaxConnectionsPerUserPerDoc)
      {
        return null;
      }

      counts[key] = count + 1;
    }

    return new Lease(this, doc, principal);
  }

  private void Release(string doc, string principal)
  {
    lock (counts)
    {
      var key = (doc, principal);

      if (counts.TryGetValue(key, out var count) && count > 1)
      {
        counts[key] = count - 1;
      }
      else
      {
        counts.Remove(key);
      }
    }
  }

  private sealed class Slot(SyncConnectionTable owner) : IDisposable
  {
    private int released;

    public void Dispose()
    {
      if (Interlocked.Exchange(ref released, 1) == 0)
      {
        Interlocked.Decrement(ref owner.live);
      }
    }
  }

  private sealed class Lease(SyncConnectionTable owner, string doc, string principal) : IDisposable
  {
    private int released;

    public void Dispose()
    {
      if (Interlocked.Exchange(ref released, 1) == 0)
      {
        owner.Release(doc, principal);
      }
    }
  }
}
