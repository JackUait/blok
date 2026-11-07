using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// Where the C# SDK's wire differs from Node's @modelcontextprotocol/server 2.4.0, these
/// filters make it answer as Node does (measured against the conformance fixtures).
/// </summary>
internal sealed class McpWireFilters
{
  private const string Legacy20241007 = "2024-10-07";
  private const string Latest2025 = "2025-11-25";

  // How the SDK words a request the client answered with an error. Only elicitation/create is ever sent.
  private const string RemoteFailure = "Request failed (remote)";

  // The initialize versions the C# SDK accepts; Node answers any other with 2025-11-25.
  private static readonly HashSet<string> Initializable = ["2024-11-05", "2025-03-26", "2025-06-18", Latest2025];

  private readonly ConcurrentDictionary<string, string> echoVersion = new(StringComparer.Ordinal);
  private long requestsSent = -1;

  internal void Install(McpServerOptions options)
  {
    options.Filters.Message.IncomingFilters.Add(next => async (context, cancellationToken) =>
    {
      // Node registers no logging capability; the SDK answers logging/setLevel itself.
      if (context.JsonRpcMessage is JsonRpcRequest { Method: "logging/setLevel" })
      {
        throw new ModelContextProtocol.McpProtocolException("Method not found", ModelContextProtocol.McpErrorCode.MethodNotFound);
      }
      Incoming(context.JsonRpcMessage);
      await next(context, cancellationToken);
    });
    options.Filters.Message.OutgoingFilters.Add(next => async (context, cancellationToken) =>
    {
      var replaced = Outgoing(context.JsonRpcMessage);

      await next(replaced is null ? context : new MessageContext(context.Server, replaced), cancellationToken);
    });
  }

  internal void Incoming(JsonRpcMessage message)
  {
    if (message is not JsonRpcRequest { Method: "initialize", Params: JsonObject parameters } request)
    {
      return;
    }
    var version = McpJson.String(parameters["protocolVersion"]);

    if (version is null || Initializable.Contains(version))
    {
      return;
    }
    // Node still lists 2024-10-07 and echoes it; the SDK knows only later versions.
    if (version == Legacy20241007)
    {
      echoVersion[request.Id.ToString()] = Legacy20241007;
      parameters["protocolVersion"] = "2024-11-05";

      return;
    }
    parameters["protocolVersion"] = Latest2025;
  }

  internal JsonRpcMessage? Outgoing(JsonRpcMessage message)
  {
    switch (message)
    {
      case JsonRpcResponse { Result: JsonObject result } response when result["serverInfo"] is not null:
        // Node registers tools and prompts only; the SDK adds logging.
        (result["capabilities"] as JsonObject)?.Remove("logging");
        if (result["protocolVersion"] is not null && echoVersion.TryRemove(response.Id.ToString(), out var echoed))
        {
          result["protocolVersion"] = echoed;
        }

        return null;
      // Node's SDK puts a progress token on every request it sends, counted from 0 per connection.
      case JsonRpcRequest { Params: JsonObject parameters }:
        var meta = parameters["_meta"] as JsonObject ?? [];

        meta["progressToken"] ??= Interlocked.Increment(ref requestsSent);
        parameters["_meta"] = meta;

        return null;
      // A 2025 stdio client refused elicitation/create: Node's SDK answers the tools/call with a tool error.
      case JsonRpcError error when error.Error.Message.StartsWith(RemoteFailure, StringComparison.Ordinal):
        return new JsonRpcResponse
        {
          Id = error.Id,
          Result = new JsonObject
          {
            ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = error.Error.Message }),
            ["isError"] = true,
          },
          Context = error.Context,
        };
      case JsonRpcError { Error.Code: -32601 } error when error.Error.Message != "Method not found":
        return new JsonRpcError
        {
          Id = error.Id,
          Error = new JsonRpcErrorDetail { Code = -32601, Message = "Method not found", Data = error.Error.Data },
          Context = error.Context,
        };
      default:
        return null;
    }
  }
}
