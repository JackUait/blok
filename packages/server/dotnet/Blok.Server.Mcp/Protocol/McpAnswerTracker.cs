using System.Collections.Concurrent;
using Blok.Server.Mcp.Core;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// The client's requests that have no answer on the wire yet. Stop waits on these after the
/// calls end, because the SDK writes an answer a moment after its handler returns.
/// </summary>
internal sealed class McpAnswerTracker
{
  private readonly ConcurrentDictionary<string, TaskCompletionSource> open = new(StringComparer.Ordinal);
  // Every request id the SDK took or answered; it answers some (ping on 2026-07-28) before any filter.
  private readonly ConcurrentDictionary<string, bool> reached = new(StringComparer.Ordinal);

  // The tools/call ids seen, whose answers stdin's end silences.
  private readonly ConcurrentDictionary<string, bool> toolCalls = new(StringComparer.Ordinal);

  /// <summary>
  /// First in the list, so it is the outermost filter and sees every request. With a core, a
  /// tools/call answer due after stdin ended is not written: Node closes its transport at the
  /// end, though the calls it read still run.
  /// </summary>
  internal void Install(McpServerOptions options, McpServerCore? core = null)
  {
    options.Filters.Message.IncomingFilters.Insert(0, next => async (context, cancellationToken) =>
    {
      if (context.JsonRpcMessage is JsonRpcRequest request)
      {
        reached[request.Id.ToString()] = true;
        if (request.Method == RequestMethods.ToolsCall)
        {
          toolCalls[request.Id.ToString()] = true;
        }
        open.TryAdd(request.Id.ToString(), new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
      }
      // A cancelled request gets no answer.
      else if (context.JsonRpcMessage is JsonRpcNotification { Method: NotificationMethods.CancelledNotification } cancelled
          && cancelled.Params?["requestId"]?.ToString() is string id)
      {
        Done(id);
      }
      await next(context, cancellationToken);
    });
    options.Filters.Message.OutgoingFilters.Add(next => async (context, cancellationToken) =>
    {
      if (context.JsonRpcMessage is not (JsonRpcResponse or JsonRpcError))
      {
        await next(context, cancellationToken);

        return;
      }
      var id = ((JsonRpcMessageWithId)context.JsonRpcMessage).Id.ToString();

      if (!(core?.InputEnded == true && toolCalls.ContainsKey(id)))
      {
        await next(context, cancellationToken);
      }
      reached[id] = true;
      Done(id);
    });
  }

  /// <summary>Waits until the SDK has taken or answered each of these requests, or the time is up.</summary>
  internal async Task ReachedAsync(IEnumerable<string> ids, TimeSpan limit)
  {
    var deadline = DateTime.UtcNow + limit;

    while (!ids.All(reached.ContainsKey) && DateTime.UtcNow < deadline)
    {
      await Task.Delay(5);
    }
  }

  /// <summary>Waits until every request seen so far is answered, or the time is up.</summary>
  internal async Task DrainAsync(TimeSpan limit)
  {
    var pending = open.Values.Select(waiter => waiter.Task).ToArray();

    await Task.WhenAny(Task.WhenAll(pending), Task.Delay(limit));
  }

  private void Done(string id)
  {
    if (open.TryRemove(id, out var waiter))
    {
      waiter.TrySetResult();
    }
  }
}
