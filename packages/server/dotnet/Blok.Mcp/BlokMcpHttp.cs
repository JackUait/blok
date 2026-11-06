using Blok.Server.Mcp.Core;

namespace Blok.Mcp;

internal static class BlokMcpHttp
{
  internal static Task<int> RunAsync(BlokMcpHost host, McpConfig config)
  {
    throw new NotSupportedException("--http is not built yet.");
  }
}
