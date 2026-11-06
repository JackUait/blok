using Blok.Server.Mcp.Outbound;
using Blok.Server.Runtime;

namespace Blok.Server.Mcp.Core;

/// <summary>The process-wide pieces: the runtime bundle and the outbound HTTP owner.</summary>
internal sealed class BlokMcpHost(McpBundle bundle, McpHttpCaller http)
{
  /*
   * Jint counts every byte a call allocates, not what it holds. A batch of 300 inserts of
   * 2000 characters needs between 750 and 775 MiB (measured), past the runtime's 512 MiB
   * default; Node takes it in about 0.1 s at 160 MB resident. 2 GiB leaves room over that
   * without letting one call run unbounded. MCP only: other runtime users keep the default.
   */
  internal const long AllocationBudgetBytes = 2L * 1024 * 1024 * 1024;

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
