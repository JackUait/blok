using Blok.Server.Mcp.Core;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp.Protocol;

/// <summary>blok-mcp over stdio: one session, which stops when stdin ends or <c>stop</c> completes.</summary>
internal static class McpStdioSession
{
  internal static async Task RunAsync(McpServerCore core, McpServerOptions options, Stream input, Stream output, Task stop)
  {
    var answers = new McpAnswerTracker();

    answers.Install(options, core);
    // Wire order is known only while the transport reads, so calls take their handle places there.
    // At stdin's end the read stays open: the SDK would drop the answers still to come.
    var reader = new McpOrderedInput(input, core, holdAtEnd: true);

    // The reader holds its next line until these answers are written. No cancel can free one: a
    // cancel line is passed on only after the answer it names is out.
    options.Filters.Message.OutgoingFilters.Add(next => async (context, cancellationToken) =>
    {
      try
      {
        await next(context, cancellationToken);
      }
      finally
      {
        if (context.JsonRpcMessage is JsonRpcResponse or JsonRpcError)
        {
          reader.Answered(((JsonRpcMessageWithId)context.JsonRpcMessage).Id.ToString());
        }
      }
    });
    var transport = new StreamServerTransport(reader, new McpNodeBytesStream(output), "blok-mcp", NullLoggerFactory.Instance);
    var server = McpServer.Create(transport, options, NullLoggerFactory.Instance);
    var run = server.RunAsync(CancellationToken.None);

    // Node's stdin end stops the server as SIGTERM does (index.ts stopOnShutdown).
    await Task.WhenAny(run, stop, reader.Ended);
    if (!run.IsCompleted)
    {
      // Work first, then the transport: closing it first would drop the answers of calls in flight.
      var begun = DateTime.UtcNow;

      // Node answers what it read before it stops; here the SDK takes those lines a moment later.
      await answers.ReachedAsync(reader.RequestIds, core.StopDrain);
      await core.StopAsync();
      await answers.DrainAsync(core.StopDrain - (DateTime.UtcNow - begun) is { Ticks: > 0 } left ? left : TimeSpan.Zero);

      // A call that never ended would hold the transport's dispose, so the session ends here.
      return;
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
  }
}
