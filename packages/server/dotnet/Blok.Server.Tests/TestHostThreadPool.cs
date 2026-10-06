using System.Runtime.CompilerServices;

namespace Blok.Server.Tests;

internal static class TestHostThreadPool
{
  // Worst case, every parallel test slot (one per core) blocks a pool thread,
  // and so does every blocker that TestHostThreadPoolTests adds. vstest parks
  // two more, and async I/O still needs spare threads. The default minimum is
  // one per core. Below this count, async I/O waits for the pool's slow thread
  // injection, so short fetch budgets in other tests run out.
  [ModuleInitializer]
  internal static void RaiseMinimumWorkerThreads()
  {
    ThreadPool.GetMinThreads(out var workers, out var completionPorts);
    ThreadPool.SetMinThreads(
        Math.Max(workers, (2 * Environment.ProcessorCount) + 8),
        completionPorts);
  }
}
