using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Protocol;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Server;

namespace Blok.Mcp;

/// <summary>blok-mcp over stdio: one session, which ends when stdin closes.</summary>
internal static class BlokMcpStdio
{
  internal static async Task<int> RunAsync(BlokMcpHost host, McpConfig config)
  {
    await using var core = new McpServerCore(host.Bundle, config, host.Http);
    var principal = config.PrincipalOrDefault;
    var options = await McpSdkServer.OptionsAsync(core, _ => new McpCallerIdentity(principal, null), CancellationToken.None);
    ILoggerFactory logs = NullLoggerFactory.Instance;
    await using var transport = new StdioServerTransport("blok-mcp", logs);
    await using var server = McpServer.Create(transport, options, logs);
    var stop = new CancellationTokenSource();

    Console.CancelKeyPress += (_, e) =>
    {
      e.Cancel = true;
      stop.Cancel();
    };
    AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Cancel();
    try
    {
      await server.RunAsync(stop.Token);
    }
    catch (OperationCanceledException)
    {
      // SIGINT or SIGTERM.
    }

    return 0;
  }
}
