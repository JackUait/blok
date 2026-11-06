using System.Runtime.InteropServices;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Protocol;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Server;

namespace Blok.Mcp;

/// <summary>blok-mcp over stdio: one session, which ends when stdin closes or on SIGINT/SIGTERM.</summary>
internal static class BlokMcpStdio
{
  internal static async Task<int> RunAsync(BlokMcpHost host, McpConfig config)
  {
    await using var core = new McpServerCore(host.Bundle, config, host.Http);
    var principal = config.PrincipalOrDefault;
    var options = await McpSdkServer.OptionsAsync(core, _ => new McpCallerIdentity(principal, null), CancellationToken.None);
    var answers = new McpAnswerTracker();

    answers.Install(options);
    ILoggerFactory logs = NullLoggerFactory.Instance;
    var transport = new StdioServerTransport("blok-mcp", logs);
    var server = McpServer.Create(transport, options, logs);
    using var stop = new CancellationTokenSource();
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
    var run = server.RunAsync(stop.Token);

    await Task.WhenAny(run, stopping.Task);
    if (stopping.Task.IsCompleted)
    {
      // Work first, then the transport: closing it first would drop the answers of calls in flight.
      var begun = DateTime.UtcNow;

      await core.StopAsync();
      await answers.DrainAsync(core.StopDrain - (DateTime.UtcNow - begun) is { Ticks: > 0 } left ? left : TimeSpan.Zero);

      // A call that never ended would hold the transport's dispose, so the process ends here.
      return 0;
    }
    try
    {
      await run;
    }
    catch (OperationCanceledException)
    {
      // The transport ended.
    }
    await core.StopAsync();
    await server.DisposeAsync();
    await transport.DisposeAsync();

    return 0;
  }
}
