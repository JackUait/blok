using System.Diagnostics;
using Xunit;

namespace Blok.Server.Tests;

public sealed class TestHostThreadPoolTests
{
  [Fact]
  public async Task QueuedWorkStillRunsWhileEveryParallelTestSlotBlocksAPoolThread()
  {
    // xUnit runs one test per core, a synchronous test holds a pool thread
    // the whole time, and vstest parks two more pool threads for the run.
    // The blockers wait on a plain event: Task.Wait would make the pool add
    // threads for them, which Process.WaitForExit and CPU work do not.
    var blockers = Environment.ProcessorCount + 2;
    var release = new ManualResetEventSlim();
    var probe = new TaskCompletionSource<TimeSpan>();
    var started = 0;

    try
    {
      for (var index = 0; index < blockers; index++)
      {
        ThreadPool.UnsafeQueueUserWorkItem(
            _ =>
            {
              Interlocked.Increment(ref started);
              release.Wait(TimeSpan.FromSeconds(30));
            },
            null);
      }

      Assert.True(
          SpinWait.SpinUntil(
              () => Volatile.Read(ref started) == blockers,
              TimeSpan.FromSeconds(1)),
          $"only {Volatile.Read(ref started)} of {blockers} blocking work " +
          "items got a pool thread");

      var clock = Stopwatch.StartNew();
      ThreadPool.UnsafeQueueUserWorkItem(
          _ => probe.TrySetResult(clock.Elapsed),
          null);
      var waited = await probe.Task;
      Assert.True(
          waited < TimeSpan.FromSeconds(1),
          $"queued work waited {waited.TotalMilliseconds:F0} ms for a pool thread");
    }
    finally
    {
      release.Set();
    }
  }
}
