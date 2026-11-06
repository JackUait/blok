using System.Collections.Concurrent;
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

  internal void Install(McpServerOptions options)
  {
    options.Filters.Message.IncomingFilters.Add(next => async (context, cancellationToken) =>
    {
      if (context.JsonRpcMessage is JsonRpcRequest request)
      {
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
      await next(context, cancellationToken);
      if (context.JsonRpcMessage is JsonRpcResponse or JsonRpcError)
      {
        Done(((JsonRpcMessageWithId)context.JsonRpcMessage).Id.ToString());
      }
    });
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
