using Blok.Server.Mcp.Outbound;
using Blok.Server.Runtime;

namespace Blok.Server.Mcp.Core;

/// <summary>The process-wide pieces: the runtime bundle and the outbound HTTP owner.</summary>
internal sealed class BlokMcpHost(McpBundle bundle, McpHttpCaller http)
{
  internal McpBundle Bundle { get; } = bundle;

  internal McpHttpCaller Http { get; } = http;

  internal static BlokMcpHost CreateRuntime(int poolSize = 2)
  {
    return new BlokMcpHost(new McpBundle(JintBlokRuntime.FromEmbeddedResource(poolSize, TimeSpan.FromSeconds(60))), new McpHttpCaller());
  }
}
