using Blok.Server.Mcp.Outbound;
using Blok.Server.Runtime;

namespace Blok.Server.Mcp.Core;

/// <summary>The process-wide pieces: the runtime bundle and the outbound HTTP owner.</summary>
internal sealed class BlokMcpHost(McpBundle bundle, McpHttpCaller http)
{
  /*
   * Jint counts every byte a call allocates, not what it holds, and it cannot count what a
   * call holds: no per-engine retained size, only process-wide GC numbers. A batch of 2000-
   * character inserts churns about 2.2 MiB per insert, linearly (measured: 1300 pass at
   * 3 GiB; 5050, which fills stdio's 10 MiB message cap, fail at 10 GiB and pass at 12 GiB in
   * about 25 s). Node runs 3000 in about 1 s. 16 GiB covers the largest message either
   * transport takes, with room; the 60 s call timeout still bounds a call. MCP only: other
   * runtime users keep the default.
   */
  internal const long AllocationBudgetBytes = 16L * 1024 * 1024 * 1024;

  internal McpBundle Bundle { get; } = bundle;

  internal McpHttpCaller Http { get; } = http;

  internal static BlokMcpHost CreateRuntime(int poolSize = 2)
  {
    return new BlokMcpHost(new McpBundle(Runtime(poolSize)), new McpHttpCaller());
  }

  /// <summary>The runtime MCP calls run on, with its own allocation budget.</summary>
  internal static IBlokRuntime Runtime(int poolSize = 2)
  {
    return JintBlokRuntime.FromEmbeddedResource(poolSize, TimeSpan.FromSeconds(60), AllocationBudgetBytes);
  }
}
