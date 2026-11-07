using System.Runtime.InteropServices;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Protocol;

namespace Blok.Mcp;

/// <summary>blok-mcp over stdio: one session, which stops when stdin ends or on SIGINT/SIGTERM.</summary>
internal static class BlokMcpStdio
{
  internal static async Task<int> RunAsync(BlokMcpHost host, McpConfig config)
  {
    await using var core = new McpServerCore(host.Bundle, config, host.Http);
    var principal = config.PrincipalOrDefault;
    var options = await McpSdkServer.OptionsAsync(core, _ => new McpCallerIdentity(principal, null), CancellationToken.None);
    var stopping = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var signals = new List<PosixSignalRegistration>();

    // The first signal stops once. Its handlers go, so a second signal ends the process at once.
    void OnSignal(PosixSignalContext context)
    {
      context.Cancel = true;
      lock (signals)
      {
        signals.ForEach(registration => registration.Dispose());
        signals.Clear();
      }
      stopping.TrySetResult();
    }

    lock (signals)
    {
      signals.Add(PosixSignalRegistration.Create(PosixSignal.SIGTERM, OnSignal));
      signals.Add(PosixSignalRegistration.Create(PosixSignal.SIGINT, OnSignal));
    }
    await McpStdioSession.RunAsync(core, options, Console.OpenStandardInput(), Console.OpenStandardOutput(), stopping.Task);

    return 0;
  }
}
