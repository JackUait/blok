namespace Blok.Server.Outbound;

/// <summary>
/// A lane of two slots per caller key in one fetcher pool, kept while anyone
/// holds or waits for one of its slots. A pool holds four, so one caller
/// cannot fill it alone.
/// </summary>
internal sealed class CallerLanes
{
  private const int FetchesPerCaller = 2;

  private readonly Dictionary<string, Lane> lanes = new(StringComparer.Ordinal);

  /// <summary>Takes one of key's slots, waiting until the token ends. No key has no lane.</summary>
  internal async ValueTask<IDisposable?> EnterAsync(string? key, CancellationToken cancellationToken)
  {
    if (string.IsNullOrEmpty(key))
    {
      return null;
    }

    Lane? lane;
    lock (lanes)
    {
      if (!lanes.TryGetValue(key, out lane))
      {
        lane = new Lane();
        lanes[key] = lane;
      }

      lane.Users++;
    }

    try
    {
      await lane.Slots.WaitAsync(cancellationToken);
    }
    catch
    {
      Leave(key, lane);
      throw;
    }

    return new Lease(this, key, lane);
  }

  private void Leave(string key, Lane lane)
  {
    lock (lanes)
    {
      if (--lane.Users == 0)
      {
        lanes.Remove(key);
        lane.Dispose();
      }
    }
  }

  private sealed class Lane : IDisposable
  {
    internal SemaphoreSlim Slots { get; } = new(FetchesPerCaller, FetchesPerCaller);

    internal int Users { get; set; }

    public void Dispose() => Slots.Dispose();
  }

  private sealed class Lease(CallerLanes owner, string key, Lane lane) : IDisposable
  {
    private int disposed;

    public void Dispose()
    {
      if (Interlocked.Exchange(ref disposed, 1) == 1)
      {
        return;
      }

      lane.Slots.Release();
      owner.Leave(key, lane);
    }
  }
}
