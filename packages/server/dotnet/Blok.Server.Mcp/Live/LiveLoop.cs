using System.Collections.Concurrent;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// One handle's event loop, like the JS one Node runs the room on: work posted
/// here runs one item at a time, and an await inside it resumes here. Every
/// touch of the room's doc, outbox and awareness happens on this loop.
/// </summary>
internal sealed class LiveLoop : SynchronizationContext
{
  private readonly ConcurrentQueue<(SendOrPostCallback Callback, object? State)> queue = new();
  private int pumping;

  internal bool IsCurrent => Current == this;

  public override void Post(SendOrPostCallback d, object? state)
  {
    queue.Enqueue((d, state));
    if (Interlocked.CompareExchange(ref pumping, 1, 0) == 0)
    {
      ThreadPool.UnsafeQueueUserWorkItem(_ => Pump(), null);
    }
  }

  public override void Send(SendOrPostCallback d, object? state)
  {
    throw new NotSupportedException("The live loop never runs work synchronously from another thread.");
  }

  public override SynchronizationContext CreateCopy()
  {
    return this;
  }

  internal void Post(Action action)
  {
    Post(static state => ((Action)state!)(), action);
  }

  /// <summary>Runs <paramref name="work"/> on the loop and hands its outcome back.</summary>
  internal Task<T> RunAsync<T>(Func<Task<T>> work)
  {
    var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);

    Post(async () =>
    {
      try
      {
        done.SetResult(await work());
      }
      catch (Exception error)
      {
        done.SetException(error);
      }
    });

    return done.Task;
  }

  internal Task RunAsync(Func<Task> work)
  {
    return RunAsync(async () =>
    {
      await work();

      return true;
    });
  }

  internal Task RunAsync(Action work)
  {
    return RunAsync(() =>
    {
      work();

      return Task.CompletedTask;
    });
  }

  /// <summary>A one-shot timer whose callback runs on the loop unless cancelled first.</summary>
  internal LiveTimer Schedule(TimeSpan delay, Action callback)
  {
    return new LiveTimer(this, delay, callback);
  }

  private void Pump()
  {
    var previous = Current;

    SetSynchronizationContext(this);
    try
    {
      while (true)
      {
        while (queue.TryDequeue(out var item))
        {
          try
          {
            item.Callback(item.State);
          }
          catch (Exception error)
          {
            Console.Error.WriteLine($"blok-mcp: live room work failed: {error}");
          }
        }
        Volatile.Write(ref pumping, 0);
        // A Post that saw pumping == 1 just before the reset relies on this pump.
        if (queue.IsEmpty || Interlocked.CompareExchange(ref pumping, 1, 0) != 0)
        {
          return;
        }
      }
    }
    finally
    {
      SetSynchronizationContext(previous);
    }
  }
}

/// <summary>A cancellable one-shot timer on a <see cref="LiveLoop"/>.</summary>
internal sealed class LiveTimer : IDisposable
{
  private readonly Timer timer;
  private bool cancelled;

  internal LiveTimer(LiveLoop loop, TimeSpan delay, Action callback)
  {
    timer = new Timer(_ => loop.Post(() =>
    {
      if (!cancelled)
      {
        cancelled = true;
        callback();
      }
    }), null, delay, Timeout.InfiniteTimeSpan);
  }

  /// <summary>Call on the loop: a tick already queued then does nothing.</summary>
  public void Dispose()
  {
    cancelled = true;
    timer.Dispose();
  }
}
