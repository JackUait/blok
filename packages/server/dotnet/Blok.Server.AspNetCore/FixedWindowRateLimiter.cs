namespace Blok.Server.AspNetCore;

internal sealed class FixedWindowRateLimiter
{
  private static readonly TimeSpan WindowDuration = TimeSpan.FromMinutes(1);

  private readonly object _gate = new();
  private readonly long _requestsPerMinute;
  private readonly TimeProvider _timeProvider;
  private readonly Dictionary<string, Window> _windows = [];
  private DateTimeOffset _lastSweep;

  public FixedWindowRateLimiter(
      BlokServerOptions options,
      TimeProvider timeProvider)
  {
    _requestsPerMinute = options.RateLimitPerMinute;
    _timeProvider = timeProvider;
    _lastSweep = timeProvider.GetUtcNow();
  }

  public bool Allow(string key)
  {
    if (_requestsPerMinute <= 0)
    {
      return true;
    }

    lock (_gate)
    {
      var now = _timeProvider.GetUtcNow();

      Sweep(now);

      if (!_windows.TryGetValue(key, out var window) ||
          now - window.Start >= WindowDuration)
      {
        _windows[key] = new Window(now, 1);

        return true;
      }

      if (window.Count >= _requestsPerMinute)
      {
        return false;
      }

      window.Count++;

      return true;
    }
  }

  private void Sweep(DateTimeOffset now)
  {
    if (now - _lastSweep < WindowDuration)
    {
      return;
    }

    _lastSweep = now;

    foreach (var entry in _windows)
    {
      if (now - entry.Value.Start >= WindowDuration)
      {
        _windows.Remove(entry.Key);
      }
    }
  }

  private sealed class Window(DateTimeOffset start, long count)
  {
    public DateTimeOffset Start { get; } = start;

    public long Count { get; set; } = count;
  }
}
